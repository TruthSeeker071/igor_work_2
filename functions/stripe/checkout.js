// FlightWay — POST /stripe/checkout (free/paid merge §3).
//
// Session-gated. Turns one of pricing.html's four data-tier values into a Stripe
// Checkout Session and hands the client the hosted URL. No SDK (see _lib/stripe.js).
// The entitlement itself is never written here — only the webhook may write plan
// columns, because only the webhook has proof the money moved.
//
//   POST { tier: 'monthly'|'annual'|'lifetime'|'sprint' } → { url }

import { originFromEnv, jsonResponse, preflightResponse } from '../_lib.js';
import { getSessionEmail, checkRateLimit, clientIp } from '../_lib/auth.js';
import { SKUS, stripeConfigured, priceIdFor, createCheckoutSession } from '../_lib/stripe.js';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

async function customerIdFor(env, email) {
  try {
    const row = await env.DB.prepare('SELECT stripe_customer_id FROM users WHERE email = ?')
      .bind(email).first();
    return (row && row.stripe_customer_id) || '';
  } catch {
    return '';
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Sign in to start your Flight Plan.' }, origin);

  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body.' }, origin); }
  const tier = String(body?.tier || '').trim().toLowerCase();
  const sku = SKUS[tier];
  if (!sku) return jsonResponse(400, { error: 'Unknown plan tier.' }, origin);

  try {
    await checkRateLimit(env, `checkout:${clientIp(request)}`, { max: 20 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  if (!stripeConfigured(env)) {
    return jsonResponse(503, { error: 'Checkout is not available yet.' }, origin);
  }
  const price = priceIdFor(env, tier);
  if (!price) {
    console.error('stripe checkout: missing price env', sku.priceEnv);
    return jsonResponse(503, { error: 'That plan is not purchasable yet.' }, origin);
  }

  // Redirect targets must be this site, not the CORS origin.
  const site = new URL(request.url).origin;
  const metadata = { email, tier };

  const form = {
    mode: sku.mode,
    line_items: [{ price, quantity: 1 }],
    client_reference_id: email,
    metadata,
    success_url: `${site}/portal.html?checkout=success&tier=${encodeURIComponent(tier)}`,
    cancel_url: `${site}/pricing.html?checkout=cancelled`,
  };

  // Reuse the Stripe customer once we know it, so a returning buyer doesn't
  // fork into a second customer record (which would break the portal link).
  const existing = await customerIdFor(env, email);
  if (existing) form.customer = existing;
  else form.customer_email = email;

  if (sku.mode === 'subscription') {
    // The live CTA says "Start free trial" for both cadences — honour it rather
    // than charging on click (§3/§9).
    form.subscription_data = { metadata };
    if (sku.trialDays) form.subscription_data.trial_period_days = sku.trialDays;
  } else {
    // One-time SKUs: carry the tier onto the PaymentIntent so lifetime and
    // sprint stay distinguishable at webhook time without a price-ID lookup.
    form.payment_intent_data = { metadata };
  }

  try {
    const session = await createCheckoutSession(env, form);
    if (!session || !session.url) {
      console.error('stripe checkout: session without url', session && session.id);
      return jsonResponse(502, { error: 'Stripe did not return a checkout link.' }, origin);
    }
    return jsonResponse(200, { url: session.url, sessionId: session.id }, origin);
  } catch (err) {
    console.error('stripe checkout failed', err?.status, err?.stripeCode, err?.message);
    return jsonResponse(502, { error: 'Could not start checkout. Try again in a moment.' }, origin);
  }
}
