#!/usr/bin/env bash
# Create COACH_KV namespaces on the *currently logged-in* Cloudflare account
# and print wrangler.toml lines to paste (or pass --write to update the file).
#
# Prereq: npx wrangler login   (use igorkl@protonmail.com account in the browser)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Logged in as:"
npx wrangler whoami
echo ""

read -r -p "Create COACH_KV namespaces on this account? [y/N] " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || exit 0

echo "Creating production namespace..."
PROD_JSON=$(npx wrangler kv namespace create COACH_KV 2>&1)
echo "$PROD_JSON"
PROD_ID=$(echo "$PROD_JSON" | sed -n 's/.*id = "\([^"]*\)".*/\1/p' | head -1)

echo "Creating preview namespace..."
PREVIEW_JSON=$(npx wrangler kv namespace create COACH_KV --preview 2>&1)
echo "$PREVIEW_JSON"
PREVIEW_ID=$(echo "$PREVIEW_JSON" | sed -n 's/.*id = "\([^"]*\)".*/\1/p' | head -1)

if [[ -z "$PROD_ID" || -z "$PREVIEW_ID" ]]; then
  echo "Could not parse namespace IDs. Create them in the dashboard and update wrangler.toml manually."
  exit 1
fi

BLOCK="[[kv_namespaces]]
binding = \"COACH_KV\"
id = \"$PROD_ID\"
preview_id = \"$PREVIEW_ID\""

echo ""
echo "Add/replace in wrangler.toml:"
echo "$BLOCK"
echo ""

if [[ "${1:-}" == "--write" ]]; then
  python3 - <<PY
from pathlib import Path
import re
p = Path("wrangler.toml")
text = p.read_text()
block = '''$BLOCK'''
if "[[kv_namespaces]]" in text:
    text = re.sub(r"\[\[kv_namespaces\]\][\s\S]*?(?=\n\[|\Z)", block + "\n", text)
else:
    text = text.rstrip() + "\n\n" + block + "\n"
p.write_text(text)
print("Updated wrangler.toml")
PY
  echo "Next: commit, push, and redeploy Pages on this Cloudflare account."
fi
