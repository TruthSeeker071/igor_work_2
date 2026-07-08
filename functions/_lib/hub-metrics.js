/** Server-side static career metrics (mirrors hub career-deep-dives.js industry tables). */

const SALARY = {
  Technology: ['$95k', '$150k', '$220k+'],
  Finance: ['$58k', '$108k', '$175k+'],
  Healthcare: ['$62k', '$98k', '$155k+'],
  Education: ['$48k', '$72k', '$105k+'],
  Law: ['$55k', '$115k', '$190k+'],
  Government: ['$50k', '$82k', '$125k+'],
  Creative: ['$52k', '$88k', '$135k+'],
  Trades: ['$42k', '$68k', '$95k+'],
  Design: ['$58k', '$95k', '$145k+'],
  Media: ['$45k', '$78k', '$120k+'],
  Business: ['$55k', '$105k', '$165k+'],
  Engineering: ['$62k', '$98k', '$145k+'],
  'Social Impact': ['$42k', '$65k', '$92k+'],
  Science: ['$50k', '$88k', '$130k+'],
};

const TECH_SCORE = {
  Technology: 88, Finance: 52, Healthcare: 48, Education: 22, Law: 28,
  Government: 25, Creative: 32, Trades: 55, Design: 40, Media: 28,
  Business: 35, Engineering: 72, 'Social Impact': 18, Science: 65,
};

const SLUG_INDUSTRY = {
  'software-engineer': 'Technology', 'ux-designer': 'Technology', 'data-scientist': 'Technology',
  'product-manager': 'Technology', 'cybersecurity-analyst': 'Technology', 'devops-engineer': 'Technology',
  'investment-banker': 'Finance', 'financial-analyst': 'Finance', actuary: 'Finance', accountant: 'Finance',
  surgeon: 'Healthcare', nurse: 'Healthcare', therapist: 'Healthcare', pharmacist: 'Healthcare',
  'physician-assistant': 'Healthcare', 'physical-therapist': 'Healthcare', 'biomedical-engineer': 'Healthcare',
  teacher: 'Education', professor: 'Education',
  lawyer: 'Law', paralegal: 'Law',
  'policy-analyst': 'Government', 'urban-planner': 'Government',
  'graphic-designer': 'Creative', 'content-strategist': 'Creative', copywriter: 'Creative',
  electrician: 'Trades',
  architect: 'Design',
  journalist: 'Media', 'public-relations': 'Media', 'video-producer': 'Media',
  entrepreneur: 'Business', 'hr-manager': 'Business', 'operations-manager': 'Business',
  'real-estate-agent': 'Business', 'supply-chain-manager': 'Business',
  'mechanical-engineer': 'Engineering', 'civil-engineer': 'Engineering',
  'social-worker': 'Social Impact',
  'environmental-scientist': 'Science',
  'software-engineering': 'Technology', 'data-science': 'Technology', 'ux-design': 'Technology',
  'product-management': 'Technology', 'investment-banking': 'Finance', 'financial-analysis': 'Finance',
  'management-consulting': 'Business', 'marketing-strategy': 'Creative', 'business-analytics': 'Finance',
  'corporate-strategy': 'Business', 'healthcare-admin': 'Healthcare', 'legal-operations': 'Law',
};

const HUB_ZONE_TO_INDUSTRY = {
  tech: 'Technology',
  cybersecurity: 'Technology',
  healthcare: 'Healthcare',
  finance: 'Finance',
  science: 'Science',
  engineering: 'Engineering',
  creative: 'Creative',
  business: 'Business',
  marketing: 'Creative',
  education: 'Education',
  law: 'Law',
  social: 'Social Impact',
  media: 'Media',
  government: 'Government',
  operations: 'Business',
  trades: 'Trades',
  agriculture: 'Science',
  hospitality: 'Hospitality',
};

function metricsFromIndustry(industry, careerName) {
  if (!industry) return null;
  const sal = SALARY[industry] || ['$50k', '$85k', '$125k+'];
  const tech = TECH_SCORE[industry] || 40;
  const aiAuto = tech > 70 ? 42 : tech > 45 ? 32 : 22;
  const name = String(careerName || 'this field').toLowerCase();
  return {
    entrySalary: sal[0],
    midSalary: sal[1],
    seniorSalary: sal[2],
    jobGrowth: '+11%',
    jobGrowthLabel: 'Faster than average',
    technicalScore: tech,
    aiAutomation: aiAuto,
    aiOutlook: `AI will automate routine tasks in ${name} workflows, but judgment and domain expertise remain human.`,
    aiTasks: [
      { task: 'Routine reporting', risk: 'high' },
      { task: 'Research & drafts', risk: 'med' },
      { task: 'Stakeholder relationships', risk: 'low' },
    ],
  };
}

export function staticMetricsForHubZone(hubZone, careerName) {
  const industry = HUB_ZONE_TO_INDUSTRY[String(hubZone || '').toLowerCase()];
  return metricsFromIndustry(industry, careerName);
}

export async function staticMetricsForSoc(soc, careerName, env, baseUrl) {
  if (!soc) return null;
  const { getCareers } = await import('./onet/store.js');
  const rows = await getCareers(env, baseUrl);
  const row = rows.find((c) => c.soc === soc);
  if (!row) return null;
  return staticMetricsForHubZone(row.hubZone, careerName || row.title);
}

function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const JOB_ZONE_EDUCATION = {
  1: 'High school or less',
  2: 'High school + training',
  3: 'Associate degree or equivalent',
  4: "Bachelor's degree typical",
  5: 'Graduate degree typical',
};

function topDimensionsByDomain(lv, importance, registry, domain, limit) {
  if (!lv || !registry || !registry.dimensions) return [];
  const scored = [];
  registry.dimensions.forEach((d) => {
    if (domain && d.domain !== domain) return;
    const level = lv[d.index] || 0;
    if (level <= 0) return;
    const imp = importance && importance[d.index] != null ? importance[d.index] / 100 : 0.5;
    scored.push({ name: d.name, level: Math.round(level * 10) / 10, score: level * imp });
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit || 6);
}

function topOverallRequirements(lv, importance, registry, limit) {
  if (!lv || !registry || !registry.dimensions) return [];
  const scored = [];
  registry.dimensions.forEach((d) => {
    const level = lv[d.index] || 0;
    if (level <= 0) return;
    const imp = importance && importance[d.index] != null ? importance[d.index] / 100 : 0.5;
    scored.push({
      name: d.name,
      domain: d.domain,
      level: Math.round(level * 10) / 10,
      score: level * imp,
    });
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit || 10);
}

async function onetVectorSliceForSoc(soc, env, baseUrl) {
  const {
    getRegistry,
    getSocIndex,
    getLvBuffer,
    getImBuffer,
    sliceVector,
  } = await import('./onet/store.js');
  const registry = await getRegistry(env, baseUrl);
  const socIndex = await getSocIndex(env, baseUrl);
  const idx = socIndex[soc];
  if (idx == null) return null;
  const lvBuf = await getLvBuffer(env, baseUrl);
  const imBuf = await getImBuffer(env, baseUrl);
  return {
    registry,
    lv: sliceVector(lvBuf, idx),
    im: sliceVector(imBuf, idx),
  };
}

export async function onetDimensionHintsForSoc(soc, env, baseUrl) {
  const slice = await onetVectorSliceForSoc(soc, env, baseUrl);
  if (!slice) return null;
  const { lv, im, registry } = slice;
  return {
    skills: topDimensionsByDomain(lv, im, registry, 'skills', 5).map((d) => d.name),
    knowledge: topDimensionsByDomain(lv, im, registry, 'knowledge', 4).map((d) => d.name),
    abilities: topDimensionsByDomain(lv, im, registry, 'abilities', 4).map((d) => d.name),
    workActivities: topDimensionsByDomain(lv, im, registry, 'workActivities', 5).map((d) => d.name),
  };
}

export async function onetProfileForSoc(soc, env, baseUrl) {
  if (!soc) return null;
  const { getCareers } = await import('./onet/store.js');
  const rows = await getCareers(env, baseUrl);
  const row = rows.find((c) => c.soc === soc);
  const slice = await onetVectorSliceForSoc(soc, env, baseUrl);
  if (!slice) return null;
  const { lv, im, registry } = slice;
  const domains = ['skills', 'knowledge', 'abilities', 'workActivities'];
  const byDomain = {};
  domains.forEach((domain) => {
    byDomain[domain] = topDimensionsByDomain(lv, im, registry, domain, 6);
  });
  return {
    catalog: row ? {
      title: row.title,
      description: row.description || null,
      jobZone: row.jobZone || null,
      collarCategory: row.collarCategory || null,
      socMajor: row.socMajor || null,
      hubZone: row.hubZone || null,
      soc: row.soc,
    } : { soc },
    byDomain,
    topOverall: topOverallRequirements(lv, im, registry, 10),
    onetRelease: registry.onetRelease || null,
  };
}

export async function onetQuickFactsForSoc(soc, env, baseUrl) {
  if (!soc) return null;
  const { getCareers } = await import('./onet/store.js');
  const rows = await getCareers(env, baseUrl);
  const row = rows.find((c) => c.soc === soc);
  if (!row) return null;
  const jz = Number(row.jobZone);
  const industry = HUB_ZONE_TO_INDUSTRY[String(row.hubZone || '').toLowerCase()] || row.hubZone;
  return {
    Sector: industry || row.hubZone,
    'Job zone': jz ? `Zone ${jz}` : null,
    'Education prep': JOB_ZONE_EDUCATION[jz] || null,
    'Collar type': row.collarCategory || null,
    'SOC major': row.socMajor ? `Major group ${row.socMajor}` : null,
    'O*NET SOC': row.soc,
  };
}

export function staticMetricsForCareer(slug, careerName) {
  const key = String(slug || '').toLowerCase() || slugify(careerName);
  const industry = SLUG_INDUSTRY[key];
  return metricsFromIndustry(industry, careerName);
}
