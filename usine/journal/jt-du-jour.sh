#!/bin/bash
# 🎬 LE JOURNAL DE FREEWORLD TV — la journée du hub (service systemd freeworld-jt, lancé chaque matin par son timer).
#   1) attendre la COMMANDE du jour (publiée par le générateur, signée par sa clé) jusqu'à JT_ATTENTE_FIN UTC ;
#   2) planif.py la relit comme une entrée étrangère et prépare le travail d'usine ;
#   3) orchestre.sh le fabrique sur machines INTERRUPTIBLES (H100/H200), reprise sur une autre si le loueur reprend ;
#   4) montage.py monte le Journal dans une unité systemd BORNÉE (CPUQuota=200 %, MemoryMax=2G : condition DATASPACE) ;
#   5) la vidéo et l'affiche vont sur la forge (locale), dont le CID est attendu ;
#   6) le RÉSULTAT signé part sur les relais : le générateur met le Journal à l'antenne à 19:30 UTC. Sinon, le JT
#      habituel en images garde le canal 1 ce soir-là — l'antenne n'est jamais vide.
# Toute anomalie part sur le canal d'alerte. Un fichier PAUSE à côté de ce script arrête tout (le fondateur garde la main).
#
#   jt-du-jour.sh [AAAA-MM-JJ]                  (défaut : aujourd'hui, UTC)
#   JT_ESSAI=1 jt-du-jour.sh AAAA-MM-JJ         ESSAI : commande posée à la main dans jours/<date>-essai/jt.json,
#                                               tout est fabriqué et monté, RIEN n'est publié (ni résultat, ni antenne)
set -u
ICI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DATE=${1:-$(date -u +%F)}
ESSAI=${JT_ESSAI:-0}; SUFFIXE=""; [ "$ESSAI" = 1 ] && SUFFIXE="-essai"
J="$ICI/jours/$DATE$SUFFIXE"; T="$J/travail"; mkdir -p "$J"
NODE=${JT_NODE:-/opt/node22/bin/node}
ALERTE=${USINE_ALERTE:-/opt/nostr-relay-platform/scripts/alerte-canal.sh}
FORGE=${JT_FORGE:-http://127.0.0.1:5400}
ATTENTE_FIN=${JT_ATTENTE_FIN:-09:00}
LOCATION_FIN=${JT_LOCATION_FIN:-11:00}         # après, une machine louée finirait trop tard pour le soir
BUDGET_JOUR_MAX=${JT_BUDGET_JOUR_MAX:-12}
# 1 à 4 cartes : vast.py juge chaque offre au coût du TRAVAIL (une machine à N cartes anime N fois plus vite, cf. animer.sh).
FILTRE=${JT_FILTRE:-'{"gpu_ram":{"gte":79000},"compute_cap":{"gte":900,"lte":900},"cpu_ram":{"gte":128000},"num_gpus":{"gte":1,"lte":4}}'}
journal() { echo "$(date -u +%FT%TZ) $*" | tee -a "$J/ETAT"; }
alerte() { [ -x "$ALERTE" ] && "$ALERTE" "$1" "$2" "${3:-default}" >/dev/null 2>&1 || true; }
echec() { journal "🔴 $1"; alerte "Journal Freeworld $DATE$SUFFIXE : $1" "${2:-Voir $J/ETAT sur le hub.}" "${3:-default}"; exit 1; }
[ -f "$ICI/PAUSE" ] && { journal "PAUSE : aucun Journal aujourd'hui ($ICI/PAUSE)"; exit 0; }
[ -f "$J/resultat.json" ] && { journal "déjà fait aujourd'hui (résultat présent)"; exit 0; }
journal "DEBUT du Journal du $DATE"

# ── 1) La commande du jour ──
if [ "$ESSAI" = 1 ]; then
  [ -f "$J/jt.json" ] || echec "essai : poser d'abord la commande dans $J/jt.json"
  journal "ESSAI : commande posée à la main, rien ne sera publié"
else
  while :; do
    "$NODE" "$ICI/nostr-jt.mjs" commande "$DATE" "$J/jt.json" >> "$J/ETAT" 2>&1; c=$?
    [ $c = 0 ] && break
    [ $c = 2 ] || echec "commande du jour illisible ou refusée (code $c)"
    [ "$(date -u +%H:%M)" \< "$ATTENTE_FIN" ] || echec "aucune commande reçue avant $ATTENTE_FIN UTC" \
      "Le générateur n'a rien publié ce matin : le JT habituel en images gardera le canal 1 ce soir."
    sleep 300
  done
fi

# ── 2) Le travail d'usine (les résultats d'un passage précédent du même jour sont gardés : reprise) ──
python3 "$ICI/planif.py" "$J/jt.json" "$T" >> "$J/ETAT" 2>&1 || echec "commande refusée par le planificateur" "$(tail -1 "$J/ETAT")"
read -r MOTS HEURES BM BT ECH ANIM FIXE <<<"$(python3 - "$T" "$BUDGET_JOUR_MAX" <<'PY'
import json, sys
reps = json.load(open(f"{sys.argv[1]}/entrees/repliques.json", encoding="utf-8"))
mots = sum(len(r["texte"].split()) for r in reps)
# Heures de carte : 0,36 s de parole par mot (Chatterbox) × ~31 s de calcul H100 par seconde de vidéo (15/09), marge
# 25 %, + ~35 min d'installation et de téléchargements — au dixième d'heure : arrondi à l'heure, le 1er essai réel
# (15/09) se croyait à 2 h et n'entrait plus dans son budget.
heures = max(1.0, round(mots * 0.36 * 31 / 3600 * 1.25 + 0.6, 1))
# Le pire cas d'une machine : jusqu'à 1,8 $/h (enchère H100 du 15/09 après-midi : 1,54 $/h), + ~1 $ de bande passante et
# de disque. ⚠️ Le moins cher à l'heure (0,76 $/h) facturait 0,038 $/Go : 5,66 $ rien que pour télécharger les modèles.
machine = round(heures * 1.8 + 1.0, 1)
total = min(float(sys.argv[2]), round(machine * 1.6, 1))
# Une machine à N cartes (vast.py, animer.sh) : la part qui se PARTAGE entre les cartes — l'animation — et celle qui ne se
# partage pas — installation, voix, images : elle compte FIXE + ANIM / N heures. Le budget reste celui d'une carte seule.
anim = round(mots * 0.36 * 31 / 3600 * 1.25, 2)
print(mots, heures, min(machine, total), total, int(heures * 60 + 60), anim, 0.6)
PY
)"
journal "travail : $MOTS mots, ~$HEURES h de carte (dont $ANIM h d'animation, partagées entre les cartes), budget $BM \$ par machine et $BT \$ au plus pour la journée"

# ── 3) La fabrication, sur machines interruptibles ──
for essai in 1 2 3; do
  USINE_DOSSIER="$T" USINE_ETIQUETTE="usine-jt$SUFFIXE-$DATE" USINE_INTERRUPTIBLE=1 USINE_REPRISES=4 \
  USINE_BUDGET="$BM" USINE_BUDGET_TOTAL="$BT" USINE_HEURES="$HEURES" USINE_ANIM_H="$ANIM" USINE_FIXE_H="$FIXE" USINE_GO=150 USINE_DISQUE=300 \
  USINE_ECHEANCE_MIN="$ECH" USINE_ECHEANCE_TOTALE_MIN=${JT_ECHEANCE_TOTALE_MIN:-720} USINE_FILTRE="$FILTRE" \
    bash "$ICI/../orchestre.sh" >> "$J/usine.log" 2>&1
  [ -f "$T/resultats/FINI" ] && break
  grep -q "ABANDON : pas de location\|ABANDON : 3 hôtes" "$T/ETAT" 2>/dev/null || break   # une autre fin : ne pas insister
  [ "$(date -u +%H:%M)" \< "$LOCATION_FIN" ] || break
  journal "aucune machine interruptible ($essai/3) : nouvel essai dans 30 min"; sleep 1800
done
N=$(ls "$T"/resultats/clips/*.mp4 2>/dev/null | wc -l)
[ "$N" -gt 0 ] || echec "aucun plan fabriqué" "$(tail -3 "$T/ETAT" 2>/dev/null)"
journal "usine : $N plan(s) rendus ($(tail -1 "$T/ETAT" | cut -c1-160))"

# ── 4) Le montage, dans une unité systemd bornée ──
rm -f "$J/montage.log"
systemd-run --wait --collect --quiet --unit "freeworld-jt-montage-$DATE" \
  -p CPUQuota=200% -p MemoryMax=2G -p Nice=19 -p IOWeight=20 -p PrivateTmp=yes \
  -p StandardOutput="append:$J/montage.log" -p StandardError="append:$J/montage.log" \
  --setenv=JT_HABILLAGE="$ICI/habillage" /usr/bin/python3 "$ICI/montage.py" "$T" || echec "montage en échec" "$(tail -3 "$J/montage.log")"
journal "montage : $(tail -1 "$J/montage.log" | cut -c1-200)"

# ── 5) La forge : vidéo, affiche, CID (la clé de service ne passe jamais en argument) ──
HDR=$(mktemp); chmod 600 "$HDR"; trap 'rm -f "$HDR"' EXIT
printf 'Authorization: Bearer %s\n' "$(grep -m1 '^WAF_API_KEYS=' /opt/forge3d/.env | cut -d= -f2- | tr -d '"' | cut -d, -f1)" > "$HDR"
depose() { curl -sf --max-time 600 -H @"$HDR" -F "file=@$1;type=$2" -F "prompt=$3" "$FORGE/api/v1/upload"; }
V=$(depose "$T/journal.mp4" video/mp4 "Le Journal de Freeworld TV — $DATE") || echec "dépôt de la vidéo refusé par la forge"
A=$(depose "$T/affiche.jpg" image/jpeg "Affiche du Journal de Freeworld TV — $DATE") || A='{}'
champ() { python3 -c "import json,sys; print((json.loads(sys.argv[1] or '{}')).get(sys.argv[2]) or '')" "$1" "$2"; }
VID=$(champ "$V" id); AID=$(champ "$A" id)
echo "{\"date\":\"$DATE\",\"ids\":[\"$VID\"$([ -n "$AID" ] && echo ",\"$AID\"")]}" >> "$ICI/depots.jsonl"
CID=""
for i in $(seq 1 40); do   # l'épinglage IPFS se fait en arrière-plan ; sans CID, le Journal part avec l'adresse de la forge
  CID=$(champ "$(curl -sf -H @"$HDR" "$FORGE/api/v1/assets/$VID")" ipfs); [ -n "$CID" ] && break; sleep 15
done
journal "forge : vidéo $VID ${CID:+(CID ${CID:0:14}…)}${CID:-(pas encore de CID)}"

# ── 6) Le résultat signé, pour le générateur ──
python3 - "$T/chapitres.json" "$V" "$A" "$CID" > "$J/resultat.tmp" <<'PY' || echec "résultat impossible à écrire"
import json, sys
ch, v, a = json.load(open(sys.argv[1])), json.loads(sys.argv[2]), json.loads(sys.argv[3] or "{}")
r = {"blossomUrl": v["url"], "durationSec": ch["durationSec"], "segments": ch["segments"]}
if sys.argv[4]:
    r["videoCid"] = sys.argv[4]
if a.get("url"):
    r["poster"] = a.get("ipfs") or a["url"]
print(json.dumps(r, ensure_ascii=False))
PY
if [ "$ESSAI" = 1 ]; then
  mv "$J/resultat.tmp" "$J/resultat.json"; journal "ESSAI : résultat écrit et PAS publié ($J/resultat.json)"
else
  "$NODE" "$ICI/nostr-jt.mjs" resultat "$DATE" "$J/resultat.tmp" >> "$J/ETAT" 2>&1 || echec "résultat non publié sur les relais"
  mv "$J/resultat.tmp" "$J/resultat.json"
fi
MANQUE=$(python3 -c "import json; print(', '.join(json.load(open('$T/chapitres.json'))['manquants']))")
SIGNALEES=$(python3 - "$T/resultats/images/controle.jsonl" 2>/dev/null <<'PY'
import json, sys
for ligne in open(sys.argv[1], encoding="utf-8"):
    d = json.loads(ligne)
    fautes = [k for k in ("humain", "texte", "decoupe", "interdit", "reporter", "melange") if d.get(k) is True]
    if fautes:
        print(f"{d['cle']} ({', '.join(fautes)})", end=" ")
PY
)
[ -n "$MANQUE$SIGNALEES" ] && alerte "Journal Freeworld $DATE$SUFFIXE : à regarder" "Plans manquants : ${MANQUE:-aucun}. Images signalées : ${SIGNALEES:-aucune}." default
journal "✅ Journal du $DATE prêt et annoncé au générateur ($(python3 -c "import json; print(round(json.load(open('$T/chapitres.json'))['durationSec'] / 60, 1))") min)"
