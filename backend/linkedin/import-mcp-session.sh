#!/usr/bin/env bash
# import-mcp-session.sh — Importe la session LinkedIn MCP depuis ta machine.
#
# Usage :
#   bash import-mcp-session.sh /chemin/linkedin-mcp-session.tar.gz
#   bash import-mcp-session.sh /chemin/.linkedin-mcp        (dossier extrait)
#
# Seuls 2 fichiers sont portables et nécessaires :
#   cookies.json        → cookies LinkedIn (format Playwright)
#   source-state.json   → { source_runtime_id, login_generation }
# Le profil navigateur + le cache Chromium sont recréés automatiquement ici
# (bridge de runtime → linux-x64-container) au prochain appel d'outil.
set -euo pipefail

DEST="${HOME}/.linkedin-mcp"
MCP_DIR="$(cd "$(dirname "$0")/vendor/linkedin-mcp-server" && pwd)"

[[ $# -ge 1 ]] || { echo "Usage: $0 <archive.tar.gz | dossier .linkedin-mcp>"; exit 2; }
SRC="$1"
mkdir -p "$DEST"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ -d "$SRC" ]]; then
  cp -a "$SRC" "$TMP/src"
else
  tar -xzf "$SRC" -C "$TMP" 2>/dev/null || true
fi

# Localise cookies.json + source-state.json où qu'ils soient dans l'archive.
n=0
while IFS= read -r f; do
  cp "$f" "$DEST/$(basename "$f")"
  echo "✓ $(basename "$f") → $DEST"
  n=$((n+1))
done < <(find "$TMP" -type f \( -name 'cookies.json' -o -name 'source-state.json' \) 2>/dev/null)

[[ $n -gt 0 ]] || { echo "❌ Aucun cookies.json / source-state.json trouvé dans '$SRC'."; exit 1; }

echo "=== Vérification de la session ==="
cd "$MCP_DIR"
python3 -m linkedin_mcp_server --status 2>&1 | tail -25 || true
