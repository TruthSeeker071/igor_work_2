/**
 * FWFeatureIntro — no feature is ever met cold.
 *
 * Two surfaces, one manifest, one persisted fact:
 *   - a full-screen interstitial the first time a student enters a feature
 *     (what it gives them, never what it is called), and
 *   - a quiet hint ribbon inside the feature afterwards.
 *
 * Persistence lives on the canonical user object at journey.featureIntros,
 * written through FWUser — signed out that is localStorage, signed in the same
 * blob syncs to D1 (auth.js mergeFeatureIntros unions the two, so a screen
 * already shown can never become unshown). One shape per feature:
 *     { seen: true, seenAt: <iso>, ribbonDismissed: true }
 *
 * Copy rules for the manifest (these are the product decision, not style):
 *   - `headline` is the OUTCOME in ≤ 9 words. "A resume built from what we
 *     already know about you" — never "Resume Builder".
 *   - each benefit is a concrete claim about what happens, never a category.
 *   - `visual` is an inline SVG scene drawn from theme tokens. No imagery.
 *
 * Load order: after user.js (state) and events.js (counters); lucide-lite must
 * be present on the page for benefit icons — a missing icon degrades to no
 * icon, never to broken markup.
 */
(function (global) {
  'use strict';

  var ICON_STROKE = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 84" fill="none" '
    + 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

  // ── Manifest ────────────────────────────────────────────────────────────
  // key → the feature. `entitlement` (optional) names the plan-limits feature
  // key: when the student's plan does not have it, the interstitial IS the
  // upsell and the CTA becomes the plan link.
  var FEATURES = {
    hub: {
      key: 'hub',
      eyebrow: 'Career Hub',
      headline: 'See every real career, scored against you',
      benefits: [
        { icon: 'compass', text: 'Around 900 real occupations, grouped by field — not a list of job titles you already know.' },
        { icon: 'sliders-horizontal', text: 'Each orb is sized and lit by how well it matches the answers you gave, dimension by dimension.' },
        { icon: 'sparkles', text: 'Click any orb and Marco will deep-dive it: the work, the pay, the path from where you are.' },
      ],
      cta: 'Open the map',
      skipLabel: 'Skip',
      ribbon: [
        'Click any orb — Marco can deep-dive it for you.',
        'Zoom into a field to see the careers inside it.',
        'Search jumps straight to a career you already have in mind.',
      ],
      visual: '<svg ' + ICON_STROKE + ' class="fw-intro-scene" aria-hidden="true">'
        + '<circle cx="34" cy="42" r="21" class="fw-intro-scene-faint" />'
        + '<circle cx="78" cy="34" r="15" class="fw-intro-scene-faint" />'
        + '<circle cx="72" cy="64" r="10" class="fw-intro-scene-faint" />'
        + '<circle cx="34" cy="42" r="7.5" class="fw-intro-scene-hot" fill="currentColor" stroke="none" />'
        + '<circle cx="26" cy="30" r="3" fill="currentColor" stroke="none" opacity="0.55" />'
        + '<circle cx="45" cy="52" r="4.2" fill="currentColor" stroke="none" opacity="0.75" />'
        + '<circle cx="78" cy="34" r="3.4" fill="currentColor" stroke="none" opacity="0.5" />'
        + '<circle cx="86" cy="42" r="2.2" fill="currentColor" stroke="none" opacity="0.35" />'
        + '<circle cx="72" cy="64" r="2.6" fill="currentColor" stroke="none" opacity="0.45" />'
        + '<path d="M41 46 L71 62" opacity="0.35" />'
        + '<path d="M41 38 L64 35" opacity="0.35" />'
        + '</svg>',
    },
    marco: {
      key: 'marco',
      eyebrow: 'Marco',
      headline: 'An advisor who has already read your file',
      benefits: [
        { icon: 'scroll-text', text: 'Marco reads your quiz, your roadmap, your resume and your school before every reply.' },
        { icon: 'map', text: 'Answers land in your context — your courses, your deadlines, the career you are aiming at.' },
        { icon: 'message-circle', text: 'He raises the thing you did not ask about when it is the thing that matters.' },
      ],
      cta: 'Start a conversation',
      skipLabel: 'Skip',
      ribbon: [
        'Ask Marco about a specific class, firm or deadline — he has your file.',
        'The panel on the right is what he is working from. Fix anything wrong there.',
        'Ask "what should I do this week?" for a plan you can actually act on.',
      ],
      visual: '<svg ' + ICON_STROKE + ' class="fw-intro-scene" aria-hidden="true">'
        + '<rect x="12" y="16" width="58" height="34" rx="9" class="fw-intro-scene-faint" />'
        + '<path d="M26 30 H56" opacity="0.55" /><path d="M26 39 H48" opacity="0.35" />'
        + '<path d="M28 50 L24 60 L38 50" class="fw-intro-scene-faint" />'
        + '<rect x="62" y="42" width="46" height="26" rx="8" class="fw-intro-scene-hot" />'
        + '<path d="M72 52 H98" opacity="0.55" /><path d="M72 60 H88" opacity="0.35" />'
        + '</svg>',
    },
    roadmap: {
      key: 'roadmap',
      eyebrow: 'Career Roadmap',
      headline: 'The path from this term to that job',
      benefits: [
        { icon: 'target', text: 'Pick a target career and get the classes, projects and applications that actually lead there.' },
        { icon: 'calendar-days', text: 'Laid out by term, so you know what to do this quarter and what can wait.' },
        { icon: 'repeat', text: 'It rewrites itself when your target changes, your grades land or a deadline moves.' },
      ],
      cta: 'Build my roadmap',
      skipLabel: 'Skip',
      ribbon: [
        'Click a step to have Marco break it into what you do this week.',
        'Change your target career and the whole plan re-derives around it.',
        'Steps you have already done can be marked complete — the plan reflows.',
      ],
      visual: '<svg ' + ICON_STROKE + ' class="fw-intro-scene" aria-hidden="true">'
        + '<path d="M14 66 C34 66 30 44 48 44 C66 44 62 22 84 22" class="fw-intro-scene-hot" />'
        + '<circle cx="14" cy="66" r="4" fill="currentColor" stroke="none" opacity="0.75" />'
        + '<circle cx="48" cy="44" r="4" fill="currentColor" stroke="none" opacity="0.55" />'
        + '<circle cx="84" cy="22" r="6.5" fill="currentColor" stroke="none" />'
        + '<path d="M14 74 H104" opacity="0.2" /><path d="M40 74 V70" opacity="0.2" />'
        + '<path d="M68 74 V70" opacity="0.2" /><path d="M96 74 V70" opacity="0.2" />'
        + '</svg>',
    },
    resume: {
      key: 'resume',
      eyebrow: 'Resume',
      headline: 'A resume built from what we already know',
      benefits: [
        { icon: 'file-text', text: 'Starts from your quiz, your classes and your roadmap — not from a blank page.' },
        { icon: 'shield', text: 'Formatted to survive the screeners real firms run before a person ever reads it.' },
        { icon: 'sparkles', text: 'Tailor it to one posting and see exactly which lines changed and why.' },
      ],
      cta: 'Build my resume',
      skipLabel: 'Skip',
      ribbon: [
        'Paste a job posting and Marco will tailor this resume to it.',
        'Upload an old resume — we read it in rather than make you retype it.',
        'Every bullet you write here feeds the rest of your profile.',
      ],
      visual: '<svg ' + ICON_STROKE + ' class="fw-intro-scene" aria-hidden="true">'
        + '<rect x="26" y="10" width="52" height="66" rx="7" class="fw-intro-scene-faint" />'
        + '<path d="M38 26 H60" class="fw-intro-scene-hot" />'
        + '<path d="M38 38 H66" opacity="0.4" /><path d="M38 47 H62" opacity="0.4" />'
        + '<path d="M38 56 H66" opacity="0.4" /><path d="M38 65 H52" opacity="0.4" />'
        + '<path d="M84 40 l5 5 9-11" class="fw-intro-scene-hot" />'
        + '<circle cx="90" cy="43" r="14" opacity="0.25" />'
        + '</svg>',
    },
    'know-you': {
      key: 'know-you',
      eyebrow: 'Getting to know you',
      headline: 'Answer a few things, sharpen everything',
      benefits: [
        { icon: 'user-round', text: 'A handful of questions about how you actually work, not another personality label.' },
        { icon: 'sliders-horizontal', text: 'Every answer moves your career fits, your roadmap and what Marco says next.' },
        { icon: 'compass', text: 'Skip anything you are unsure about — a partial answer still improves the read.' },
      ],
      cta: 'Answer a few',
      skipLabel: 'Later',
      ribbon: [
        'Skipping a question is fine — it only means we weight it less.',
        'Come back any time; new answers re-score your matches immediately.',
      ],
      visual: '<svg ' + ICON_STROKE + ' class="fw-intro-scene" aria-hidden="true">'
        + '<circle cx="40" cy="30" r="12" class="fw-intro-scene-hot" />'
        + '<path d="M22 62 a18 18 0 0 1 36 0" class="fw-intro-scene-hot" />'
        + '<path d="M72 26 H104" opacity="0.4" /><circle cx="80" cy="26" r="3.4" fill="currentColor" stroke="none" />'
        + '<path d="M72 42 H104" opacity="0.4" /><circle cx="94" cy="42" r="3.4" fill="currentColor" stroke="none" />'
        + '<path d="M72 58 H104" opacity="0.4" /><circle cx="86" cy="58" r="3.4" fill="currentColor" stroke="none" />'
        + '</svg>',
    },
    simulation: {
      key: 'simulation',
      eyebrow: 'Day in the Life',
      headline: 'Try the job before you commit four years',
      benefits: [
        { icon: 'briefcase', text: 'A real workday from the career you are considering — the decisions, the pressure, the trade-offs.' },
        { icon: 'users', text: 'Colleagues push back, priorities collide, and what you choose has consequences.' },
        { icon: 'graduation-cap', text: 'You finish with a read on whether the work suits you, not just whether the title sounds good.' },
      ],
      cta: 'Run a day',
      skipLabel: 'Skip',
      ribbon: [
        'Run the same day twice, differently — the branches are worth seeing.',
        'Your choices here feed back into your career fits.',
      ],
      visual: '<svg ' + ICON_STROKE + ' class="fw-intro-scene" aria-hidden="true">'
        + '<rect x="18" y="18" width="84" height="48" rx="8" class="fw-intro-scene-faint" />'
        + '<path d="M18 30 H102" opacity="0.3" />'
        + '<circle cx="26" cy="24" r="2" fill="currentColor" stroke="none" opacity="0.5" />'
        + '<path d="M34 44 H62" class="fw-intro-scene-hot" /><path d="M34 54 H54" opacity="0.35" />'
        + '<path d="M74 40 v18" opacity="0.3" /><path d="M74 49 h16" opacity="0.3" />'
        + '<circle cx="90" cy="43" r="3.4" fill="currentColor" stroke="none" opacity="0.7" />'
        + '<circle cx="90" cy="55" r="3.4" fill="currentColor" stroke="none" opacity="0.35" />'
        + '</svg>',
    },
    opportunities: {
      key: 'opportunities',
      eyebrow: 'Opportunities',
      headline: 'Real programs open right now, matched to you',
      benefits: [
        { icon: 'compass', text: 'Live internships, fellowships, competitions and courses found against your actual skill gaps.' },
        { icon: 'calendar-days', text: 'Each one carries its real deadline, so nothing quietly closes while you are studying.' },
        { icon: 'scroll-text', text: 'Every match is sourced — you can read where it came from before you spend a night on it.' },
      ],
      cta: 'See my matches',
      skipLabel: 'Skip',
      ribbon: [
        'Deadlines from here show up in Marco’s weekly plan too.',
        'Matches come from your gaps — close one and the list changes.',
      ],
      visual: '<svg ' + ICON_STROKE + ' class="fw-intro-scene" aria-hidden="true">'
        + '<rect x="18" y="14" width="84" height="18" rx="6" class="fw-intro-scene-hot" />'
        + '<rect x="18" y="38" width="84" height="18" rx="6" class="fw-intro-scene-faint" />'
        + '<rect x="18" y="62" width="84" height="18" rx="6" class="fw-intro-scene-faint" />'
        + '<path d="M28 23 H62" opacity="0.5" /><path d="M84 23 H94" opacity="0.75" />'
        + '<path d="M28 47 H58" opacity="0.35" /><path d="M84 47 H94" opacity="0.5" />'
        + '<path d="M28 71 H66" opacity="0.35" /><path d="M84 71 H94" opacity="0.5" />'
        + '</svg>',
    },
    'mock-interview': {
      key: 'mock-interview',
      eyebrow: 'Mock Interview',
      headline: 'Practice the interview before it counts',
      entitlement: 'premium',
      benefits: [
        { icon: 'mic', text: 'A live interviewer for the role you are chasing, asking what that role actually asks.' },
        { icon: 'repeat', text: 'It pushes back on a weak answer the way a real interviewer would, in the moment.' },
        { icon: 'scroll-text', text: 'You finish with a debrief from Marco: what landed, what did not, what to drill next.' },
      ],
      cta: 'Start practicing',
      skipLabel: 'Not now',
      ribbon: [
        'Name the firm and the round — the questions change with both.',
        'The debrief is the point. Read it before you run another one.',
      ],
      visual: '<svg ' + ICON_STROKE + ' class="fw-intro-scene" aria-hidden="true">'
        + '<rect x="46" y="12" width="20" height="34" rx="10" class="fw-intro-scene-hot" />'
        + '<path d="M36 38 v6 a20 20 0 0 0 40 0 v-6" class="fw-intro-scene-hot" />'
        + '<path d="M56 64 v10" opacity="0.5" /><path d="M42 74 H70" opacity="0.5" />'
        + '<path d="M20 30 q-6 12 0 24" opacity="0.3" /><path d="M12 24 q-8 18 0 36" opacity="0.18" />'
        + '<path d="M92 30 q6 12 0 24" opacity="0.3" /><path d="M100 24 q8 18 0 36" opacity="0.18" />'
        + '</svg>',
    },
    sharpen: {
      key: 'sharpen',
      eyebrow: 'Sharpen',
      // Ribbon-only on purpose: sharpen is a STEP inside the quiz flow, right
      // after signup, and the plan forbids an interstitial mid-task. The step
      // already has its own heading and sub-line; the ribbon carries the rest
      // of the teaching. The interstitial copy stays authored in case sharpen
      // ever becomes a surface of its own again.
      introMode: 'ribbon',
      headline: 'Turn a rough match into a real one',
      benefits: [
        { icon: 'sliders-horizontal', text: 'A second pass of questions aimed at the fields your first answers left ambiguous.' },
        { icon: 'target', text: 'Careers that were close together separate — you get a ranking you can act on.' },
        { icon: 'repeat', text: 'Every answer re-scores the whole map the moment you save it.' },
      ],
      cta: 'Sharpen my matches',
      skipLabel: 'Skip for now',
      ribbon: [
        'Skipping is fine — these questions only sharpen what you already gave us.',
        'Answer even a few and your top matches visibly separate.',
      ],
      visual: '<svg ' + ICON_STROKE + ' class="fw-intro-scene" aria-hidden="true">'
        + '<path d="M18 26 H74" opacity="0.35" /><circle cx="60" cy="26" r="5" class="fw-intro-scene-hot" fill="currentColor" stroke="none" />'
        + '<path d="M18 44 H74" opacity="0.35" /><circle cx="34" cy="44" r="5" class="fw-intro-scene-hot" fill="currentColor" stroke="none" />'
        + '<path d="M18 62 H74" opacity="0.35" /><circle cx="50" cy="62" r="5" class="fw-intro-scene-hot" fill="currentColor" stroke="none" />'
        + '<path d="M88 20 v48" opacity="0.3" />'
        + '<path d="M84 32 h8" opacity="0.6" /><path d="M84 44 h8" opacity="0.45" /><path d="M84 56 h8" opacity="0.3" />'
        + '</svg>',
    },
    // S7: the IA flip's new primary tab. No `entitlement` — §4 makes the weekly
    // loop free forever, so this interstitial is an orientation, never an upsell.
    flightplan: {
      key: 'flightplan',
      eyebrow: 'Flight Plan',
      headline: 'What to do this week, in one place',
      benefits: [
        { icon: 'calendar-days', text: 'Three concrete tasks, pulled from the roadmap you already built. Check one off here and it counts on your roadmap.' },
        { icon: 'briefcase', text: 'Real application windows in your field, with the days left on them — so a deadline never passes quietly.' },
        { icon: 'scroll-text', text: 'Everything you finish gets logged as evidence you can point at later.' },
      ],
      cta: 'Open my Flight Plan',
      skipLabel: 'Skip',
      ribbon: [
        'Checking a task here marks the step done on your roadmap.',
        'Put a date on a roadmap step and it shows up under Commitments.',
      ],
      visual: '<svg ' + ICON_STROKE + ' class="fw-intro-scene" aria-hidden="true">'
        + '<rect x="16" y="12" width="66" height="60" rx="8" class="fw-intro-scene-faint" />'
        + '<rect x="26" y="24" width="14" height="10" rx="3" class="fw-intro-scene-hot" />'
        + '<path d="M29 29 L31.5 31.5 L37 25.5" />'
        + '<path d="M48 29 H72" opacity="0.5" />'
        + '<rect x="26" y="40" width="14" height="10" rx="3" opacity="0.5" />'
        + '<path d="M48 45 H68" opacity="0.35" />'
        + '<rect x="26" y="56" width="14" height="10" rx="3" opacity="0.35" />'
        + '<path d="M48 61 H64" opacity="0.25" />'
        + '<circle cx="96" cy="30" r="12" class="fw-intro-scene-hot" />'
        + '<path d="M96 24 v6 l4 3" />'
        + '</svg>',
    },
    // S12: the Application Tracker board. No `entitlement` — the tracker is
    // free on every plan (§4: "Application Tracker (basic) — Free").
    applications: {
      key: 'applications',
      eyebrow: 'Applications',
      headline: 'Every application, from saved to offer',
      benefits: [
        { icon: 'clipboard-list', text: 'Save a role from the Opportunity Finder — or add one by hand — and it lands here.' },
        { icon: 'repeat', text: 'Move it along as it moves in real life: applied, interviewing, offer, closed.' },
        { icon: 'file-text', text: 'Tailor a resume or practise the interview for that exact role, right from its card.' },
      ],
      cta: 'Open my Applications',
      skipLabel: 'Skip',
      ribbon: [
        'Change the status on a card the day something actually happens.',
        'Tailor resume and Practice open that role’s tools directly.',
      ],
      visual: '<svg ' + ICON_STROKE + ' class="fw-intro-scene" aria-hidden="true">'
        + '<rect x="12" y="14" width="24" height="56" rx="8" class="fw-intro-scene-faint" />'
        + '<rect x="42" y="14" width="24" height="56" rx="8" class="fw-intro-scene-faint" />'
        + '<rect x="72" y="14" width="24" height="56" rx="8" class="fw-intro-scene-hot" />'
        + '<rect x="18" y="24" width="12" height="9" rx="2" opacity="0.5" />'
        + '<rect x="48" y="24" width="12" height="9" rx="2" opacity="0.5" />'
        + '<rect x="78" y="24" width="12" height="9" rx="2" />'
        + '<path d="M48 46 H92" opacity="0.4" />'
        + '<path d="M22 60 L58 60 L58 46 L78 46" stroke-dasharray="1 6" opacity="0.55" />'
        + '</svg>',
    },
    // D10: an existing-user prompt, not a page feature — triggered from
    // notify-optin.js after GET /notify-prefs resolves with weekly still off.
    // No `entitlement`: the weekly digest is free-plan too.
    'weekly-digest': {
      key: 'weekly-digest',
      eyebrow: 'Weekly Flight Plan',
      headline: 'Get your Flight Plan by email, every Monday',
      benefits: [
        { icon: 'calendar-days', text: 'The same three tasks from your Flight Plan card, in your inbox before the week starts.' },
        { icon: 'repeat', text: 'Sent automatically every Monday — nothing to check, nothing to remember.' },
        { icon: 'settings', text: 'Turn it back off any time from Notifications in your portal.' },
      ],
      cta: 'Turn on weekly emails',
      skipLabel: 'No thanks',
      ribbon: [
        'Manage this any time from Notifications in your portal.',
      ],
      visual: '<svg ' + ICON_STROKE + ' class="fw-intro-scene" aria-hidden="true">'
        + '<rect x="14" y="20" width="80" height="52" rx="8" class="fw-intro-scene-faint" />'
        + '<path d="M14 26 L54 50 L94 26" class="fw-intro-scene-hot" />'
        + '<circle cx="98" cy="18" r="10" fill="currentColor" stroke="none" />'
        + '<path d="M8 62 H100" opacity="0.2" /><path d="M30 62 V66" opacity="0.2" />'
        + '<path d="M54 62 V66" opacity="0.2" /><path d="M78 62 V66" opacity="0.2" />'
        + '</svg>',
    },
    // S18. Panel-level, both of them — `season-panel.js` and `term-panel.js`
    // call maybeShow() from their own handlers, because the moment of entry for
    // a panel is the first press of its button, not the page load that happened
    // to include it.
    'interview-season': {
      key: 'interview-season',
      eyebrow: 'Interview Season',
      headline: 'Six weeks that end with you ready',
      // §4: locked-visible on free. `entitlement` turns the interstitial itself
      // into the upgrade moment, which is D18 moment 3 and not a fifth one.
      entitlement: 'premium',
      benefits: [
        { icon: 'target', text: 'One scored mock a week, each aimed at a different part of the rubric — stories, then technicals, then pressure.' },
        { icon: 'sparkles', text: 'Built from what your field actually asks: a consulting week 3 and a software week 3 are not the same week.' },
        { icon: 'repeat', text: 'Week 1 is cold on purpose. The gap between it and week 6 is the only number this program is measuring.' },
      ],
      cta: 'Start my season',
      skipLabel: 'Not now',
      ribbon: [
        'One session a week beats six in a night — the debriefs need time to land.',
        'Week 5 wants a real employer name. Pick the one you would actually take.',
      ],
      visual: '<svg ' + ICON_STROKE + ' class="fw-intro-scene" aria-hidden="true">'
        + '<path d="M14 68 H106" opacity="0.25" />'
        + '<path d="M18 62 L34 56 L50 50 L66 38 L82 30 L98 18" class="fw-intro-scene-hot" />'
        + '<circle cx="18" cy="62" r="3.5" fill="currentColor" stroke="none" opacity="0.45" />'
        + '<circle cx="50" cy="50" r="3.5" fill="currentColor" stroke="none" opacity="0.6" />'
        + '<circle cx="98" cy="18" r="5" fill="currentColor" stroke="none" />'
        + '<path d="M18 68 V72" opacity="0.25" /><path d="M50 68 V72" opacity="0.25" />'
        + '<path d="M82 68 V72" opacity="0.25" /><path d="M98 68 V72" opacity="0.25" />'
        + '</svg>',
    },
    // No `entitlement`: §4 puts no meter on the Semester Loop, and metering the
    // thing that makes a student plan their term would meter the loop the whole
    // cap table exists to protect.
    semester: {
      key: 'semester',
      eyebrow: 'Your term',
      headline: 'Three outcomes, dated across your term',
      benefits: [
        { icon: 'calendar-days', text: 'Name what you want to be true by the last day. FlightWay spreads them across the weeks instead of stacking them at finals.' },
        { icon: 'target', text: 'Each one becomes a dated step on your roadmap, so your weekly plan already knows about them.' },
        { icon: 'scroll-text', text: 'At the end you get a review of what actually moved — and one extra roadmap rebuild for the term that changed your mind.' },
      ],
      cta: 'Set up my term',
      skipLabel: 'Later',
      ribbon: [
        'Three is the limit on purpose. A term with six priorities has none.',
        'Change the dates any time — the commitments move with them.',
      ],
      visual: '<svg ' + ICON_STROKE + ' class="fw-intro-scene" aria-hidden="true">'
        + '<rect x="18" y="18" width="84" height="52" rx="8" class="fw-intro-scene-faint" />'
        + '<path d="M18 32 H102" opacity="0.35" />'
        + '<path d="M36 12 V24" opacity="0.5" /><path d="M84 12 V24" opacity="0.5" />'
        + '<circle cx="38" cy="46" r="4" class="fw-intro-scene-hot" fill="currentColor" stroke="none" />'
        + '<circle cx="60" cy="46" r="4" class="fw-intro-scene-hot" fill="currentColor" stroke="none" />'
        + '<circle cx="82" cy="46" r="4" class="fw-intro-scene-hot" fill="currentColor" stroke="none" />'
        + '<path d="M30 60 H90" opacity="0.2" />'
        + '</svg>',
    },
  };

  // ── State (journey.featureIntros through FWUser) ─────────────────────────
  function allState() {
    try {
      if (!global.FWUser || typeof global.FWUser.get !== 'function') return {};
      var user = global.FWUser.get();
      var intros = user && user.journey && user.journey.featureIntros;
      return (intros && typeof intros === 'object') ? intros : {};
    } catch (_) { return {}; }
  }

  function stateFor(key) {
    var row = allState()[key];
    return (row && typeof row === 'object') ? row : {};
  }

  /** Merge a patch into one feature's row. Never clears a flag another tab set. */
  function patch(key, fields, opts) {
    if (!key || !global.FWUser || typeof global.FWUser.update !== 'function') return;
    try {
      global.FWUser.update(function (user) {
        if (!user.journey || typeof user.journey !== 'object') user.journey = {};
        var intros = (user.journey.featureIntros && typeof user.journey.featureIntros === 'object')
          ? Object.assign({}, user.journey.featureIntros) : {};
        intros[key] = Object.assign({}, intros[key], fields);
        user.journey.featureIntros = intros;
        return user;
      }, opts);
    } catch (_) { /* private mode — the intro simply shows again */ }
  }

  function isSeen(key) { return !!stateFor(key).seen; }

  // Three outcomes, three counters: 'completed' (took the CTA into the
  // feature), 'skipped' (dismissed — ESC, backdrop or Skip), 'upgraded' (a
  // locked feature's CTA sent them to the plan). Reading skipped-vs-completed
  // per feature is how you tell a weak headline from a weak feature.
  var OUTCOMES = { skip: 'skipped', gate: 'upgraded' };

  function markSeen(key, how) {
    if (!key || isSeen(key)) return;
    patch(key, { seen: true, seenAt: new Date().toISOString() });
    log('feature_intro_' + (OUTCOMES[how] || 'completed'), { feature: key });
  }

  // The read side of those counters, over the local ring buffer. Since S1 the
  // same events also reach D1 through the beacon, so the authoritative numbers
  // live in the admin dashboard — this stays as the zero-latency local view:
  // open any page with ?fw_debug_events=1, or call it from the console.
  // Shape: { hub: { shown, completed, skipped, upgraded, ribbonDismissed } }.
  var STAT_EVENTS = {
    feature_intro_shown: 'shown',
    feature_intro_completed: 'completed',
    feature_intro_skipped: 'skipped',
    feature_intro_upgraded: 'upgraded',
    feature_ribbon_dismissed: 'ribbonDismissed',
  };

  function stats() {
    var out = {};
    var events = [];
    try {
      if (global.FWEvents && typeof global.FWEvents.all === 'function') events = global.FWEvents.all();
    } catch (_) { events = []; }
    events.forEach(function (e) {
      var field = e && STAT_EVENTS[e.t];
      var key = e && e.d && e.d.feature;
      if (!field || !key) return;
      if (!out[key]) out[key] = { shown: 0, completed: 0, skipped: 0, upgraded: 0, ribbonDismissed: 0 };
      out[key][field] += 1;
    });
    return out;
  }

  function log(type, data) {
    try {
      if (global.FWEvents && typeof global.FWEvents.log === 'function') global.FWEvents.log(type, data);
    } catch (_) { /* telemetry never breaks a page */ }
  }

  // ── Seeding: an existing student has already met most of this ────────────
  // Cheap client-side heuristics over data already in memory — a feature the
  // student has demonstrably used must never interrupt them to be introduced.
  // Runs once (marked by _seeded), so a later reset of one flag stays reset.
  function seed() {
    if (allState()._seeded) return;
    // Never fabricate a user object for a visitor who has none: writing
    // fw_user_v1 here makes user.js's boot migration believe the legacy quiz
    // blob was already promoted, and the next boot DELETES that blob instead
    // of reading it. With no stored profile there is nothing to seed anyway,
    // so this is a pure no-op that runs again once a profile exists.
    var stored = null;
    try { stored = global.FWUser && global.FWUser.get ? global.FWUser.get() : null; } catch (_) { stored = null; }
    if (!stored) return;
    var blob = null;
    try { blob = global.FWUser && global.FWUser.getBlob ? global.FWUser.getBlob() : null; } catch (_) { blob = null; }
    var seen = {};
    if (blob) {
      if (blob.scores && typeof blob.scores === 'object') seen.hub = true;
      if (blob.refine && typeof blob.refine === 'object') seen.sharpen = true;
      if (blob.profileBuilding && Array.isArray(blob.profileBuilding.answers)
          && blob.profileBuilding.answers.length) seen['know-you'] = true;
      if (blob.resumeText || blob.resumeSummary) seen.resume = true;
    }
    if (lsHas('fw_roadmap_v1')) seen.roadmap = true;
    if (lsHasItems('fw_sim_history_v2')) seen.simulation = true;
    if (visitedPage('coach.html')) seen.marco = true;
    var now = new Date().toISOString();
    try {
      global.FWUser.update(function (user) {
        if (!user.journey || typeof user.journey !== 'object') user.journey = {};
        var intros = (user.journey.featureIntros && typeof user.journey.featureIntros === 'object')
          ? Object.assign({}, user.journey.featureIntros) : {};
        Object.keys(seen).forEach(function (key) {
          intros[key] = Object.assign({ seenAt: now }, intros[key], { seen: true });
        });
        intros._seeded = true;
        user.journey.featureIntros = intros;
        return user;
      }, { sync: false });
    } catch (_) { /* private mode */ }
  }

  function lsHas(key) {
    try { return !!localStorage.getItem(key); } catch (_) { return false; }
  }

  function lsHasItems(key) {
    try {
      var arr = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(arr) && arr.length > 0;
    } catch (_) { return false; }
  }

  // S1 added automatic page context (page_view / session_start) to the same
  // ring buffer this reads. Those are evidence a page LOADED, not evidence the
  // student did anything on it — and this heuristic's whole job is the latter.
  // Left unfiltered, the first ever load of coach.html would mark the Marco
  // intro as already-seen and suppress it for exactly the new user it exists
  // for. Filtering here keeps the pre-S1 meaning intact.
  var AUTO_EVENTS = { page_view: 1, session_start: 1 };

  function visitedPage(page) {
    try {
      if (!global.FWEvents || typeof global.FWEvents.all !== 'function') return false;
      return global.FWEvents.all().some(function (e) {
        return e && e.page === page && !AUTO_EVENTS[e.t];
      });
    } catch (_) { return false; }
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function icon(name) {
    try {
      if (global.lucide && typeof global.lucide.svg === 'function') return global.lucide.svg(name);
    } catch (_) { /* fall through */ }
    return '';
  }

  /** True when something else already owns the screen — never stack modals. */
  function modalOpen() {
    var nodes = document.querySelectorAll('[aria-modal="true"], .fw-intro-root');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.closest('[hidden]')) continue;
      if (el.offsetParent !== null || el.getClientRects().length) return true;
    }
    return false;
  }

  var active = null; // { root, feature, resolve, lastFocused }

  function close(how) {
    if (!active) return;
    var current = active;
    active = null;
    markSeen(current.feature.key, how);
    document.removeEventListener('keydown', onKey, true);
    if (current.root && current.root.parentNode) current.root.parentNode.removeChild(current.root);
    document.body.classList.remove('fw-intro-open');
    if (current.lastFocused && typeof current.lastFocused.focus === 'function') {
      try { current.lastFocused.focus(); } catch (_) { /* node may be gone */ }
    }
    if (current.resolve) current.resolve(how);
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close('skip');
      return;
    }
    if (e.key !== 'Tab') return;
    var focusables = active.root.querySelectorAll('button, [href]');
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /** Locked features keep the same hype and swap the CTA for the plan link. */
  function planGate(feature) {
    if (!feature.entitlement) return null;
    try {
      if (global.FWEnt && typeof global.FWEnt.has === 'function' && global.FWEnt.has(feature.entitlement) === false) {
        return { label: 'Part of Flight Plan', href: 'pricing.html' };
      }
    } catch (_) { /* entitlements not booted — treat as unlocked */ }
    return null;
  }

  function render(feature) {
    var gate = planGate(feature);
    var root = document.createElement('div');
    root.className = 'fw-intro-root';
    root.innerHTML = ''
      + '<div class="fw-intro-backdrop" data-fw-intro-act="skip"></div>'
      + '<div class="fw-intro-card" role="dialog" aria-modal="true" aria-labelledby="fw-intro-headline">'
      + '<div class="fw-intro-visual" aria-hidden="true">' + feature.visual + '</div>'
      + '<p class="fw-intro-eyebrow">' + esc(feature.eyebrow) + '</p>'
      + '<h2 class="fw-intro-headline" id="fw-intro-headline">' + esc(feature.headline) + '</h2>'
      + '<ul class="fw-intro-benefits">'
      + feature.benefits.map(function (b) {
        return '<li class="fw-intro-benefit"><span class="fw-intro-benefit-icon" aria-hidden="true">'
          + icon(b.icon) + '</span><span>' + esc(b.text) + '</span></li>';
      }).join('')
      + '</ul>'
      + '<div class="fw-intro-actions">'
      + '<button type="button" class="fw-intro-skip" data-fw-intro-act="skip">'
      + esc(feature.skipLabel || 'Skip') + '</button>'
      + (gate
        ? '<a class="fw-btn fw-btn-primary fw-btn-lg fw-intro-cta" href="' + esc(gate.href) + '" data-fw-intro-act="gate">'
          + esc(gate.label) + ' <span aria-hidden="true">→</span></a>'
        : '<button type="button" class="fw-btn fw-btn-primary fw-btn-lg fw-intro-cta" data-fw-intro-act="go">'
          + esc(feature.cta) + '</button>')
      + '</div></div>';
    return root;
  }

  /**
   * Show one feature's interstitial regardless of its seen flag. Resolves with
   * 'go' | 'skip' | 'gate' when it closes; both outcomes mark the feature seen,
   * so nobody meets the same screen twice.
   */
  function show(key) {
    var feature = FEATURES[key];
    if (!feature || !document.body) return Promise.resolve('skip');
    if (active) return Promise.resolve('skip');
    var root = render(feature);
    document.body.appendChild(root);
    document.body.classList.add('fw-intro-open');
    return new Promise(function (resolve) {
      active = { root: root, feature: feature, resolve: resolve, lastFocused: document.activeElement };
      root.addEventListener('click', function (e) {
        var hit = e.target.closest('[data-fw-intro-act]');
        if (!hit) return;
        var act = hit.getAttribute('data-fw-intro-act');
        if (act === 'gate') { markSeen(key, 'gate'); return; } // let the link navigate
        e.preventDefault();
        close(act === 'go' ? 'go' : 'skip');
      });
      document.addEventListener('keydown', onKey, true);
      // rAF so the entrance transition has a frame to start from.
      requestAnimationFrame(function () {
        root.classList.add('is-open');
        var cta = root.querySelector('.fw-intro-cta');
        if (cta && typeof cta.focus === 'function') cta.focus();
      });
      log('feature_intro_shown', { feature: key });
    });
  }

  /** Show only if this student has never seen it and nothing else owns the screen. */
  function maybeShow(key) {
    if (!FEATURES[key] || isSeen(key) || modalOpen()) return Promise.resolve(null);
    return show(key);
  }

  // ── Hint ribbon ──────────────────────────────────────────────────────────
  // Quiet, one line, dismissable for good. Rotates through the feature's tips
  // by visit count so a returning student is not told the same thing forever.
  var ribbonIdx = {};     // tip chosen for this page load — stable across re-renders
  var ribbonCounted = {}; // the rotation counter advances once per page load, not per render

  function ribbon(key, mount) {
    var feature = FEATURES[key];
    if (!feature || !feature.ribbon || !feature.ribbon.length || !mount) return null;
    if (stateFor(key).ribbonDismissed) return null;
    var tips = feature.ribbon;
    // A panel that re-renders (opportunities) re-mounts its ribbon; without a
    // per-load index it would walk the whole rotation in one visit.
    if (!(key in ribbonIdx)) {
      ribbonIdx[key] = Math.abs(Number(stateFor(key).ribbonSeen) || 0) % tips.length;
    }
    var idx = ribbonIdx[key];
    var el = document.createElement('div');
    el.className = 'fw-hint-ribbon';
    el.setAttribute('role', 'note');
    el.innerHTML = '<span class="fw-hint-ribbon-text">' + esc(tips[idx]) + '</span>'
      + '<button type="button" class="fw-hint-ribbon-close" aria-label="Dismiss this tip">'
      + (icon('x') || '&times;') + '</button>';
    el.querySelector('.fw-hint-ribbon-close').addEventListener('click', function () {
      patch(key, { ribbonDismissed: true });
      log('feature_ribbon_dismissed', { feature: key });
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    mount.appendChild(el);
    if (!ribbonCounted[key]) {
      ribbonCounted[key] = true;
      // Local-only: the rotation counter is not worth a profile PUT, and
      // introsHash deliberately ignores it.
      patch(key, { ribbonSeen: idx + 1 }, { sync: false });
    }
    return el;
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  // A page declares its feature with <body data-fw-intro="hub">. Panel-level
  // features (sharpen, opportunities, mock-interview) call maybeShow() from
  // their own open handler instead — the interstitial belongs at the moment of
  // entry, and for a panel that moment is not page load.
  function auto() {
    if (!document.body) return;
    var key = document.body.getAttribute('data-fw-intro');
    if (!key) return;
    maybeShow(key);
  }

  // A surface declares its ribbon slot with <div data-fw-ribbon="marco">.
  // Only for a feature already introduced BEFORE this page load: showing the
  // ribbon in the same visit as the interstitial repeats what the student just
  // read. JS-rendered surfaces call ribbon() directly instead.
  function mountRibbons() {
    var slots = document.querySelectorAll('[data-fw-ribbon]');
    for (var i = 0; i < slots.length; i++) {
      var key = slots[i].getAttribute('data-fw-ribbon');
      if (!key || !FEATURES[key]) continue;
      // A ribbon-only feature has no interstitial to wait for.
      if (isSeen(key) || FEATURES[key].introMode === 'ribbon') ribbon(key, slots[i]);
    }
  }

  function boot() {
    seed();
    mountRibbons();
    // Veiled pages have an exact "content is ready" moment; unveiled ones (the
    // hub) do not, so wait for load and one beat rather than guess a delay
    // that lands over a spinner.
    if (global.FWPageVeil && typeof global.FWPageVeil.onReveal === 'function') global.FWPageVeil.onReveal(auto);
    else if (document.readyState === 'complete') setTimeout(auto, 300);
    else global.addEventListener('load', function () { setTimeout(auto, 300); });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState !== 'loading') boot();
    else document.addEventListener('DOMContentLoaded', boot);
  }

  global.FWFeatureIntro = {
    FEATURES: FEATURES,
    show: show,
    maybeShow: maybeShow,
    isSeen: isSeen,
    markSeen: markSeen,
    stateFor: stateFor,
    ribbon: ribbon,
    seed: seed,
    stats: stats,
  };
})(typeof window !== 'undefined' ? window : globalThis);
