#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== FlightWay smoke =="

required=(
  index.html Flightway.html dashboard.html
  portal.html roadmap.html coach.html profile-build.html quiz.html auth.html career.html
  assets/css/flightway-theme.css
  assets/css/flightway-pages.css
  assets/css/hub-dashboard.css
  assets/js/boot/theme-boot.js
  assets/js/shared/page-boot.js
  assets/js/shared/auth-pages.js
  assets/js/shared/roadmap-sync.js
  assets/js/quiz/quiz-data.js
  assets/js/quiz/quiz-app.js
  assets/js/shared/auth.js
  assets/js/shared/sector-fit-sheet.js
  assets/js/shared/profile-alignment.js
  assets/js/app/portal.js
  assets/js/app/roadmap.js
  assets/js/app/roadmap-tree.js
  assets/js/landing/auth-cta.js
  assets/js/coach/coach.js
  assets/js/hub/hub-careers.js
  assets/js/hub/hub-dashboard.js
  assets/data/industries.json
  functions/_lib.js
  functions/_lib/profile.js
  functions/_lib/sector-fit-sheet.js
  functions/_lib/career-sector-map.js
  functions/_lib/dossier-parse.js
  functions/_lib/profile-alignment.js
  functions/profile-align.js
  functions/profile.js
  functions/career-roadmap.js
  functions/_lib/roadmap.js
  functions/_lib/roadmap-tree.js
  migrations/0002_career_analyses.sql
)

for f in "${required[@]}"; do
  test -f "$f" || { echo "MISSING $f"; exit 1; }
done

for f in assets/js/**/*.js; do
  node --check "$f"
done

for f in functions/*.js functions/**/*.js; do
  node --check "$f"
done

python3 -c "import json; json.load(open('assets/data/industries.json'))"
python3 -c "import json; json.load(open('assets/data/salary-tiers.json'))"

grep -q 'hub-boot-error' dashboard.html || { echo "MISSING hub-boot-error in dashboard.html"; exit 1; }
grep -q 'finally' assets/js/hub/hub-dashboard.js || { echo "MISSING hub boot finally in hub-dashboard.js"; exit 1; }
grep -q 'showHubBootError' assets/js/hub/hub-dashboard.js || { echo "MISSING showHubBootError in hub-dashboard.js"; exit 1; }

if [ "${SMOKE_HUB_LOAD:-}" = "1" ]; then
  echo "== Hub load smoke (Playwright) =="
  HUB_SMOKE_DIR="$ROOT/scripts/playwright-smoke"
  if [ ! -d "$HUB_SMOKE_DIR/node_modules/playwright" ]; then
    mkdir -p "$HUB_SMOKE_DIR"
    (cd "$HUB_SMOKE_DIR" && npm init -y >/dev/null 2>&1 && npm install playwright@1.49.0 --no-save)
  fi
  (cd "$HUB_SMOKE_DIR" && npx playwright install chromium)
  NODE_PATH="$HUB_SMOKE_DIR/node_modules" node "$ROOT/scripts/smoke-hub-load.mjs"
fi

echo "OK — split pages: portal roadmap coach profile quiz auth career; Flightway.html is legacy redirect shim"
