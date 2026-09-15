#!/bin/bash
# 🏭 USINE DE NUIT — orchestrateur générique (tourne DÉTACHÉ sur le hub, sous systemd).
# Loue, lance, suit, rapatrie, puis DÉTRUIT — toujours — et vérifie la disparition.
#
#   USINE_DOSSIER=/root/usine/<travail> USINE_ETIQUETTE=usine-<travail> bash usine/orchestre.sh
#
# Le dossier du travail contient `travail.sh` (exécuté sur la machine louée) et `entrees/` (copié tel
# quel, sous-dossiers compris). Les résultats reviennent dans `$USINE_DOSSIER/resultats/`.
# Réglages (voir vast.py) : USINE_BUDGET, USINE_HEURES, USINE_GO, USINE_DISQUE, USINE_FILTRE,
# USINE_IMAGE, USINE_CREDIT_MIN, USINE_INTERRUPTIBLE ; ici : USINE_ECHEANCE_MIN (défaut 120, par machine),
# USINE_DEMARRAGE_MAX (900 s), et pour les longs travaux sur machines interruptibles :
#   USINE_REPRISES              machines de remplacement permises après une interruption (défaut 0) ;
#   USINE_BUDGET_TOTAL          plafond de TOUTES les machines du travail (défaut : budget × (1 + reprises)) ;
#   USINE_ECHEANCE_TOTALE_MIN   échéance du travail entier, reprises comprises (défaut : celle d'une machine) ;
#   USINE_SYNCHRO               rapatriement AU FIL DE L'EAU (défaut : 1 dès qu'une reprise est permise).
# Contrat de reprise : travail.sh saute ce qui est déjà dans resultats/ (rapporté sur la machine suivante)
# et écrit resultats/FINI quand tout est fait ; un fichier en cours d'écriture commence par un point.
#
# Garanties, apprises à nos dépens (14/09/2026 et avant) :
#   · un FILET systemd indépendant détruit la machine même si ce script meurt (kill -9) ;
#   · ce script détruit à sa sortie, quelle qu'elle soit (trap EXIT), et VÉRIFIE ;
#   · un hôte qui n'ouvre pas son SSH à temps est exclu et remplacé (3 hôtes au plus) ;
#   · la surveillance est tenue par le HUB, jamais par un poste qui peut s'endormir ;
#   · toute anomalie (crédit, abandon, destruction non confirmée) part sur le canal d'alerte ;
#   · (15/09) une machine INJOIGNABLE n'est pas un travail fini : l'ancien suivi prenait l'échec du SSH pour
#     la fin du travail — une machine interruptible reprise par le loueur aurait tout emporté.
set -u
D=${USINE_DOSSIER:?USINE_DOSSIER obligatoire}; ETIQ=${USINE_ETIQUETTE:?USINE_ETIQUETTE obligatoire}
export USINE_ETIQUETTE
E="$D/ETAT"; K=${USINE_CLE_SSH:-/root/.ssh/id_offsite}
ECHEANCE_MIN=${USINE_ECHEANCE_MIN:-120}; DEMARRAGE_MAX=${USINE_DEMARRAGE_MAX:-900}; FILET_MIN=$((ECHEANCE_MIN + 10))
REPRISES=${USINE_REPRISES:-0}; BUDGET_MACHINE=${USINE_BUDGET:-3}
BUDGET_TOTAL=${USINE_BUDGET_TOTAL:-$(python3 -c "print($BUDGET_MACHINE * (1 + $REPRISES))")}
ECHEANCE_TOTALE_MIN=${USINE_ECHEANCE_TOTALE_MIN:-$ECHEANCE_MIN}
SYNCHRO=${USINE_SYNCHRO:-$([ "$REPRISES" -gt 0 ] && echo 1 || echo 0)}
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
T_DEBUT=$(date +%s); DEPENSE=0
etat "DEBUT $ETIQ (budget ${BUDGET_MACHINE} \$ au pire cas par machine, ${BUDGET_TOTAL} \$ en tout ; échéance ${ECHEANCE_MIN} min par machine, ${ECHEANCE_TOTALE_MIN} min en tout ; ${REPRISES} reprise(s)$([ "${USINE_INTERRUPTIBLE:-}" = 1 ] && echo ', machines INTERRUPTIBLES'))"
O="-i $K -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=12 -o LogLevel=ERROR"
R() { ssh $O -p "$SP" "root@$SH" "$@"; }
total_min() { echo $(( ($(date +%s) - T_DEBUT) / 60 )); }
rapatrier() {
  # rsync ne recopie que ce qui a changé ; les fichiers « .partiel » en cours d'écriture restent sur la machine.
  if [ "$SYNCHRO" = 1 ]; then rsync -a --exclude='.*' -e "ssh $O -p $SP" "root@$SH:/workspace/usine/resultats/" "$D/resultats/" 2>/dev/null
  else scp $O -P "$SP" -r -q "root@$SH:/workspace/usine/resultats/." "$D/resultats/"; fi
}
machine=0
while :; do
  machine=$((machine + 1))
  RESTE=$(python3 -c "print(round($BUDGET_TOTAL - $DEPENSE, 2))")
  if [ $machine -gt 1 ]; then
    python3 -c "import sys; sys.exit(0 if $RESTE >= 0.3 else 1)" || { alerte "Usine $ETIQ : budget épuisé" "Plus de quoi relouer après une interruption ($RESTE \$ restants)." default; etat "ABANDON : budget total épuisé ($RESTE \$ restants)"; exit 0; }
    [ "$(total_min)" -lt "$ECHEANCE_TOTALE_MIN" ] || { alerte "Usine $ETIQ : échéance totale" "Interrompue trop tard pour relouer." default; etat "ABANDON : échéance totale atteinte"; exit 0; }
    etat "REPRISE : machine n°$machine ($RESTE \$ restants)"
  fi
  export USINE_BUDGET=$(python3 -c "print(min($BUDGET_MACHINE, $RESTE))")
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
  limite() { [ $(( ($(date +%s) - T0) / 60 )) -ge $ECHEANCE_MIN ] || [ "$(total_min)" -ge "$ECHEANCE_TOTALE_MIN" ]; }
  # Le coût RÉEL de cette machine (tarif × durée) n'atteint jamais son budget : une machine à 4 cartes coûte 4 fois plus à
  # l'heure — un travail bloqué dessus doit s'arrêter bien avant l'échéance, prévue pour une carte seule.
  depasse() { python3 -c "import sys; sys.exit(0 if float('${DPH:-0}') * ($(date +%s) - $T0) / 3600 >= 0.95 * $USINE_BUDGET else 1)"; }
  etat "SSH ok ($GPU, $DPH \$/h)"
  R 'mkdir -p /workspace/usine/entrees /workspace/usine/resultats'
  if [ "$SYNCHRO" = 1 ]; then
    R 'command -v rsync >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rsync; } >/dev/null 2>&1'
    # REPRISE : tout ce que les machines précédentes ont fini part AVANT le lancement ; travail.sh le sautera.
    if [ -n "$(ls -A "$D/resultats" 2>/dev/null)" ]; then
      rsync -a -e "ssh $O -p $SP" "$D/resultats/" "root@$SH:/workspace/usine/resultats/" \
        && etat "reprise : $(find "$D/resultats" -type f | wc -l) fichier(s) déjà faits rapportés sur la machine"
    fi
  fi
  scp $O -P "$SP" -q "$D/travail.sh" "$ICI/telecharger.sh" "root@$SH:/workspace/usine/" \
    && scp $O -P "$SP" -q -r "$D"/entrees/. "root@$SH:/workspace/usine/entrees/"
  R 'cd /workspace/usine && (setsid nohup bash travail.sh > lancement.log 2>&1 < /dev/null &)'
  etat "LANCE"
  issue=termine; perdu=0; tic=0
  while :; do
    sleep 60; tic=$((tic + 1))
    if R 'pgrep -f "^bash travail.sh" >/dev/null'; then
      perdu=0
    elif R true; then
      etat "travail TERMINE"; break
    else
      # Injoignable : fin de location, reprise par le loueur, ou simple hoquet réseau — Vast tranche.
      perdu=$((perdu + 1)); st=$(V info | awk '{print $2}')
      etat "machine injoignable ($perdu/3, état Vast : ${st:-aucune})"
      if [ "$st" != running ] || [ $perdu -ge 3 ]; then issue=interrompue; etat "⚡ machine INTERROMPUE (état Vast : ${st:-aucune})"; break; fi
      continue
    fi
    if limite; then
      issue=echeance; etat "ÉCHÉANCE atteinte (${ECHEANCE_MIN} min par machine, ${ECHEANCE_TOTALE_MIN} min en tout)"
      alerte "Usine $ETIQ : échéance atteinte" "Le travail n'a pas fini à temps ; résultats partiels rapatriés." default; break
    fi
    if depasse; then
      issue=echeance; etat "BUDGET de la machine atteint (~${USINE_BUDGET} \$ au tarif de ${DPH} \$/h)"
      alerte "Usine $ETIQ : budget de la machine atteint" "Arrêt avant dépassement ; résultats partiels rapatriés." default; break
    fi
    [ "$SYNCHRO" = 1 ] && [ $((tic % 5)) = 0 ] && rapatrier
    etat "suivi : $(R 'tail -1 /workspace/usine/resultats/journal.txt 2>/dev/null' | cut -c1-170)"
  done
  [ $issue = interrompue ] || { rapatrier && etat "RAPATRIE : $(ls "$D/resultats" | tr '\n' ' ' | cut -c1-300)"; }
  COUT=$(python3 -c "print(round(float('${DPH:-0}') * ($(date +%s) - $T0) / 3600, 3))")
  DEPENSE=$(python3 -c "print(round($DEPENSE + $COUT, 3))")
  etat "machine n°$machine : ~$COUT \$ ; dépense du travail ~$DEPENSE \$ ; destruction : $(V detruire 2>&1 | tail -1)"
  [ -f "$D/resultats/FINI" ] && { etat "travail FINI"; break; }
  if [ $issue = interrompue ] && [ $machine -le $REPRISES ]; then continue; fi
  [ $issue = interrompue ] && alerte "Usine $ETIQ : interrompue" "Machine reprise par le loueur et plus de reprise permise ; résultats partiels." default
  break
done
