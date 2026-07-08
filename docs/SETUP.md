# FlightWay — Cloudflare Pages Setup

Static site at repo root (`.`) with Pages Functions in `/functions/` and KV binding `COACH_KV`.

| Environment | Branch | Pages project | URL |
|-------------|--------|---------------|-----|
| Production | `main` | `flightway` | https://flightway.pages.dev |
| Prototype | `Jacob_Work` | `flightway-prototype` | https://flightway-prototype.pages.dev |

**Do not use Netlify** for this repo. Legacy `Leo_Working` used Netlify; current stack is Cloudflare only.

---

## User flows

| Flow | Path |
|------|------|
| Landing | `/` (`index.html`) |
| Quiz + AI coach | `/Flightway.html` |
| Career Hub | `/dashboard.html` (`#r=` token or `fw_hub_quiz_v1` in localStorage) |
| Email results | `/send-results` → link to `dashboard.html#r=…` |
| AI advisor | `Flightway.html#coach` |
| Sign in (no quiz) | `Flightway.html#signin` |

API routes: `/account`, `/chat`, `/dossier`, `/send-results`

---

## One-time Cloudflare setup

### Pages vs Worker

Use a **Pages** project (static + `/functions/`), not a standalone Worker with `wrangler deploy`.

**Pages → Settings → Builds:**
- Build command: *(empty)*
- Build output directory: **`.`**
- Deploy command: *(empty)* for Git-connected Pages

If Git is wrongly connected to a Worker, set deploy command to `npm run deploy` (runs `wrangler pages deploy`).

### KV binding

**Settings → Functions → KV namespace bindings:**

| Variable | Namespace IDs (see `wrangler.toml`) |
|----------|-------------------------------------|
| `COACH_KV` | Production: `14129792fcce40dabe02380aff80d055` · Preview: `5a3893c3048b45e3a2bf6dfdcca92e65` |

Prototype can share prod KV (internal testing) or use a separate namespace for isolation.

### Secrets & variables

**Settings → Variables and Secrets** (Production + Preview):

| Name | Secret? | Purpose |
|------|---------|---------|
| `GEMINI_API_KEY` | Yes | AI coach |
| `RESEND_API_KEY` | Yes | Quiz email |
| `FROM_EMAIL` | No | e.g. `Flightway <quiz@flightway.ai>` |
| `GEMINI_MODEL` | No | Default `gemini-2.5-flash-lite` |
| `GEMINI_FALLBACK_MODEL` | No | Default `gemini-2.5-flash` on 503/overload (deprecated `gemini-2.0-*` models are ignored) |
| `GEMINI_RESUME_MODEL` | No | PDF resume extraction model; default `gemini-2.5-flash-lite` |
| `GEMINI_USE_SEARCH` | No | `auto`, `always`, or `never` |
| `ALLOWED_ORIGIN` | No | CORS origin for your domain |

```bash
npx wrangler pages secret put GEMINI_API_KEY --project-name=flightway
npx wrangler pages secret put RESEND_API_KEY --project-name=flightway
```

Redeploy after adding secrets.

---

## Deploy

```bash
npm run deploy              # main → flightway
npm run deploy:prototype    # Jacob_Work → flightway-prototype
```

GitHub Actions (repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`):
- `.github/workflows/deploy-pages.yml` — push to `main`
- `.github/workflows/deploy-jacob-work.yml` — push to `Jacob_Work`

---

## Local development

```bash
cp .dev.vars.example .dev.vars   # add keys locally — never commit
npx wrangler pages dev .
```

---

## Prototype project (optional isolated env)

1. Create Pages project **`flightway-prototype`**, production branch `Jacob_Work`
2. Same KV/secrets as above (or separate KV for isolation)
3. `npm run deploy:prototype`

Branch preview URL format: `https://jacob-work.flightway.pages.dev` when using one project with preview deployments.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| 404 on `/chat`, `/account` | Confirm `/functions/` at repo root and `COACH_KV` bound |
| Email fails | Set `RESEND_API_KEY`, verify `FROM_EMAIL` in Resend |
| Coach says take quiz first | Complete quiz or open hub with `#r=` / `fw_hub_quiz_v1` |
| Git Worker build fails | Use Pages project or `npm run deploy`, not `wrangler deploy` |
| Entrepreneur always #1 on hub | Take quiz; hub reads `fw_hub_quiz_v1` or URL token |

Legacy redirect: `/dreamforce.html` → `/Flightway.html` via `_redirects`.
