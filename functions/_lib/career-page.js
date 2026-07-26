/**
 * FlightWay V2 S13 — server-rendered public career pages.
 *
 * This module is PURE: no env, no fetch, no D1, no KV. It takes catalog rows and
 * O*NET dimension numbers that the route has already loaded and returns HTML
 * strings. That is what makes `seo:check` able to render all 782 pages offline
 * in a second instead of standing up a server.
 *
 * Three things here are load-bearing and easy to get wrong later:
 *
 * 1. **The canonical slug is usually not `slugify(title)`.** Mirroring
 *    `onet-catalog.js`, a legacy hub slug wins where there is one, so
 *    15-1252.00 ("Software Developers") is `/careers/software-engineer`. But
 *    only where it is UNAMBIGUOUS — see `buildCatalogIndex`, which is where the
 *    real rule and the reason for it live. Everything else (the title form, the
 *    64-char truncation `career-lookup.js` emits, the `SLUG_ALIASES` table, and
 *    every losing hub name) is a 301 alias, so no spelling of a career 404s and
 *    no career is reachable at two URLs. `verify:aliases` asserts the alias
 *    table here matches the other four copies AND that the whole routing index
 *    resolves — it is the assertion that caught this being wrong the first time.
 *
 * 2. **The canonical URL is hardcoded to flightway.ai**, exactly like
 *    index.html's. Both Pages projects serve this identical route, and the
 *    whole point of a canonical is that the preview host points away from
 *    itself. It is therefore also safe to share one KV render cache between
 *    the two projects: the body does not depend on the host.
 *
 * 3. **O*NET levels and importances are already 0–100** in the artifacts
 *    (verified: `vectors-lv.f32.bin` ranges 0–89 for a software developer, not
 *    0–7). The registry's `lvMax: 7` describes O*NET's own scale, NOT the
 *    numbers in the buffers. Never rescale.
 *
 * Attribution: O*NET is public data published by USDOL/ETA and is credited on
 * every page (terms.html §11 carries the full statement).
 */

export const SITE = 'https://flightway.ai';

/**
 * Bump this when the RENDERED OUTPUT changes — copy, layout, structured data,
 * or the catalog artifacts underneath. It is the KV cache key's version
 * segment, so bumping it orphans every cached page and the next request for
 * each slug re-renders. That is the purge hook; there is no other one.
 */
export const CAREER_PAGE_VERSION = 's14a';

/** The date the career-page CONTENT last changed. Feeds <lastmod> in the
 *  sitemap. Google ignores a lastmod it can tell is fabricated, so this moves
 *  with CAREER_PAGE_VERSION and never with an unrelated deploy. */
export const CAREER_CONTENT_DATE = '2026-07-24';

export const CAREER_PAGE_TTL_SECONDS = 86400;

/**
 * The O*NET release these pages credit. Kept as a constant rather than threaded
 * through from the registry, because it is used in prose and this module is
 * pure — but `seo:check` asserts it equals `onetRelease` in
 * `data/onet/dimension-registry-v1.json`, so an ETL rebuild that moves the
 * release and leaves this behind turns the suite red rather than putting a
 * false citation on ~780 public pages.
 */
export const ONET_RELEASE = '30.3';

/** How many O*NET dimensions a profile is scored across. Mirrors
 *  `functions/_lib/onet/constants.js` DIM_COUNT; asserted equal by seo:check. */
export const ONET_DIMENSIONS = 161;

// ---------------------------------------------------------------------------
// Slugs. Server mirror of assets/js/shared/onet-catalog.js.

// CANONICAL legacy-slug alias table. Canonical copy:
// assets/js/shared/onet-catalog.js. scripts/verify-slug-aliases.mjs asserts
// every copy is identical — this file is the fifth.
const SLUG_ALIASES = {
  'software-engineering': 'software-engineer',
  'data-science': 'data-scientist',
  'ux-design': 'ux-designer',
  'product-management': 'product-manager',
  'investment-banking': 'investment-banker',
  'financial-analysis': 'financial-analyst',
  'management-consulting': 'operations-manager',
  'marketing-strategy': 'content-strategist',
  'business-analytics': 'financial-analyst',
  'corporate-strategy': 'operations-manager',
  'healthcare-admin': 'nurse',
  'legal-operations': 'paralegal',
};

export { SLUG_ALIASES };

/** Byte-identical to onet-catalog.js's slugify(). */
export function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** career-lookup.js's slugifyTitle() truncates at 64 chars. 38 catalog titles
 *  are longer than that, so anything built by that helper arrives clipped —
 *  registered as an alias rather than left to 404. */
export function truncatedSlug(name) {
  return slugify(name).slice(0, 64).replace(/-+$/, '');
}

export function normalizeSlug(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  return SLUG_ALIASES[s] || s;
}

/**
 * Build the whole routing + directory index from the catalog rows and the hub
 * map. One pass, cached for the isolate's life by the caller.
 *
 * Returns:
 *   bySlug   Map canonicalSlug -> row
 *   aliasTo  Map aliasSlug -> canonicalSlug   (301 targets)
 *   bySoc    Map soc -> row
 *   sectors  [{ key, label, blurb, rows }]     (directory order)
 *   count    number of in-scope careers
 */
export function buildCatalogIndex({ careers, hubMap }) {
  const rows = (careers || []).filter((r) => r && r.soc && r.title && r.mvpInScope !== false);

  // soc -> the legacy hub slugs that name it. TWO buckets, and the distinction
  // is what keeps this correct:
  //
  //   PRIMARY   — the hub card's own `socs[0]`, the occupation the card IS.
  //   SECONDARY — a SOC the card also touches. `product-manager` and
  //               `devops-engineer` both list 15-1252.00 as a secondary, which
  //               is why "first hub id wins over all of a card's socs" (what
  //               onet-catalog.js does, and what this mirrored at first) is the
  //               wrong rule here: it hands one occupation three names.
  //
  // A secondary never becomes a canonical URL. It is registered as an alias, so
  // the slug still resolves — it just resolves to the page it belongs on.
  const primaryLegacy = new Map();   // soc -> [slug]
  const anyLegacy = new Map();       // soc -> [slug]
  const hubCareers = (hubMap && hubMap.careers) || {};
  const pushTo = (map, soc, slug) => {
    if (!map.has(soc)) map.set(soc, []);
    const list = map.get(soc);
    if (!list.includes(slug)) list.push(slug);
  };
  for (const id of Object.keys(hubCareers)) {
    const entry = hubCareers[id];
    if (!entry || !entry.name) continue;
    const legacy = slugify(entry.name);
    if (!legacy) continue;
    const socs = entry.socs || [];
    if (socs[0] && socs[0].soc) pushTo(primaryLegacy, socs[0].soc, legacy);
    for (const s of socs) if (s && s.soc) pushTo(anyLegacy, s.soc, legacy);
  }

  const bySlug = new Map();
  const bySoc = new Map();
  const aliasTo = new Map();
  const addAlias = (alias, canonical) => {
    if (!alias || alias === canonical) return;
    if (bySlug.has(alias) || aliasTo.has(alias)) return; // a real page always wins
    aliasTo.set(alias, canonical);
  };

  for (const row of rows) {
    const primaries = primaryLegacy.get(row.soc) || [];
    // A legacy slug is the canonical URL only when it is the SOLE hub name for
    // that occupation. Four SOCs are named by two cards each — 13-2051.00 is
    // both "Investment Banker" and "Financial Analyst" — and picking one by hub
    // id would be arbitrary AND would leave the other 404ing, which is exactly
    // what it did. Ambiguity falls back to the O*NET title, which is what the
    // page's own <h1> says anyway; both hub names then 301 to it.
    const preferred = primaries.length === 1 ? primaries[0] : slugify(row.title);
    const titleSlug = slugify(row.title);
    let canonical = preferred || titleSlug;
    if (bySlug.has(canonical)) canonical = titleSlug;
    // Never drop a career because two of them wanted one URL. The SOC digits
    // are the only thing guaranteed unique, so they are the last resort.
    if (!canonical || bySlug.has(canonical)) canonical = `${titleSlug || 'career'}-${row.soc.replace(/\D/g, '')}`;
    // Additive annotation on a row the O*NET store owns: recomputed
    // identically on every build, read only by this module's renderers.
    row.__slug = canonical;
    bySlug.set(canonical, row);
    bySoc.set(row.soc, row);
  }

  // Aliases are registered only after every canonical slug exists, so a title
  // slug that happens to BE another career's canonical page is never hijacked.
  for (const row of rows) {
    const canonical = row.__slug;
    if (!canonical) continue;
    addAlias(slugify(row.title), canonical);
    addAlias(truncatedSlug(row.title), canonical);
    for (const legacy of anyLegacy.get(row.soc) || []) addAlias(legacy, canonical);
  }
  // Resolved LAST, and through the alias map: `investment-banking` points at
  // `investment-banker`, which is itself now an alias. Registering the raw
  // target would leave a redirect pointing at a 404.
  for (const from of Object.keys(SLUG_ALIASES)) {
    const to = SLUG_ALIASES[from];
    const target = bySlug.has(to) ? to : aliasTo.get(to);
    if (target) addAlias(from, target);
  }

  const sectorRows = new Map();
  for (const row of rows) {
    if (!row.__slug) continue;
    const key = String(row.hubZone || 'other');
    if (!sectorRows.has(key)) sectorRows.set(key, []);
    sectorRows.get(key).push(row);
  }
  const sectors = SECTOR_ORDER
    .filter((key) => sectorRows.has(key))
    .map((key) => ({
      key,
      label: SECTOR_LABELS[key] || titleCase(key.replace(/-/g, ' ')),
      blurb: SECTOR_BLURBS[key] || '',
      rows: sectorRows.get(key).sort((a, b) => a.title.localeCompare(b.title)),
    }));
  // A zone the label table has never heard of still gets a section rather than
  // silently dropping its careers out of the directory and the sitemap.
  for (const [key, list] of sectorRows) {
    if (sectors.some((s) => s.key === key)) continue;
    sectors.push({
      key,
      label: SECTOR_LABELS[key] || titleCase(key.replace(/-/g, ' ')),
      blurb: SECTOR_BLURBS[key] || '',
      rows: list.sort((a, b) => a.title.localeCompare(b.title)),
    });
  }

  return { rows: rows.filter((r) => r.__slug), bySlug, aliasTo, bySoc, sectors, count: bySlug.size };
}

// ---------------------------------------------------------------------------
// Sectors. Labels mirror assets/js/shared/hub-zone-fit.js's ZONE_LABELS.

export const SECTOR_ORDER = [
  'tech', 'business-finance', 'engineering-science', 'healthcare', 'creative-media',
  'education', 'law', 'government', 'social', 'trades',
];

export const SECTOR_LABELS = {
  tech: 'Technology',
  'business-finance': 'Business & Finance',
  'engineering-science': 'Engineering & Science',
  healthcare: 'Healthcare',
  'creative-media': 'Creative & Media',
  education: 'Education',
  law: 'Law',
  government: 'Government',
  social: 'Social Impact',
  trades: 'Skilled Trades',
};

const SECTOR_BLURBS = {
  tech: 'Building, running and securing software and the systems it lives on.',
  'business-finance': 'Money, markets, operations and the people who run organizations.',
  'engineering-science': 'Designing physical systems and doing the research behind them.',
  healthcare: 'Clinical care, diagnostics and the work that keeps patients alive and well.',
  'creative-media': 'Design, writing, performance and everything that gets published.',
  education: 'Teaching, curriculum and the institutions around them.',
  law: 'Advocacy, compliance and the machinery of the legal system.',
  government: 'Public administration, policy and civil service.',
  social: 'Social work, community services and the helping professions.',
  trades: 'Skilled hands-on work — construction, installation, repair and production.',
};

/**
 * Which salary-tiers.json sector a career reads its band from. `null` means the
 * band is not shown at all — an honest omission beats a wrong number on an
 * indexed page. Two hub zones (trades, government) have no band in the file,
 * and two hub zones are merges that split on the SOC major group:
 *   business-finance → SOC 13 is "business and financial operations" (finance),
 *                      everything else in that zone is management (business)
 *   engineering-science → SOC 17 is the engineering group, 19 is the science one
 */
export function salarySectorFor(row) {
  const zone = String((row && row.hubZone) || '');
  const major = String((row && row.socMajor) || '');
  switch (zone) {
    case 'tech': return 'tech';
    case 'healthcare': return 'healthcare';
    case 'education': return 'education';
    case 'law': return 'law';
    case 'social': return 'social';
    case 'creative-media': return 'creative';
    case 'business-finance': return major === '13' ? 'finance' : 'business';
    case 'engineering-science': return major === '19' ? 'science' : 'engineering';
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Job zones. O*NET's own five preparation levels, in FlightWay's voice.

export const JOB_ZONES = {
  1: {
    label: 'Zone 1 — little preparation needed',
    education: 'Some of these jobs ask for a high-school diploma; many ask for nothing formal.',
    experience: 'Little or no previous work experience is expected.',
    training: 'Training is usually measured in days or weeks, on the job.',
  },
  2: {
    label: 'Zone 2 — some preparation needed',
    education: 'A high-school diploma is the usual starting point.',
    experience: 'Some prior work experience helps but is rarely required.',
    training: 'Expect a few months to a year of on-the-job training.',
  },
  3: {
    label: 'Zone 3 — medium preparation needed',
    education: 'Vocational training, an associate degree, or equivalent on-the-job experience.',
    experience: 'One to two years of related experience is typical.',
    training: 'Employers expect you to arrive with the core skill already.',
  },
  4: {
    label: 'Zone 4 — considerable preparation needed',
    education: "A four-year bachelor's degree is the usual entry ticket.",
    experience: 'Two to four years of related work, internships or research on top of the degree.',
    training: 'Most of the learning happens before you are hired, not after.',
  },
  5: {
    label: 'Zone 5 — extensive preparation needed',
    education: "Graduate school — a master's, a PhD, an MD or a JD, depending on the field.",
    experience: 'More than five years of related experience is common before the title is yours.',
    training: 'This is a long runway. Start the prerequisites early or the timeline slips a year at a time.',
  },
};

// ---------------------------------------------------------------------------
// Content derivation. Every sentence below is computed from a number in the
// artifacts; nothing is invented per career.

function importanceBand(im) {
  if (im >= 85) return 'central to the job';
  if (im >= 70) return 'a major part of the work';
  if (im >= 55) return 'a regular part of the work';
  return 'part of the mix';
}

function levelBand(lv) {
  if (lv >= 75) return 'expert level';
  if (lv >= 60) return 'a high level';
  if (lv >= 45) return 'a solid working level';
  if (lv >= 30) return 'a basic working level';
  return 'an introductory level';
}

function topDims(dims, domain, n) {
  return (dims || [])
    .filter((d) => d && d.domain === domain)
    .sort((a, b) => (b.im - a.im) || (b.lv - a.lv) || a.name.localeCompare(b.name))
    .slice(0, n);
}

function dimLevel(dims, name) {
  const hit = (dims || []).find((d) => d && d.name === name);
  return hit ? hit.lv : 0;
}

function dimImportance(dims, name) {
  const hit = (dims || []).find((d) => d && d.name === name);
  return hit ? hit.im : 0;
}

/**
 * "How the work tends to run" — deterministic rules over real dimension
 * importances. Each note names the O*NET activity it came from, so a reader (or
 * a future session) can check it rather than trust it. Rules that do not fire
 * produce nothing; a career with a flat profile gets a short section, not a
 * padded one.
 */
export function workContextNotes(dims) {
  const notes = [];
  const im = (n) => dimImportance(dims, n);
  const push = (text, source) => notes.push({ text, source });

  if (im('Working with Computers') >= 70) {
    push('Most of the day happens at a screen.', 'Working with Computers');
  }
  if (im('Performing General Physical Activities') >= 60 || im('Handling and Moving Objects') >= 65) {
    push('The work is physical — you are on your feet and handling things, not sitting still.', 'Performing General Physical Activities');
  }
  if (im('Performing for or Working Directly with the Public') >= 65) {
    push('You are in front of the public, so the job is partly performance.', 'Performing for or Working Directly with the Public');
  }
  if (im('Establishing and Maintaining Interpersonal Relationships') >= 70) {
    push('Long-running relationships carry the work; the same people come back.', 'Establishing and Maintaining Interpersonal Relationships');
  }
  if (im('Coordinating the Work and Activities of Others') >= 65 || im('Guiding, Directing, and Motivating Subordinates') >= 60) {
    push('Part of the job is other people’s output, not only your own.', 'Coordinating the Work and Activities of Others');
  }
  if (im('Making Decisions and Solving Problems') >= 80) {
    push('You own decisions rather than execute someone else’s.', 'Making Decisions and Solving Problems');
  }
  if (im('Evaluating Information to Determine Compliance with Standards') >= 70) {
    push('Rules and standards are checkable and someone checks them.', 'Evaluating Information to Determine Compliance with Standards');
  }
  if (im('Thinking Creatively') >= 75) {
    push('There is real room to invent — the answer is not in a manual.', 'Thinking Creatively');
  }
  if (im('Assisting and Caring for Others') >= 70) {
    push('People depend on you directly, and that is the point of the role.', 'Assisting and Caring for Others');
  }
  if (im('Controlling Machines and Processes') >= 65 || im('Operating Vehicles, Mechanized Devices, or Equipment') >= 65) {
    push('You run equipment, and running it well is a skill in itself.', 'Controlling Machines and Processes');
  }
  // ~15% of occupations have a profile flat enough that no threshold above
  // fires. Rather than drop the section on those pages — which is where a page
  // starts looking thin — fall back to naming the single activity O*NET rates
  // highest. Still a real number, still cited, never invented.
  if (!notes.length) {
    const top = topDims(dims, 'workActivities', 1)[0];
    if (top) {
      push(`The day is built around ${top.name.toLowerCase()} more than anything else (${Math.round(top.im)}/100).`, top.name);
    }
  }
  return notes.slice(0, 5);
}

/**
 * The `career-descriptions.json` artifact clips O*NET's text at 500 characters,
 * and 32 of the 782 descriptions therefore end mid-sentence — "…May maintain
 * databases within an application area, working". Invisible inside the app,
 * where the paragraph is one of many; unmissable on a public page whose whole
 * claim is that the data is real. Cut back to the last complete sentence rather
 * than shipping a severed clause. (Fixing the ETL's 500-char clip would mean
 * regenerating and committing a 185KB artifact for 32 rows — recorded as
 * deferred instead.)
 */
export function cleanDescription(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  if (/[.!?]$/.test(s)) return s;
  const cut = Math.max(s.lastIndexOf('. '), s.lastIndexOf('! '), s.lastIndexOf('? '));
  if (cut > 60) return s.slice(0, cut + 1);
  return `${s.replace(/[\s,;:—-]+$/, '')}…`;
}

function firstSentence(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  const dot = s.indexOf('. ');
  if (dot > 20) return s.slice(0, dot + 1);
  return s.length > 200 ? `${s.slice(0, 197).trim()}…` : s;
}

export const MAX_META_DESCRIPTION = 158;
export const MAX_TITLE = 62;

/** Cut at a word boundary and finish the sentence. A description Google clips
 *  mid-word reads like a broken page in the one place a stranger sees us. */
function clamp(text, max) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > 40 ? cut.slice(0, at) : cut).replace(/[\s,;:—-]+$/, '')}…`;
}

/** ≤158 chars, unique per career (the title carries the uniqueness), never
 *  truncated mid-word. */
export function metaDescriptionFor(row, dims) {
  const top = topDims(dims, 'skills', 2).map((d) => d.name.toLowerCase());
  const skills = top.length === 2 ? `${top[0]} and ${top[1]}` : (top[0] || 'the core skills');
  const withSkills = `What ${row.title} actually do, what the job takes (${skills}), how people get in, and how FlightWay scores your fit.`;
  if (withSkills.length <= MAX_META_DESCRIPTION) return withSkills;
  const short = `What ${row.title} actually do, what the job takes, and how FlightWay scores your fit against it.`;
  if (short.length <= MAX_META_DESCRIPTION) return short;
  return clamp(`What ${row.title} actually do, and how FlightWay scores your fit.`, MAX_META_DESCRIPTION);
}

/**
 * O*NET occupation titles run to 65+ characters on their own ("Aerospace
 * Engineering and Operations Technologists and Technicians"), so a fixed
 * suffix would push 391 of 782 titles past what a search result shows. The
 * suffix is therefore dropped in stages, and on the longest titles dropped
 * entirely — the occupation name is already unique and already descriptive,
 * which is the whole job of a title tag.
 */
export function titleFor(title) {
  const full = `${title} — what the job takes | FlightWay`;
  if (full.length <= MAX_TITLE) return full;
  const brand = `${title} | FlightWay`;
  if (brand.length <= MAX_TITLE) return brand;
  return String(title);
}

/**
 * Assemble everything one career page renders. Pure — the route supplies rows
 * and numbers, this decides what the page SAYS.
 */
export function careerContent({ row, dims, related, sameSector, salaryTiers, catalogCount }) {
  const jz = Number(row.jobZone) || 0;
  const zone = JOB_ZONES[jz] || null;
  const salaryKey = salarySectorFor(row);
  const band = salaryKey && salaryTiers ? salaryTiers[salaryKey] : null;
  const description = cleanDescription(row.description);

  return {
    slug: row.__slug,
    soc: row.soc,
    title: row.title,
    sectorKey: row.hubZone,
    sectorLabel: SECTOR_LABELS[row.hubZone] || titleCase(String(row.hubZone || '').replace(/-/g, ' ')),
    description,
    hook: firstSentence(description) || `${row.title} on FlightWay.`,
    metaDescription: metaDescriptionFor(row, dims),
    activities: topDims(dims, 'workActivities', 6).map((d) => ({
      name: d.name, im: Math.round(d.im), lv: Math.round(d.lv), band: importanceBand(d.im),
    })),
    skills: topDims(dims, 'skills', 5).map((d) => ({
      name: d.name, im: Math.round(d.im), lv: Math.round(d.lv), band: levelBand(d.lv),
    })),
    knowledge: topDims(dims, 'knowledge', 4).map((d) => ({
      name: d.name, im: Math.round(d.im), lv: Math.round(d.lv), band: levelBand(d.lv),
    })),
    abilities: topDims(dims, 'abilities', 4).map((d) => ({
      name: d.name, im: Math.round(d.im), lv: Math.round(d.lv), band: levelBand(d.lv),
    })),
    zone,
    zoneNumber: jz,
    salary: band ? { key: salaryKey, label: SALARY_SECTOR_LABELS[salaryKey] || salaryKey, tiers: band } : null,
    context: workContextNotes(dims),
    related: (related || []).map((r) => ({ slug: r.__slug, title: r.title, sector: SECTOR_LABELS[r.hubZone] || '' })),
    sameSector: (sameSector || []).map((r) => ({ slug: r.__slug, title: r.title })),
    computerLevel: Math.round(dimLevel(dims, 'Working with Computers')),
    catalogCount: catalogCount || 0,
  };
}

const SALARY_SECTOR_LABELS = {
  tech: 'technology', finance: 'finance', business: 'business', law: 'law',
  healthcare: 'healthcare', creative: 'creative', science: 'science',
  engineering: 'engineering', education: 'education', social: 'social impact',
};

// ---------------------------------------------------------------------------
// Escaping. Catalog titles come from a build artifact, not a user — but this is
// the only HTML in the product assembled by string concatenation, so it escapes
// unconditionally rather than reasoning about which field is trusted.

export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON-LD payloads must not be able to close their own <script>. */
export function jsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function titleCase(s) {
  return String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// The shell. Every asset reference is ROOT-RELATIVE: this route serves at
// /careers/<slug>, so `assets/…` would resolve to /careers/assets/… and 404.
// The ?v= stamps are governed by verify:busters, which scans functions/ for
// exactly this reason.

const HEAD_ASSETS = `<link rel="icon" type="image/svg+xml" href="/assets/icons/favicon.svg?v=20260720f">
<link rel="icon" href="/favicon.ico?v=20260720a" sizes="any">
<link rel="icon" type="image/png" href="/assets/icons/favicon-128.png?v=20260720a">
<link rel="apple-touch-icon" href="/assets/icons/apple-touch-180.png?v=20260720a">
<link rel="preload" href="/assets/fonts/inter-latin.woff2?v=20260720a" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/space-grotesk-latin.woff2?v=20260720a" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/flightway-theme.css?v=20260721p">
<script src="/assets/js/boot/theme-boot.js?v=20260703p"></script>
<script src="/assets/js/shared/events.js?v=20260724a" defer></script>
<script src="/assets/js/shared/brand.js?v=20260720i" defer></script>
<script src="/assets/js/shared/theme.js?v=20260703p" defer></script>`;

const OG_CAREERS = `${SITE}/assets/og/og-careers.png?v=20260724j`;

/**
 * Page-specific CSS is INLINED rather than shipped as a stylesheet. Two
 * reasons, both about this route specifically: 782 pages that each want one
 * round trip fewer before first paint is exactly where inlining pays, and a
 * separate /assets file would put a cache-buster on the critical path of a
 * surface whose whole job is to be fetched cold by a stranger. The shared
 * theme sheet still carries the tokens, the nav and the footer.
 */
const PAGE_CSS = `
/* The shared nav collapses into a JS-driven hamburger below 768px. These pages
   deliberately do NOT load landing.js (one fewer script on a cold SEO fetch),
   so the links are shown at every width here and allowed to wrap instead. */
.career-guide .fw-nav-links{display:flex;flex-wrap:wrap;gap:6px 18px}
.career-guide .fw-nav-actions{display:flex}
.career-guide .fw-nav-inner{flex-wrap:wrap;gap:10px}
.cg-wrap{max-width:1080px;margin:0 auto;padding:0 clamp(16px,4vw,32px)}
.cg-crumbs{font-size:13px;color:rgb(var(--muted));padding:24px 0 0}
.cg-crumbs a{color:rgb(var(--muted));text-decoration:none}
.cg-crumbs a:hover{color:rgb(var(--primary));text-decoration:underline}
.cg-hero{padding:24px 0 40px;border-bottom:1px solid rgb(var(--border))}
.cg-eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:rgb(var(--primary));font-weight:700;margin-bottom:10px}
.cg-hero h1{font-family:'Space Grotesk',system-ui,sans-serif;font-size:clamp(30px,5vw,46px);line-height:1.1;margin:0 0 14px;letter-spacing:-0.02em}
.cg-hook{font-size:clamp(16px,2.2vw,19px);line-height:1.55;color:rgb(var(--muted));max-width:62ch;margin:0}
.cg-facts{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px;padding:0;list-style:none}
.cg-fact{border:1px solid rgb(var(--border));border-radius:999px;padding:6px 14px;font-size:13px;color:rgb(var(--muted));background:rgb(var(--surface))}
.cg-fact strong{color:rgb(var(--text));font-weight:600}
.cg-sec{padding:40px 0;border-bottom:1px solid rgb(var(--border))}
.cg-sec:last-of-type{border-bottom:0}
.cg-sec h2{font-family:'Space Grotesk',system-ui,sans-serif;font-size:clamp(21px,3vw,27px);margin:0 0 8px;letter-spacing:-0.01em}
.cg-lede{color:rgb(var(--muted));margin:0 0 22px;max-width:66ch;line-height:1.6}
.cg-list{list-style:none;padding:0;margin:0;display:grid;gap:12px}
@media(min-width:760px){.cg-list--2{grid-template-columns:1fr 1fr}}
.cg-item{border:1px solid rgb(var(--border));border-radius:12px;padding:14px 16px;background:rgb(var(--surface))}
.cg-item-name{font-weight:600;margin:0 0 4px}
.cg-item-note{font-size:14px;color:rgb(var(--muted));margin:0;line-height:1.5}
.cg-meter{height:4px;border-radius:2px;background:rgb(var(--border));margin-top:10px;overflow:hidden}
.cg-meter span{display:block;height:100%;background:rgb(var(--primary))}
.cg-grid3{display:grid;gap:16px}
@media(min-width:760px){.cg-grid3{grid-template-columns:repeat(3,1fr)}}
.cg-card{border:1px solid rgb(var(--border));border-radius:14px;padding:18px;background:rgb(var(--surface))}
.cg-card h3{margin:0 0 6px;font-size:15px;letter-spacing:.02em}
.cg-card p{margin:0;color:rgb(var(--muted));font-size:14px;line-height:1.55}
.cg-notes{margin:0;padding:0;list-style:none;display:grid;gap:10px}
.cg-notes li{padding-left:18px;position:relative;line-height:1.55;color:rgb(var(--text))}
.cg-notes li:before{content:'';position:absolute;left:0;top:9px;width:7px;height:7px;border-radius:50%;background:rgb(var(--primary))}
.cg-notes small{display:block;color:rgb(var(--muted));font-size:12px;margin-top:2px}
.cg-links{display:flex;flex-wrap:wrap;gap:8px;padding:0;margin:0;list-style:none}
.cg-links a{display:inline-block;border:1px solid rgb(var(--border));border-radius:999px;padding:7px 14px;font-size:14px;text-decoration:none;color:rgb(var(--text));background:rgb(var(--surface))}
.cg-links a:hover{border-color:rgb(var(--primary) / 0.4);color:rgb(var(--primary))}
.cg-cta{margin:44px 0;border:1px solid rgb(var(--primary) / 0.3);border-radius:18px;padding:clamp(22px,4vw,36px);background:rgb(var(--primary) / 0.06);text-align:center}
.cg-cta h2{margin:0 0 10px}
.cg-cta p{margin:0 auto 20px;max-width:52ch;color:rgb(var(--muted));line-height:1.6}
.cg-btn{display:inline-block;background:rgb(var(--primary));color:#fff;border-radius:12px;padding:13px 26px;font-weight:600;text-decoration:none}
.cg-btn:hover{filter:brightness(1.06)}
.cg-btn--ghost{background:transparent;color:rgb(var(--text));border:1px solid rgb(var(--border));margin-left:10px}
.cg-fit dl{margin:0;display:grid;gap:14px}
.cg-fit dt{font-weight:600;margin:0}
.cg-fit dd{margin:4px 0 0;color:rgb(var(--muted));line-height:1.6}
.cg-src{font-size:13px;color:rgb(var(--muted));line-height:1.6;padding:26px 0 44px;max-width:74ch}
.cg-src a{color:rgb(var(--muted))}
.cg-dir-search{width:100%;max-width:420px;padding:11px 14px;border:1px solid rgb(var(--border));border-radius:10px;background:rgb(var(--surface));color:rgb(var(--text));font-size:15px;font-family:inherit}
.cg-dir-count{font-size:13px;color:rgb(var(--muted));margin:10px 0 0}
.cg-dir-sec{padding:30px 0;border-bottom:1px solid rgb(var(--border))}
.cg-dir-sec h2{font-family:'Space Grotesk',system-ui,sans-serif;font-size:22px;margin:0 0 4px}
.cg-dir-blurb{color:rgb(var(--muted));margin:0 0 16px;font-size:14px}
.cg-dir-list{list-style:none;padding:0;margin:0;display:grid;gap:6px 20px}
@media(min-width:700px){.cg-dir-list{grid-template-columns:1fr 1fr}}
@media(min-width:1000px){.cg-dir-list{grid-template-columns:1fr 1fr 1fr}}
.cg-dir-list a{color:rgb(var(--text));text-decoration:none;font-size:14px;line-height:1.7}
.cg-dir-list a:hover{color:rgb(var(--primary));text-decoration:underline}
.cg-empty{color:rgb(var(--muted));padding:30px 0}
`;

/** Marketing nav — the signed-out variant. Same classes as index.html so the
 *  shared theme sheet styles it with no additions. */
function navHtml() {
  return `<header class="fw-nav">
  <div class="fw-container">
    <nav class="fw-nav-inner" aria-label="Main">
      <a href="/" class="fw-brand" data-fw-brand data-fw-brand-href="/" aria-label="FlightWay home"></a>
      <ul class="fw-nav-links">
        <li><a href="/#how-it-works">How it works</a></li>
        <li><a href="/careers">Careers</a></li>
        <li><a href="/guides">Guides</a></li>
        <li><a href="/pricing">Pricing</a></li>
      </ul>
      <div class="fw-nav-actions">
        <button type="button" class="fw-theme-toggle" aria-label="Switch theme" aria-pressed="true">
          <span class="fw-theme-icon" aria-hidden="true"></span>
        </button>
        <a href="/auth#signin" class="fw-btn fw-btn-ghost fw-btn-sm">Sign in</a>
        <a href="/quiz" class="fw-btn fw-btn-primary fw-btn-sm">Take the quiz</a>
      </div>
    </nav>
  </div>
</header>`;
}

function footerHtml() {
  return `<footer class="fw-footer">
  <div class="fw-container">
    <div class="fw-footer-grid">
      <div>
        <a href="/" class="fw-brand" data-fw-brand data-fw-brand-href="/" aria-label="FlightWay"></a>
        <p class="fw-footer-tagline">The talent development platform for students.</p>
      </div>
      <div class="fw-footer-col">
        <h3>Product</h3>
        <ul>
          <li><a href="/careers">All careers</a></li>
          <li><a href="/guides">Guides</a></li>
          <li><a href="/quiz">Career quiz</a></li>
          <li><a href="/pricing">Pricing</a></li>
        </ul>
      </div>
      <div class="fw-footer-col">
        <h3>Company</h3>
        <ul>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </div>
      <div class="fw-footer-col">
        <h3>Legal</h3>
        <ul>
          <li><a href="/privacy">Privacy</a></li>
          <li><a href="/terms">Terms</a></li>
          <li><a href="/security">Security</a></li>
        </ul>
      </div>
    </div>
    <div class="fw-footer-bar">
      <p>&copy; 2026 FlightWay, Inc. All rights reserved.</p>
      <p>The talent development platform.</p>
    </div>
  </div>
</footer>`;
}

/**
 * Exported for `_lib/guides.js` (S14). The guides hub is the same kind of
 * surface — public, server-rendered, crawled cold by a stranger — so it shares
 * this head, this nav and this footer rather than growing a second one that
 * drifts. `css` appends surface-specific rules AFTER PAGE_CSS; guide rules do
 * not ride along on ~780 career pages that never use them.
 */
export function shell({ title, description, canonicalPath, ogImage, structured, main, noindex, css }) {
  const url = `${SITE}${canonicalPath}`;
  const img = ogImage || OG_CAREERS;
  const ld = (structured || []).map((o) => `<script type="application/ld+json">${jsonLd(o)}</script>`).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex, follow">' : `<link rel="canonical" href="${esc(url)}">`}
<meta property="og:site_name" content="FlightWay">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="FlightWay — career development for students">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(img)}">
${HEAD_ASSETS}
<style>${PAGE_CSS}${css || ''}</style>
${ld}
</head>
<body class="career-guide">
${navHtml()}
${main}
${footerHtml()}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// The career page.

function dimItems(list, kind) {
  return list.map((d) => `<li class="cg-item">
      <p class="cg-item-name">${esc(d.name)}</p>
      <p class="cg-item-note">${kind === 'activity'
        ? `${esc(d.band)} — rated ${d.im}/100 for importance.`
        : `Needed at ${esc(d.band)} (${d.lv}/100), and rated ${d.im}/100 for importance.`}</p>
      <div class="cg-meter" aria-hidden="true"><span style="width:${Math.max(2, Math.min(100, kind === 'activity' ? d.im : d.lv))}%"></span></div>
    </li>`).join('\n');
}

export function renderCareerPage(c) {
  const url = `${SITE}/careers/${c.slug}`;
  const title = titleFor(c.title);

  const occupation = {
    '@context': 'https://schema.org',
    '@type': 'Occupation',
    name: c.title,
    description: c.description || c.hook,
    occupationalCategory: c.soc,
    url,
    mainEntityOfPage: url,
    industry: c.sectorLabel,
    skills: c.skills.map((s) => s.name).join(', ') || undefined,
    responsibilities: c.activities.map((a) => a.name).join(', ') || undefined,
    educationRequirements: c.zone ? c.zone.education : undefined,
    experienceRequirements: c.zone ? c.zone.experience : undefined,
    provider: { '@type': 'Organization', name: 'FlightWay', url: SITE },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'FlightWay', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Careers', item: `${SITE}/careers` },
      { '@type': 'ListItem', position: 3, name: c.title, item: url },
    ],
  };

  const facts = [
    `<li class="cg-fact">Sector: <strong>${esc(c.sectorLabel)}</strong></li>`,
    c.zone ? `<li class="cg-fact">Preparation: <strong>${esc(c.zone.label)}</strong></li>` : '',
    `<li class="cg-fact">O*NET code: <strong>${esc(c.soc)}</strong></li>`,
  ].filter(Boolean).join('');

  const salaryHtml = c.salary ? `
  <section class="cg-sec" id="pay">
    <h2>What it pays</h2>
    <p class="cg-lede">These are typical <strong>${esc(c.salary.label)}</strong> compensation bands by employer tier — sector-level figures, not a measured salary for ${esc(c.title)} specifically. Treat them as the shape of the market, then check a real posting for the number.</p>
    <div class="cg-grid3">
      ${['elite', 'mid', 'small'].filter((k) => c.salary.tiers[k]).map((k) => `<div class="cg-card">
        <h3>${esc(c.salary.tiers[k].firms)}</h3>
        <p><strong>${esc(c.salary.tiers[k].range)}</strong></p>
      </div>`).join('\n      ')}
    </div>
  </section>` : '';

  const contextHtml = c.context.length ? `
  <section class="cg-sec" id="how-the-work-runs">
    <h2>How the work tends to run</h2>
    <p class="cg-lede">Each line below is read off a single O*NET activity rating for this occupation — named, so you can disagree with it.</p>
    <ul class="cg-notes">
      ${c.context.map((n) => `<li>${esc(n.text)}<small>From “${esc(n.source)}”</small></li>`).join('\n      ')}
    </ul>
  </section>` : '';

  const relatedHtml = c.related.length ? `
  <section class="cg-sec" id="related">
    <h2>Careers next to this one</h2>
    <p class="cg-lede">Nearest neighbours by O*NET profile — these ask for a similar mix of skills, so they are the realistic pivots.</p>
    <ul class="cg-links">
      ${c.related.map((r) => `<li><a href="/careers/${esc(r.slug)}">${esc(r.title)}</a></li>`).join('\n      ')}
    </ul>
  </section>` : '';

  const sectorHtml = c.sameSector.length ? `
  <section class="cg-sec" id="sector">
    <h2>More in ${esc(c.sectorLabel)}</h2>
    <ul class="cg-links">
      ${c.sameSector.map((r) => `<li><a href="/careers/${esc(r.slug)}">${esc(r.title)}</a></li>`).join('\n      ')}
    </ul>
    <p class="cg-lede" style="margin:18px 0 0"><a href="/careers#${esc(c.sectorKey)}">See every ${esc(c.sectorLabel)} career &rarr;</a></p>
  </section>` : '';

  const main = `<main class="cg-wrap">
  <p class="cg-crumbs"><a href="/">FlightWay</a> / <a href="/careers">Careers</a> / ${esc(c.title)}</p>

  <header class="cg-hero">
    <p class="cg-eyebrow">${esc(c.sectorLabel)}</p>
    <h1>${esc(c.title)}</h1>
    <p class="cg-hook">${esc(c.hook)}</p>
    <ul class="cg-facts">${facts}</ul>
  </header>

  <section class="cg-sec" id="what-you-do">
    <h2>What you'll actually do</h2>
    <p class="cg-lede">The activities O*NET rates highest for this occupation, most important first. Numbers are out of 100.</p>
    <ul class="cg-list cg-list--2">
${dimItems(c.activities, 'activity')}
    </ul>
    ${c.description ? `<p class="cg-lede" style="margin:22px 0 0">${esc(c.description)}</p>` : ''}
  </section>

  <section class="cg-sec" id="what-it-takes">
    <h2>What it takes</h2>
    <p class="cg-lede">Two numbers per line: the <strong>level</strong> the work expects, and how <strong>important</strong> it is to doing the job well. Both are O*NET ratings, already on a 0–100 scale.</p>
    <h3 style="font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:rgb(var(--muted));margin:24px 0 12px">Skills</h3>
    <ul class="cg-list cg-list--2">
${dimItems(c.skills, 'skill')}
    </ul>
    <h3 style="font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:rgb(var(--muted));margin:28px 0 12px">Knowledge</h3>
    <ul class="cg-list cg-list--2">
${dimItems(c.knowledge, 'knowledge')}
    </ul>
    <h3 style="font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:rgb(var(--muted));margin:28px 0 12px">Abilities</h3>
    <ul class="cg-list cg-list--2">
${dimItems(c.abilities, 'ability')}
    </ul>
  </section>

  ${c.zone ? `<section class="cg-sec" id="education">
    <h2>How people get in</h2>
    <p class="cg-lede">O*NET places this occupation in <strong>${esc(c.zone.label)}</strong>. That is a statement about what employers typically require, not a rule about you.</p>
    <div class="cg-grid3">
      <div class="cg-card"><h3>Education</h3><p>${esc(c.zone.education)}</p></div>
      <div class="cg-card"><h3>Experience</h3><p>${esc(c.zone.experience)}</p></div>
      <div class="cg-card"><h3>Training</h3><p>${esc(c.zone.training)}</p></div>
    </div>
  </section>` : ''}
  ${salaryHtml}
  ${contextHtml}

  <section class="cg-sec cg-fit" id="fit">
    <h2>How FlightWay scores your fit against this</h2>
    <p class="cg-lede">No black box. Here is the whole method, factor by factor.</p>
    <dl>
      <dt>1. You answer a short quiz</dt>
      <dd>Your answers build a profile across the same ${ONET_DIMENSIONS} O*NET dimensions this page is describing — skills, knowledge, abilities and work activities. Same axes, so the comparison is like-for-like.</dd>
      <dt>2. We correlate the two profiles</dt>
      <dd>Fit is a mean-centered cosine — a correlation between the SHAPE of your profile and the shape of ${esc(c.title)}. Centering matters: raw similarity between any two occupations sits at 0.70–0.85 because all work shares a common profile, so without it every career would look like a match.</dd>
      <dt>3. The number you see is personality fit only</dt>
      <dd>"Would I want this work" and "am I ready for this work" are different questions, and averaging them answers neither. So readiness — what your résumé, coursework and projects prove — is scored separately and shown next to fit, never blended into it.</dd>
      <dt>4. Every factor is visible</dt>
      <dd>You can open any match and see which dimensions pushed it up and which pulled it down. If you disagree with the number, you can see exactly where it came from.</dd>
    </dl>
  </section>

  ${relatedHtml}
  ${sectorHtml}

  <section class="cg-cta">
    <h2>See your fit for ${esc(c.title)}</h2>
    <p>Ten questions, about 90 seconds. You get your match against ${esc(c.title)} and ${esc(String(c.catalogCount || 750))}+ other real careers — with the reasoning shown.</p>
    <a class="cg-btn" href="/quiz?from=career&amp;career=${encodeURIComponent(c.slug)}" data-cg-cta="hero" data-cg-slug="${esc(c.slug)}">Take the quiz</a>
    <a class="cg-btn cg-btn--ghost" href="/career?slug=${encodeURIComponent(c.slug)}" data-cg-cta="app" data-cg-slug="${esc(c.slug)}">Open in FlightWay</a>
  </section>

  <p class="cg-src">Occupational data on this page comes from the <strong>O*NET ${esc(ONET_RELEASE)} Database</strong>, published by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). O*NET is a registered trademark of USDOL/ETA. FlightWay is not endorsed by, and USDOL/ETA is not responsible for, anything built on that data — see <a href="/terms#our-content">our terms</a>. What is ours is the comparison, the score and the plan.</p>
</main>
<script>
(function(){
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('[data-cg-cta]') : null;
    if (!a || !window.FWEvents) return;
    FWEvents.log('career_cta_click', { placement: a.getAttribute('data-cg-cta'), slug: a.getAttribute('data-cg-slug') });
  });
})();
</script>`;

  return shell({
    title,
    description: c.metaDescription,
    canonicalPath: `/careers/${c.slug}`,
    structured: [occupation, breadcrumb],
    main,
  });
}

// ---------------------------------------------------------------------------
// The directory.

export function renderCareersIndex({ sectors, count }) {
  const title = `All ${count} careers, by sector | FlightWay`;
  const description = `Browse every one of the ${count} careers FlightWay scores you against — what each job takes, what it pays, and how people get in.`;

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'FlightWay', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Careers', item: `${SITE}/careers` },
    ],
  };
  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Career guides',
    description,
    url: `${SITE}/careers`,
    isPartOf: { '@type': 'WebSite', name: 'FlightWay', url: SITE },
  };

  const main = `<main class="cg-wrap">
  <p class="cg-crumbs"><a href="/">FlightWay</a> / Careers</p>

  <header class="cg-hero">
    <p class="cg-eyebrow">Career guides</p>
    <h1>Every career we score you against</h1>
    <p class="cg-hook">${count} real occupations from the U.S. Department of Labor's O*NET database, grouped by sector. Each one has a page: what the job actually involves, what it takes, how people get in, and how your fit is calculated.</p>
    <p style="margin:22px 0 0">
      <label for="cg-search" style="display:block;font-size:13px;color:rgb(var(--muted));margin-bottom:8px">Find a career</label>
      <input id="cg-search" class="cg-dir-search" type="search" placeholder="Try &quot;nurse&quot;, &quot;data&quot;, &quot;electrician&quot;" autocomplete="off">
    </p>
    <p class="cg-dir-count" id="cg-count" role="status"></p>
  </header>

${sectors.map((s) => `  <section class="cg-dir-sec" id="${esc(s.key)}" data-cg-sector>
    <h2>${esc(s.label)} <span style="color:rgb(var(--muted));font-weight:400;font-size:15px">(${s.rows.length})</span></h2>
    ${s.blurb ? `<p class="cg-dir-blurb">${esc(s.blurb)}</p>` : ''}
    <ul class="cg-dir-list">
${s.rows.map((r) => `      <li data-cg-name="${esc(r.title.toLowerCase())}"><a href="/careers/${esc(r.__slug)}">${esc(r.title)}</a></li>`).join('\n')}
    </ul>
  </section>`).join('\n')}

  <p class="cg-empty" id="cg-empty" hidden>No career matches that. Try a shorter word — the list matches on the job title.</p>

  <section class="cg-cta">
    <h2>Which of these actually fits you?</h2>
    <p>Ten questions, about 90 seconds. You get scored against all ${count} of them, with the reasoning shown rather than hidden.</p>
    <a class="cg-btn" href="/quiz?from=careers-index" data-cg-cta="index" data-cg-slug="index">Take the quiz</a>
  </section>

  <p class="cg-src">Occupational data comes from the <strong>O*NET ${esc(ONET_RELEASE)} Database</strong>, published by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), and is used under its public terms. O*NET is a registered trademark of USDOL/ETA, which does not endorse FlightWay — see <a href="/terms#our-content">our terms</a>.</p>
</main>
<script>
(function(){
  var input = document.getElementById('cg-search');
  var countEl = document.getElementById('cg-count');
  var emptyEl = document.getElementById('cg-empty');
  var secs = Array.prototype.slice.call(document.querySelectorAll('[data-cg-sector]'));
  var items = secs.map(function(s){
    return { sec: s, rows: Array.prototype.slice.call(s.querySelectorAll('[data-cg-name]')) };
  });
  var total = items.reduce(function(n, g){ return n + g.rows.length; }, 0);
  var logged = false;
  function apply(q){
    var needle = String(q || '').trim().toLowerCase();
    var shown = 0;
    items.forEach(function(g){
      var any = false;
      g.rows.forEach(function(li){
        var hit = !needle || li.getAttribute('data-cg-name').indexOf(needle) !== -1;
        li.hidden = !hit;
        if (hit) { any = true; shown++; }
      });
      g.sec.hidden = !any;
    });
    emptyEl.hidden = shown !== 0;
    countEl.textContent = needle ? (shown + ' of ' + total + ' careers') : '';
    if (needle && !logged && window.FWEvents) { logged = true; FWEvents.log('career_index_search', { has_query: 1 }); }
  }
  if (input) {
    input.addEventListener('input', function(){ apply(input.value); });
    // A filter that only works with JS must never hide rows before JS runs, so
    // the input starts empty and nothing is hidden until someone types.
  }
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('[data-cg-cta]') : null;
    if (!a || !window.FWEvents) return;
    FWEvents.log('career_cta_click', { placement: a.getAttribute('data-cg-cta'), slug: a.getAttribute('data-cg-slug') });
  });
})();
</script>`;

  return shell({
    title,
    description,
    canonicalPath: '/careers',
    structured: [collection, breadcrumb],
    main,
  });
}

// ---------------------------------------------------------------------------
// 404. Noindex and no canonical — an indexable "not found" page is how a site
// ends up with thousands of soft-404s in Search Console.

export function renderCareerNotFound(slug) {
  const main = `<main class="cg-wrap">
  <p class="cg-crumbs"><a href="/">FlightWay</a> / <a href="/careers">Careers</a></p>
  <header class="cg-hero">
    <p class="cg-eyebrow">Not found</p>
    <h1>We don't have a page for that career</h1>
    <p class="cg-hook">${slug ? `Nothing in our catalog matches <strong>${esc(slug)}</strong>. ` : ''}The full list is one click away, and the quiz will point you at the careers that actually fit.</p>
    <p style="margin:26px 0 0">
      <a class="cg-btn" href="/careers">Browse every career</a>
      <a class="cg-btn cg-btn--ghost" href="/quiz">Take the quiz</a>
    </p>
  </header>
</main>`;
  return shell({
    title: 'Career not found | FlightWay',
    description: 'That career page does not exist. Browse the full FlightWay career directory instead.',
    canonicalPath: '/careers',
    structured: [],
    main,
    noindex: true,
  });
}
