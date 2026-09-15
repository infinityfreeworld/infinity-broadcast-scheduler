#!/bin/bash
# 🎬 USINE — LE JOURNAL DE FREEWORLD TV, sur la machine louée (carte de 80 Go : H100 / A100 / H200).
#   1) les voix (Chatterbox 0.1.7) et les images (Qwen-Image-Edit-2511) EN MÊME TEMPS : ~6 + 58 Go tiennent sur 80 ;
#   2) tous les plans LongCat-Video-Avatar 1.5, modèle chargé UNE seule fois (lc_lot.py, décision du fondateur).
# Entrées (préparées sur le hub par planif.py) : entrees/{repliques,images,plans}.json, refs/, persos/, et les scripts.
#
# REPRISE (machines interruptibles, fondateur 15/09/2026) : l'orchestre rapporte dans resultats/ tout ce que les
# machines précédentes ont fini ; chaque étape le saute (restant.py), jusqu'à ne pas réinstaller ce qui ne sert plus.
# resultats/FINI = « cette machine a fait tout ce qui était possible » : l'orchestre ne reloue pas.
set -u
# Le dossier est celui où l'usine a DÉPOSÉ ce script : jamais écrit en dur (14/09 : 7 min facturées à vide).
S=$(cd "$(dirname "$0")" && pwd); RES=$S/resultats; W=$S/poids; mkdir -p "$RES/clips" "$RES/voix" "$RES/images" "$W" && cd "$S"
[ -f entrees/plans.json ] || { echo "🔴 entrees/plans.json introuvable dans $S" | tee -a "$RES/journal.txt"; exit 1; }
journal() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$RES/journal.txt"; }
etape() { local e=$1; shift; local t=$(date +%s); ( "$@" ) >> "$RES/$e.log" 2>&1 && journal "$e ok en $(( $(date +%s) - t )) s" || { journal "⚠ $e en ERREUR : $(tail -2 "$RES/$e.log" | tr '\n' ' ' | cut -c1-200)"; return 1; }; }
T0=$(date +%s)
journal "DEBUT · $(nvidia-smi --query-gpu=name,memory.total,compute_cap --format=csv,noheader) · RAM $(free -g | awk '/Mem:/{print $2}') Go · disque $(df -BG --output=avail /workspace | tail -1)"
export DEBIAN_FRONTEND=noninteractive HF_HOME=/workspace/hf HF_XET_HIGH_PERFORMANCE=1
apt-get update -qq && apt-get install -y -qq --no-install-recommends python3.10 python3.10-venv python3.10-dev build-essential git ffmpeg \
  libgl1 libglib2.0-0 libsndfile1 libsamplerate0 sox curl ca-certificates rsync >/dev/null 2>&1 && journal "apt ok"
curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1; export PATH="$HOME/.local/bin:$PATH"
cp entrees/*.py .
# « plans-tous » et non « plans » : sur une machine neuve, aucune voix n'existe encore, donc aucun plan n'est faisable — le
# 1er essai réel (15/09) a sauté l'installation de LongCat et l'a attendue pour toujours (rattrapé à la main sur la machine).
RV=$(python3.10 restant.py voix); RI=$(python3.10 restant.py images); RP=$(python3.10 restant.py plans-tous)
journal "à faire : $RV voix, $RI image(s), $RP plan(s) (le reste vient des machines précédentes)"

# ── Poids LongCat (en fond, retentés) ──
python3.10 -m venv /opt/venv/hf && /opt/venv/hf/bin/pip install -q -U huggingface_hub
HF=/opt/venv/hf/bin/hf
tele_lc() {
  for i in 1 2 3 4; do
    $HF download meituan-longcat/LongCat-Video --local-dir $W/lc/LongCat-Video --include "tokenizer/*" --include "text_encoder/*" --include "vae/*" --include "*.json" &&
    # Sans base_model_int8 : lc_lot.py ne s'en sert pas, et chaque Go téléchargé se paie chez certains hôtes (15/09).
    $HF download meituan-longcat/LongCat-Video-Avatar-1.5 --local-dir $W/lc/LongCat-Video-Avatar-1.5 --include "base_model/*" \
      --include "lora/*" --include "scheduler/*" --include "vocal_separator/*" --include "whisper-large-v3/*.json" --include "whisper-large-v3/model.safetensors" --include "*.json" && return 0
    sleep $((i * 30))
  done; return 1
}
[ "$RP" != 0 ] && ( etape poids-longcat tele_lc; touch $W/.fini-lc ) &

# ── Environnements (seulement ceux qui servent encore) ──
v_lc() {
  git clone -q --single-branch --branch main https://github.com/meituan-longcat/LongCat-Video $S/LongCat-Video && git -C $S/LongCat-Video checkout -q 6b3f4b8582a8bc3f20f795735f5383716c4ba794 &&
  python3.10 -m venv /opt/venv/lc && . /opt/venv/lc/bin/activate && cd $S/LongCat-Video &&
  pip install -q -U pip wheel setuptools ninja packaging psutil &&
  pip install -q torch==2.6.0+cu124 torchvision==0.21.0+cu124 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124 &&
  pip install -q https://github.com/Dao-AILab/flash-attention/releases/download/v2.7.4.post1/flash_attn-2.7.4.post1+cu12torch2.6cxx11abiFALSE-cp310-cp310-linux_x86_64.whl &&
  pip install -q -r requirements.txt &&
  sed -i -e '/^libsndfile1==/d' -e '/^tritonserverclient==/d' requirements_avatar.txt &&
  pip install -q -r requirements_avatar.txt &&
  python -c "import torch, flash_attn; print('lc', torch.__version__)"
}
v_cb() { uv venv -q --seed -p 3.11 /opt/v-cb && /opt/v-cb/bin/pip install -q torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124 && /opt/v-cb/bin/pip install -q chatterbox-tts==0.1.7 "setuptools<81" && /opt/v-cb/bin/python -c "import perth; assert perth.PerthImplicitWatermarker is not None; print('cb ok')"; }
v_edit() { uv venv -q --seed -p 3.11 /opt/v-edit && /opt/v-edit/bin/pip install -q torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124 && /opt/v-edit/bin/pip install -q "diffusers>=0.36" "transformers>=4.51" accelerate sentencepiece protobuf peft pillow && (/opt/v-edit/bin/python -c "from diffusers import QwenImageEditPlusPipeline" 2>/dev/null || /opt/v-edit/bin/pip install -q "git+https://github.com/huggingface/diffusers") && /opt/v-edit/bin/python -c "from diffusers import QwenImageEditPlusPipeline; print('qwen-edit ok')"; }
modele_edit() { for i in 1 2 3 4 5; do /opt/v-edit/bin/python -c "from huggingface_hub import snapshot_download as s; s('Qwen/Qwen-Image-Edit-2511'); s('lightx2v/Qwen-Image-Edit-2511-Lightning', allow_patterns=['Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors'])" && return 0; sleep $((i * 20)); done; return 1; }
PL=; PV=; PI=
[ "$RP" != 0 ] && { etape venv-lc v_lc & PL=$!; }
# Les voix et les images tournent EN MÊME TEMPS sur la carte ; LongCat (~72 Go) attend qu'elles aient rendu la place.
[ "$RV" != 0 ] && { ( etape venv-cb v_cb && etape voix /opt/v-cb/bin/python voix_jt.py ) & PV=$!; }
[ "$RI" != 0 ] && { ( etape venv-edit v_edit && etape modele-edit modele_edit && etape images /opt/v-edit/bin/python images_jt.py ) & PI=$!; }
[ -n "$PV$PI" ] && wait $PV $PI
journal "voix et images : $(python3.10 restant.py voix) voix et $(python3.10 restant.py images) image(s) manquent encore"

# ── Tous les plans, modèle chargé une fois ; une 2e passe reprend ceux qui ont échoué (hoquet, mémoire) ──
RP=$(python3.10 restant.py plans)
if [ "$RP" != 0 ]; then
  [ -n "$PL" ] && wait $PL
  while [ ! -f $W/.fini-lc ]; do sleep 20; done
  . /opt/venv/lc/bin/activate && cp lc_lot.py LongCat-Video/ && cd $S/LongCat-Video
  for passe in 1 2; do
    t=$(date +%s)
    timeout 43200 torchrun --nproc_per_node=1 lc_lot.py --checkpoint_dir=$W/lc/LongCat-Video-Avatar-1.5 --lot $S/entrees/plans.json \
      --racine $S --sortie $RES/clips < /dev/null >> "$RES/lot.log" 2>&1
    cd $S; RP=$(python3.10 restant.py plans); cd $S/LongCat-Video
    journal "lot, passe $passe : $(( $(date +%s) - t )) s, $RP plan(s) encore à rendre"
    [ "$RP" = 0 ] && break
  done
  cd $S; deactivate
fi
journal "plans : $(grep -h '"ok": false' $RES/clips/lot.jsonl 2>/dev/null | tail -5 | cut -c1-160 | tr '\n' ' ')"
touch "$RES/FINI"
journal "FIN en $(( ($(date +%s) - T0) / 60 )) min · $(ls $RES/clips/*.mp4 2>/dev/null | wc -l) plan(s) rendus"
