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

# 🔴 Le dépôt était NOMMÉ EN DUR, sur un chemin qui n'existe que sur le Mac du
# Bâtisseur : partout ailleurs — l'intégration continue comprise — ce script
# s'arrêtait sur « dépôt introuvable », et le test qui l'exerce échouait. On le
# déduit de l'emplacement du script, ce qui marche sur toute machine ; DEPOT
# reste surchargeable pour un cas particulier.
DEPOT="${DEPOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# Le journal suit la convention du système : ~/Library/Logs sur macOS,
# ~/.local/state ailleurs (base directory de freedesktop).
if [ -d "$HOME/Library/Logs" ]; then
  JOURNAL="$HOME/Library/Logs/infinity-radio"
else
  JOURNAL="${XDG_STATE_HOME:-$HOME/.local/state}/infinity-radio"
fi
mkdir -p "$JOURNAL"
FICHIER="$JOURNAL/nuit-$(date -u +%Y-%m-%d).log"

# En mode --decision on n'écrit PAS dans le journal : cette sortie sert à
# éprouver la décision depuis un terminal, et un verdict invisible ne
# s'éprouve pas.
if [ "${1:-}" != "--decision" ]; then
  exec >> "$FICHIER" 2>&1
fi
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  NUIT DU $(date -u '+%Y-%m-%d %H:%M UTC')"
echo "════════════════════════════════════════════════════════════"

cd "$DEPOT" || { echo "🔴 dépôt introuvable : $DEPOT"; exit 1; }

# ── FENÊTRE D'OPPORTUNITÉ ────────────────────────────────────────────
#
# Décision du Bâtisseur (07/09/2026) : plutôt qu'une heure fixe, la nuit se
# fabrique à la PREMIÈRE occasion entre 20 h et minuit où le Mac est
# allumé. Une heure fixe est le pire des deux mondes : si la machine dort,
# launchd rattrape au réveil — à une heure imprévisible, et rien ne
# distingue « rattrapé » de « jamais lancé ».
#
# 🔴 Deux garde-fous, sans lesquels la fenêtre serait pire que l'heure fixe :
#   1. un TÉMOIN de dernière exécution, sinon on rediffuse toutes les
#      15 minutes pendant quatre heures ;
#   2. un RATTRAPAGE au-delà de 26 h, sinon un Mac éteint quatre soirs de
#      suite ne produit rien et personne ne le voit.
TEMOIN="$HOME/Library/Application Support/infinity-radio/derniere-nuit"
mkdir -p "$(dirname "$TEMOIN")"

HEURE=$(date +%H); HEURE=${HEURE#0}   # "08" → 8, sinon bash lit de l'octal
AUJOURDHUI=$(date +%F)
DERNIERE=$(cat "$TEMOIN" 2>/dev/null || echo "")

# Décision isolée dans UNE fonction, pour pouvoir l'éprouver sans rien
# produire : `nuit-locale.sh --decision` imprime le verdict et sort.
decider() {
  local heure="$1" derniere="$2" ecoule="$3" aujourdhui="$4"
  if [ -n "$derniere" ] && [ "$derniere" = "$aujourdhui" ]; then
    echo "DEJA_FAIT"; return
  fi
  if [ "$heure" -ge 20 ] && [ "$heure" -le 23 ]; then
    echo "FENETRE"; return
  fi
  # 🔴 Un PREMIER lancement n'est pas un retard. Sans cette condition, une
  # installation à 14 h se croyait en retard de 9 999 heures et publiait
  # quinze émissions sur-le-champ. Vu en vrai le 07/09/2026 — arrêté à
  # temps, aucune émission publiée, mais c'était de justesse.
  if [ -n "$derniere" ] && [ "$ecoule" -ge 26 ]; then
    echo "RATTRAPAGE"; return
  fi
  echo "ATTENDRE"
}

if [ -f "$TEMOIN" ]; then
  ECOULE=$(( ( $(date +%s) - $(stat -f %m "$TEMOIN") ) / 3600 ))
else
  ECOULE=0
fi

VERDICT=$(decider "$HEURE" "$DERNIERE" "$ECOULE" "$AUJOURDHUI")

if [ "${1:-}" = "--decision" ]; then
  echo "heure=${HEURE} derniere=${DERNIERE:-aucune} ecoule=${ECOULE}h -> $VERDICT"
  exit 0
fi

case "$VERDICT" in
  DEJA_FAIT)  echo "  déjà produit aujourd'hui ($AUJOURDHUI) — rien à faire."; exit 0 ;;
  ATTENDRE)   echo "  hors fenêtre (il est ${HEURE} h) — on attend 20 h."; exit 0 ;;
  FENETRE)    echo "  fenêtre 20 h–minuit, il est ${HEURE} h — on y va." ;;
  RATTRAPAGE) echo "  ⚠️ RATTRAPAGE : ${ECOULE} h sans émission (dernière : $DERNIERE)." ;;
esac




# Le PATH d'un service launchd est minimal : node et uv n'y sont pas.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NODE_OPTIONS="--max-old-space-size=4096"

command -v node >/dev/null || { echo "🔴 node introuvable dans le PATH"; exit 1; }
echo "  node $(node --version) · $(sw_vers -productVersion 2>/dev/null)"

# ── 1. Contrôle de couture : les voix demandées existent-elles ? ──
# Informatif : une voix manquante retombe sur Piper, ce n'est pas bloquant.
# ── Annoncer la diffusion, AVANT tout le reste ───────────────────────
# data-space : leur alerte se déclenche à l'OUVERTURE de la session, pas à
# notre première requête. Ouvrir tôt leur laisse le temps de rattraper une
# panne d'allumage avant qu'elle ne devienne la nôtre — et leur station
# chauffe pendant que nous écrivons les dialogues.
echo ""
echo "── ouverture de la session de diffusion ──"
npx tsx src/scripts/ouvrir-session.ts || echo "  (sans session — pas bloquant)"

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
# ── Archive du dépôt, relue ──────────────────────────────────────────
# 🔴 Onze commits ont vécu sur ce seul disque le 08/09/2026, faute d'accès
# au dépôt distant. Une sauvegarde qu'on ne refait pas vieillit ; une
# sauvegarde qu'on ne relit pas n'existe pas.
echo ""
echo "── archive du dépôt ──"
ARCHIVE="/tmp/infinity-scheduler-$(date +%Y%m%d).bundle"
if git bundle create "$ARCHIVE" --all 2>/dev/null; then
  # Relecture : un paquet fabriqué depuis un clone superficiel a l'air
  # sain et ne contient rien. Seul un clone réel le prouve.
  TMPC="/tmp/verif-bundle-$$"
  if git clone -q "$ARCHIVE" "$TMPC" 2>/dev/null \
     && [ "$(git -C "$TMPC" rev-parse HEAD)" = "$(git rev-parse HEAD)" ]; then
    npx tsx src/scripts/deposer-archive.ts "$ARCHIVE" || echo "  ⚠️ dépôt de l'archive en échec"
  else
    echo "  🔴 ARCHIVE ILLISIBLE — rien déposé"
  fi
  rm -rf "$TMPC" "$ARCHIVE"
else
  echo "  ⚠️ fabrication de l'archive en échec"
fi

echo ""
echo "── purge (rétention ${RETENTION_JOURS:-10} jours) ──"
npx tsx src/scripts/purger-emissions.ts --executer || echo "  ⚠️ purge en échec — pas bloquant pour la diffusion"

# Le témoin n'est posé QUE sur un succès : un échec doit pouvoir être
# retenté à la prochaine occasion, pas être compté comme une nuit faite.
if [ "$CODE" -eq 0 ]; then
  echo "$AUJOURDHUI" > "$TEMOIN"
  echo "  témoin posé : $AUJOURDHUI"
else
  echo "  ⚠️ témoin NON posé (code $CODE) — nouvelle tentative à la prochaine occasion"
fi

echo ""
echo "  FIN $(date -u '+%H:%M UTC') · code de sortie $CODE"
exit $CODE
