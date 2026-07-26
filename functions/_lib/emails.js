// FlightWay V2 S4 — the lifecycle email CONTENT builders. Each returns
// { subject, html, text, listUnsubscribe? } built on the shared shell/footer in
// email-template.js, so the send site only does sendMail(env, {...}). Imported by
// both Pages Functions (register) and the standalone cron Worker (day-3, digest),
// so it stays pure like everything else in _lib/.

import { renderEmail, marketingFooter, transactionalFooter, siteBase } from './email-template.js';
import { daysUntil, closesPhrase } from './deadline-core.js';
import { renderMarkdown } from './broadcast.js';

const P = 'font-size:15px;line-height:1.65;color:#c3ccea;margin:0 0 16px';
const H = 'margin:24px 0 8px;font-size:15px;font-weight:700;color:#e8edff';
const MUTED = 'color:#8a93ac';
const UL = 'padding-left:20px;margin:0 0 4px;font-size:15px;line-height:1.5;color:#e8edff';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function para(text) { return `<p style="${P}">${esc(text)}</p>`; }

/** "Confirm your email" — transactional (no unsubscribe on a verification mail). */
export function verifyEmail(env, email, verifyUrl) {
  const intro = 'You’re in. Confirm this email so we can save your matches and send your '
    + 'weekly Flight Plan and reminders. This link works for 48 hours.';
  const { html, text } = renderEmail({
    preheader: 'Confirm your email to turn on your weekly Flight Plan and reminders.',
    heading: 'Confirm your email',
    bodyHtml: para(intro),
    bodyText: intro,
    cta: { label: 'Confirm my email', url: verifyUrl },
    footer: transactionalFooter(),
  });
  return { subject: 'Confirm your FlightWay email', html, text };
}

/** Welcome — the first lifecycle email (marketing footer, one-click unsub). Sent
 * immediately at signup. Honest tease: it does not fabricate a specific match
 * (S6's reveal computes those); it points to the hub where the real matches live. */
export async function welcomeEmail(env, email) {
  const base = siteBase(env);
  const footer = await marketingFooter(env, email, {
    category: 'all',
    why: 'You’re getting this because you just created a FlightWay account.',
  });
  const body = [
    'FlightWay is your career co-pilot: you tell it where you want to go, it builds the '
      + 'week-by-week plan to get there — and chases you to actually do it.',
    'Your career matches are ready. Open your hub to see your top 10, why each one fits, '
      + 'and turn the strongest into a real roadmap.',
  ];
  const { html, text } = renderEmail({
    preheader: 'Your matches are ready — here’s how to start.',
    heading: 'Welcome to FlightWay',
    bodyHtml: body.map(para).join(''),
    bodyText: body.join('\n\n'),
    cta: { label: 'See your matches', url: `${base}/portal.html` },
    footer,
  });
  return { subject: 'Welcome to FlightWay — your matches are ready', html, text, listUnsubscribe: footer.listUnsubscribe };
}

/** Day-3 follow-up — "your matches are waiting" (marketing footer). Sent by the
 * cron dispatcher, exactly once per user, email_log-guarded, verified + opted-in. */
export async function day3Email(env, email) {
  const base = siteBase(env);
  const footer = await marketingFooter(env, email, {
    category: 'all',
    why: 'You’re getting this because you created a FlightWay account a few days ago.',
  });
  const body = [
    'Quick nudge: the students who get the most out of FlightWay turn one match into a '
      + 'roadmap in the first week — then the weekly Flight Plan keeps it moving.',
    'It takes about two minutes to start. Pick the path that pulls at you and we’ll break '
      + 'it into the next few concrete steps.',
  ];
  const { html, text } = renderEmail({
    preheader: 'Turn a match into a roadmap in about two minutes.',
    heading: 'Your matches are waiting',
    bodyHtml: body.map(para).join(''),
    bodyText: body.join('\n\n'),
    cta: { label: 'Build your roadmap', url: `${base}/roadmap.html` },
    footer,
  });
  return { subject: 'Your FlightWay matches are waiting', html, text, listUnsubscribe: footer.listUnsubscribe };
}

/**
 * How a commitment reads in an email. Neutral by design: "3 days late" states a
 * fact, where "you're 3 days late" is the scolding Marco's own follow-through
 * rules forbid — and an email is the one place nobody can reply to explain.
 */
function commitWhen(c) {
  const n = c.daysOut;
  if (!Number.isFinite(n)) return 'no date';
  if (n < 0) return `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} late`;
  if (n === 0) return 'due today';
  if (n === 1) return 'due tomorrow';
  return `due in ${n} days`;
}

/**
 * The teaser slot (§5 S11, D18). Rendered as a bordered aside rather than a
 * body paragraph so it reads as an ad and is skippable — a promotional line
 * disguised as coaching is how an email stops being trusted.
 */
function teaserBlock(t) {
  if (!t) return { html: '', text: '' };
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 4px">`
    + `<tr><td style="border:1px solid #223056;border-radius:12px;padding:16px 18px;background:#0e1530">`
    + `<p style="margin:0 0 6px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;${MUTED}">`
    + `${t.kind === 'upgrade' ? 'With Premium' : 'Included in your plan'}</p>`
    + `<p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#f3f6ff">${esc(t.headline)}</p>`
    + `<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#c3ccea">${esc(t.line)}</p>`
    + `<a href="${esc(t.ctaUrl)}" style="color:#8fb6ff;text-decoration:underline;font-size:14px">${esc(t.ctaLabel)} →</a>`
    + `</td></tr></table>`;
  const text = `\n\n${t.headline}\n${t.line}\n${t.ctaLabel}: ${t.ctaUrl}`;
  return { html, text };
}

/** Marco's one line. A quoted note, so it is visibly him and not the product. */
function marcoBlock(line) {
  if (!line) return { html: '', text: '' };
  return {
    html: `<p style="margin:24px 0 4px;padding-left:14px;border-left:3px solid #6ea8ff;font-size:15px;`
      + `line-height:1.6;color:#c3ccea"><span style="${MUTED};font-size:12px;display:block;margin-bottom:4px">`
      + `Marco</span>${esc(line)}</p>`,
    text: `\n\nMarco: ${line}`,
  };
}

/**
 * The weekly Flight Plan digest (§5 S11). Takes the COMPOSED digest from
 * `_lib/digest.js` rather than raw lists — the decision of what goes in it and
 * in what order lives there, and this function only decides how it looks. That
 * split is what lets `test:cron` assert the content model and `test:emails`
 * assert the rendering without either one having to fake the other.
 */
export async function weeklyDigestEmail(env, email, digest) {
  const base = siteBase(env);
  const d = digest || {};
  const footer = await marketingFooter(env, email, {
    category: 'weekly',
    why: 'You’re getting this because your weekly Flight Plan email is on (one email a week).',
  });

  const tasks = d.tasks || [];
  const deadlines = d.deadlines || [];
  const commitments = d.commitments || [];
  const n = tasks.length;

  const htmlParts = [];
  const textParts = [];

  // S18 — the term line frames everything under it, so it goes above the streak
  // rather than into a section of its own: "Week 6 of 15 · Fall 2026" changes how
  // the three tasks below it read, and a student five weeks from finals reads the
  // same list differently from one in week two. Empty (and absent) for every
  // student who has not told us their dates, which is most of them.
  if (d.termLine) {
    htmlParts.push(`<p style="margin:0 0 10px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;${MUTED}">${esc(d.termLine)}</p>`);
    textParts.push(d.termLine);
  }

  if (d.streak) {
    htmlParts.push(`<p style="margin:0 0 16px;font-size:14px;${MUTED}">${esc(d.streak)}</p>`);
    textParts.push(d.streak);
  }

  if (n) {
    htmlParts.push(para('Finish these to move your career coordinates — that’s the whole point.'));
    htmlParts.push(`<ol style="padding-left:20px;margin:0 0 4px;font-size:16px;line-height:1.5;color:#e8edff">`
      + tasks.map((t) => `<li style="margin:0 0 10px">${esc(t.label)}`
        + (t.waypointTitle ? ` <span style="${MUTED}">— ${esc(t.waypointTitle)}</span>` : '')
        + '</li>').join('')
      + '</ol>');
    textParts.push('Finish these to move your career coordinates:\n'
      + tasks.map((t, i) => `${i + 1}. ${t.label}${t.waypointTitle ? ' — ' + t.waypointTitle : ''}`).join('\n'));
  }

  // Deadlines before commitments: an application window is imposed on the
  // student and cannot be moved; a date they set themselves can.
  if (deadlines.length) {
    htmlParts.push(`<p style="${H}">Closing soon:</p>`);
    htmlParts.push(`<ul style="${UL}">`
      + deadlines.map((x) => {
        const name = x.url
          ? `<a href="${esc(x.url)}" style="color:#8fb6ff;text-decoration:underline">${esc(x.title)}</a>`
          : esc(x.title);
        return `<li style="margin:0 0 8px">${name}`
          + (x.org ? ` <span style="${MUTED}">— ${esc(x.org)}</span>` : '')
          + `<br><span style="${MUTED};font-size:13px">${esc(x.date)} · ${esc(x.when)}</span></li>`;
      }).join('')
      + '</ul>');
    textParts.push('Closing soon:\n'
      + deadlines.map((x) => `- ${x.title}${x.org ? ' — ' + x.org : ''} (${x.date}, ${x.when})`).join('\n'));
  }

  if (commitments.length) {
    htmlParts.push(`<p style="${H}">You said you would:</p>`);
    htmlParts.push(`<ul style="${UL}">`
      + commitments.map((c) => `<li style="margin:0 0 8px">${esc(c.text)}`
        + ` <span style="${MUTED}">— ${esc(commitWhen(c))}</span></li>`).join('')
      + '</ul>');
    textParts.push('You said you would:\n'
      + commitments.map((c) => `- ${c.text} — ${commitWhen(c)}`).join('\n'));
  }

  // S17 — the stale-draft nudge, above the applications line because it ASKS for
  // something (send it) where that one only reports. Its link carries the
  // `#network` fragment, so the click lands on the list rather than at the top of
  // a long Flight Plan; the UTM is built by digest.js so the query sits BEFORE
  // the `#` (composeDigest's own trap — a query after the fragment never reaches
  // the beacon and the attribution silently disappears while the link still works).
  if (d.staleDraftsLine) {
    htmlParts.push(`<p style="${H}">${esc(d.staleDraftsLine)}</p>`);
    htmlParts.push(`<p style="margin:0;font-size:14px;${MUTED}">A message you never send is worth `
      + 'exactly as much as one you never wrote. '
      + `<a href="${esc(d.staleDraftsUrl || `${base}/flightplan.html#network`)}" `
      + 'style="color:#8fb6ff;text-decoration:underline">Open your network list</a></p>');
    textParts.push(`${d.staleDraftsLine} A message you never send is worth exactly as much as one you `
      + `never wrote. Open your network list: ${d.staleDraftsUrl || `${base}/flightplan.html#network`}`);
  }

  // S12 — one line, last, and only when it is non-zero. It reports what already
  // happened rather than asking for anything, so it sits below the asks.
  if (d.applicationsLine) {
    htmlParts.push(`<p style="margin:22px 0 0;font-size:14px;${MUTED}">${esc(d.applicationsLine)} `
      + `<a href="${base}/applications.html?utm_source=email&utm_medium=digest&utm_campaign=weekly" `
      + `style="color:#8fb6ff;text-decoration:underline">Open your tracker</a></p>`);
    textParts.push(`${d.applicationsLine} Open your tracker: ${base}/applications.html`);
  }

  const marco = marcoBlock(d.marcoLine);
  const teaser = teaserBlock(d.teaser);

  const subject = n
    ? `Your ${n} Flight Plan task${n === 1 ? '' : 's'} this week`
    : (deadlines.length ? `${deadlines[0].title} ${deadlines[0].when}` : 'Your week on FlightWay');

  const { html, text } = renderEmail({
    preheader: n
      ? `Your ${n} Flight Plan task${n === 1 ? '' : 's'} this week.`
      : (deadlines.length ? `${deadlines[0].title} ${deadlines[0].when}.` : 'What’s open this week.'),
    heading: n ? `Your ${n} task${n === 1 ? '' : 's'} this week` : 'Your week on FlightWay',
    bodyHtml: htmlParts.join('') + marco.html + teaser.html,
    bodyText: textParts.join('\n\n') + marco.text + teaser.text,
    cta: {
      label: 'Open your Flight Plan',
      url: `${base}/flightplan.html?utm_source=email&utm_medium=digest&utm_campaign=weekly`,
    },
    footer,
  });
  return { subject, html, text, listUnsubscribe: footer.listUnsubscribe };
}

/**
 * Month in Review (D13) — the one email a month that asks for nothing. Every
 * section is skipped when empty rather than rendered as a zero: "0 deadlines
 * hit" is a sentence that makes a quiet month feel like a failure, and the
 * headline already handles that case honestly.
 */
export async function monthReviewEmail(env, email, review) {
  const base = siteBase(env);
  const r = review || {};
  const footer = await marketingFooter(env, email, {
    category: 'review',
    why: 'You’re getting this because your monthly review email is on (one email a month).',
  });

  const url = `${base}/review?m=${encodeURIComponent(r.month || '')}`
    + '&utm_source=email&utm_medium=review&utm_campaign=monthly';
  const htmlParts = [para(r.headline || '')];
  const textParts = [r.headline || ''];

  const list = (title, rows, fmt) => {
    if (!rows || !rows.length) return;
    htmlParts.push(`<p style="${H}">${esc(title)}</p>`);
    htmlParts.push(`<ul style="${UL}">${rows.map((x) => `<li style="margin:0 0 8px">${fmt.html(x)}</li>`).join('')}</ul>`);
    textParts.push(`${title}\n${rows.map((x) => `- ${fmt.text(x)}`).join('\n')}`);
  };

  if (r.activity && r.activity.length) {
    list('What you did', r.activity, {
      html: (a) => `${esc(String(a.count))} <span style="${MUTED}">${esc(a.count === 1 ? a.one : a.label)}</span>`,
      text: (a) => `${a.count} ${a.count === 1 ? a.one : a.label}`,
    });
  }
  list('Deadlines you hit', r.deadlinesHit, {
    html: (d) => `${esc(d.title)}${d.org ? ` <span style="${MUTED}">— ${esc(d.org)}</span>` : ''}`,
    text: (d) => `${d.title}${d.org ? ' — ' + d.org : ''}`,
  });
  list('Deadlines that passed', r.deadlinesMissed, {
    html: (d) => `${esc(d.title)} <span style="${MUTED}">— ${esc(d.date)}</span>`,
    text: (d) => `${d.title} — ${d.date}`,
  });
  list('Commitments you kept', r.commitmentsKept, {
    html: (c) => esc(c.text),
    text: (c) => c.text,
  });
  list('Commitments that slipped', r.commitmentsSlipped, {
    html: (c) => `${esc(c.text)} <span style="${MUTED}">— was due ${esc(c.dueAt)}</span>`,
    text: (c) => `${c.text} — was due ${c.dueAt}`,
  });
  // S12 — the two sections S11 left present-and-empty. Same `list` helper, so
  // they skip themselves on a month with neither, exactly like the rest.
  list('Proof you added', r.evidence, {
    html: (e) => `${esc(e.title)}${e.type ? ` <span style="${MUTED}">— ${esc(e.type)}</span>` : ''}`,
    text: (e) => `${e.title}${e.type ? ' — ' + e.type : ''}`,
  });
  list('Applications you moved', r.applications, {
    html: (a) => `${esc(a.role)}${a.company ? ` <span style="${MUTED}">— ${esc(a.company)}</span>` : ''}`
      + ` <span style="${MUTED}">→ ${esc(a.status)}</span>`,
    text: (a) => `${a.role}${a.company ? ' — ' + a.company : ''} → ${a.status}`,
  });

  // S20 — the three sections S16/S17/S18 shipped without. Same skip-when-empty
  // rule as everything above; the composer already decided what counts.
  if (r.outreach && r.outreach.advanced) {
    const o = r.outreach;
    const bits = [
      o.drafted ? `${o.drafted} drafted` : '',
      o.sent ? `${o.sent} sent` : '',
      o.replied ? `${o.replied} replied` : '',
      o.met ? `${o.met} met` : '',
    ].filter(Boolean).join(', ');
    const line = `${o.advanced} contact${o.advanced === 1 ? '' : 's'} moved forward${bits ? ` — ${bits}` : ''}.`;
    htmlParts.push(`<p style="${H}">Your outreach</p>${para(line)}`);
    textParts.push(`Your outreach\n${line}`);
  }

  if (r.readiness && r.readiness.measured) {
    const rd = r.readiness;
    const line = rd.from == null
      ? `Your live-posting readiness stands at ${rd.score}%.`
      : (rd.delta === 0
        ? `Your live-posting readiness held at ${rd.score}%.`
        : `Your live-posting readiness moved from ${rd.from}% to ${rd.score}%.`);
    htmlParts.push(`<p style="${H}">Job-posting readiness</p>${para(line)}`);
    textParts.push(`Job-posting readiness\n${line}`);
  }

  if (r.movement && r.movement.measured && (r.movement.up || r.movement.down)) {
    const m = r.movement;
    const line = `Your career coordinates moved on ${m.up + m.down} dimension${m.up + m.down === 1 ? '' : 's'} `
      + `(${m.up} up, ${m.down} down) across ${m.weeks} weekly snapshots.`;
    htmlParts.push(`<p style="${H}">Your coordinates</p>${para(line)}`);
    textParts.push(`Your coordinates\n${line}`);
  }

  if (r.term && r.term.present) {
    const name = r.term.label || 'Your term';
    const line = r.term.ended
      ? `${name} wrapped up on ${r.term.endDate} — the end-of-term review has its own email.`
      : `${name} — you closed the month at week ${r.term.week} of ${r.term.total}.`;
    htmlParts.push(`<p style="${H}">Your term</p>${para(line)}`);
    textParts.push(`Your term\n${line}`);
  }

  if (r.nextFocus && r.nextFocus.text) {
    const line = r.nextFocus.kind === 'commitment'
      ? `Next month, one thing: “${r.nextFocus.text}”${r.nextFocus.dueAt ? ` (due ${r.nextFocus.dueAt})` : ''}.`
      : `Next month, one thing: ${r.nextFocus.text}.`;
    htmlParts.push(`<p style="${H}">One focus</p>${para(line)}`);
    textParts.push(`One focus\n${line}`);
  }

  const heading = `${r.label || 'Your month'} in review`;
  const { html, text } = renderEmail({
    preheader: r.headline || heading,
    heading,
    bodyHtml: htmlParts.join(''),
    bodyText: textParts.join('\n\n'),
    cta: { label: 'See the full review', url },
    footer,
  });
  return { subject: heading, html, text, listUnsubscribe: footer.listUnsubscribe };
}

/**
 * S18 — "your term is over, the review is ready" (§5 S18: "Both ritual moments
 * get … email triggers (cron: term boundaries)").
 *
 * Category `review`, alongside the Month in Review, because it is the same kind
 * of thing: a retrospective that asks for nothing. It carries NO numbers — the
 * review is computed when the student opens it, and an email that quotes a figure
 * the page then recomputes is an email that can be wrong by the time it is read.
 */
export async function termReviewEmail(env, email, term) {
  const base = siteBase(env);
  const t = term || {};
  const footer = await marketingFooter(env, email, {
    category: 'review',
    why: 'You’re getting this because your review emails are on (one at the end of each term).',
  });
  const label = String(t.label || 'your term');
  const body = [
    `${label} is over. Your review is ready: what you actually finished, what slipped, the `
      + 'proof you added, and how far your career coordinates moved across the whole term.',
    'It also unlocks one extra roadmap rebuild — because a term that changed what you want '
      + 'should be allowed to change the plan.',
  ];
  const { html, text } = renderEmail({
    preheader: `${label} is done — here’s what actually moved.`,
    heading: `${label} in review`,
    bodyHtml: body.map(para).join(''),
    bodyText: body.join('\n\n'),
    cta: {
      label: 'Open your term review',
      url: `${base}/flightplan.html?utm_source=email&utm_medium=review&utm_campaign=term_review#semester`,
    },
    footer,
  });
  return { subject: `${label} in review`, html, text, listUnsubscribe: footer.listUnsubscribe };
}

/**
 * S18 — "your term started and you never set it up".
 *
 * Category `product` rather than `review`: this is a prompt to use a feature, and
 * a student who unsubscribed from retrospectives did not ask to stop being
 * offered things. Sent at most once per term (`termSetupType`) and only inside
 * the first fortnight — after that the moment has passed and the mail is a nag.
 */
export async function termSetupEmail(env, email, term) {
  const base = siteBase(env);
  const t = term || {};
  const footer = await marketingFooter(env, email, {
    category: 'product',
    why: 'You’re getting this because product updates are on for your FlightWay account.',
  });
  const label = String(t.label || 'Your term');
  const body = [
    `${label} has started. Name three things you want to be true by the end of it and `
      + 'FlightWay dates them across the weeks — so they arrive as work you scheduled rather '
      + 'than as a panic in the last fortnight.',
    'It takes about two minutes, and every week after it is easier because of it.',
  ];
  const { html, text } = renderEmail({
    preheader: 'Three outcomes, dated across the term. Two minutes.',
    heading: 'Set up your term',
    bodyHtml: body.map(para).join(''),
    bodyText: body.join('\n\n'),
    cta: {
      label: 'Pick your three outcomes',
      url: `${base}/flightplan.html?utm_source=email&utm_medium=lifecycle&utm_campaign=term_setup#semester`,
    },
    footer,
  });
  return { subject: `Set up ${label.toLowerCase().startsWith('your') ? label.toLowerCase() : label}`, html, text, listUnsubscribe: footer.listUnsubscribe };
}

/**
 * An admin broadcast (D11). The body is admin-authored markdown, rendered by
 * `renderMarkdown` — which escapes BEFORE emitting any tag, so the only markup
 * that reaches an inbox is markup this codebase produced. Category `product`,
 * so unsubscribing from product updates does not touch the weekly plan.
 */
export async function broadcastEmail(env, email, { subject, bodyMd }) {
  const footer = await marketingFooter(env, email, {
    category: 'product',
    why: 'You’re getting this because product updates are on for your FlightWay account.',
  });
  const body = renderMarkdown(bodyMd);
  const { html, text } = renderEmail({
    preheader: String(subject || '').slice(0, 120),
    heading: String(subject || ''),
    bodyHtml: body.html,
    bodyText: body.text,
    footer,
  });
  return { subject: String(subject || ''), html, text, listUnsubscribe: footer.listUnsubscribe };
}

/**
 * S9 — the Deadline Radar alert (D12). ONE email per user per tier per night,
 * listing every deadline of theirs that landed in that window, rather than one
 * email per deadline: three separate "a deadline is coming" mails in one
 * evening is how a useful warning becomes something people filter.
 *
 * Category `deadlines`, so the one-click unsubscribe turns off exactly this and
 * leaves the weekly plan alone. The CTA carries UTM so the click shows up as an
 * attributed `page_view` — the plan's `deadline_alert_click` is measured that
 * way rather than with a tracking pixel (open-tracking is a §9 non-goal).
 *
 * @param tier 't3' (closing within a week) | 't14' (about two weeks out)
 */
export async function deadlineAlertEmail(env, email, items, tier, now = Date.now()) {
  const base = siteBase(env);
  const soon = tier === 't3';
  const footer = await marketingFooter(env, email, {
    category: 'deadlines',
    why: 'You’re getting this because deadline alerts are on for your FlightWay account.',
  });
  const rows = (items || []).map((d) => {
    const out = daysUntil(d.due_date || d.deadline, now);
    return {
      title: String(d.title || ''),
      org: String(d.org || ''),
      url: /^https:\/\//i.test(String(d.url || '')) ? String(d.url) : '',
      when: closesPhrase(out),
      date: String(d.due_date || d.deadline || ''),
    };
  }).filter((r) => r.title && r.date);

  const n = rows.length;
  const lead = soon
    ? 'These close within the week. If one matters, block out time for it now — this is the part that is genuinely hard to undo later.'
    : 'These are about two weeks out. Two weeks is enough time to do them properly, which is the only reason we tell you this early.';

  const itemsHtml = rows.map((r) => {
    const name = r.url
      ? `<a href="${esc(r.url)}" style="color:#8fb6ff;text-decoration:underline">${esc(r.title)}</a>`
      : esc(r.title);
    return `<li style="margin:0 0 12px">${name}`
      + (r.org ? ` <span style="color:#8a93ac">— ${esc(r.org)}</span>` : '')
      + `<br><span style="color:#8a93ac;font-size:13px">${esc(r.date)} · ${esc(r.when)}</span></li>`;
  }).join('');

  const bodyHtml = para(lead)
    + `<ul style="padding-left:20px;margin:0 0 4px;font-size:16px;line-height:1.5;color:#e8edff">${itemsHtml}</ul>`;
  const bodyText = `${lead}\n\n`
    + rows.map((r) => `- ${r.title}${r.org ? ' — ' + r.org : ''} (${r.date}, ${r.when})${r.url ? '\n  ' + r.url : ''}`).join('\n');

  const heading = soon
    ? `${n} deadline${n === 1 ? '' : 's'} closing soon`
    : `${n} deadline${n === 1 ? '' : 's'} in about two weeks`;
  const { html, text } = renderEmail({
    preheader: `${rows[0] ? rows[0].title + ' ' + rows[0].when : heading}.`,
    heading,
    bodyHtml,
    bodyText,
    cta: {
      label: 'Open my Deadline Radar',
      url: `${base}/flightplan.html?utm_source=email&utm_medium=deadline&utm_campaign=${soon ? 't3' : 't14'}#deadlines`,
    },
    footer,
  });
  return { subject: heading, html, text, listUnsubscribe: footer.listUnsubscribe };
}

/**
 * S15 (D24) — "you earned a free month". Sent to the REFERRER the moment the
 * Stripe customer-balance credit lands, from the webhook.
 *
 * Marketing footer with an unsubscribe, not a transactional one: the money is
 * real but the message is still promotional in tone (it ends by asking for
 * another referral), and a promotional ask under a transactional footer is
 * exactly the trust erosion the S11 teaser rules exist to prevent. `product` is
 * the category — someone who has turned product email off should not get this.
 */
export async function referralCreditEmail(env, email, { cents = 0, currency = 'usd' } = {}) {
  const base = siteBase(env);
  const amount = Number(cents) > 0
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'usd').toUpperCase() })
      .format(Number(cents) / 100)
    : '';
  const footer = await marketingFooter(env, email, {
    category: 'product',
    why: 'You’re getting this because someone you invited to FlightWay subscribed.',
  });
  const body = [
    amount
      ? `Someone you invited just subscribed, so ${amount} of credit is now sitting on your FlightWay account. It comes off your next invoice automatically — there is nothing to redeem.`
      : 'Someone you invited just subscribed, so a month of credit is now sitting on your FlightWay account. It comes off your next invoice automatically — there is nothing to redeem.',
    'Thanks for that. If you know anyone else staring at a career decision with no method behind it, your link still works.',
  ];
  const { html, text } = renderEmail({
    preheader: 'A friend you invited subscribed — your credit is on your account.',
    heading: 'You earned a free month',
    bodyHtml: body.map(para).join(''),
    bodyText: body.join('\n\n'),
    cta: { label: 'Get my invite link', url: `${base}/invite?utm_source=email&utm_medium=referral&utm_campaign=credit` },
    footer,
  });
  return { subject: 'Your FlightWay referral credit is in', html, text, listUnsubscribe: footer.listUnsubscribe };
}

/** The referee's half. Closes the loop out loud — the person who was referred is
 *  the likeliest next referrer, and this is the one moment they are thinking
 *  about the friend who sent them. */
export async function referralThanksEmail(env, email) {
  const base = siteBase(env);
  const footer = await marketingFooter(env, email, {
    category: 'product',
    why: 'You’re getting this because you joined FlightWay through a friend’s invite.',
  });
  const body = [
    'Quick note: the friend whose link brought you here just got a free month, because you subscribed. That is how the invite works — both sides get something.',
    'You have a link of your own now. Same deal: your friend gets their first month free, you get a month credited when they subscribe.',
  ];
  const { html, text } = renderEmail({
    preheader: 'Your friend got their free month — and you have a link of your own.',
    heading: 'Thanks — that counted',
    bodyHtml: body.map(para).join(''),
    bodyText: body.join('\n\n'),
    cta: { label: 'Get my invite link', url: `${base}/invite?utm_source=email&utm_medium=referral&utm_campaign=thanks` },
    footer,
  });
  return { subject: 'Your friend just got a free month', html, text, listUnsubscribe: footer.listUnsubscribe };
}
