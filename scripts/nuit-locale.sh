#!/bin/bash
# Nuit de la radio Infinity — production LOCALE, sans GitHub.
#
# POURQUOI CE SCRIPT EXISTE
# La production tournait sur GitHub Actions. L'accès au compte propriétaire
# a été perdu le 07/09/2026 : plus de fusion, plus de secrets, plus de cron.
# La nuit se fabrique donc ici, sur la machine du Bâtisseur.
#
# 🔴 Ce script ne DOIT PAS échouer en silence. Chaque étape écrit dans le
# journal, et le code de sortie distingue « rien produit » de « tout bien ».

set -u  # PAS de `set -e` : une station qui tombe ne doit pas emporter les 14 autres.

DEPOT="/Users/med/Claude code Fichier Vs code/infinity-broadcast-scheduler"
JOURNAL="$HOME/Library/Logs/infinity-radio"
mkdir -p "$JOURNAL"
FICHIER="$JOURNAL/nuit-$(date -u +%Y-%m-%d).log"

exec >> "$FICHIER" 2>&1
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  NUIT DU $(date -u '+%Y-%m-%d %H:%M UTC')"
echo "════════════════════════════════════════════════════════════"

cd "$DEPOT" || { echo "🔴 dépôt introuvable : $DEPOT"; exit 1; }

# Le PATH d'un service launchd est minimal : node et uv n'y sont pas.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NODE_OPTIONS="--max-old-space-size=4096"

command -v node >/dev/null || { echo "🔴 node introuvable dans le PATH"; exit 1; }
echo "  node $(node --version) · $(sw_vers -productVersion 2>/dev/null)"

# ── 1. Contrôle de couture : les voix demandées existent-elles ? ──
# Informatif : une voix manquante retombe sur Piper, ce n'est pas bloquant.
echo ""
echo "── contrôle des voix ──"
npx tsx src/scripts/verifier-voix.ts || echo "  (voix manquantes — repli Piper attendu)"

# ── 2. Les quinze stations ──
echo ""
echo "── génération ──"
npx tsx src/scripts/generate-all.ts
CODE=$?
echo "  generate-all → code $CODE"

# ── 3. Rétention : les émissions vivent 10 jours ──
echo ""
echo "── purge (rétention ${RETENTION_JOURS:-10} jours) ──"
npx tsx src/scripts/purger-emissions.ts --executer || echo "  ⚠️ purge en échec — pas bloquant pour la diffusion"

echo ""
echo "  FIN $(date -u '+%H:%M UTC') · code de sortie $CODE"
exit $CODE
