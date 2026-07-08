/**
 * Shared academics keyword → industry / objective-domain rules.
 * Used by hub-academics (sector scores) and onet-vectors (objective vector).
 */
(function (global) {
  // Substring → legacy quiz industry keys (sector scoring).
  var KEYWORD_IND = {
    calc: { tech: 2, finance: 2, engineering: 2, science: 1 },
    math: { tech: 2, finance: 3, engineering: 2, science: 1 },
    statisti: { finance: 3, tech: 2, science: 2 },
    stats: { finance: 3, tech: 2, science: 2 },
    econom: { finance: 3, business: 3, realestate: 1 },
    econ: { finance: 3, business: 3, realestate: 1 },
    account: { finance: 3, business: 2 },
    finance: { finance: 4, business: 2 },
    business: { business: 3, finance: 2, startups: 1 },
    market: { marketing: 3, business: 2, media: 1 },
    comput: { tech: 4, engineering: 2, cybersecurity: 2 },
    program: { tech: 4, engineering: 1, startups: 1 },
    coding: { tech: 4, engineering: 1 },
    softw: { tech: 4, engineering: 1 },
    data: { tech: 3, finance: 2, science: 1 },
    cyber: { cybersecurity: 4, tech: 2 },
    engineer: { engineering: 4, tech: 1, aerospace: 1 },
    physics: { science: 3, engineering: 2, aerospace: 1 },
    chem: { science: 3, healthcare: 1, pharmaceutical: 2 },
    bio: { science: 3, healthcare: 3, pharmaceutical: 1 },
    anatom: { healthcare: 4, science: 1 },
    medic: { healthcare: 4, science: 1, pharmaceutical: 1 },
    mcat: { healthcare: 4, science: 2 },
    health: { healthcare: 4, social: 1 },
    nurs: { healthcare: 4 },
    psych: { healthcare: 2, social: 2, education: 2, hr: 1 },
    sociolog: { social: 3, education: 1, government: 1 },
    history: { education: 2, law: 2, government: 1 },
    politic: { law: 3, government: 2, social: 2 },
    gov: { government: 3, law: 2, social: 1 },
    law: { law: 4, government: 1 },
    lsat: { law: 4, government: 1 },
    debate: { law: 3, business: 1, social: 1 },
    philosoph: { law: 2, education: 2, creative: 1 },
    english: { creative: 2, education: 2, media: 1, law: 1 },
    writ: { creative: 3, media: 2, marketing: 1, education: 1 },
    literat: { creative: 2, education: 2, media: 1 },
    art: { creative: 4, marketing: 1 },
    design: { creative: 4, marketing: 2, tech: 1 },
    music: { creative: 3, media: 1, education: 1 },
    film: { creative: 3, media: 3, marketing: 1 },
    media: { media: 3, marketing: 2, creative: 1 },
    theat: { creative: 3, media: 1, education: 1 },
    communicat: { marketing: 2, media: 2, social: 1, business: 1 },
    language: { social: 2, education: 2, creative: 1 },
    spanish: { social: 2, education: 1 },
    environ: { science: 3, social: 1, agriculture: 2 },
    agricultur: { agriculture: 4, science: 1 },
    architect: { creative: 3, engineering: 2, trades: 1 },
    aviat: { aerospace: 4, engineering: 2 },
    aerospace: { aerospace: 4, engineering: 2 },
    hospitalit: { hospitality: 4, business: 1 },
    culinar: { hospitality: 3, creative: 1 },
    shop: { trades: 3, engineering: 1 },
    woodwork: { trades: 4 },
    welding: { trades: 4 },
    education: { education: 3, social: 1 },
    teach: { education: 3, social: 1 },
    cs101: { tech: 4, engineering: 1 },
    cs201: { tech: 4, engineering: 2 },
    trade: { trades: 4, engineering: 1 },
    premed: { healthcare: 4, science: 2 },
    'pre-med': { healthcare: 4, science: 2 },
    prelaw: { law: 4, government: 1 },
    'pre-law': { law: 4, government: 1 },
    mba: { business: 3, finance: 2 },
    phd: { science: 4, education: 2 },
    jd: { law: 4 },
    nursing: { healthcare: 4 },
    accounting: { finance: 3, business: 2 },
    sociology: { social: 3, education: 1 },
    anthropology: { social: 2, science: 1 },
    philosophy: { law: 2, education: 2 },
    journalism: { media: 3, creative: 2 },
    econ101: { finance: 3, business: 3 },
  };

  var GRAD_OBJECTIVE_TEXT = [
    'medicine healthcare nursing mcat pre-med science med school health professions',
    'law school lsat legal government attorney pre-law',
    'phd research academia graduate science thesis dissertation',
    'mba business finance graduate school management',
    'internship work industry experience tech business career',
    '',
  ];

  function gradObjectiveText(gradIndex) {
    if (typeof gradIndex !== 'number' || gradIndex < 0) return '';
    return GRAD_OBJECTIVE_TEXT[gradIndex] || '';
  }

  var RESUME_THEME_RULES = [
    { pattern: /\b(python|javascript|typescript|java|react|node\.?js|sql|programming|software|developer|github|aws|cloud|devops|cs\d{2,3})\b/i, themes: [{ zone: 'tech', weight: 1 }, { zone: 'cybersecurity', weight: 0.35 }], boost: 12 },
    { pattern: /\b(algorithmic trading|black-?scholes|market-?making|quantitative|numpy|pandas|computational|applied mathematics|statistical analysis|fintech)\b/i, themes: [{ zone: 'finance', weight: 1 }, { zone: 'tech', weight: 0.85 }, { zone: 'science', weight: 0.35 }], boost: 12 },
    { pattern: /\b(robotics|robotic|ros\b|autonomous (vehicle|system)|embedded systems)\b/i, themes: [{ zone: 'engineering', weight: 1 }, { zone: 'tech', weight: 0.85 }], boost: 10 },
    { pattern: /\b(ai product|product management|ml product|ai pm|artificial intelligence)\b/i, themes: [{ zone: 'tech', weight: 1 }, { zone: 'business', weight: 0.6 }], boost: 10 },
    { pattern: /\b(genomic|genomics|bioinformatics|sequencing|computational biology)\b/i, themes: [{ zone: 'science', weight: 1 }, { zone: 'tech', weight: 0.7 }], boost: 10 },
    { pattern: /\b(data|machine learning|deep learning|statistics|analytics|stats|pytorch|tensorflow)\b/i, themes: [{ zone: 'tech', weight: 0.8 }, { zone: 'science', weight: 0.5 }, { zone: 'finance', weight: 0.4 }], boost: 10 },
    { pattern: /\b(finance|accounting|excel|financial modeling|valuation|investment|banking|econ|economics)\b/i, themes: [{ zone: 'finance', weight: 1 }, { zone: 'business', weight: 0.5 }], boost: 10 },
    { pattern: /\b(marketing|social media|seo|content|advertising|brand|growth)\b/i, themes: [{ zone: 'marketing', weight: 1 }, { zone: 'creative', weight: 0.4 }], boost: 8 },
    { pattern: /\b(leadership|managed|team lead|president|director|supervisor)\b/i, themes: [{ zone: 'business', weight: 1 }, { zone: 'operations', weight: 0.6 }], boost: 10 },
    { pattern: /\b(research|laboratory|thesis|publication|manuscript|experiment)\b/i, themes: [{ zone: 'science', weight: 1 }, { zone: 'tech', weight: 0.35 }], boost: 10 },
    { pattern: /\b(design|figma|ux|ui|graphic|adobe|photoshop|illustrator)\b/i, themes: [{ zone: 'creative', weight: 1 }, { zone: 'tech', weight: 0.45 }], boost: 10 },
    { pattern: /\b(internship|intern)\b/i, themes: [{ zone: 'business', weight: 0.7 }, { zone: 'tech', weight: 0.5 }], boost: 6 },
    { pattern: /\b(gpa|dean'?s list|honors|\b[34]\.\d{1,2}\b)\b/i, themes: [{ zone: 'academic', weight: 1 }], boost: 5 },
    { pattern: /\b(volunteer|community|nonprofit|outreach|advocacy)\b/i, themes: [{ zone: 'social', weight: 1 }, { zone: 'government', weight: 0.35 }], boost: 6 },
    { pattern: /\b(project|capstone|portfolio|built|launched)\b/i, themes: [{ zone: 'tech', weight: 0.6 }, { zone: 'business', weight: 0.5 }], boost: 8 },
    { pattern: /\b(law|lsat|legal|attorney|paralegal|litigation)\b/i, themes: [{ zone: 'law', weight: 1 }, { zone: 'government', weight: 0.4 }], boost: 9 },
    { pattern: /\b(nursing|pre-?med|healthcare|clinical|patient|mcat)\b/i, themes: [{ zone: 'healthcare', weight: 1 }, { zone: 'science', weight: 0.45 }], boost: 10 },
    { pattern: /\b(engineering|mechanical|civil|electrical|cad|solidworks|matlab)\b/i, themes: [{ zone: 'engineering', weight: 1 }, { zone: 'tech', weight: 0.35 }], boost: 9 },
    { pattern: /\b(cybersecurity|infosec|penetration|soc analyst|siem|cissp)\b/i, themes: [{ zone: 'cybersecurity', weight: 1 }, { zone: 'tech', weight: 0.5 }], boost: 10 },
    { pattern: /\b(consulting|strategy|mba|operations|supply chain|logistics)\b/i, themes: [{ zone: 'business', weight: 1 }, { zone: 'operations', weight: 0.55 }], boost: 8 },
    { pattern: /\b(teaching|tutor|education|curriculum|classroom|professor)\b/i, themes: [{ zone: 'education', weight: 1 }, { zone: 'social', weight: 0.35 }], boost: 8 },
    { pattern: /\b(journalism|broadcast|film|video|podcast|media)\b/i, themes: [{ zone: 'media', weight: 1 }, { zone: 'creative', weight: 0.45 }], boost: 8 },
    { pattern: /\b(hospitality|hotel|restaurant|culinary|tourism|event planning)\b/i, themes: [{ zone: 'hospitality', weight: 1 }], boost: 7 },
    { pattern: /\b(agriculture|farming|conservation|forestry|sustainability)\b/i, themes: [{ zone: 'agriculture', weight: 1 }, { zone: 'science', weight: 0.35 }], boost: 7 },
    { pattern: /\b(welding|electrician|plumber|hvac|carpentry|construction|trades)\b/i, themes: [{ zone: 'trades', weight: 1 }, { zone: 'engineering', weight: 0.3 }], boost: 8 },
  ];

  var RESUME_KEYWORD_RULES = RESUME_THEME_RULES;

  var ZONE_PROFILES_URL = '/data/onet/artifacts/zone-dimension-profiles.json';

  var GRAD_OBJECTIVE = {
    med: { knowledge: 12, skills: 8 },
    law: { knowledge: 10, workActivities: 6 },
    phd: { knowledge: 12, workActivities: 8 },
    mba: { skills: 10, workActivities: 8 },
  };

  function classDeltaFromText(text, sign) {
    var t = (text || '').toLowerCase();
    var d = {};
    if (!t) return d;
    Object.keys(KEYWORD_IND).forEach(function (kw) {
      if (t.indexOf(kw) !== -1) {
        var s = KEYWORD_IND[kw];
        Object.keys(s).forEach(function (k) {
          d[k] = (d[k] || 0) + s[k] * sign;
        });
      }
    });
    return d;
  }

  function parseGpaFromText(text) {
    var m = String(text || '').match(/\b([0-4]\.\d{1,2})\b/);
    return m ? Number(m[1]) : null;
  }

  global.FWAcademicsMap = {
    KEYWORD_IND: KEYWORD_IND,
    RESUME_THEME_RULES: RESUME_THEME_RULES,
    RESUME_KEYWORD_RULES: RESUME_KEYWORD_RULES,
    ZONE_PROFILES_URL: ZONE_PROFILES_URL,
    GRAD_OBJECTIVE: GRAD_OBJECTIVE,
    GRAD_OBJECTIVE_TEXT: GRAD_OBJECTIVE_TEXT,
    gradObjectiveText: gradObjectiveText,
    classDeltaFromText: classDeltaFromText,
    parseGpaFromText: parseGpaFromText,
  };
}(typeof window !== 'undefined' ? window : globalThis));
