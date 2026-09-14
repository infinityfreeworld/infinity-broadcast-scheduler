#!/bin/bash
# 🏭 USINE — télécharger un modèle : Hugging Face d'abord, ModelScope en SECOURS.
#
# Pourquoi (14/09/2026) : FLUX.1-schnell est devenu « gated » du jour au lendemain, et le miroir de
# DATASPACE n'a pas la place de nos ~140 Go (21 Go libres sur son plus petit serveur). ModelScope
# publie les mêmes modèles sous les MÊMES identifiants (vérifié : Z-Image-Turbo, LongCat-Video,
# LongCat-Video-Avatar-1.5, Qwen3-TTS VoiceDesign, VoxCPM2, chatterbox) — un secours gratuit.
#
#   source telecharger.sh ; telecharger <depot> <dossier> [motif-inclus…]
#
# Rend 0 si l'une des deux sources a livré, et écrit la source utilisée dans le journal.
telecharger() {
  local depot=$1 dossier=$2; shift 2
  local inclus=() m
  for m in "$@"; do inclus+=(--include "$m"); done
  mkdir -p "$dossier"
  if command -v hf >/dev/null 2>&1 && hf download "$depot" --local-dir "$dossier" "${inclus[@]}" >/dev/null 2>&1; then
    echo "modèle $depot : Hugging Face"; return 0
  fi
  echo "modèle $depot : Hugging Face a échoué → ModelScope"
  command -v modelscope >/dev/null 2>&1 || pip install -q modelscope >/dev/null 2>&1
  if modelscope download --model "$depot" --local_dir "$dossier" "${inclus[@]}" >/dev/null 2>&1; then
    echo "modèle $depot : ModelScope"; return 0
  fi
  echo "⚠ modèle $depot : AUCUNE source n'a livré"; return 1
}
