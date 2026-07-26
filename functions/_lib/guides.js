/**
 * The guides hub — /guides and /guides/<slug>  (V2 S14, decisions D20 + D27).
 *
 * PURE. No env, no fetch, no D1, no KV, no catalog. Everything a guide says is
 * a constant in this file, which is what lets `seo:check` render all eight
 * pages offline and assert against every one of them — and what keeps a guide
 * from 500ing because the O*NET artifact store had a bad minute. The career
 * pages need the catalog; these do not, and pretending otherwise would buy a
 * failure mode for nothing.
 *
 * Consequently there is also NO KV cache here (the career pages have one).
 * Rendering a guide is string concatenation over a constant — measured in
 * microseconds — so a KV round trip would be slower than the work it skips.
 * `Cache-Control: s-maxage` still puts them in Cloudflare's edge cache.
 *
 * THE CONTENT RULES, which are not decoration:
 *   1. Informational first. The first two thirds of every guide has to be worth
 *      reading by someone who never signs up. A guide that pitches in section 1
 *      is a doorway page, and doorway pages are a manual-action risk for the
 *      whole domain (plan §10). `seo:check` asserts the CTA is last.
 *   2. Nothing is claimed that is not true today. No prices (S19 re-leads
 *      pricing and would make any number here false), no statistics, no
 *      testimonials, no feature that has not shipped.
 *   3. Every FAQ answer is visible on the page. Google's FAQPage guidelines
 *      require the marked-up Q&A to be present for the user, and `seo:check`
 *      asserts the JSON-LD questions equal the rendered ones.
 *
 * Body strings carry a deliberately tiny amount of inline HTML. They are repo
 * constants rather than user input, but this is the only HTML in the product
 * assembled by concatenation, so `inline()` below re-escapes everything that is
 * not on a four-tag allowlist instead of trusting the author — and `seo:check`
 * asserts the raw source only ever uses those four, so a typo is a red gate
 * rather than a silently-stripped word.
 */
import { SITE, esc, jsonLd, shell, ONET_RELEASE } from './career-page.js';

/** Bump when the rendered output changes. Feeds <lastmod> in the sitemap and
 *  the "Updated" line on every guide, so it must move with the CONTENT and
 *  never with an unrelated deploy. */
export const GUIDES_CONTENT_DATE = '2026-07-24';

/** The catalog-size claim these pages make in prose ("780+ careers"). Asserted
 *  by `seo:check` as a FLOOR against the live catalog, the same discipline
 *  ONET_RELEASE gets: if the catalog ever shrinks under it, the suite goes red
 *  rather than eight public pages carrying an overstatement. */
export const CAREER_COUNT_CLAIM = 780;

// New asset. The stamp is 20260725, not 20260724, because `verify:busters`
// dates an uncommitted file by UTC and the file was written after 00:00 UTC —
// the letter sequence a-k spent on 2026-07-24 by S1..S13 does not apply to it.
const OG_GUIDES = `${SITE}/assets/og/og-guides.png?v=20260725a`;

/** Reading pace. Computed from the real word count rather than hand-written,
 *  because a hand-written one is wrong the first time anyone edits a guide. */
const WORDS_PER_MINUTE = 220;

export const GROUPS = [
  { key: 'start', label: 'Start here', blurb: 'What these tools are for, and how to pick a direction without pretending to be certain.' },
  { key: 'judge', label: 'Judging the tools', blurb: 'Career tests, advisors, coaches and AI — what each one is actually good at.' },
  { key: 'work', label: 'Doing the work', blurb: 'The part after you have a direction: terms, deadlines, and evidence that accumulates.' },
  { key: 'parents', label: 'For parents', blurb: 'How to help without adding pressure, and how to judge anything you are asked to pay for.' },
];

// ---------------------------------------------------------------------------
// The guides.

const G_CAREER_QUIZ = {
  slug: 'career-quiz',
  group: 'start',
  title: 'A career quiz that explains its answers',
  h1: 'A career quiz that explains its answers',
  description: 'Most career quizzes hand you a label and hide the reasoning. Here is what a good one owes you, and how to check whether yours does it.',
  hook: 'A career quiz is a cheap way to widen the list of things you would consider. It is a terrible way to be told who you are. The difference is entirely in whether it shows its work.',
  sections: [
    {
      id: 'what-a-quiz-is-for',
      h2: 'What a career quiz is actually for',
      body: [
        'The honest job of a career quiz is <strong>generating candidates</strong>. Most people can name maybe thirty jobs. The U.S. Department of Labor’s occupational database describes hundreds more, and a large share of them are invisible to anyone who has not already met somebody doing them. A quiz that puts eight occupations in front of you that you had never considered has done something genuinely useful, even if you reject seven of them.',
        'The dishonest job is <strong>issuing a verdict</strong>. No twenty-question instrument knows what you will care about in six years, what your family situation will allow, or which of your interests will survive contact with the actual work. Any tool that speaks as though it does is either overselling or has not thought about it.',
        'So the right posture toward a result is: this is a list to investigate, ranked by something. The only question that matters next is <em>ranked by what, exactly</em>.',
      ],
    },
    {
      id: 'why-most-feel-hollow',
      h2: 'Why most of them feel hollow',
      body: [
        'Four failure modes account for nearly all of it, and you can spot every one of them from the results screen.',
      ],
      list: {
        kind: 'ol',
        items: [
          'A type label instead of a comparison. Being told you are a four-letter type, or a color, is a description of you that has been detached from any occupation. The step from label to job is where all the actual difficulty lives, and it gets waved through.',
          'Everything scores high. If the top ten results are all in the eighties and nineties, the scale is not discriminating between them. That usually means raw similarity is being reported without correcting for the fact that all work has a lot in common.',
          'No visible reasoning. If you cannot ask why one result outranked another and get an answer in terms of things you recognize, you have no way to disagree with it — and disagreeing with a result productively is most of the value.',
          'A tiny question bank driving a huge claim. Ten questions can support a rough, wide first pass. They cannot support a confident single answer, and a tool that presents one is telling you something about its marketing rather than its method.',
        ],
      },
    },
    {
      id: 'what-to-demand',
      h2: 'What to demand from any career quiz',
      body: [
        'Five things. They are not exotic, and a tool that refuses any of them is one you should be reading skeptically.',
      ],
      list: {
        kind: 'ul',
        items: [
          'Real occupations, named. Not sectors, not "creative roles" — the job title an employer would actually post, so you can go read about it elsewhere.',
          'A stated data source for what those occupations involve. Somebody had to decide what a given job requires. Ask who.',
          'A visible per-result explanation: which of your answers pushed this up, which pulled it down.',
          'A spread of scores. Results that separate are results that mean something.',
          'A stated limit. A tool that never tells you what it cannot do has not audited itself.',
        ],
      },
    },
    {
      id: 'how-the-score-should-work',
      h2: 'How the score should work',
      body: [
        'The comparison that survives scrutiny is a <strong>shape</strong> comparison. Describe yourself and describe the occupation on the same set of axes — the same skills, the same kinds of knowledge, the same work activities — and then ask how similar the two profiles are as patterns, not as totals.',
        'There is one correction that makes or breaks this, and it is worth understanding because it explains the "everything scores high" problem. Any two occupations, picked at random, look fairly similar: nearly all work involves some reading, some communicating, some judgment. Raw similarity between two arbitrary jobs sits somewhere around 0.70 to 0.85 before you have learned anything. If a tool reports that number, everything looks like a match and the ranking is noise.',
        'Subtracting the average profile first — centering — throws away the part that every job shares and compares only what makes this occupation distinctive against what makes you distinctive. That is the number worth ranking on, and it is why a well-built quiz produces results that actually spread out.',
      ],
    },
    {
      id: 'fit-is-not-readiness',
      h2: 'Fit is not readiness, and blending them answers neither',
      body: [
        '"Would I like this work" and "could I get this job right now" are different questions with different evidence behind them. The first is about disposition. The second is about what your coursework, projects and résumé can currently prove.',
        'Averaging them produces a single number that answers neither question, and it is the reason so many results feel simultaneously flattering and useless. A seventeen-year-old is not ready for anything yet; that is not a statement about fit. Keep them apart and both numbers become actionable — one tells you where to look, the other tells you what to go build.',
      ],
    },
    {
      id: 'how-flightway-does-it',
      h2: 'How FlightWay’s quiz works',
      body: [
        'Ten questions, about ninety seconds. Your answers build a profile across 161 dimensions taken from O*NET, the U.S. Department of Labor’s occupational database, and that profile is compared against <a href="/careers">780+ real occupations</a> described on those same 161 axes. Same axes on both sides, so the comparison is like-for-like.',
        'The score is the mean-centered correlation described above. Fit only — readiness is scored separately and never folded in. Every match opens to show which dimensions pushed it up and which pulled it down, so if you disagree with a result you can see exactly where it came from and decide the tool is wrong. That is the intended use.',
        'The top three matches are visible before you make an account. Each one links to a full page on that occupation — <a href="/careers/software-engineer">Software Developers</a>, <a href="/careers/nurse">Registered Nurses</a>, <a href="/careers/accountant">Accountants and Auditors</a> and the rest — covering what the work involves, what it takes, and how people get in.',
      ],
    },
  ],
  faq: [
    { q: 'How long does the FlightWay career quiz take?', a: 'About ninety seconds. It is ten questions, and you can see your top three matches without creating an account.' },
    { q: 'Is the career quiz free?', a: 'Yes. Taking the quiz and seeing your top matches is free. A free account saves your results and shows all ten.' },
    { q: 'Where does the occupational data come from?', a: 'O*NET release 30.3, published by the U.S. Department of Labor, Employment and Training Administration. It is public data that describes what occupations involve and what they require. FlightWay is not endorsed by USDOL/ETA.' },
    { q: 'What does the fit score actually mean?', a: 'It is a correlation between the shape of your profile and the shape of the occupation, across 161 shared dimensions, after subtracting the average profile that all work has in common. It measures whether the work suits you, not whether you are currently qualified for it.' },
    { q: 'Can I see why a particular career was ranked where it was?', a: 'Yes. Every match opens to show the dimensions that raised it and the dimensions that lowered it. If the reasoning does not match how you see yourself, that disagreement is useful information.' },
    { q: 'Should I choose a career based on a quiz result?', a: 'No. A result is a list of candidates worth investigating, ranked by one specific measure. The next step is reading about the work and finding a cheap way to try some of it.' },
  ],
  related: ['do-career-tests-work', 'how-to-choose-a-career', 'career-advisor-vs-coach-vs-ai'],
  careers: ['software-engineer', 'nurse', 'accountant', 'data-scientist'],
  cta: {
    h2: 'See your matches, and the reasoning',
    p: 'Ten questions, about ninety seconds, scored against 780+ real occupations. Your top three and the factors behind them are visible before you sign up for anything.',
  },
};

const G_HOW_TO_CHOOSE = {
  slug: 'how-to-choose-a-career',
  group: 'start',
  title: 'How to choose a career: a working method',
  h1: 'How to choose a career: a working method',
  description: 'A sequence you can actually run: widen the list, cut it on evidence, test the survivors cheaply, then commit to one thing for one term.',
  hook: 'Choosing a career is usually taught as an act of introspection. It works far better as a sequence of cheap experiments, because the information you need is mostly not inside your head.',
  sections: [
    {
      id: 'the-question-is-badly-posed',
      h2: 'The question is badly posed',
      body: [
        '"What should I do with my life" cannot be answered, because it asks about a person who does not exist yet. You are being asked to predict the preferences of someone with a decade more experience, in an economy that has not happened.',
        'The answerable version is smaller and much more useful: <strong>what should I commit the next twelve months to, such that I learn something that narrows the question?</strong> That has an answer. It has several defensible answers, which is the point — the goal is a decision good enough to generate evidence, not a decision you will never revise.',
        'Reframing it this way also removes the paralysis. A twelve-month commitment that turns out wrong costs you twelve months and leaves you with a much sharper sense of what you actually want. Refusing to choose costs the same twelve months and leaves you where you started.',
      ],
    },
    {
      id: 'start-from-evidence',
      h2: 'Start from evidence, not from vibes',
      body: [
        'Before generating options, write down what you already have real evidence for. Not what you enjoy in the abstract — what you have actually done and how it went. The classes where the work stopped feeling like work. The project you kept going after the grade was in. The thing people ask you for help with. The tasks you avoid so consistently that it has become a pattern.',
        'This list is short and it is boring, and that is why it is trustworthy. Self-report about preferences is unreliable; self-report about what you actually did last year is much less so. Everything downstream gets better when it starts here.',
        'One caution: separate <em>the subject</em> from <em>the work</em>. Loving the ideas in a field tells you less than you think about wanting the job. Enjoying biology and wanting to be a laboratory technician are different findings, and confusing them is the single most common way people end up three years into something that never suited them.',
      ],
    },
    {
      id: 'the-method',
      h2: 'The method',
      body: [
        'Four steps, in order. The order matters — most people invert the first two and end up choosing between the four jobs they had already heard of.',
      ],
      list: {
        kind: 'ol',
        items: [
          'Widen. Get to thirty or forty candidate occupations, deliberately including ones you would not have named. A structured tool is good for this because its ignorance of your assumptions is the feature. Read the actual descriptions rather than reacting to the titles.',
          'Cut on evidence. Take each candidate to a real description of the day-to-day work and the education it typically requires, and cut the ones you would not want on a Tuesday morning. Most of the list dies here, quickly, and that is correct.',
          'Test the survivors cheaply. Five or six left. For each one, find the cheapest thing you can do that produces real information: a conversation with someone doing it, a small project in the shape of the work, one course, one competition. Not a summer — a week.',
          'Commit to one, for one term. Pick the survivor that produced the most interest per unit of effort and give it a term of real attention. Set an end date and a review. You are not marrying it; you are running the experiment properly.',
        ],
      },
    },
    {
      id: 'testing-cheaply',
      h2: 'How to test a career cheaply',
      body: [
        'The best test is the smallest piece of the actual work you can get your hands on. For a data-heavy role, that is a real dataset and a question nobody has answered. For a caring profession, it is volunteering somewhere that will let you be present for the unglamorous hours. For an engineering role, it is building the thing badly, alone, and noticing whether you want to make it better.',
        'The second-best test is a conversation with somebody two to four years into it, asked well. "Do you like it" produces nothing. "What did you do yesterday, hour by hour" produces everything. So does "what surprised you", and "who quits, and why".',
        'What is <em>not</em> a test: reading more about the field, watching people talk about it, or attending an information session. Those generate the feeling of progress without generating evidence, and they are infinitely expandable, which is why they are the default procrastination for careful people.',
      ],
    },
    {
      id: 'deciding-under-uncertainty',
      h2: 'Deciding while you are still uncertain',
      body: [
        'Two ideas make the final call easier. The first is <strong>reversibility</strong>: prefer the choice that is cheaper to undo when the evidence is thin. A first job in a field you can leave is a smaller bet than a five-year credential, and early in a career almost everything is more reversible than it feels.',
        'The second is that <strong>the skills transfer more than the title suggests</strong>. Occupations that look unrelated by name are frequently near-neighbours in what they actually require — the same analysis, the same communication, the same tolerance for ambiguity. Choosing wrong within a neighbourhood is a small error. That is worth knowing, because it lowers the stakes of the decision you are agonising over.',
        'And set the review date now, while you are still clear-eyed. "I will look at this again at the end of the spring term, and here is what would make me change course" is the difference between a decision and a drift.',
      ],
    },
    {
      id: 'what-flightway-does',
      h2: 'Where FlightWay fits in this',
      body: [
        'The first two steps are what the product is built around. The <a href="/quiz">quiz</a> widens the list — 780+ real occupations, ranked by a stated method rather than a vibe — and every result opens onto a <a href="/careers">full page for that occupation</a> so step two is one click, not a research project.',
        'After that it turns into a plan. Pick a direction and you get a roadmap of waypoints and steps you can put due dates on, plus three or four concrete tasks each week. You can track more than one branch at once, which is the honest way to handle a decision you have not finished making.',
      ],
    },
  ],
  faq: [
    { q: 'How do I choose a career if nothing stands out?', a: 'Widen the list first. Most people are choosing between the small number of jobs they have heard of, and nothing standing out is usually a sign that the list is too short rather than that you lack preferences. Then cut on real descriptions of the day-to-day work.' },
    { q: 'What if I pick wrong?', a: 'Early choices are far more reversible than they feel, and occupations that look unrelated often require similar things, so choosing wrong within a neighbourhood costs less than it seems. Set a review date when you commit so that revising is a plan rather than a failure.' },
    { q: 'How long should I spend deciding?', a: 'Long enough to test five or six candidates cheaply, which is weeks rather than years. Extended deliberation without new evidence does not improve the decision; it just moves the cost from choosing to waiting.' },
    { q: 'Is it better to follow your passion or follow the money?', a: 'Neither framing is useful on its own. Look for work whose day-to-day tasks you can tolerate on an ordinary Tuesday, that pays enough for the life you want, and that you have some evidence of being suited to. Where those overlap is a much smaller and more answerable question.' },
    { q: 'Should I choose a major or a career first?', a: 'A direction first, loosely held, then a major that keeps several versions of that direction open. Majors constrain less than most students fear, and the evidence you build outside the major usually matters more to an employer than its name.' },
  ],
  related: ['career-quiz', 'career-development-in-college', 'plan-your-semester-around-a-career-goal'],
  careers: ['data-scientist', 'management-analysts', 'therapist', 'mechanical-engineer'],
  cta: {
    h2: 'Start with a wider list',
    p: 'The quiz takes about ninety seconds and ranks you against 780+ real occupations, with the reasoning behind every result shown rather than hidden. It is free, and the top three are visible before you sign up.',
  },
};

const G_DO_TESTS_WORK = {
  slug: 'do-career-tests-work',
  group: 'judge',
  title: 'Do career tests work? An honest answer',
  h1: 'Do career tests work? An honest answer',
  description: 'Career tests do one job well and several jobs badly. Here is which is which, and how to use one without letting it decide anything.',
  hook: 'The question hides a second question: work at what? Career tests are reasonably good at widening your options and poor at telling you who you are. Most disappointment comes from expecting the second.',
  sections: [
    {
      id: 'what-do-you-mean-by-work',
      h2: 'First, what would "work" even mean?',
      body: [
        'There are at least three claims bundled into the question, and they have very different answers.',
        '<strong>Can a test predict which job you will end up happy in?</strong> No instrument should claim this, and the ones that imply it are overreaching. Job satisfaction depends heavily on the specific team, manager, and moment — none of which a questionnaire can see.',
        '<strong>Can a test describe your dispositions consistently?</strong> Somewhat, and it varies enormously by instrument. Well-constructed inventories measuring traits on continuous scales are more stable than instruments that sort people into discrete types.',
        '<strong>Can a test put good options in front of you that you would not have found?</strong> Yes, and this is the one that actually earns its keep. It is also the claim almost nobody markets, because it is modest.',
      ],
    },
    {
      id: 'the-three-families',
      h2: 'The three families, and what each measures',
      body: [
        'Lumping them together is most of why the debate is confused. They measure different things and fail differently.',
      ],
      list: {
        kind: 'ul',
        items: [
          'Interest inventories. These ask what kinds of activity appeal to you and map the answers onto occupations. The best-known framework sorts interests into six broad areas — realistic, investigative, artistic, social, enterprising and conventional — and the U.S. Department of Labor publishes a free instrument of this kind alongside O*NET. Interests are the thing self-report handles best, because you are reporting a preference rather than estimating an ability.',
          'Personality instruments. These describe traits. Some are carefully built around continuous dimensions; others sort people into named types, which is where reliability problems concentrate — a person near the middle of a scale can be assigned a different type on a retest without their answers having meaningfully changed. Type labels are memorable and that memorability is exactly the risk.',
          'Aptitude and ability tests. These attempt to measure what you can do rather than what you like. They are the most demanding to build properly, the most sensitive to practice and test conditions, and the least useful to a student on their own, because at seventeen or twenty you have not yet done the thing being predicted.',
        ],
      },
    },
    {
      id: 'what-they-genuinely-do',
      h2: 'What they genuinely do well',
      body: [
        'Three things, and they are not small.',
        'They <strong>expand the option set</strong>. Most people can name a few dozen jobs; the federal occupational database runs to many hundreds. Any structured instrument that reliably surfaces occupations outside your social circle is doing real work, because you cannot choose from a list you have never seen.',
        'They <strong>give you vocabulary</strong>. Being handed the words for a preference you had noticed but never named — that you would rather investigate than persuade, or build than coordinate — is genuinely clarifying, and it makes the next conversation with an advisor much more productive.',
        'They <strong>force a structured pass</strong> over questions you would otherwise circle vaguely. Thirty minutes of being asked systematically about what you want beats a year of thinking about it in the shower.',
      ],
    },
    {
      id: 'where-they-fail',
      h2: 'Where they fail',
      body: [
        'Four failure modes, all of them common enough to expect.',
      ],
      list: {
        kind: 'ol',
        items: [
          'Statements that feel true about everyone. Descriptions written broadly enough will read as accurate to almost any reader — a well-documented effect that has been demonstrated by handing an entire room the same personality profile and collecting near-universal agreement. If a result feels uncannily accurate, check whether it would feel accurate to your roommate too.',
          'Type labels that outlive their evidence. A four-letter code is easy to remember, easy to identify with, and hard to revise. People carry them for years and quietly rule out options on their basis, which is far more than the instrument can support.',
          'Undifferentiated results. When everything scores high, nothing has been ranked. This is usually a scaling problem rather than a fact about you, and it makes the output unusable no matter how sound the questions were.',
          'The result treated as a verdict. This is the expensive one. A test output is a hypothesis to investigate. Treated as an identity, it stops the investigation it was supposed to start.',
        ],
      },
    },
    {
      id: 'how-to-use-one-well',
      h2: 'How to use one well',
      body: [
        'Take it, then treat the output as a reading list. Pick the three or four results you had not considered, go read what the work actually involves day to day, and throw out the ones you would not want. The value was in the candidates, not the ranking.',
        'Ask the tool to show its reasoning, and use the reasoning as the real output. "This scored high because of these specific factors" is checkable against your own experience. A bare number is not.',
        'And never let a result close a door. A test can reasonably suggest you look at something. Nothing about a questionnaire justifies deciding you are not the sort of person who does a particular kind of work.',
      ],
    },
    {
      id: 'what-we-do',
      h2: 'What FlightWay does about all this',
      body: [
        'FlightWay is an interest-and-activity instrument in the first family, and it is built around the failure modes above rather than around a label. Your answers build a profile on 161 dimensions taken from O*NET — the U.S. Department of Labor’s occupational database — and are compared against 780+ real occupations described on those same dimensions. No types, no colors, no four-letter code.',
        'The ranking is a mean-centered correlation, which is the fix for the "everything scores high" problem: the profile that all work shares is subtracted before anything is compared, so results actually separate. Every match opens to show the specific dimensions that raised and lowered it, and readiness is kept as a separate number rather than blended into fit.',
        'The stated limit, in the product itself: a fit score is a data point you can check, not a verdict. That is why the reasoning is shown — so you can disagree with it on the evidence.',
      ],
    },
  ],
  faq: [
    { q: 'Are career tests accurate?', a: 'They are reasonably good at describing interests and poor at predicting outcomes. Treat a result as a list of options worth investigating rather than as a measurement of who you are, and the accuracy question mostly stops mattering.' },
    { q: 'Are free career tests as good as paid ones?', a: 'Often, yes. What matters is whether the instrument names real occupations, states where its occupational data comes from, and explains why it ranked things the way it did. Price is not a proxy for any of those.' },
    { q: 'Why do career tests give me different results each time?', a: 'Instruments that sort people into discrete types are unstable near the boundaries, so small changes in mood or interpretation can flip a category. Tools that report positions on continuous scales, and that show which factors drove a result, tend to move less and are easier to sanity-check when they do.' },
    { q: 'What is the O*NET database?', a: 'A public occupational database published by the U.S. Department of Labor that describes what hundreds of occupations involve and what skills, knowledge and abilities they require. FlightWay uses release 30.3 as the source for its career data and is not endorsed by USDOL/ETA.' },
    { q: 'Should a career test tell me what to major in?', a: 'No. It can suggest directions worth exploring, but a major is a decision with academic, financial and personal constraints that no questionnaire has any visibility into.' },
  ],
  related: ['career-quiz', 'career-advisor-vs-coach-vs-ai', 'how-to-choose-a-career'],
  careers: ['ux-designer', 'paralegal', 'electrical-engineers', 'market-research-analysts-and-marketing-specialists'],
  cta: {
    h2: 'A result you can argue with',
    p: 'FlightWay ranks you against 780+ real occupations and shows the factors behind every match, so you can check the reasoning instead of trusting the number. The quiz is free and takes about ninety seconds.',
  },
};

const G_ADVISOR_VS_COACH = {
  slug: 'career-advisor-vs-coach-vs-ai',
  group: 'judge',
  title: 'Career advisor vs. coach vs. AI',
  h1: 'Career advisor vs. career coach vs. AI: what students actually need',
  description: 'Three different jobs get called the same thing. Here is what each one is genuinely good at, what it costs you, and how to tell which one you need.',
  hook: 'A campus advisor, a paid coach and an AI tool are not three grades of the same service. They solve different problems, and picking the wrong one is usually a diagnosis error rather than a budget one.',
  sections: [
    {
      id: 'three-different-jobs',
      h2: 'Three different jobs',
      body: [
        'Strip the labels off and there are three distinct things a student might need. <strong>Information</strong>: what this field is like, what it requires, what the process looks like and when it happens. <strong>Judgment</strong>: someone who knows your specific situation well enough to tell you something true that you did not want to hear. <strong>Follow-through</strong>: the unglamorous business of turning a decision into things that actually get done on ordinary weeks.',
        'Almost every complaint about career help is a mismatch between which of these you needed and which one you got. Being handed information when you needed judgment feels like being brushed off. Being coached on motivation when what you lacked was a recruiting calendar feels like an expensive waste.',
      ],
    },
    {
      id: 'campus-advisor',
      h2: 'What a campus career advisor is good at',
      body: [
        'Institutional knowledge, and it is undervalued. They know which employers actually recruit at your school, which alumni are reachable, which departments run what, which internal deadlines exist and how the school’s own systems work. None of that is on the public internet, and none of it can be guessed by a tool.',
        'They are also free, already paid for by your tuition, and the majority of students never use them — which means capacity is usually there for the ones who ask.',
        'The limits are structural rather than personal. Advisors carry large caseloads, so continuity is hard: they will not remember what you said six weeks ago unless you remind them. Their depth is broad rather than field-specific — a generalist advising across every discipline cannot also be current on one field’s hiring norms. And the appointment is a moment, not a process, so everything between appointments is on you.',
        'Use them for: what happens at this school, who to talk to, what I am missing about the process. Come with specific questions and they are one of the best resources you have.',
      ],
    },
    {
      id: 'paid-coach',
      h2: 'What a paid career coach is good at',
      body: [
        'Attention and accountability, focused on one person. A good coach knows your situation in detail, notices patterns across sessions, holds you to what you said you would do, and is willing to tell you something uncomfortable because that is what you are paying for. For someone genuinely stuck — repeatedly not doing the thing they keep deciding to do — that is worth a lot.',
        'Field-specific coaches add something else: the norms and the calendar of one industry, and often a network in it.',
        'The limits are cost and variance. Coaching is expensive per hour, so you buy it in small amounts, which caps how much follow-through it can supply. Quality varies enormously and the field is unregulated — anyone can use the title. And there is a failure mode worth naming: coaching feels productive. An hour of being asked good questions is satisfying whether or not anything changed afterward.',
        'Before paying anyone, ask: what specifically will be different in six weeks, and how will we know? A good coach has a crisp answer.',
      ],
    },
    {
      id: 'ai-tools',
      h2: 'What an AI tool is good at, and what it is not',
      body: [
        'Three things, genuinely. <strong>Breadth</strong>: it can compare you against every occupation in a catalog rather than the ones that came to mind. <strong>Availability</strong>: it is there at eleven at night in week nine, which is when most students actually confront this. <strong>Memory and repetition</strong>: it can track what you committed to and ask about it every week without getting bored, which is exactly the labor humans are worst at supplying cheaply.',
        'What it is not good at is equally clear. It does not know your school, your family, your health or your finances unless you tell it, and it cannot see your face fall when you describe the job you think you are supposed to want. It has no relationships to make an introduction with. And it will answer confidently in areas where it should defer — which is why the useful question about any AI career tool is not how smart it sounds but <strong>what it shows you about its own reasoning</strong>, and whether it states its limits out loud.',
        'A tool that hands you a number and no explanation is asking for trust it has not earned. A tool that shows the factors behind a result lets you catch it being wrong, which is the only workable relationship to have with one.',
      ],
    },
    {
      id: 'how-to-choose',
      h2: 'How to choose between them',
      body: [
        'Diagnose the gap first, then pick.',
      ],
      list: {
        kind: 'ul',
        items: [
          'You do not know what your options are → a structured tool, then reading. This is a breadth problem and humans are slow at breadth.',
          'You know the options and cannot decide → a conversation with someone who knows you. Judgment is the human specialty.',
          'You do not know how the process works at your school → the campus advisor, immediately. Nothing else has this information.',
          'You know what to do and are not doing it → structure and accountability, weekly. A coach if you can afford one, a system if you cannot.',
          'You need someone in the industry → neither a generalist advisor nor a tool. You need an actual person doing the work, and the advisor may be the fastest route to one.',
        ],
      },
    },
    {
      id: 'where-flightway-sits',
      h2: 'Where FlightWay sits',
      body: [
        'Explicitly in the first and fourth rows: breadth, and then follow-through. The <a href="/quiz">quiz</a> and the <a href="/careers">career pages</a> handle the option set — 780+ occupations from federal data, with the reasoning behind every match shown. After that it becomes a weekly system: a roadmap you can put due dates on, three or four concrete tasks a week, deadline alerts fourteen and three days out, and a coach that remembers what you said you would do and asks about it.',
        'It is not a substitute for your campus advisor, and the product does not pretend otherwise — the school-specific knowledge genuinely is not in the data. The sensible arrangement is the tool for breadth and week-to-week structure, the advisor for everything institutional, and a real conversation with someone in the field before you commit to it.',
      ],
    },
  ],
  faq: [
    { q: 'What is the difference between a career advisor and a career coach?', a: 'An advisor is usually attached to a school and is strongest on institutional knowledge — who recruits there, what the deadlines are, which alumni are reachable — and is included in your tuition. A coach is paid privately and is strongest on sustained individual attention and accountability over multiple sessions.' },
    { q: 'Is a career coach worth the money for a student?', a: 'It depends on the gap. If you keep deciding to do something and not doing it, paid accountability can be worth it. If you mainly lack information about options or about how your school’s process works, cheaper things solve that better. Ask any coach what will be measurably different in six weeks before paying.' },
    { q: 'Can AI replace a career counselor?', a: 'No, and a tool that claims otherwise is overselling. AI is good at breadth, availability and week-to-week follow-through. It cannot read a room, make an introduction, or know anything about your school, family or finances that you have not told it.' },
    { q: 'Are campus career services actually useful?', a: 'Yes, and they are the most underused resource most students have. They hold information that exists nowhere else — which employers recruit there, internal deadlines, reachable alumni. Come with specific questions rather than an open-ended request for advice.' },
    { q: 'What should I ask before paying for any career service?', a: 'What specifically will be different in six weeks, how will we know, what does it not do, and where does its information come from. A service that answers all four crisply is a service that has audited itself.' },
  ],
  related: ['career-quiz', 'parents-guide-to-career-help', 'do-career-tests-work'],
  careers: ['therapist', 'management-analysts', 'financial-and-investment-analysts'],
  cta: {
    h2: 'The breadth part, free',
    p: 'FlightWay handles the two things software is actually good at: comparing you against 780+ real occupations, and chasing the plan week by week. The quiz takes about ninety seconds and costs nothing.',
  },
};

// S14 agent-drafted guides are spliced in below this line.
const G_COLLEGE = {
  slug: 'career-development-in-college',
  group: 'work',
  title: 'What career development in college actually means',
  h1: 'What career development in college actually means',
  description: 'Career development in college means exploration, skill-building, and evidence — not a senior-year scramble.',
  hook: 'Most advice from a career center describes activities, not a method. This page lays out what the four years are actually for, and how to tell whether you are making progress.',
  sections: [
    {
      id: 'what-the-phrase-actually-means',
      h2: 'What career development actually means',
      body: [
        'Career development is the term colleges use for a specific kind of work: reducing uncertainty about what kind of work would suit you, getting measurably better at something a field values, and building the proof that both happened. It is not the list of activities a career center hands out — the fair, the résumé workshop, the professional headshot afternoon. Those are inputs. The output is a person who, by graduation, can explain why they are pointed at a direction and has something to show for it.',
        'The pamphlet version treats this as a checklist finished once, before graduation. The real version behaves more like compound interest: what gets deposited in the first two years determines what is available to draw on in the fourth. A student who starts in year one is not working harder than one who starts in year three — they are further along a curve that takes time to bend.',
      ],
    },
    {
      id: 'exploration-skill-building-evidence',
      h2: 'Exploration, skill-building, and evidence are three different jobs',
      body: [
        'Three distinct kinds of work get lumped under the single label <em>career development</em>, and treating them as one is where most plans go wrong. Exploration is finding out what you do not yet know about a field — what the day-to-day work actually involves, not what the job title implies. Skill-building is getting measurably better at something that field values. Evidence is the artifact that proves one of the other two actually happened: a project, a transcript line, a person willing to describe specifically what you did.',
        'The common mistake is substitution. An information session is exploration, but students often log it as if it were evidence. A class is skill-building, but if nothing produced in it ever gets shown to anyone outside the course, it never becomes evidence either. All three need to happen. None of them stands in for the other two.',
      ],
    },
    {
      id: 'why-four-years-are-a-sequence',
      h2: 'Why the four years are a sequence, not a senior-year scramble',
      body: [
        'These three kinds of work have a natural order, because they have different costs of being wrong and different amounts of time behind them. Exploration is cheapest early, when changing direction costs a semester rather than a job offer. Skill-building compounds only if it starts before the deadlines that require it are visible on a calendar. Evidence takes the longest to accumulate, because it depends on the other two already being underway — there is no shortcut that produces two years of a body of work in two months.',
        'Run in reverse — evidence assembled in a panic during year four, skill-building crammed into year three, exploration skipped because there is no longer time to be wrong — and the sequence collapses into the scramble most students recognize. The four years are not a deadline. They are the only amount of time in which the compounding actually has room to work.',
        'None of this is a formula — direction changes, majors get declared late, life intervenes. But the rough shape holds across most versions of a real four years:',
      ],
      list: {
        kind: 'ol',
        items: [
          'Years one and two: weight exploration higher than the other two, while changing your mind is still cheap',
          'Year three: shift the weight toward skill-building and the first pieces of evidence, once a direction has held for a while',
          'Year four: evidence assembly and applying should be finishing a body of work, not starting one',
        ],
      },
    },
    {
      id: 'what-compounds-and-what-doesnt',
      h2: 'What compounds and what does not',
      body: [
        'Three things compound. A body of work: a handful of projects or roles that build on each other and that you could describe, each in one sentence, without checking notes. A small number of real relationships: a professor, supervisor, or older student who has watched you work over time and would say something specific about you if asked, not just confirm that you attended. A clear story: a reason for the direction you are pointed at that sounds the same the second time you tell it, because it is actually true rather than assembled for an application.',
        'A student aiming at <a href="/careers/software-engineer">Software Developers</a> compounds by shipping small projects that get harder over time and stay visible in one place. A student aiming at <a href="/careers/nurse">Registered Nurses</a> compounds by logging clinical or volunteer hours under a supervisor who remembers them specifically. A student aiming at <a href="/careers/accountant">Accountants and Auditors</a> compounds through coursework that stacks toward a credential, plus a season of real numbers handled for someone other than a professor. The mechanism is the same in every field: something specific, attached to a name, that gets harder over time.',
        'Three things reliably do not compound, no matter how much time gets put into them:',
      ],
      list: {
        kind: 'ul',
        items: [
          'Attending events without any follow-up afterward',
          'Club titles that describe status rather than anything produced',
          'Switching direction every term without finishing what the last one started',
        ],
      },
    },
    {
      id: 'how-to-tell-if-youre-making-progress',
      h2: 'How to tell whether you are making progress',
      body: [
        'Two questions catch most of the failure mode. First: is there one specific thing, from the last three months, that could be shown to a stranger right now — not described, shown? Second: if asked to explain why you are pointed at the direction you are pointed at, would the answer sound the same in six months, or is it being assembled fresh each time someone asks? Neither question is exhaustive. Both catch the same problem, which is being busy without becoming legible.',
        'Keeping that legible over time is mostly a logging problem, not a work problem — the proof usually exists, it just is not written down anywhere a person could find it in December. FlightWay’s Evidence Locker is built for exactly that: a place to record what you actually did, tagged to the specific skill gap it closes, so the second question above has an answer that does not need to be reconstructed from memory.',
      ],
    },
    {
      id: 'starting-late-is-still-starting',
      h2: 'If this feels overdue, the exploration step still applies',
      body: [
        'If none of the above has happened and the calendar already says junior or senior year, the honest version is: exploration is compressed, not eliminated; skill-building can still move quickly if it is targeted rather than broad; evidence can be produced faster than it feels like it can, in a focused stretch, once the direction is no longer in question. What does not work is trying to do all three at once, in every direction simultaneously, in the time that is left.',
        'A narrower starting point helps more than a longer list of options. FlightWay’s quiz is free, takes about ninety seconds, and compares a profile built from your answers against more than 780 real occupations to produce a ranked, explainable list — not a single verdict, but a place to start narrowing from ten down to one.',
      ],
    },
  ],
  faq: [
    { q: 'Is career development the same thing as career counseling?', a: 'No. Career counseling is usually a conversation with an advisor about options and decisions. Career development is the underlying work of exploration, skill-building, and evidence that a counseling conversation can help organize, but cannot do for you.' },
    { q: 'When should career development start in college?', a: 'As early as possible, because exploration is cheapest before you have committed to a direction. Starting in year one does not mean having a plan finished by year one — it means the work of exploration and skill-building starts sooner rather than later.' },
    { q: 'Does joining a lot of clubs count as career development?', a: 'Joining clubs can support it, but membership alone does not. What compounds is what got produced or learned inside the club and can be pointed to afterward, such as a project or a role with real responsibility, not the number of organizations listed on a résumé.' },
    { q: 'What if I am already a junior or senior and have not done much of this?', a: 'Exploration gets compressed but is not impossible, and both skill-building and evidence can move faster than expected once a direction is no longer in question. The main risk at that point is trying to explore everything at once instead of narrowing quickly to one direction and going deep.' },
    { q: 'How is this different from just getting good grades?', a: 'Grades measure performance inside a course. Career development measures whether that performance produced something visible outside it. A strong transcript and a body of work a stranger could evaluate are both useful, but neither one substitutes for the other.' },
  ],
  related: ['plan-your-semester-around-a-career-goal', 'how-to-choose-a-career', 'career-quiz'],
  careers: ['software-engineer', 'nurse', 'accountant'],
  cta: {
    h2: 'Start with the free quiz',
    p: 'A chosen direction becomes a roadmap of waypoints and steps, with a short list of weekly tasks that updates on its own. Finding the direction starts with FlightWay’s quiz — free, about ninety seconds, and ranked across 780+ careers — <a href="/quiz">take it here</a>.',
  },
};
const G_SEMESTER = {
  slug: 'plan-your-semester-around-a-career-goal',
  group: 'work',
  title: 'How to plan your semester around one career goal',
  h1: 'How to plan your semester around one career goal',
  description: 'A concrete method for planning a semester around one career goal, including what to do when the plan breaks.',
  hook: 'Most semester plans fail because they start with five goals and no honest look at the weeks already spoken for. This is a method for picking one outcome and mapping it onto the calendar that actually exists.',
  sections: [
    {
      id: 'start-with-one-outcome',
      h2: 'Start with one outcome, not five',
      body: [
        'The default semester plan lists five goals — better grades, more networking, a new language, a fitness habit, an internship search — and produces roughly zero of them at the level intended. A semester has a fixed number of weeks and a fixed number of hours outside class. A plan with five owners has no owner.',
        'The fix is not motivation. It is picking the single outcome tied to whatever career direction is currently being tested, and letting everything else continue at whatever baseline effort it already gets. That is not a claim that grades or fitness do not matter. It is an acknowledgment that a semester reliably produces one new, real thing, rarely five.',
      ],
    },
    {
      id: 'audit-the-term-before-adding-anything',
      h2: 'Audit the term before adding anything to it',
      body: [
        'Before committing to anything new, write down what the term already contains: the course load and which specific weeks are exam-heavy, existing club or team commitments and their real weekly hours, paid work and its hours, and any fixed personal commitments. Most students can list their courses from memory. Far fewer can state their actual weekly hour budget, which is the number that determines what is realistic.',
        'The audit usually finds less slack than the semester appeared to have from the outside. Four items are worth writing down specifically:',
      ],
      list: {
        kind: 'ul',
        items: [
          'Course load, and which weeks are exam-heavy or paper-heavy',
          'Club, team, or leadership commitments, in hours per week, not just a title',
          'Paid work hours, including irregular shifts',
          'Fixed personal commitments that will not move for a school project',
        ],
      },
    },
    {
      id: 'pick-the-one-deliverable',
      h2: 'Pick the one deliverable that will exist at the end',
      body: [
        'With the outcome named and the real hours known, the next step is naming a specific deliverable, not a vague intention. Not getting better at coding in general, but three repositories with a short written explanation of what each one does. Not exploring healthcare in general, but twenty logged hours of shadowing with a supervisor’s name attached. A vague goal produces vague effort. A deliverable is something a stranger could be shown in December.',
        'For a student testing <a href="/careers/data-scientist">Data Scientists</a>, that might be one analysis project with a public writeup instead of three half-finished ones. For a student testing <a href="/careers/ux-designer">Web and Digital Interface Designers</a>, it might be a single polished case study added to a portfolio. For a student testing <a href="/careers/mechanical-engineer">Mechanical Engineers</a>, it might be one completed CAD project entered into a competition. The deliverable should be the smallest version that is still real, sized to the hours the audit found, not the hours a more ambitious version of the semester would have had.',
      ],
    },
    {
      id: 'map-it-onto-the-weeks',
      h2: 'Map it onto the weeks, including the weeks it will not happen',
      body: [
        'A semester runs roughly fourteen to sixteen weeks, and two or three of them are already spoken for before anything else gets scheduled: the week before midterms, the week before finals, and usually one more around a break or a crunch in a harder class. A plan that assumes even effort across every week is wrong before it starts.',
        'Naming the dead weeks up front, and shifting more of the deliverable’s work into the weeks around them, is what keeps one bad exam week from quietly ending the whole plan by week nine. A rough shape that holds across most semesters:',
      ],
      list: {
        kind: 'ol',
        items: [
          'Weeks 1-2: name the outcome, run the audit, define the deliverable',
          'Weeks 3-6: first real block of work on the deliverable',
          'Weeks 7-8: checkpoint (see the midpoint section below)',
          'Exam-heavy weeks: expect close to zero progress, and plan for it rather than fight it',
          'Final weeks: finish and log the deliverable somewhere it can be pointed to later, not just turned in',
        ],
      },
    },
    {
      id: 'the-midterm-checkpoint',
      h2: 'Put a checkpoint at the midpoint',
      body: [
        'A deliverable planned in week one and checked once in week fifteen has no error correction built into it. A short, honest look around week seven or eight, at how much of the deliverable actually exists compared with what the plan assumed, is what allows the second half of the term to be replanned instead of quietly abandoned.',
        'The checkpoint only works if it is genuinely honest. If a third of the deliverable exists at the midpoint, the plan for the second half should assume a third pace, not hope for a sudden acceleration with no evidence behind it.',
      ],
    },
    {
      id: 'when-the-plan-breaks',
      h2: 'What to do when the plan breaks',
      body: [
        'It will break. A class turns out harder than expected, a job adds hours, something personal takes priority for two weeks. That is not a sign the method failed — a plan is a starting position, not a contract. What matters is whether a checkpoint catches the break early enough to resize the deliverable, rather than discovering in week fourteen that none of it happened.',
        'Part of what makes a plan break silently is that the only record of it lived in one person’s head, or in a note nobody reopened after week one. FlightWay’s roadmap breaks a chosen career direction into waypoints and steps, with a due date that can sit on each step rather than just on the outcome, and its weekly Flight Plan turns whatever step is next into three or four concrete tasks for that specific week, regenerated every week instead of planned once at the start of term and forgotten.',
      ],
    },
  ],
  faq: [
    { q: 'How many goals should I actually set for a semester?', a: 'One primary outcome tied to a career direction, not five. Everything else in your life continues at whatever baseline effort it already gets, because a semester cannot reliably produce five new things at once.' },
    { q: 'What if my course load is already full?', a: 'Run the audit first and size the deliverable to whatever hours are actually left, even if that number is small. A modest deliverable that gets finished is more useful in December than an ambitious one that gets abandoned in week nine.' },
    { q: 'When in the semester should this planning happen?', a: 'In the first one or two weeks, before the schedule fills in and before the audit turns into guesswork. Planning it in week six usually means retrofitting a plan around commitments that already exist, rather than choosing them deliberately.' },
    { q: 'What actually counts as a deliverable?', a: 'Something specific enough that a stranger could be shown the result in December, such as a finished project or a logged set of hours with a named supervisor attached. General intentions like exploring a field or getting better at something are not deliverables on their own.' },
    { q: 'What happens if the plan falls apart partway through the term?', a: 'That is what the midpoint checkpoint is for. An honest look at how much of the deliverable exists by week seven or eight allows the second half to be resized around the real pace, instead of discovering in the final weeks that the plan never happened.' },
  ],
  related: ['career-development-in-college', 'find-internship-deadlines', 'career-quiz'],
  careers: ['data-scientist', 'ux-designer', 'mechanical-engineer'],
  cta: {
    h2: 'Plan the semester around a direction, not a guess',
    p: 'A roadmap with a due date on each step, and a weekly Flight Plan that turns the next step into a short task list, are what keep a semester plan from quietly disappearing. Finding the direction to build it around starts with FlightWay’s quiz — free, about ninety seconds — <a href="/quiz">take the quiz</a>.',
  },
};
const G_DEADLINES = {
  slug: 'find-internship-deadlines',
  group: 'work',
  title: 'How to find internship deadlines before they pass',
  h1: 'How to find internship deadlines before they pass',
  description: 'A practical system for tracking internship deadlines across employers, schools, and organizations so you stop finding out too late.',
  hook: 'Deadlines decide outcomes more than most students realize. Here is how to find them early enough to matter, and what to do if you are already late.',
  sections: [
    {
      id: 'why-deadlines-decide-outcomes',
      h2: 'Why the deadline is the real filter',
      body: [
        'Most advice about internships focuses on being competitive: the right coursework, the right resume line, the right story in an interview. All of that matters, but none of it matters if the application arrives after the deadline. A late submission is not scored lower. In almost every system, it is not scored at all.',
        'This is why deadlines deserve more attention than they get. A student who is a genuinely weaker fit for a role but applies on time will beat a stronger candidate who finds out three days late. That is not a comment on effort or ability. It is a statement about how application systems work: most close the portal the moment the clock runs out, and there is rarely an exception process.',
        'The timing problem is also easy to underestimate because it is invisible. A rejection for fit at least generates a signal — an interview that goes poorly, a role that was never a good match. A missed deadline generates nothing. There is no rejection email to learn from, just silence, because the application was never in the pool to begin with.',
      ],
    },
    {
      id: 'where-deadlines-actually-live',
      h2: 'The places deadlines actually live',
      body: [
        'There is no single calendar that lists every internship deadline in a given field. Instead, the information lives in several separate places, each maintained by a different kind of organization, and each with real gaps. None of these sources is complete on its own: a career center board can miss a posting that only appeared on the employer’s own site, and a faculty mailing list will not mention a fellowship in an unrelated department.',
        'This fragmentation is not an accident, and it is not going away. Each organization manages its own hiring and has no obligation to broadcast it anywhere else. The practical result is that finding deadlines is itself a skill, separate from the skill of being a good candidate, and it rewards deliberate searching over passively waiting for something to land in your inbox. The five places worth checking on a regular basis:',
      ],
      list: {
        kind: 'ul',
        items: [
          'Employer career pages, where the primary posting and its real deadline live, if the employer sets a firm date at all.',
          'University career-center systems and job boards, which pull in some employer postings but rarely all of them, often with a delay.',
          'Department and faculty mailing lists, which surface field-specific openings a general career center would never see.',
          'Professional societies and student chapters, which post opportunities aimed specifically at students in that field.',
          'Competition, fellowship, and program organizers, who run on their own timeline, separate from standard recruiting.',
        ],
      },
    },
    {
      id: 'calendars-vary-by-field',
      h2: 'Recruiting calendars vary by field, so learn yours',
      body: [
        'Recruiting calendars do not run on one universal clock. A role in <a href="/careers/software-engineer">Software Developers</a> or <a href="/careers/financial-and-investment-analysts">Financial and Investment Analysts</a> often opens applications far ahead of the actual start date. A role in <a href="/careers/accountant">Accountants and Auditors</a> or a design-focused position like <a href="/careers/ux-designer">Web and Digital Interface Designers</a> can follow a very different pattern. A calendar that is accurate for one field can be badly wrong, in either direction, for another.',
        'The only reliable fix is to learn the calendar for your specific field rather than trust a generic rule of thumb passed around online. Ask people already in the field, ask a department advisor, or ask the professional society for that field directly. Look at when last year’s postings for similar roles actually opened and closed, not just when the work started. That pattern is a far better guide than a generic timeline written for no field in particular.',
      ],
    },
    {
      id: 'build-one-list-you-check',
      h2: 'Build one list you actually check',
      body: [
        'Scattered sources are manageable if they feed one list instead of living in your head. The list does not need to be sophisticated. It needs three fields for every entry, and it needs to live somewhere you actually look:',
      ],
      list: {
        kind: 'ol',
        items: [
          'The deadline itself, as a specific date, not a season or a month.',
          'A link straight to the application or posting.',
          'The source it came from, so you know where to check again if the date changes.',
        ],
      },
      after: [
        'A spreadsheet, a notes app, or a shared document all work. What matters is that it is a single list, not five tabs you half-remember, and that you update it the moment you find something new rather than promising yourself you will add it later.',
      ],
    },
    {
      id: 'set-reminders-ahead-of-the-deadline',
      h2: 'Set your reminder ahead of the deadline, not on it',
      body: [
        'A reminder set for the day something is due is nearly useless. Most applications take real time: a resume tailored to the role, a short answer or essay, sometimes a recommendation someone else has to write. None of that happens well in the hours before a portal closes.',
        'Set the first reminder at least two weeks out, so there is time to write a genuinely good application rather than a rushed one. A second reminder a few days before the deadline is a useful backstop, not a replacement for the first one. FlightWay’s Deadline Radar does this automatically once a deadline is in the system: it sends an alert 14 days out and again at 3 days, on top of anything you add by hand.',
      ],
    },
    {
      id: 'if-you-already-missed-one',
      h2: 'What to do if you already missed one',
      body: [
        'A missed deadline is not a crisis, even though it feels like one. First, confirm it is actually closed. Some employers quietly extend a deadline or reopen a role that did not fill; it costs nothing to check the page again or send a short, polite email asking if applications are still being accepted.',
        'If it is genuinely closed, redirect the energy rather than losing it. Look for a later round, a different team at the same organization, or a similar role elsewhere with a deadline still open. Then fix the actual cause: if you found out too late because the posting only existed in one place, that is the gap to close before the next cycle, not a reason to assume the same thing will happen again. Once you do apply somewhere, keeping that saved opportunity moving — interested, applied, interviewing — is easier if it lives in one tracker instead of scattered emails; FlightWay’s Application Tracker is built for exactly that step.',
      ],
    },
  ],
  faq: [
    { q: 'How early should I start looking for internship deadlines?', a: 'For most fields, start watching for postings well before you would expect a role to begin, since many deadlines land far ahead of the actual start date. The safest approach is to start looking as soon as the prior recruiting cycle for your field ends, then keep checking on a regular schedule.' },
    { q: 'Where is the single best place to find internship deadlines?', a: 'There isn’t one. Employer pages, university career-center systems, department mailing lists, professional societies, and competition or fellowship organizers each carry different postings, and checking only one source will always miss something.' },
    { q: 'Can I still apply after a deadline has passed?', a: 'Usually no, but it is worth checking. Some organizations quietly extend a deadline or reopen a role that did not fill, and a short, polite email asking is low cost. If the answer is no, focus on the next round or a similar opening elsewhere instead.' },
    { q: 'Do internship deadlines differ a lot between fields?', a: 'Yes, significantly. Some fields recruit far ahead of the actual start date, while others post and fill roles much closer to when the work begins. Learn the pattern for your specific field rather than relying on a generic timeline.' },
    { q: 'What information should I record for each deadline?', a: 'At minimum, the exact date, a direct link to the application, and the source where you found it, so you can check back if anything changes. Keeping all of this in one list beats spreading it across memory, email, and browser tabs.' },
    { q: 'How does FlightWay help with internship deadlines?', a: 'FlightWay’s Deadline Radar tracks real external deadlines you add or find through the app and emails an alert 14 days and again 3 days before each one. You can also add a deadline by hand and move a saved opportunity through an Application Tracker as you apply.' },
  ],
  related: ['plan-your-semester-around-a-career-goal', 'career-development-in-college', 'career-quiz'],
  careers: ['software-engineer', 'financial-and-investment-analysts', 'accountant', 'ux-designer'],
  cta: {
    h2: 'Let something else hold the dates',
    p: 'FlightWay’s Deadline Radar tracks internship and fellowship deadlines you add by hand or find through the app, then emails an alert 14 days and 3 days before each one closes. It starts with the same free quiz as everything else on FlightWay — <a href="/quiz">about ten questions, roughly 90 seconds</a>.',
  },
};
const G_PARENTS = {
  slug: 'parents-guide-to-career-help',
  group: 'parents',
  title: 'A parent’s guide to helping with career decisions',
  h1: 'A parent’s guide to helping with career decisions',
  description: 'What has changed since you applied for jobs, how to tell support from pressure, and what a paid career service should be honest about.',
  hook: 'Career recruiting has changed since you went through it, but the underlying need has not: real evidence of real skills. Here is what actually helps, and what does not.',
  sections: [
    {
      id: 'what-has-actually-changed',
      h2: 'What has actually changed since you were applying',
      body: [
        'Some of what has changed is real. In a handful of fields, formal recruiting now starts earlier in college than it used to, with structured application cycles that used to sit much closer to graduation. Application volume is higher almost everywhere, partly because applying online is easier than it once was, so more students apply to more things. There are also more tools now: more platforms, more test-prep, more advice content, most of it competing for attention rather than actually helping.',
        'What has not changed is the underlying question every employer is still asking, in one form or another: what can you actually do, and what proof do you have of it. Coursework, projects, part-time work, and internships still answer that question the way they always did. The landscape around the question is busier and faster. The question itself is old.',
      ],
    },
    {
      id: 'pressure-versus-support',
      h2: 'Pressure and support are not the same thing',
      body: [
        'Pressure and support can look identical from the outside. Both involve asking about plans, both involve caring about the outcome, and both can come from a good place. The difference usually shows up in what happens after the answer. Support can sit with an uncertain or unimpressive answer without needing to fix it immediately. Pressure treats an uncertain answer as a problem that needs solving right now, usually by the parent.',
        'A rough test: notice whose anxiety the conversation is actually managing. If a check-in about internships or majors mostly relieves your own worry, that is worth noticing, even if the words you use are gentle. If it genuinely gives the student a place to think out loud without a predetermined right answer, that is closer to support. Most parents do both at different moments. The goal is not to eliminate concern, only to notice when it has started driving the conversation.',
      ],
    },
    {
      id: 'better-questions-to-ask',
      h2: 'Questions worth asking besides the obvious one',
      body: [
        '"So what are you going to do" asks for a conclusion. Most students do not have one yet, and the question mostly just adds stress on top of that fact. Questions about process tend to open a real conversation instead of shutting one down, and none of them demand a five-year plan or a finished answer. A few that work better:',
      ],
      list: {
        kind: 'ul',
        items: [
          'What have you tried so far, even if it did not go anywhere.',
          'What did you learn from the last thing that did not work out.',
          'What would you want to be true a year from now, even without a plan for getting there.',
          'What feels like it is missing right now: information, confidence, or just time.',
        ],
      },
      after: [
        'The point is not to extract a plan in one conversation. It is to signal, repeatedly, that the process itself counts as progress, which is usually more useful than producing an answer meant to satisfy a parent in the moment.',
      ],
    },
    {
      id: 'what-the-career-center-can-and-cant-do',
      h2: 'What the school career center can and cannot do',
      body: [
        'A school career center is a genuinely useful, underused resource, and also not a complete solution by itself. Most can review a resume, run a mock interview, point a student toward listed opportunities, and explain how to use tools the school already pays for. Staff there see a wide range of students across many majors and have watched far more paths than any one family will encounter directly.',
        'What a career center usually cannot do is give a student individualized attention over months, chase down every opportunity in a specific niche field, or replace the slower work of the student actually trying things and building evidence of what they can do. Encourage the student to go, more than once, and treat it as one input, not the whole strategy.',
      ],
    },
    {
      id: 'how-to-evaluate-a-paid-career-service',
      h2: 'How to evaluate any paid career service, including this one',
      body: [
        'Paid career tools and services range widely in what they actually do, and the marketing rarely makes the difference obvious. A useful way to evaluate any of them, including FlightWay, is to ask what they are honest about. A good service is specific about what its score or recommendation actually measures, plain about what it does not do, and clear about which parts are free. Worth asking before paying for any of them:',
      ],
      list: {
        kind: 'ul',
        items: [
          'What exactly does this measure, and can you see the reasoning behind a result, not just the result itself.',
          'What is free, and what requires payment, stated plainly rather than discovered at checkout.',
          'Does this claim to guarantee an outcome, like an internship or a job. If so, that claim alone is a reason for caution.',
          'Is my student’s data used only to help them, or sold or shared elsewhere.',
        ],
      },
      after: [
        'FlightWay’s own answer to that test: the quiz and its results are free, the method behind every match is visible rather than hidden, and the score is about <em>fit</em> only, not a promise about readiness or outcome. Judging any service by that same standard, including this one, is a reasonable way to spend a few extra minutes before paying for anything.',
      ],
    },
    {
      id: 'what-actually-helps',
      h2: 'What actually helps',
      body: [
        'The list of things that reliably help is shorter than it might seem. Pay attention without requiring a conclusion. Let "I don’t know yet" be an acceptable answer more than once. Ask about specific, recent experiences rather than abstract five-year plans. Offer to look at something together, a resume or a list of options, only when asked, not on your own schedule.',
        'The most useful thing a parent can offer is usually not advice about which career to choose. It is patience while the student gathers real evidence: a class, a project, a summer role, a rejection, a fit test, whatever actually produces information. Pressure can occasionally speed up a decision. It rarely improves the quality of it.',
      ],
    },
  ],
  faq: [
    { q: 'Is it normal for my student to not know what career they want yet?', a: 'Yes, this is extremely common, especially early in college. What matters more at this stage is that they are gathering real experience, coursework, and evidence of skills, not that they have already picked a single answer.' },
    { q: 'How is career recruiting different now than when I was in school?', a: 'In some fields, formal recruiting starts earlier in college and follows a more structured cycle than it used to. Application volume is generally higher too, since applying online is easier. The underlying thing employers look for, real evidence of ability, has not changed.' },
    { q: 'Should I push my student to pick a career direction sooner?', a: 'Pushing for a firm decision usually adds stress without adding clarity. It tends to work better to support the process of gathering evidence, through classes, projects, and internships, and let the direction narrow on its own over time.' },
    { q: 'What can our school’s career center actually do for my student?', a: 'A career center can typically review a resume, run practice interviews, and point students toward listed opportunities and campus resources. It usually cannot provide months of individualized attention or guarantee results in a specific niche field, so it works best as one resource among several.' },
    { q: 'How do I know if a paid career service is worth it for my student?', a: 'Look at what the service is honest about: whether it explains its method, is clear about what is free versus paid, and avoids promising a specific outcome like a job or an internship. A service that cannot explain its own reasoning in plain terms is harder to trust.' },
    { q: 'Is FlightWay something I sign up for, or my student?', a: 'The account belongs to the student, and the quiz itself is free: about ten questions, roughly 90 seconds. A parent’s role is usually best played by asking what the student found, not by taking over the account.' },
  ],
  related: ['career-advisor-vs-coach-vs-ai', 'do-career-tests-work', 'how-to-choose-a-career'],
  careers: ['nurse', 'mechanical-engineer', 'paralegal', 'therapist'],
  cta: {
    h2: 'A free starting point that belongs to your student',
    p: 'FlightWay’s quiz is free — about ten questions, roughly 90 seconds — and the account it creates belongs to your student, not to you. The most useful thing you can do is ask what they found interesting, not ask for the login.',
  },
};

export const GUIDES = [
  G_CAREER_QUIZ, G_HOW_TO_CHOOSE, G_DO_TESTS_WORK, G_ADVISOR_VS_COACH,
  G_COLLEGE, G_SEMESTER, G_DEADLINES, G_PARENTS,
].filter(Boolean);

export const GUIDE_BY_SLUG = new Map(GUIDES.map((g) => [g.slug, g]));

/**
 * Anchor text for the career pages guides link at. Held here, not looked up,
 * because this module is pure and must not learn to fetch the catalog just to
 * label a link — but `seo:check` asserts every entry equals that slug's REAL
 * O*NET title in the live catalog, so a renamed occupation turns the suite red
 * instead of leaving eight public pages calling it by its old name.
 */
export const CAREER_TITLES = {
  'software-engineer': 'Software Developers',
  'data-scientist': 'Data Scientists',
  nurse: 'Registered Nurses',
  accountant: 'Accountants and Auditors',
  'mechanical-engineer': 'Mechanical Engineers',
  'electrical-engineers': 'Electrical Engineers',
  'management-analysts': 'Management Analysts',
  'market-research-analysts-and-marketing-specialists': 'Market Research Analysts and Marketing Specialists',
  'ux-designer': 'Web and Digital Interface Designers',
  paralegal: 'Paralegals and Legal Assistants',
  therapist: 'Mental Health Counselors',
  'financial-and-investment-analysts': 'Financial and Investment Analysts',
};

// ---------------------------------------------------------------------------
// Inline markup. The four tags a body string may use, re-checked at render time
// rather than trusted — see the header note.

const ALLOWED_TAG = /^(?:\/?(?:strong|em|a)|a href="[^"<>]*")$/;

/**
 * Escapes everything except <strong>, <em>, <a href="…"> and their closers.
 *
 * One pass, not a chain of `.replace()`s: a chain either re-escapes the tags it
 * just decided to keep, or leaves an unpaired `<` alone. Walk the string once,
 * escape the gaps, and let a tag through only if it matches the allowlist.
 */
export function inline(text) {
  const src = String(text == null ? '' : text)
    .replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
  const gap = (s) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const re = /<([^<>]*)>/g;
  let out = '';
  let at = 0;
  let m = re.exec(src);
  while (m) {
    out += gap(src.slice(at, m.index));
    out += ALLOWED_TAG.test(m[1]) ? `<${m[1]}>` : gap(m[0]);
    at = m.index + m[0].length;
    m = re.exec(src);
  }
  return out + gap(src.slice(at));
}

/** Every tag a guide's prose actually uses — `seo:check` asserts this is a
 *  subset of the allowlist, so a typo is caught at build rather than stripped. */
export function tagsUsed(text) {
  return [...String(text || '').matchAll(/<([^>]*)>/g)].map((m) => m[1]);
}

/** Plain text, for llms-full.txt and for the word count. */
export function stripTags(text) {
  return String(text == null ? '' : text)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** Every authored prose string in a guide, in reading order. One definition so
 *  the word count, the plain-text build and the gate's markup scan cannot
 *  disagree about what counts as the guide's content. */
export function guideProse(g) {
  return [
    g.hook,
    ...g.sections.flatMap((s) => [
      ...s.body, ...((s.list && s.list.items) || []), ...(s.after || []),
    ]),
  ];
}

export function guideWordCount(g) {
  return guideProse(g).join(' ').split(/\s+/).filter(Boolean).length;
}

export function readMinutes(g) {
  return Math.max(3, Math.round(guideWordCount(g) / WORDS_PER_MINUTE));
}

// ---------------------------------------------------------------------------
// CSS. Appended after career-page.js's PAGE_CSS, which already carries the
// wrapper, hero, section, card, CTA and source-note rules these pages reuse.

const GUIDE_CSS = `
.gd-prose p{line-height:1.7;margin:0 0 16px;max-width:68ch;color:rgb(var(--text))}
.gd-prose p:last-child{margin-bottom:0}
.gd-after{margin-top:18px}
.gd-prose a{color:rgb(var(--primary));text-decoration:underline;text-underline-offset:2px}
.gd-steps{max-width:68ch;margin:18px 0 0;padding-left:22px;display:grid;gap:12px}
.gd-steps li{line-height:1.65;padding-left:4px}
.gd-steps li::marker{color:rgb(var(--primary));font-weight:700}
.gd-toc{border:1px solid rgb(var(--border));border-radius:14px;padding:18px 20px;background:rgb(var(--surface));margin:28px 0 0}
.gd-toc h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:rgb(var(--muted));margin:0 0 10px;font-family:inherit}
.gd-toc ol{margin:0;padding-left:20px;display:grid;gap:7px}
.gd-toc a{color:rgb(var(--text));text-decoration:none;line-height:1.5}
.gd-toc a:hover{color:rgb(var(--primary));text-decoration:underline}
.gd-faq{display:grid;gap:14px;margin:0}
.gd-faq-item{border:1px solid rgb(var(--border));border-radius:12px;padding:16px 18px;background:rgb(var(--surface))}
.gd-faq-q{font-weight:600;margin:0 0 6px;line-height:1.45}
.gd-faq-a{margin:0;color:rgb(var(--muted));line-height:1.6}
.gd-meta{font-size:13px;color:rgb(var(--muted));margin:18px 0 0}
.gd-cards{list-style:none;padding:0;margin:0;display:grid;gap:14px}
@media(min-width:760px){.gd-cards{grid-template-columns:1fr 1fr}}
.gd-card{border:1px solid rgb(var(--border));border-radius:14px;padding:18px 20px;background:rgb(var(--surface))}
.gd-card h3{margin:0 0 6px;font-size:17px;letter-spacing:-0.01em}
.gd-card h3 a{color:rgb(var(--text));text-decoration:none}
.gd-card h3 a:hover{color:rgb(var(--primary))}
.gd-card p{margin:0;color:rgb(var(--muted));font-size:14px;line-height:1.55}
.gd-card-meta{display:block;margin-top:10px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:rgb(var(--muted))}
`;

// ---------------------------------------------------------------------------
// Rendering.

/**
 * `body` renders above the list, `after` below it. The split exists because a
 * section that introduces a list with a colon and then comments on it needs
 * three parts, not two — flattening them into `body` puts the commentary
 * between the colon and the thing it introduces, which reads as a mistake.
 */
function sectionHtml(s) {
  const paras = s.body.map((p) => `    <p>${inline(p)}</p>`).join('\n');
  const tag = s.list && s.list.kind === 'ol' ? 'ol' : 'ul';
  const list = s.list
    ? `\n    <${tag} class="gd-steps">\n${
      s.list.items.map((i) => `      <li>${inline(i)}</li>`).join('\n')}\n    </${tag}>`
    : '';
  const after = (s.after && s.after.length)
    ? `\n    <div class="gd-prose gd-after">\n${s.after.map((p) => `      <p>${inline(p)}</p>`).join('\n')}\n    </div>`
    : '';
  return `  <section class="cg-sec" id="${esc(s.id)}">
    <h2>${esc(s.h2)}</h2>
    <div class="gd-prose">
${paras}
    </div>${list}${after}
  </section>`;
}

export function renderGuidePage(g) {
  const url = `${SITE}/guides/${g.slug}`;
  const fullTitle = `${g.title} | FlightWay`;

  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: g.title,
    description: g.description,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: GUIDES_CONTENT_DATE,
    dateModified: GUIDES_CONTENT_DATE,
    inLanguage: 'en-US',
    image: OG_GUIDES.split('?')[0],
    author: { '@type': 'Organization', name: 'FlightWay', url: SITE },
    publisher: { '@type': 'Organization', name: 'FlightWay', url: SITE },
    isPartOf: { '@type': 'WebSite', name: 'FlightWay', url: SITE },
  };
  const faqPage = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: g.faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'FlightWay', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Guides', item: `${SITE}/guides` },
      { '@type': 'ListItem', position: 3, name: g.title, item: url },
    ],
  };

  const toc = g.sections.map((s) => `        <li><a href="#${esc(s.id)}">${esc(s.h2)}</a></li>`).join('\n');

  const relatedGuides = g.related.map((slug) => GUIDE_BY_SLUG.get(slug)).filter(Boolean);
  const relatedHtml = relatedGuides.length
    ? `  <section class="cg-sec" id="more-guides">
    <h2>More guides</h2>
    <ul class="cg-links">
${relatedGuides.map((r) => `      <li><a href="/guides/${esc(r.slug)}">${esc(r.title)}</a></li>`).join('\n')}
    </ul>
  </section>`
    : '';

  const careersHtml = g.careers && g.careers.length
    ? `  <section class="cg-sec" id="career-pages">
    <h2>Careers mentioned here</h2>
    <p class="cg-lede">Each one has a full page: what the work involves, what it takes, how people get in, and what it pays.</p>
    <ul class="cg-links">
${g.careers.map((slug) => `      <li><a href="/careers/${esc(slug)}">${esc(CAREER_TITLES[slug] || slug.replace(/-/g, ' '))}</a></li>`).join('\n')}
    </ul>
  </section>`
    : '';

  const main = `<main class="cg-wrap">
  <p class="cg-crumbs"><a href="/">FlightWay</a> / <a href="/guides">Guides</a></p>

  <header class="cg-hero">
    <p class="cg-eyebrow">Guide</p>
    <h1>${esc(g.h1)}</h1>
    <p class="cg-hook">${inline(g.hook)}</p>
    <p class="gd-meta">${readMinutes(g)} min read · Updated ${esc(GUIDES_CONTENT_DATE)}</p>
    <nav class="gd-toc" aria-label="On this page">
      <h2>On this page</h2>
      <ol>
${toc}
      </ol>
    </nav>
  </header>

${g.sections.map(sectionHtml).join('\n\n')}

  <section class="cg-sec" id="faq">
    <h2>Questions people ask</h2>
    <div class="gd-faq">
${g.faq.map((f) => `      <div class="gd-faq-item">
        <p class="gd-faq-q">${esc(f.q)}</p>
        <p class="gd-faq-a">${esc(f.a)}</p>
      </div>`).join('\n')}
    </div>
  </section>

${careersHtml}
${relatedHtml}

  <section class="cg-cta">
    <h2>${esc(g.cta.h2)}</h2>
    <p>${inline(g.cta.p)}</p>
    <a class="cg-btn" href="/quiz?from=guide&amp;guide=${encodeURIComponent(g.slug)}" data-gd-cta="end" data-gd-slug="${esc(g.slug)}">Take the quiz</a>
    <a class="cg-btn cg-btn--ghost" href="/careers">Browse every career</a>
  </section>

  <p class="cg-src">Occupational data referenced in this guide comes from the <strong>O*NET ${esc(ONET_RELEASE)} Database</strong>, published by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). O*NET is a registered trademark of USDOL/ETA, which does not endorse FlightWay — see <a href="/terms#our-content">our terms</a>. This guide is general information about choosing and building a career; it is not professional, financial or legal advice.</p>
</main>
<script>
(function(){
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('[data-gd-cta]') : null;
    if (!a || !window.FWEvents) return;
    FWEvents.log('guide_cta_click', { placement: a.getAttribute('data-gd-cta'), slug: a.getAttribute('data-gd-slug') });
  });
})();
</script>`;

  return shell({
    title: fullTitle,
    description: g.description,
    canonicalPath: `/guides/${g.slug}`,
    ogImage: OG_GUIDES,
    structured: [article, faqPage, breadcrumb],
    main,
    css: GUIDE_CSS,
  });
}

export function renderGuidesIndex() {
  const title = 'Career guides for students | FlightWay';
  const description = `${GUIDES.length} guides on choosing a career, judging the tools that claim to help, and doing the weekly work that actually moves it.`;

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'FlightWay', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Guides', item: `${SITE}/guides` },
    ],
  };
  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'FlightWay guides',
    description,
    url: `${SITE}/guides`,
    inLanguage: 'en-US',
    isPartOf: { '@type': 'WebSite', name: 'FlightWay', url: SITE },
    hasPart: GUIDES.map((g) => ({
      '@type': 'Article',
      headline: g.title,
      description: g.description,
      url: `${SITE}/guides/${g.slug}`,
    })),
  };

  const groups = GROUPS
    .map((grp) => ({ ...grp, rows: GUIDES.filter((g) => g.group === grp.key) }))
    .filter((grp) => grp.rows.length);

  const main = `<main class="cg-wrap">
  <p class="cg-crumbs"><a href="/">FlightWay</a> / Guides</p>

  <header class="cg-hero">
    <p class="cg-eyebrow">Guides</p>
    <h1>Career guides for students</h1>
    <p class="cg-hook">Written to be useful whether or not you ever sign up: how to pick a direction, how to judge the tools that claim to help, and what the work looks like week to week once you have chosen. No statistics we cannot source, and no promises about outcomes.</p>
  </header>

${groups.map((grp) => `  <section class="cg-sec" id="${esc(grp.key)}">
    <h2>${esc(grp.label)}</h2>
    <p class="cg-lede">${esc(grp.blurb)}</p>
    <ul class="gd-cards">
${grp.rows.map((g) => `      <li class="gd-card">
        <h3><a href="/guides/${esc(g.slug)}">${esc(g.title)}</a></h3>
        <p>${esc(g.description)}</p>
        <span class="gd-card-meta">${readMinutes(g)} min read</span>
      </li>`).join('\n')}
    </ul>
  </section>`).join('\n\n')}

  <section class="cg-sec" id="careers">
    <h2>Looking for a specific job?</h2>
    <p class="cg-lede">Every occupation FlightWay scores you against has its own page — what the work involves, the skills and knowledge it takes, the education path, a salary band and related careers.</p>
    <ul class="cg-links">
      <li><a href="/careers">Browse every career</a></li>
      <li><a href="/careers/software-engineer">Software Developers</a></li>
      <li><a href="/careers/nurse">Registered Nurses</a></li>
      <li><a href="/careers/accountant">Accountants and Auditors</a></li>
      <li><a href="/careers/data-scientist">Data Scientists</a></li>
    </ul>
  </section>

  <section class="cg-cta">
    <h2>Or start with the quiz</h2>
    <p>Ten questions, about ninety seconds, ranked against 780+ real occupations with the reasoning shown rather than hidden.</p>
    <a class="cg-btn" href="/quiz?from=guides" data-gd-cta="index" data-gd-slug="index">Take the quiz</a>
  </section>

  <p class="cg-src">Occupational data referenced across these guides comes from the <strong>O*NET ${esc(ONET_RELEASE)} Database</strong>, published by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). O*NET is a registered trademark of USDOL/ETA, which does not endorse FlightWay — see <a href="/terms#our-content">our terms</a>.</p>
</main>
<script>
(function(){
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('[data-gd-cta]') : null;
    if (!a || !window.FWEvents) return;
    FWEvents.log('guide_cta_click', { placement: a.getAttribute('data-gd-cta'), slug: a.getAttribute('data-gd-slug') });
  });
})();
</script>`;

  return shell({
    title,
    description,
    canonicalPath: '/guides',
    ogImage: OG_GUIDES,
    structured: [collection, breadcrumb],
    main,
    css: GUIDE_CSS,
  });
}

/** Noindex, no canonical — same reasoning as the career 404. */
export function renderGuideNotFound(slug) {
  const main = `<main class="cg-wrap">
  <p class="cg-crumbs"><a href="/">FlightWay</a> / <a href="/guides">Guides</a></p>
  <header class="cg-hero">
    <p class="cg-eyebrow">Not found</p>
    <h1>There is no guide at that address</h1>
    <p class="cg-hook">${slug ? `Nothing here matches <strong>${esc(slug)}</strong>. ` : ''}The full list is one click away.</p>
    <p style="margin:26px 0 0">
      <a class="cg-btn" href="/guides">All guides</a>
      <a class="cg-btn cg-btn--ghost" href="/careers">Browse every career</a>
    </p>
  </header>
</main>`;
  return shell({
    title: 'Guide not found | FlightWay',
    description: 'That guide does not exist. Browse the full list of FlightWay career guides instead.',
    canonicalPath: '/guides',
    ogImage: OG_GUIDES,
    structured: [],
    main,
    noindex: true,
    css: GUIDE_CSS,
  });
}

// ---------------------------------------------------------------------------
// Plain text, for /llms-full.txt.

export function guideText(g) {
  const out = [
    `# ${g.title}`,
    '',
    `URL: ${SITE}/guides/${g.slug}`,
    `Updated: ${GUIDES_CONTENT_DATE}`,
    '',
    stripTags(g.hook),
    '',
  ];
  for (const s of g.sections) {
    out.push(`## ${s.h2}`, '');
    for (const p of s.body) out.push(stripTags(p), '');
    if (s.list) {
      for (const i of s.list.items) out.push(`- ${stripTags(i)}`);
      out.push('');
    }
    for (const p of s.after || []) out.push(stripTags(p), '');
  }
  out.push('## Questions people ask', '');
  for (const f of g.faq) out.push(`Q: ${f.q}`, `A: ${f.a}`, '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}
