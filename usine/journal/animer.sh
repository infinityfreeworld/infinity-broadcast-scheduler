#!/bin/bash
# 🎞️ L'animation de tous les plans (LongCat-Video-Avatar 1.5) sur TOUTES les cartes de la machine louée — appelé par
# travail.sh, le venv de LongCat déjà activé. Un lot par carte, d'égale durée de voix (restant.py lots), un lc_lot.py par
# carte (le modèle chargé une fois PAR CARTE), démarrages espacés (la mémoire vive ne porte qu'un chargement à la fois),
# une 2e passe pour ce qui a échoué (hoquet, mémoire), réparti de nouveau sur les cartes.
# Fondateur, 15/09/2026 : « comment limiter le coût et la durée ? » — ce soir-là, des machines à 4 cartes H100 se louaient
# 0,40 $/h la carte en enchère : quatre fois plus vite, et moins cher qu'une carte seule à 1,69 $/h.
#
#   bash animer.sh DOSSIER_DU_TRAVAIL DOSSIER_DES_POIDS
# Réglages : ANIMER_CARTES (défaut : les cartes que voit nvidia-smi), ANIMER_ESPACEMENT (secondes entre deux démarrages, 60).
set -u
S=$1; W=$2; RES=$S/resultats
journal() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$RES/journal.txt"; }
NG=${ANIMER_CARTES:-$(nvidia-smi -L 2>/dev/null | grep -c '^GPU')}
[ "$NG" -ge 1 ] 2>/dev/null || NG=1
for passe in 1 2; do
  cd "$S" || exit 1
  n=$(python3.10 restant.py lots "$NG")
  [ "${n:-0}" = 0 ] && break
  t=$(date +%s); pids=""
  journal "lot, passe $passe : $(python3.10 restant.py plans) plan(s) sur $n carte(s)"
  cd "$S/LongCat-Video" || exit 1
  for k in $(seq 0 $((n - 1))); do
    [ "$k" -gt 0 ] && sleep "${ANIMER_ESPACEMENT:-60}"
    CUDA_VISIBLE_DEVICES=$k LOT_TMP="./audio_temp_file_$k" timeout 43200 torchrun --standalone --nproc_per_node=1 lc_lot.py \
      --checkpoint_dir="$W/lc/LongCat-Video-Avatar-1.5" --lot "$S/entrees/lots/lot-$k.json" --racine "$S" --sortie "$RES/clips" \
      < /dev/null >> "$RES/lot-$k.log" 2>&1 &
    pids="$pids $!"
  done
  wait $pids
  cd "$S" || exit 1
  journal "lot, passe $passe : $(( $(date +%s) - t )) s, $(python3.10 restant.py plans) plan(s) encore à rendre"
done
