// FlightWay — POST /stripe/webhook (free/paid merge §3).
//
// The ONLY place that writes plan columns off the back of a payment. Unauthed by
// design (Stripe calls it), so the signature is the auth: verifyWebhookSignature
// checks the HMAC and the timestamp before a single byte of the body is trusted.
//
// Delivery is at-least-once, so every event id is claimed in `stripe_events`
// before handling and released again if handling throws — a duplicate delivery
// no-ops, a genuinely failed one still gets retried by Stripe.
//
// Handled: checkout.session.completed (subscription → premium; payment →
// lifetime or a 14-day Sprint), customer.subscription.updated/.deleted (status
// sync). invoice.payment_failed is deliberately NOT a downgrade — Stripe's own
// dunning retries first, and the real transition arrives as a subscription
// status change.

import { originFromEnv, jsonResponse } from '../_lib.js';
import {
  verifyWebhookSignature, retrieveSubscription,
  lifetimeGrant, sprintGrant, subscriptionGrant,
} from '../_lib/stripe.js';
import { stripePlanWrite } from '../_lib/admin.js';
import { logServerEvent } from '../_lib/events.js';
import { creditReferrer } from '../_lib/referral.js';
import { sendMail } from '../_lib/email-template.js';
import { referralCreditEmail, referralThanksEmail } from '../_lib/emails.js';

const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.refunded',
  // S15 (D24): the only event that proves a SUBSCRIPTION referee actually paid.
  // It writes no plan columns — the subscription.* events own those.
  'invoice.payment_succeeded',
]);

/** INSERT OR IGNORE the event id. Returns false when it was already processed. */
async function claimEvent(env, id, type) {
  const res = await env.DB.prepare(
    'INSERT OR IGNORE INTO stripe_events (id, type, received_at) VALUES (?, ?, ?)',
  ).bind(id, String(type || '').slice(0, 80), new Date().toISOString()).run();
  return !!(res && res.meta && res.meta.changes === 1);
}

async function releaseEvent(env, id) {
  try { await env.DB.prepare('DELETE FROM stripe_events WHERE id = ?').bind(id).run(); } catch { /* retry-safe */ }
}

async function loadUserRow(env, email) {
  return env.DB.prepare('SELECT email, plan, plan_expires_at, stripe_customer_id FROM users WHERE email = ?')
    .bind(email).first();
}

async function emailForCustomer(env, customerId) {
  if (!customerId) return '';
  try {
    const row = await env.DB.prepare('SELECT email FROM users WHERE stripe_customer_id = ?')
      .bind(customerId).first();
    return (row && row.email) || '';
  } catch {
    return '';
  }
}

/**
 * Apply a grant. `{ skip:true }` writes nothing but still records the customer id.
 *
 * plan_source (migration 0016) is what keeps comps and purchases from fighting:
 * a purchase stamps 'stripe' and may overwrite a comp (money wins), but a
 * cancellation/expiry downgrade carries `AND plan_source != 'comp'` so it can
 * never strip a comp off a user who also once had a subscription.
 */
async function applyGrant(env, email, grant, customerId, prevPlan) {
  if (customerId) {
    await env.DB.prepare(
      'UPDATE users SET stripe_customer_id = ? WHERE email = ? AND (stripe_customer_id IS NULL OR stripe_customer_id != ?)',
    ).bind(customerId, email, customerId).run();
  }
  const write = stripePlanWrite(grant);
  if (!write) return;
  if (write.skipComp) {
    await env.DB.prepare(
      "UPDATE users SET plan = ?, plan_expires_at = ?, plan_source = ? WHERE email = ? AND (plan_source IS NULL OR plan_source != 'comp')",
    ).bind(write.plan, write.expiresAt, write.source, email).run();
    await recordPlanChanged(env, email, prevPlan, write);
    return;
  }
  await env.DB.prepare('UPDATE users SET plan = ?, plan_expires_at = ?, plan_source = ? WHERE email = ?')
    .bind(write.plan, write.expiresAt, write.source, email).run();
  await recordPlanChanged(env, email, prevPlan, write);
}

/**
 * S1 analytics: revenue events are written HERE, server-side, because a
 * client-side `checkout_success` depends on the buyer's browser surviving the
 * redirect back from Stripe — and the one number the business cannot afford to
 * under-count is the one that pays for it. logServerEvent swallows its own
 * failures by construction: an analytics insert must never fail the webhook and
 * push Stripe into a retry loop over a row nobody reads in real time.
 */
async function recordPlanChanged(env, email, prevPlan, write) {
  const from = String(prevPlan || 'free');
  const to = String(write.plan || 'free');
  if (from === to) return;
  await logServerEvent(env, 'plan_changed', {
    userId: email,
    path: '/stripe/webhook',
    props: { from, to, source: write.source || 'stripe' },
  });
}

async function handleCheckoutCompleted(env, session) {
  const meta = session.metadata || {};
  const email = String(meta.email || session.client_reference_id
    || (session.customer_details && session.customer_details.email) || '').trim().toLowerCase();
  if (!email) { console.error('stripe webhook: checkout session without an email', session.id); return; }
  if (session.payment_status === 'unpaid' && session.mode !== 'subscription') return;

  const row = await loadUserRow(env, email);
  if (!row) { console.error('stripe webhook: no user row for', email); return; }
  const customerId = typeof session.customer === 'string' ? session.customer : '';

  if (session.mode === 'subscription') {
    // Read the real subscription rather than assuming: it carries the status
    // (trialing vs active) and the period end the expiry is derived from.
    let sub = null;
    if (typeof session.subscription === 'string') {
      try { sub = await retrieveSubscription(env, session.subscription); } catch (err) {
        console.error('stripe webhook: subscription fetch failed', err?.message);
      }
    }
    const grant = sub
      ? subscriptionGrant(sub, row.plan)
      : subscriptionGrant({ status: 'active', current_period_end: 0 }, row.plan);
    await applyGrant(env, email, grant, customerId, row.plan);
    await recordCheckoutSuccess(env, email, 'subscription', String(meta.tier || meta.period || 'subscription'));
    return;
  }

  const tier = String(meta.tier || '').toLowerCase();
  if (tier === 'lifetime') {
    await applyGrant(env, email, lifetimeGrant(), customerId, row.plan);
    await recordCheckoutSuccess(env, email, 'payment', 'lifetime');
    if (session.payment_status === 'paid') await creditReferralFor(env, email);
  } else if (tier === 'sprint') {
    await applyGrant(env, email, sprintGrant(row.plan, row.plan_expires_at), customerId, row.plan);
    await recordCheckoutSuccess(env, email, 'payment', 'sprint');
    if (session.payment_status === 'paid') await creditReferralFor(env, email);
  } else {
    console.error('stripe webhook: one-time checkout with unknown tier', tier, session.id);
    await applyGrant(env, email, null, customerId, row.plan);
  }
}

/** The revenue event, written from the server so it cannot be lost to a redirect. */
async function recordCheckoutSuccess(env, email, mode, price) {
  await logServerEvent(env, 'checkout_success', {
    userId: email,
    path: '/stripe/webhook',
    props: { mode: String(mode || '').slice(0, 24), price: String(price || '').slice(0, 24) },
  });
}

/**
 * S15 (D24) — the referrer's month.
 *
 * Fired ONLY from paths where money genuinely moved, and that restriction is
 * load-bearing rather than fussy. `checkout.session.completed` also fires for a
 * 14-day trial and for a first invoice the referral coupon zeroed out; crediting
 * either would make the loop farmable — twelve throwaway accounts, twelve free
 * months redeemed, twelve months of credit issued against zero revenue. So a
 * subscription referee credits on the first invoice with `amount_paid > 0`, and
 * a one-time referee (Lifetime/Sprint) credits on the paid session itself.
 *
 * Swallows everything. A referral must never 500 this handler: the entitlement
 * was already written correctly above, and a 500 would send Stripe into a retry
 * loop that re-does the plan write for a row nobody is waiting on.
 */
async function creditReferralFor(env, email) {
  try {
    const res = await creditReferrer(env, email);
    if (!res || !res.ok) return;
    try {
      const a = await referralCreditEmail(env, res.referrer, { cents: res.cents, currency: res.currency });
      await sendMail(env, {
        to: res.referrer, subject: a.subject, html: a.html, text: a.text,
        type: 'referral_credit', listUnsubscribe: a.listUnsubscribe,
      });
      const b = await referralThanksEmail(env, res.referee);
      await sendMail(env, {
        to: res.referee, subject: b.subject, html: b.html, text: b.text,
        type: 'referral_thanks', listUnsubscribe: b.listUnsubscribe,
      });
    } catch (err) {
      console.error('referral: credit mail failed', err?.message);
    }
  } catch (err) {
    console.error('referral: credit path threw', err?.message);
  }
}

async function handleInvoicePaid(env, invoice) {
  if (!invoice || Number(invoice.amount_paid || 0) <= 0) return;
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : '';
  const email = String((invoice.metadata && invoice.metadata.email) || '').trim().toLowerCase()
    || String(invoice.customer_email || '').trim().toLowerCase()
    || await emailForCustomer(env, customerId);
  if (!email) return;
  await creditReferralFor(env, email);
}

async function handleSubscriptionEvent(env, sub) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : '';
  const email = String((sub.metadata && sub.metadata.email) || '').trim().toLowerCase()
    || await emailForCustomer(env, customerId);
  if (!email) { console.error('stripe webhook: subscription with no resolvable user', sub.id); return; }
  const row = await loadUserRow(env, email);
  if (!row) { console.error('stripe webhook: no user row for', email); return; }
  await applyGrant(env, email, subscriptionGrant(sub, row.plan), customerId, row.plan);
}

/**
 * A refund reverses the sale, so it must reverse the entitlement — otherwise
 * refunding a $199 lifetime leaves the buyer permanently premium and the only
 * remedy is hand-written SQL against production.
 *
 * Two guards make it safe to run automatically:
 *  · Only a FULL refund counts. Stripe sets `refunded: true` only when the
 *    whole charge is returned; a partial refund (goodwill credit, proration)
 *    leaves `refunded: false` and must not strip access someone still paid for.
 *  · Only `plan_source = 'stripe'` is touched. A comp is a gift that outlives
 *    any purchase, and a NULL source is a legacy/beta grant nobody paid for —
 *    neither is a refund's to take back.
 *
 * Known edge: refunding a one-off (Sprint) for someone who ALSO holds a live
 * subscription downgrades them until the next subscription.* event restores it.
 * Degrades toward briefly-free rather than wrongly-paid, and self-heals.
 */
async function handleChargeRefunded(env, charge) {
  if (!charge || charge.refunded !== true) return;

  const customerId = typeof charge.customer === 'string' ? charge.customer : '';
  const email = String((charge.metadata && charge.metadata.email) || '').trim().toLowerCase()
    || String((charge.billing_details && charge.billing_details.email) || '').trim().toLowerCase()
    || await emailForCustomer(env, customerId);
  if (!email) { console.error('stripe webhook: refund with no resolvable user', charge.id); return; }

  const res = await env.DB.prepare(
    "UPDATE users SET plan = 'free', plan_expires_at = NULL, plan_source = NULL WHERE email = ? AND plan_source = 'stripe'",
  ).bind(email).run();
  const revoked = ((res && res.meta && res.meta.changes) || 0) > 0;
  console.log(JSON.stringify({ type: 'refund_revoke', email, charge: charge.id, revoked }));
  if (revoked) {
    await logServerEvent(env, 'plan_changed', {
      userId: email,
      path: '/stripe/webhook',
      props: { from: 'premium', to: 'free', source: 'refund' },
    });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = originFromEnv(env, request);

  const secret = String(env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret || !env.DB) {
    console.error('stripe webhook: not configured');
    return jsonResponse(503, { error: 'Not configured.' }, origin);
  }

  const raw = await request.text();
  const verified = await verifyWebhookSignature(raw, request.headers.get('Stripe-Signature'), secret);
  if (!verified.ok) {
    console.error('stripe webhook: signature rejected', verified.reason);
    return jsonResponse(400, { error: 'Invalid signature.' }, origin);
  }

  let event;
  try { event = JSON.parse(raw); } catch { return jsonResponse(400, { error: 'Invalid payload.' }, origin); }
  const id = String(event?.id || '');
  const type = String(event?.type || '');
  if (!id) return jsonResponse(400, { error: 'Invalid payload.' }, origin);
  if (!HANDLED.has(type)) return jsonResponse(200, { ok: true, ignored: type }, origin);

  let claimed = false;
  try {
    claimed = await claimEvent(env, id, type);
  } catch (err) {
    console.error('stripe webhook: claim failed', err?.message);
    return jsonResponse(500, { error: 'Retry.' }, origin);
  }
  if (!claimed) return jsonResponse(200, { ok: true, duplicate: true }, origin);

  try {
    const object = event?.data?.object || {};
    if (type === 'checkout.session.completed') await handleCheckoutCompleted(env, object);
    else if (type === 'charge.refunded') await handleChargeRefunded(env, object);
    else if (type === 'invoice.payment_succeeded') await handleInvoicePaid(env, object);
    else await handleSubscriptionEvent(env, object);
  } catch (err) {
    // Un-claim so Stripe's retry is allowed to do the work.
    await releaseEvent(env, id);
    console.error('stripe webhook: handler failed', type, err?.message);
    return jsonResponse(500, { error: 'Retry.' }, origin);
  }
  return jsonResponse(200, { ok: true, type }, origin);
}
