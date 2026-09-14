#!/bin/bash
# 🏭 USINE DE NUIT — orchestrateur générique (tourne DÉTACHÉ sur le hub, sous systemd).
# Loue, lance, suit, rapatrie, puis DÉTRUIT — toujours — et vérifie la disparition.
#
#   USINE_DOSSIER=/root/usine/<travail> USINE_ETIQUETTE=usine-<travail> bash usine/orchestre.sh
#
# Le dossier du travail contient `travail.sh` (exécuté sur la machine louée) et `entrees/` (copié tel
# quel, sous-dossiers compris). Les résultats reviennent dans `$USINE_DOSSIER/resultats/`.
# Réglages (voir vast.py) : USINE_BUDGET, USINE_HEURES, USINE_GO, USINE_DISQUE, USINE_FILTRE,
# USINE_IMAGE, USINE_CREDIT_MIN ; ici : USINE_ECHEANCE_MIN (défaut 120), USINE_DEMARRAGE_MAX (900 s).
#
# Garanties, apprises à nos dépens (14/09/2026 et avant) :
#   · un FILET systemd indépendant détruit la machine même si ce script meurt (kill -9) ;
#   · ce script détruit à sa sortie, quelle qu'elle soit (trap EXIT), et VÉRIFIE ;
#   · un hôte qui n'ouvre pas son SSH à temps est exclu et remplacé (3 hôtes au plus) ;
#   · la surveillance est tenue par le HUB, jamais par un poste qui peut s'endormir ;
#   · toute anomalie (crédit, abandon, destruction non confirmée) part sur le canal d'alerte.
set -u
D=${USINE_DOSSIER:?USINE_DOSSIER obligatoire}; ETIQ=${USINE_ETIQUETTE:?USINE_ETIQUETTE obligatoire}
export USINE_ETIQUETTE
E="$D/ETAT"; K=${USINE_CLE_SSH:-/root/.ssh/id_offsite}
ECHEANCE_MIN=${USINE_ECHEANCE_MIN:-120}; DEMARRAGE_MAX=${USINE_DEMARRAGE_MAX:-900}; FILET_MIN=$((ECHEANCE_MIN + 10))
ICI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ALERTE=${USINE_ALERTE:-/opt/nostr-relay-platform/scripts/alerte-canal.sh}
UNITE="detruire-$(printf '%s' "$ETIQ" | tr -c 'a-z0-9-' '-')"
V() { python3 "$ICI/vast.py" "$@"; }
etat() { echo "$(date -u +%FT%TZ) $*" | tee -a "$E"; }
alerte() { [ -x "$ALERTE" ] && "$ALERTE" "$1" "$2" "${3:-default}" >/dev/null 2>&1 || true; }
filet() {
  systemctl stop "$UNITE.timer" "$UNITE.service" 2>/dev/null; systemctl reset-failed "$UNITE.timer" "$UNITE.service" 2>/dev/null
  systemd-run --on-active="${FILET_MIN}m" --unit="$UNITE" --setenv=USINE_ETIQUETTE="$ETIQ" \
    --description="Filet usine : détruire $ETIQ" /usr/bin/python3 -u "$ICI/vast.py" detruire >/dev/null 2>&1 \
    && etat "filet systemd réarmé (+${FILET_MIN} min)" || { etat "⚠ filet systemd NON réarmé"; alerte "Usine $ETIQ : filet non armé" "La machine n'a pas de destruction de secours." high; }
}
fin() {
  etat "destruction… $(V info)"
  local r; r=$(V detruire 2>&1 | tail -2 | tr '\n' ' '); etat "$r"
  case "$r" in *"DISPARUE (vérifié)"*) ;; *) alerte "Usine $ETIQ : destruction NON confirmée" "$r — vérifier sur Vast, la machine facture peut-être encore." high ;; esac
  etat "FIN orchestrateur"
}
trap fin EXIT
mkdir -p "$D/resultats"
etat "DEBUT $ETIQ (budget ${USINE_BUDGET:-3} \$ au pire cas, échéance ${ECHEANCE_MIN} min après location)"
O="-i $K -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=12 -o LogLevel=ERROR"
ok=0
for tour in 1 2 3; do
  for n in $(seq 1 10); do
    out=$(V louer 2>&1 | tail -2 | tr '\n' ' '); code=$?
    etat "hôte $tour, location #$n : $out"
    case "$out" in
      *LOUEE*|*DEJA*) break ;;
      *CREDIT_*) alerte "Usine $ETIQ : nuit refusée" "$out" high; etat "ABANDON : crédit"; exit 0 ;;
    esac
    sleep 60
  done
  case "$out" in *LOUEE*|*DEJA*) :;; *) alerte "Usine $ETIQ : aucune machine" "Aucune offre sous le budget après 10 essais." default; etat "ABANDON : pas de location"; exit 0;; esac
  filet
  T0=$(date +%s)
  while [ $(( $(date +%s) - T0 )) -lt $DEMARRAGE_MAX ]; do
    read -r ID ST SH SP DPH COUT GPU <<<"$(V info)"
    if [ "${SH:--}" != "-" ] && ssh $O -p "$SP" "root@$SH" true 2>/dev/null; then ok=1; break; fi
    sleep 30
  done
  [ $ok = 1 ] && break
  M=$(V machine); echo "$M" >> "$ICI/exclues.txt"
  etat "hôte $tour BLOQUÉ au démarrage ($ST) — machine $M exclue, destruction : $(V detruire 2>&1 | tail -1)"
done
[ $ok = 1 ] || { alerte "Usine $ETIQ : 3 hôtes bloqués" "Aucune machine n'a ouvert son SSH." default; etat "ABANDON : 3 hôtes bloqués au démarrage"; exit 0; }
limite() { [ $(( ($(date +%s) - T0) / 60 )) -ge $ECHEANCE_MIN ]; }
etat "SSH ok ($GPU, $DPH \$/h)"
ssh $O -p "$SP" "root@$SH" 'mkdir -p /workspace/usine/entrees'
scp $O -P "$SP" -q "$D/travail.sh" "$ICI/telecharger.sh" "root@$SH:/workspace/usine/" \
  && scp $O -P "$SP" -q -r "$D"/entrees/. "root@$SH:/workspace/usine/entrees/"
ssh $O -p "$SP" "root@$SH" 'cd /workspace/usine && (setsid nohup bash travail.sh > lancement.log 2>&1 < /dev/null &)'
etat "LANCE"
while :; do
  sleep 60
  if ! ssh $O -p "$SP" "root@$SH" 'pgrep -f "^bash travail.sh" >/dev/null'; then etat "travail TERMINE"; break; fi
  limite && { etat "ÉCHÉANCE ${ECHEANCE_MIN} min atteinte"; alerte "Usine $ETIQ : échéance atteinte" "Le travail n'a pas fini en ${ECHEANCE_MIN} min ; résultats partiels rapatriés." default; break; }
  etat "suivi : $(ssh $O -p "$SP" "root@$SH" 'tail -1 /workspace/usine/resultats/journal.txt 2>/dev/null' | cut -c1-170)"
done
scp $O -P "$SP" -r -q "root@$SH:/workspace/usine/resultats/." "$D/resultats/" && etat "RAPATRIE : $(ls "$D/resultats" | tr '\n' ' ' | cut -c1-300)"
