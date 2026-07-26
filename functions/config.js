// FlightWay 2.0 — public rollout config for the client (Pillar 0.3).
// GET /config → { paywallEnabled, stripeEnabled }. Lets
// assets/js/shared/entitlements.js know whether to render upgrade gates, and
// assets/js/shared/billing.js whether real checkout exists on this deployment
// (it doesn't wherever the Stripe keys aren't set — pricing.html then keeps its
// fake-door intent modal). Booleans only: no auth, no secrets, no key material.

import {
  originFromEnv, jsonResponse, preflightResponse, geminiConfigFromEnv, resolveGeminiModels,
} from './_lib.js';
import { paywallEnabled } from './_lib/entitlements.js';
import { analyticsEnabled } from './_lib/events.js';
import { googleAuthConfigured } from './_lib/google-oauth.js';
import { publicFeatureLimits } from './_lib/plan-limits.js';
import { stripeConfigured, stripeTestMode } from './_lib/stripe.js';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

/** An env var read as a boolean. Anything but an explicit truthy word is off —
 *  a proposal that switches itself on because somebody set it to "no" would be
 *  a price change nobody approved. */
function flag(env, name) {
  const v = String((env && env[name]) || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const stripeEnabled = stripeConfigured(env);
  return jsonResponse(200, {
    paywallEnabled: paywallEnabled(env),
    stripeEnabled,
    // Surfaced so the UI can say "test mode" out loud instead of looking like a
    // real charge during the pre-launch validation run.
    stripeTestMode: stripeEnabled && stripeTestMode(env),
    // WS-G: the cap table itself, so pricing copy and usage meters quote the
    // enforced numbers rather than a copy of them. Static per deployment —
    // no user, no auth, nothing user-specific (that is /auth/me's `remaining`).
    featureLimits: publicFeatureLimits(),
    // Every Marco surface fails identically from outside — the client's error
    // gate turns any 5xx into one generic line (correctly: a student should
    // never read "set GEMINI_API_KEY"). That left "no key" indistinguishable
    // from "wrong model" from "code threw", and no gate in the suite calls
    // Gemini, so the whole class was invisible. `aiEnabled` is whether the key
    // is present, NOT whether it works; `aiModels` is the resolved cascade,
    // which is public product config, not key material.
    aiEnabled: !!geminiConfigFromEnv(env).apiKey,
    aiModels: resolveGeminiModels(env),
    // S1: the analytics kill switch. events.js reads it here rather than
    // guessing, so one env flip (ANALYTICS_ENABLED=false) stops every beacon on
    // every page without a deploy. Default true — a deployment that forgets the
    // var should still be able to see itself.
    analyticsEnabled: analyticsEnabled(env),
    // S2: the Turnstile SITE key is public by design (it ships in the widget's
    // markup on every site that uses one) — the secret half never leaves the
    // Worker. Served rather than hard-coded so the contact form renders the
    // challenge only on deployments Jacob actually configured, and degrades to
    // a plain form everywhere else instead of rendering a broken widget.
    turnstileSiteKey: (env && env.TURNSTILE_SITE_KEY) ? String(env.TURNSTILE_SITE_KEY) : '',
    // S5 (D6): whether the "Continue with Google" buttons render. True only when
    // BOTH GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set, so the branch ships
    // with the buttons hidden until Jacob creates the OAuth client — no dead
    // button, no half-configured flow. No key material is served; this is a bool.
    googleAuthEnabled: googleAuthConfigured(env),
    // S19 (D16): the two Jacob-gated product PROPOSALS. Both ship
    // design-complete and dark, and both are plain env booleans rather than
    // derived from a Stripe price the way `stripeEnabled` is — deliberately,
    // because neither is a purchasable SKU yet. §5 S19 says "build only the
    // PAGE affordances now, wire Stripe only after Jacob approves + creates
    // products", and D16 says no silent price changes: adding either to
    // `SKUS`/the webhook would make it buyable the moment a price id appeared,
    // which is the opposite of Jacob-gated. Flipping one on renders an
    // interest card whose CTA is the same capture the pre-Stripe pricing page
    // has always used; making it CHARGE is a follow-up code change, listed in
    // the S19 ledger entry.
    semesterPassEnabled: flag(env, 'SEMESTER_PASS_ENABLED'),
    giftEnabled: flag(env, 'GIFT_ENABLED'),
  }, originFromEnv(env, request));
}
