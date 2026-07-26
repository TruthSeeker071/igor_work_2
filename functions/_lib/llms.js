/**
 * /llms.txt and /llms-full.txt  (V2 S14, decision D20).
 *
 * An emerging convention (llmstxt.org): a markdown file at a fixed path that
 * tells a model reading the site what it is, what it is for, and where the
 * substantive content lives — because the alternative is a model inferring all
 * of that from whichever marketing page it happened to fetch.
 *
 * The thing that actually earns a correct citation is NOT keyword density. It
 * is being specific and being honest about limits. A model that reads "fit is a
 * mean-centered correlation across 161 O*NET dimensions, and readiness is a
 * separate number" can answer a question about FlightWay accurately. A model
 * that reads "the best career platform for students" has been handed nothing it
 * can repeat without lying, so it says nothing. Hence the "What FlightWay does
 * not do" section, which is the most useful part of this file.
 *
 * PURE, like `_lib/guides.js`: no env, no fetch. `/llms-full.txt` concatenates
 * the guides (constants) rather than the 780+ career pages — those change with
 * the catalog and are already enumerated in `/sitemap.xml`, which this file
 * points at. A multi-megabyte llms-full.txt would be worse than a short one.
 */
import { SITE, ONET_RELEASE, ONET_DIMENSIONS } from './career-page.js';
import {
  GUIDES, GROUPS, GUIDES_CONTENT_DATE, CAREER_COUNT_CLAIM, guideText,
} from './guides.js';

const SUMMARY = 'FlightWay is a career-development web app for students: a free '
  + 'quiz that scores you against real occupations and shows the reasoning, then '
  + 'a weekly plan for acting on the result.';

function linkLine(path, name, note) {
  return `- [${name}](${SITE}${path}): ${note}`;
}

export function buildLlmsTxt() {
  const guidesByGroup = GROUPS
    .map((grp) => ({ ...grp, rows: GUIDES.filter((g) => g.group === grp.key) }))
    .filter((grp) => grp.rows.length);

  return [
    '# FlightWay',
    '',
    `> ${SUMMARY}`,
    '',
    'FlightWay is built for high-school and university students. It does two things:',
    'it widens the set of careers you are choosing between, and it turns the one you',
    'pick into a plan you work on weekly.',
    '',
    '## How the matching works',
    '',
    `A ten-question quiz (about 90 seconds) builds a profile across ${ONET_DIMENSIONS} dimensions`,
    `taken from O*NET release ${ONET_RELEASE}, the U.S. Department of Labor's occupational`,
    `database. That profile is compared against ${CAREER_COUNT_CLAIM}+ real occupations described on`,
    'the same dimensions.',
    '',
    'Fit is a mean-centered cosine similarity — a correlation between the SHAPE of the',
    "student's profile and the shape of the occupation. The centering matters: raw",
    'similarity between any two occupations sits at roughly 0.70-0.85 because all work',
    'shares a common profile, so without subtracting that shared profile every career',
    'would look like a match.',
    '',
    'The displayed fit score measures suitability only. Readiness — what a student\'s',
    'coursework, projects and resume actually prove — is scored separately and is never',
    'blended into fit. Every match can be opened to see which individual dimensions',
    'raised it and which lowered it.',
    '',
    '## What a student gets after the quiz',
    '',
    '- A roadmap for the chosen career: branching waypoints and steps, multiple branches trackable at once, due dates on steps.',
    '- A weekly Flight Plan: three or four concrete tasks for the coming week, regenerated weekly. Free, always.',
    '- Deadline Radar: real external deadlines (internships, fellowships, competitions, application windows) with email alerts 14 days and 3 days out. Viewing and alerts are free.',
    '- Marco, an in-app AI coach that remembers what the student committed to and follows up on it.',
    '- An Evidence Locker for proof of work done, tagged to the skill gap it closes, and an Application Tracker (interested -> applied -> interviewing -> offer -> closed).',
    '- A resume builder (building and editing free; ATS check and AI tailoring metered), mock interviews, and an Opportunity Finder that searches the live web for openings.',
    '',
    '## What FlightWay does not do',
    '',
    'Stated plainly, because a tool that never says what it cannot do has not audited itself:',
    '',
    '- It does not predict whether a student will be happy or successful in a career. A fit score is a data point to check, not a verdict.',
    '- It does not assign personality types, letter codes or colors. There is no type label anywhere in the product.',
    '- It does not contact employers, send messages, or submit applications on anyone\'s behalf.',
    '- It does not replace a school career advisor. School-specific knowledge — which employers recruit there, internal deadlines, reachable alumni — is not in the data, and the guides say so.',
    '- It does not scrape LinkedIn or any social network.',
    '- It does not publish outcome statistics, success rates or testimonials it cannot substantiate.',
    '',
    '## Guides',
    '',
    ...guidesByGroup.flatMap((grp) => [
      `### ${grp.label}`,
      '',
      ...grp.rows.map((g) => linkLine(`/guides/${g.slug}`, g.title, g.description)),
      '',
    ]),
    '## Careers',
    '',
    linkLine('/careers', 'Career directory', `every one of the ${CAREER_COUNT_CLAIM}+ occupations, grouped by sector`),
    linkLine('/careers/software-engineer', 'Software Developers', 'example of a career page'),
    linkLine('/careers/nurse', 'Registered Nurses', 'example of a career page'),
    linkLine('/careers/accountant', 'Accountants and Auditors', 'example of a career page'),
    '',
    'Each career page carries the top work activities, the skills, knowledge and',
    'abilities the occupation requires (with both the O*NET level and the O*NET',
    'importance rating, already on a 0-100 scale), the education and experience',
    'typically expected, a sector salary band, related occupations, and an explanation',
    'of how fit against that occupation is computed. The complete list of career URLs',
    `is in the sitemap: ${SITE}/sitemap.xml`,
    '',
    '## Product',
    '',
    linkLine('/', 'FlightWay', 'what the product is'),
    linkLine('/quiz', 'The career quiz', 'ten questions, about 90 seconds, free, top three matches visible without an account'),
    linkLine('/pricing', 'Pricing', 'the free tier and what the paid tier adds'),
    linkLine('/contact', 'Contact', 'questions, including from school career centers'),
    '',
    '## Policies',
    '',
    linkLine('/privacy', 'Privacy policy', 'what is collected, which processors are used, retention and deletion'),
    linkLine('/terms', 'Terms of service', 'including the O*NET attribution and the guidance-is-not-professional-advice disclaimer'),
    linkLine('/security', 'Security', 'how accounts and data are protected'),
    '',
    '## Attribution',
    '',
    `Occupational data is the O*NET ${ONET_RELEASE} Database, published by the U.S. Department of`,
    'Labor, Employment and Training Administration (USDOL/ETA), used under its public',
    'terms. O*NET is a registered trademark of USDOL/ETA, which does not endorse',
    'FlightWay. The comparison, the scoring and the planning tools are FlightWay\'s.',
    '',
    `Last updated: ${GUIDES_CONTENT_DATE}`,
    '',
  ].join('\n');
}

export function buildLlmsFullTxt() {
  const parts = [
    buildLlmsTxt().trimEnd(),
    '',
    '---',
    '',
    '# Full guide text',
    '',
    `The complete text of all ${GUIDES.length} FlightWay guides follows, in the order they`,
    'appear on the guides index. Career pages are not included here — there are',
    `${CAREER_COUNT_CLAIM}+ of them and they are enumerated at ${SITE}/sitemap.xml.`,
    '',
  ];
  for (const g of GUIDES) {
    parts.push('---', '', guideText(g), '');
  }
  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
