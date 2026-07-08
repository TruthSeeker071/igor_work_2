# Pushing FlightWay 2.0 (`igor_work_2`) to GitHub

A clean, ready-to-push repo is packaged as **`igor_work_2.git.bundle`** — one file
in the parent folder, next to `igor_work_2/`. It holds the full codebase on branch
`igor_work_2` with one clean commit. Use it: it avoids the sandbox filesystem
artifacts left in the in-place `igor_work_2/.git` (see note at the bottom).

## 1. Get a clean repo from the bundle
```bash
cd "/Users/igorkallash/Claude/Projects/FlightWay CTO"
git clone -b igor_work_2 igor_work_2.git.bundle igor_work_2_repo
cd igor_work_2_repo
```
You now have the full FlightWay 2.0 codebase with clean git history.

## 2. Create the GitHub repo + push
**Option A — GitHub CLI (fastest):**
```bash
gh repo create igor_work_2 --private --source=. --remote=origin --push
```
**Option B — manual:** create an empty repo named `igor_work_2` at
https://github.com/new (under `flightway-ai` or your account), then:
```bash
git remote add origin git@github.com:flightway-ai/igor_work_2.git   # or your HTTPS URL
git push -u origin igor_work_2
```

## 3. After pushing
- **D1 migration**: `wrangler d1 migrations apply flightway-db`  (adds `pricing_intents`)
- **Pages env**: set `ALLOWED_ORIGIN` (prod) + the existing `GEMINI_API_KEY` /
  `RESEND_API_KEY` secrets on the new Pages project.
- **Smoke test**: `SMOKE_BASE_URL=https://<your-preview>.pages.dev npm run pages:smoke`
- **Sim pre-gen** (needs live D1/KV): `npm run sim:pregen`

See `docs/FLIGHTWAY_2.0_WEEK1.md` for exactly what was built and what's deferred.

---
*Note: the in-place `igor_work_2/` folder is the same code, but its `.git` was
created inside a sandbox whose filesystem blocks git's lock cleanup — so prefer the
bundle for pushing.*
