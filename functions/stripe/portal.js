// FlightWay — POST /stripe/portal (free/paid merge §3).
//
// Self-serve cancel / change-plan / update-card, handed off to Stripe's hosted
// Customer Portal rather than rebuilt here. Session-gated; only works once a
// purchase has given the user a stripe_customer_id (the webhook records it).
//
//   POST {} → { url }

import { originFromEnv, jsonResponse, preflightResponse } from '../_lib.js';
import { getSessionEmail, checkRateLimit, clientIp } from '../_lib/auth.js';
import { stripeConfigured, createPortalSession } from '../_lib/stripe.js';

export async function onRequestOptions(context) {
  return preflightResponse(originFromEnv(context.env, context.request));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const email = await getSessionEmail(request, env);
  if (!email) return jsonResponse(401, { error: 'Not signed in.' }, origin);

  try {
    await checkRateLimit(env, `billportal:${clientIp(request)}`, { max: 20 });
  } catch (err) {
    return jsonResponse(err.status || 429, { error: err.message || 'Too many attempts.' }, origin);
  }

  if (!stripeConfigured(env)) return jsonResponse(503, { error: 'Billing is not available yet.' }, origin);

  let customerId = '';
  try {
    const row = await env.DB.prepare('SELECT stripe_customer_id FROM users WHERE email = ?')
      .bind(email).first();
    customerId = (row && row.stripe_customer_id) || '';
  } catch (err) {
    console.error('stripe portal: user lookup failed', err?.message);
  }
  if (!customerId) {
    return jsonResponse(404, { error: 'No billing account yet.', noCustomer: true }, origin);
  }

  const site = new URL(request.url).origin;
  try {
    const session = await createPortalSession(env, {
      customer: customerId,
      return_url: `${site}/portal.html`,
    });
    if (!session || !session.url) return jsonResponse(502, { error: 'Stripe did not return a portal link.' }, origin);
    return jsonResponse(200, { url: session.url }, origin);
  } catch (err) {
    console.error('stripe portal failed', err?.status, err?.stripeCode, err?.message);
    return jsonResponse(502, { error: 'Could not open billing. Try again in a moment.' }, origin);
  }
}
