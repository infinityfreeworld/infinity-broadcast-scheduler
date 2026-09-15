#!/bin/bash
# 🧹 Rétention du Journal de FREEWORLD TV sur le hub — timer quotidien (condition DATASPACE, 15/09/2026 : disque à 85 %).
#   · dossiers de travail (voix, images, plans, montage) : aujourd'hui et hier seulement ;
#   · vidéos et affiches déposées sur la forge : JT_GARDE_FORGE jours (DELETE /api/v1/assets/<id>, fichiers effacés).
# Le programme en cours ne pointe que sur le Journal du jour : effacer les anciens ne coupe rien à l'antenne.
set -u
ICI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
FORGE=${JT_FORGE:-http://127.0.0.1:5400}
LIMITE_JOURS=$(date -u -d "-${JT_GARDE_JOURS:-1} days" +%F)      # garde aujourd'hui et hier
LIMITE_FORGE=$(date -u -d "-${JT_GARDE_FORGE:-3} days" +%F)
for d in "$ICI"/jours/*/; do
  [ -d "$d" ] || continue
  n=$(basename "$d")
  # Les essais (jours/<date>-essai) suivent la même règle que les vrais jours.
  [[ "$n" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}(-essai)?$ ]] && [[ "${n:0:10}" < "$LIMITE_JOURS" ]] && { rm -rf -- "$d"; echo "dossier du $n effacé"; }
done
[ -f "$ICI/depots.jsonl" ] || exit 0
HDR=$(mktemp); chmod 600 "$HDR"; trap 'rm -f "$HDR" "$ICI/depots.reste"' EXIT
printf 'Authorization: Bearer %s\n' "$(grep -m1 '^WAF_API_KEYS=' /opt/forge3d/.env | cut -d= -f2- | tr -d '"' | cut -d, -f1)" > "$HDR"
: > "$ICI/depots.reste"
while IFS= read -r ligne; do
  read -r jour ids <<<"$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d['date'], ' '.join(d['ids']))" "$ligne")"
  if [[ "$jour" < "$LIMITE_FORGE" ]]; then
    reste=0
    for id in $ids; do
      code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H @"$HDR" "$FORGE/api/v1/assets/$id")
      case "$code" in 200|404) echo "forge : $id ($jour) supprimé ($code)";; *) reste=1; echo "⚠ forge : $id ($jour) → $code";; esac
    done
    [ $reste = 0 ] && continue
  fi
  echo "$ligne" >> "$ICI/depots.reste"
done < "$ICI/depots.jsonl"
mv "$ICI/depots.reste" "$ICI/depots.jsonl"
