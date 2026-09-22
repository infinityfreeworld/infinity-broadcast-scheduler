#!/bin/bash
# BIBLIOTHÈQUE MUSICALE SOUVERAINE des radios Infinity — ACE-Step 1.5 (licence MIT), instrumental,
# 6 pistes par station × 14 stations. Exécuté SUR la machine louée par /root/usine/orchestre.sh.
# Sortie garantie : resultats/FINI est TOUJOURS posé (trap). Reprise : les .mp3 déjà rapatriés sont sautés.
set -u
cd /workspace/usine || exit 1
R=/workspace/usine/resultats; mkdir -p "$R"
j() { echo "$(date -u +%T) $*" | tee -a "$R/journal.txt"; }
fin() { [ -f "$R/STATUT" ] || echo "echec" > "$R/STATUT"; date -u +%FT%TZ > "$R/FINI"; j "FIN ($(cat "$R/STATUT"))"; }
trap fin EXIT
j "debut"
{ nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv; python3 --version; df -h /workspace | tail -1; } > "$R/machine.txt" 2>&1
head -2 "$R/machine.txt" | while read -r l; do j "machine: $l"; done
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq git curl ffmpeg libsndfile1 ca-certificates >/dev/null 2>&1 || { j "ERREUR apt"; exit 1; }
j "uv"
curl -LsSf https://astral.sh/uv/install.sh | sh >"$R/uv-install.log" 2>&1 || { j "ERREUR uv"; exit 1; }
export PATH="$HOME/.local/bin:$PATH"
j "clonage ACE-Step-1.5"
git clone --depth 1 https://github.com/ACE-Step/ACE-Step-1.5.git /workspace/ACE-Step-1.5 >"$R/clone.log" 2>&1 || { j "ERREUR clone"; exit 1; }
git -C /workspace/ACE-Step-1.5 rev-parse HEAD > "$R/commit-acestep.txt"; j "commit $(cat "$R/commit-acestep.txt")"
cd /workspace/ACE-Step-1.5
j "uv sync (dépendances, python géré par uv)"
T0=$(date +%s)
uv sync >"$R/uv-sync.log" 2>&1 || { j "ERREUR uv sync : $(tail -3 "$R/uv-sync.log" | tr '\n' ' ' | cut -c1-300)"; exit 1; }
j "dépendances en $(( $(date +%s) - T0 )) s"
uv run python -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '-')" > "$R/verif-torch.txt" 2>&1
j "torch: $(tail -1 "$R/verif-torch.txt")"
grep -q "cuda True" "$R/verif-torch.txt" || { j "ERREUR : pas de GPU vu par torch"; exit 1; }
export HF_HOME=/workspace/hf
j "génération (les poids se téléchargent au premier appel)"
T0=$(date +%s)
uv run python /workspace/usine/entrees/generer.py "$R" /workspace/ACE-Step-1.5 >"$R/generer.log" 2>&1
j "génération terminée (code $?) en $(( $(date +%s) - T0 )) s : $(tail -1 "$R/generer.log" | cut -c1-200)"
j "$(ls "$R"/*.mp3 2>/dev/null | wc -l) fichier(s) mp3"
exit 0
