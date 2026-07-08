/**
 * Career Hub catalog + quiz-to-fit scoring.
 * Quiz fit scoring shim only; career identity comes from FWOnetCatalog / careers.json.
 * Quiz keys: tech, healthcare, finance, creative, education, business, law,
 * engineering, science, startups, social, marketing, trades, media, government,
 * cybersecurity, operations, hospitality, aerospace, pharmaceutical, sports,
 * realestate, hr, agriculture.
 */
(function () {
  const HUB_QUIZ_KEY = 'fw_hub_quiz_v1';

  const careers = [
    { id:1,  name:'Software Engineer',       industry:'Technology',   x:84, y:14, fitScore:85, skills:['coding','problem-solving','logic'],            description:'Design and build software systems. You\'ll spend your days solving complex technical problems, writing clean code, and collaborating with teams to ship products people use.' },
    { id:2,  name:'UX Designer',             industry:'Technology',   x:68, y:28, fitScore:72, skills:['creativity','empathy','visual thinking'],      description:'Shape how people interact with digital products. You\'ll research users, sketch interfaces, and test designs until the experience feels effortless.' },
    { id:3,  name:'Data Scientist',          industry:'Technology',   x:96, y:4, fitScore:60, skills:['statistics','coding','analysis'],            description:'Turn raw data into insight. You\'ll build models, run experiments, and help organizations make smarter decisions based on evidence.' },
    { id:4,  name:'Product Manager',         industry:'Technology',   x:78, y:58, fitScore:78, skills:['leadership','communication','strategy'],       description:'Own the vision for a product. You\'ll work across design, engineering, and business to decide what gets built, when, and why.' },
    { id:5,  name:'Investment Banker',       industry:'Finance',      x:20, y:6, fitScore:45, skills:['finance','analysis','communication'],          description:'Advise companies on mergers, acquisitions, and capital raises. High pressure, high reward, and long hours are all part of the deal.' },
    { id:6,  name:'Financial Analyst',       industry:'Finance',      x:30, y:20, fitScore:50, skills:['finance','excel','analysis'],                  description:'Evaluate financial data to guide investment and business decisions. You\'ll build models, write reports, and track market trends closely.' },
    { id:7,  name:'Actuary',                 industry:'Finance',      x:10, y:36, fitScore:30, skills:['mathematics','statistics','risk'],             description:'Use math to measure and price risk for insurance companies and pension funds. One of the most stable and well-paid careers in finance.' },
    { id:8,  name:'Accountant',              industry:'Finance',      x:2, y:18, fitScore:25, skills:['finance','detail-oriented','excel'],           description:'Manage financial records, prepare tax filings, and ensure regulatory compliance. The backbone of every functioning business.' },
    { id:9,  name:'Surgeon',                 industry:'Healthcare',   x:56, y:2, fitScore:20, skills:['medicine','precision','stamina'],              description:'Perform operations that save and improve lives. Requires years of training, steady hands, and the ability to make critical decisions under pressure.' },
    { id:10, name:'Nurse',                   industry:'Healthcare',   x:40, y:14, fitScore:35, skills:['empathy','medicine','communication'],          description:'Provide direct patient care and support. Nurses are the most human part of healthcare, offering both medical skill and genuine compassion.' },
    { id:11, name:'Therapist',               industry:'Healthcare',   x:22, y:30, fitScore:55, skills:['empathy','listening','psychology'],            description:'Help people navigate mental health challenges through talk therapy and evidence-based treatment. Deeply meaningful work with real impact.' },
    { id:12, name:'Teacher',                 industry:'Education',    x:48, y:78, fitScore:65, skills:['communication','patience','leadership'],       description:'Shape the minds of the next generation. Teaching is harder than it looks and more rewarding than most people expect.' },
    { id:13, name:'Professor',               industry:'Education',    x:58, y:96, fitScore:60, skills:['research','communication','expertise'],        description:'Teach at the university level while conducting original research. Combines deep intellectual work with mentorship and academic community.' },
    { id:14, name:'Lawyer',                  industry:'Law',          x:24, y:66, fitScore:70, skills:['argumentation','research','communication'],    description:'Represent clients, argue cases, and navigate legal systems. Requires sharp thinking, strong writing, and the ability to stay calm under pressure.' },
    { id:15, name:'Policy Analyst',          industry:'Government',   x:38, y:88, fitScore:75, skills:['research','writing','analysis'],               description:'Research and evaluate policies to help governments make better decisions. A career for people who want to shape society at the systems level.' },
    { id:16, name:'Graphic Designer',        industry:'Creative',     x:74, y:82, fitScore:80, skills:['creativity','visual thinking','software'],     description:'Create visual communication for brands, products, and media. Combines artistic skill with strategic thinking about how visuals affect people.' },
    { id:17, name:'Electrician',             industry:'Trades',       x:2, y:76, fitScore:40, skills:['technical','problem-solving','safety'],        description:'Install and maintain electrical systems in homes and buildings. A skilled trade with strong job security and good earning potential.' },
    { id:18, name:'Architect',               industry:'Design',       x:54, y:52, fitScore:68, skills:['creativity','math','spatial reasoning'],       description:'Design buildings and spaces where people live, work, and gather. Blends artistic vision with engineering constraints and human needs.' },
    { id:19, name:'Journalist',              industry:'Media',        x:36, y:92, fitScore:73, skills:['writing','curiosity','communication'],         description:'Investigate and report on the world. Journalism at its best holds power accountable and helps people understand what\'s happening and why.' },
    { id:20, name:'Entrepreneur',            industry:'Business',     x:62, y:40, fitScore:52, skills:['leadership','risk-taking','creativity'],       description:'Build something from nothing. Entrepreneurs identify problems, take calculated risks, and create organizations that didn\'t exist before.' },
    { id:21, name:'Cybersecurity Analyst',   industry:'Technology',   x:98, y:26, fitScore:58, skills:['security','analysis','problem-solving'],   description:'Protect organizations from digital threats. You\'ll monitor systems, investigate breaches, and design defenses against evolving attacks.' },
    { id:22, name:'DevOps Engineer',         industry:'Technology',   x:90, y:48, fitScore:62, skills:['automation','cloud','collaboration'],          description:'Bridge development and operations. You\'ll build pipelines, manage infrastructure, and keep software shipping reliably at scale.' },
    { id:23, name:'Mechanical Engineer',     industry:'Engineering',  x:14, y:50, fitScore:55, skills:['physics','design','CAD'],                      description:'Design machines and mechanical systems. From robotics to automotive to aerospace, you\'ll turn physics into working hardware.' },
    { id:24, name:'Civil Engineer',          industry:'Engineering',  x:6, y:62, fitScore:50, skills:['structural design','project management','math'], description:'Build the infrastructure civilization runs on — bridges, roads, water systems, and public works that last generations.' },
    { id:25, name:'Social Worker',           industry:'Social Impact',x:28, y:48, fitScore:60, skills:['empathy','advocacy','case management'],      description:'Support individuals and families through crisis. Social work combines counseling, resource navigation, and systems-level advocacy.' },
    { id:26, name:'Public Relations',        industry:'Media',        x:64, y:68, fitScore:57, skills:['communication','storytelling','media relations'], description:'Shape how organizations appear in the world. You\'ll craft narratives, manage press relationships, and protect reputations.' },
    { id:27, name:'Video Producer',          industry:'Media',        x:46, y:102, fitScore:54, skills:['storytelling','editing','visual direction'],   description:'Create video content from concept to final cut. Producers coordinate shoots, direct talent, and deliver stories that move audiences.' },
    { id:28, name:'Pharmacist',              industry:'Healthcare',   x:52, y:24, fitScore:48, skills:['chemistry','patient care','attention to detail'], description:'Dispense medications and counsel patients on safe use. Pharmacists are the final safety check in the healthcare system.' },
    { id:29, name:'Physician Assistant',     industry:'Healthcare',   x:72, y:18, fitScore:52, skills:['medicine','diagnosis','patient care'],         description:'Practice medicine under physician supervision. PAs examine patients, order tests, and treat conditions across many specialties.' },
    { id:30, name:'HR Manager',              industry:'Business',     x:82, y:66, fitScore:56, skills:['people skills','policy','conflict resolution'], description:'Build healthy workplaces. HR managers recruit talent, develop culture, and navigate the human side of growing organizations.' },
    { id:31, name:'Operations Manager',      industry:'Business',     x:66, y:56, fitScore:59, skills:['process design','leadership','analytics'],     description:'Keep organizations running smoothly. You\'ll optimize workflows, manage supply chains, and solve operational bottlenecks.' },
    { id:32, name:'Content Strategist',      industry:'Creative',     x:86, y:72, fitScore:61, skills:['writing','SEO','audience research'],           description:'Plan what brands say and where they say it. Content strategists align editorial calendars with business goals and audience needs.' },
    { id:33, name:'Biomedical Engineer',     industry:'Healthcare',   x:44, y:42, fitScore:53, skills:['biology','engineering','research'],            description:'Design medical devices and health technologies. You\'ll blend engineering rigor with biological systems to improve patient outcomes.' },
    { id:34, name:'Paralegal',               industry:'Law',          x:16, y:56, fitScore:46, skills:['legal research','writing','organization'],    description:'Support attorneys with research, document preparation, and case management. Paralegals keep legal teams moving efficiently.' },
    { id:35, name:'Urban Planner',           industry:'Government',   x:42, y:70, fitScore:58, skills:['spatial analysis','policy','public engagement'], description:'Shape how cities grow. Urban planners balance housing, transit, and green space to build communities that work for everyone.' },
    { id:36, name:'Environmental Scientist', industry:'Science',      x:18, y:34, fitScore:55, skills:['ecology','data analysis','field research'],  description:'Study ecosystems and environmental change. You\'ll collect data, model impacts, and inform policy on climate and conservation.' },
    { id:37, name:'Supply Chain Manager',    industry:'Business',     x:8, y:58, fitScore:54, skills:['logistics','negotiation','analytics'],         description:'Move goods from source to shelf. Supply chain managers optimize procurement, warehousing, and delivery across global networks.' },
    { id:38, name:'Physical Therapist',      industry:'Healthcare',   x:68, y:6, fitScore:57, skills:['anatomy','rehabilitation','patient care'],     description:'Help people recover movement and manage pain. PTs design exercise programs that restore function after injury or surgery.' },
    { id:39, name:'Copywriter',              industry:'Creative',     x:58, y:86, fitScore:55, skills:['writing','persuasion','brand voice'],          description:'Write words that sell, inspire, and clarify. Copywriters craft ads, landing pages, and campaigns that drive action.' },
    { id:40, name:'Real Estate Agent',       industry:'Business',     x:32, y:44, fitScore:50, skills:['sales','negotiation','market knowledge'],      description:'Help people buy and sell property. Real estate agents guide clients through one of life\'s biggest financial decisions.' },
    { id:41, name:'Hospitality',             industry:'Hospitality',  x:88, y:88, fitScore:62, skills:['people skills','service','organization'],       description:'Create experiences that make people feel cared for. Hospitality blends business savvy with genuine warmth — running the places where people stay, eat, celebrate, and travel.' },
    { id:42, name:'Hotel Manager',           industry:'Hospitality',  x:80, y:96, fitScore:58, skills:['operations','leadership','guest relations'],     description:'Run a hotel end to end — staff, guests, budgets, and the hundred daily details that make a stay feel seamless. Equal parts business operator and host.' },
    { id:43, name:'Restaurant Manager',      industry:'Hospitality',  x:96, y:96, fitScore:57, skills:['operations','people skills','fast decisions'],   description:'Lead a restaurant\'s floor and team. You\'ll juggle service, staffing, and guests in real time, turning a hectic dinner rush into a great night out.' },
    { id:44, name:'Event Planner',           industry:'Hospitality',  x:84, y:80, fitScore:60, skills:['organization','creativity','client relations'],    description:'Bring people together for the moments that matter — weddings, conferences, launches. You\'ll design experiences and orchestrate every detail under pressure.' },
    { id:45, name:'Travel & Tourism Manager',industry:'Hospitality',  x:98, y:82, fitScore:55, skills:['planning','customer service','cultural savvy'],   description:'Craft trips and run tourism operations that show people the world. Combines logistics, sales, and a love of place and culture.' }
  ];

  // Snapshot of the hand-authored base fit scores, captured before any quiz
  // personalization mutates them. Lets the Career Hub "Sharpen your matches"
  // panel recompute fit from scratch (reset → apply) without compounding.
  const baseFitScores = {};
  careers.forEach(function (c) { baseFitScores[c.id] = c.fitScore; });
  function resetFitScores() {
    careers.forEach(function (c) { c.fitScore = baseFitScores[c.id]; });
  }

  const careerToQuizKeys = {
    1:['tech','engineering'], 2:['creative','tech'], 3:['science','tech'], 4:['startups','business'],
    5:['finance'], 6:['finance'], 7:['finance','science'], 8:['finance'],
    9:['healthcare'], 10:['healthcare'], 11:['healthcare','social'],
    12:['education'], 13:['education','science'],
    14:['law'], 15:['law','government'], 16:['creative','marketing'], 17:['trades','engineering'],
    18:['engineering','creative'], 19:['marketing','media'], 20:['startups','business'],
    21:['cybersecurity','tech'], 22:['tech','operations'], 23:['engineering','trades'],
    24:['engineering','government'], 25:['social','healthcare'], 26:['media','marketing'],
    27:['media','creative'], 28:['pharmaceutical','healthcare'], 29:['healthcare','science'],
    30:['hr','business'], 31:['operations','business'], 32:['marketing','creative'],
    33:['pharmaceutical','engineering'], 34:['law'], 35:['government','engineering'],
    36:['science','agriculture'], 37:['operations','business'], 38:['healthcare','sports'],
    39:['creative','marketing'], 40:['realestate','business'],
    41:['hospitality','business','social'], 42:['hospitality','business','operations'],
    43:['hospitality','operations','business'], 44:['hospitality','social','creative'],
    45:['hospitality','social','business']
  };

  const subBranchNames = {
    1:['Frontend','Backend','DevOps','Mobile'],
    2:['UX Research','Interaction','Design Systems'],
    3:['ML Engineer','Data Analyst','Research Sci'],
    4:['Growth PM','Technical PM','Platform PM'],
    5:['M&A','Capital Markets','Restructuring'],
    6:['Equity Research','Corporate Fin','FP&A'],
    7:['Life Actuary','Health Actuary','Pensions'],
    8:['Tax','Audit','Forensic'],
    9:['Cardiac','Neurosurgery','Orthopedic'],
    10:['ICU Nurse','ER Nurse','Pediatric'],
    11:['Clinical Psych','Family Therapy','CBT'],
    12:['Elementary','STEM','Special Ed'],
    13:['Researcher','Lecturer','Dept Chair'],
    14:['Corporate Law','Public Defender','IP Law','Litigation'],
    15:['Health Policy','Economic Policy','Foreign Policy'],
    16:['Brand Design','Motion Graphics','Illustration'],
    17:['Residential','Industrial','Lineworker'],
    18:['Residential','Landscape','Urban Planning'],
    19:['Investigative','Broadcast','Data Journalism'],
    20:['Startup Founder','Solopreneur','Social Venture'],
    21:['Threat Intel','Pen Testing','GRC Compliance'],
    22:['Platform Eng','SRE','Release Mgmt'],
    23:['Robotics','Automotive','HVAC Design'],
    24:['Structural','Transportation','Water Systems'],
    25:['Clinical Social','School Social','Policy Advocate'],
    26:['Corporate PR','Crisis Comms','Influencer PR'],
    27:['Documentary','Commercial','Live Events'],
    28:['Retail Pharmacy','Hospital Pharmacy','Clinical Research'],
    29:['Emergency Med','Surgery Assist','Primary Care'],
    30:['Talent Acquisition','L&D','Employee Relations'],
    31:['Manufacturing Ops','Retail Ops','Process Improvement'],
    32:['SEO Content','Brand Editorial','Product Marketing'],
    33:['Medical Devices','Prosthetics','Imaging Tech'],
    34:['Litigation Support','Corporate Paralegal','Immigration'],
    35:['Transit Planning','Zoning','Sustainability Planning'],
    36:['Climate Science','Conservation','Environmental Policy'],
    37:['Procurement','Distribution','Inventory Planning'],
    38:['Orthopedic PT','Sports Rehab','Neurologic PT'],
    39:['Brand Copy','UX Writing','Email Marketing'],
    40:['Residential Sales','Commercial Broker','Property Mgmt'],
    41:['Hotel Mgmt','Restaurant Mgmt','Events','Travel & Tourism'],
    42:['Front Office','Operations','Revenue Mgmt'],
    43:['Fine Dining','Bar & Beverage','Multi-unit'],
    44:['Weddings','Corporate Events','Festivals'],
    45:['Tour Operations','Destination Mgmt','Cruise & Resort']
  };

  function b64UrlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function readQuizStateFromUrl() {
    const m = (window.location.hash || '').match(/^#r=([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    try { return JSON.parse(b64UrlDecode(m[1])); }
    catch (e) { console.warn('Bad results token in URL', e); return null; }
  }

  function readQuizStateFromStorage() {
    try {
      const raw = localStorage.getItem(HUB_QUIZ_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && data.scores && typeof data.scores === 'object') return data;
    } catch (e) { /* private mode / corrupt */ }
    return null;
  }

  function fitBlendWeights(careerId) {
    let personalized = false;
    try {
      personalized = !!(localStorage.getItem('fw_hub_refine_updated_v1') || localStorage.getItem('fw_hub_academics_updated_v1'));
    } catch (e) { /* private mode */ }
    if (personalized) return { quiz: 0.97, base: 0.03 };
    if (careerId === 20) return { quiz: 0.92, base: 0.08 };
    return { quiz: 0.85, base: 0.15 };
  }

  function blendFitScore(careerId, component, staticBase) {
    const w = fitBlendWeights(careerId);
    return Math.max(0, Math.min(100, Math.round(w.quiz * component + w.base * staticBase)));
  }

  /** Entrepreneur needs a top-tier startups signal, not just generic business lean. */
  function computeIndustryComponent(careerId, scores) {
    const keys = careerToQuizKeys[careerId] || [];
    if (!keys.length) return null;

    if (careerId === 20) {
      const startups = scores.startups || 0;
      const business = scores.business || 0;
      const creative = scores.creative || 0;
      const ranked = Object.entries(scores).sort(function (a, b) { return b[1] - a[1]; });
      const startupsRank = ranked.findIndex(function (entry) { return entry[0] === 'startups'; });
      let component = startups * 0.55 + business * 0.25 + creative * 0.2;
      if (startupsRank > 2) component *= 0.72;
      if (startups < 55) component *= 0.65;
      if (startups < 40) component *= 0.5;
      return component;
    }

    let wSum = 0;
    let wTot = 0;
    keys.forEach(function (k, i) {
      const weight = i === 0 ? 2 : 1;
      const v = typeof scores[k] === 'number' ? scores[k] : 0;
      wSum += v * weight;
      wTot += weight;
    });
    return wTot ? wSum / wTot : null;
  }

  function applyQuizScores(scores) {
    careers.forEach(function (c) {
      const component = computeIndustryComponent(c.id, scores);
      if (component === null) return;
      c.fitScore = blendFitScore(c.id, component, baseFitScores[c.id]);
    });
    if (window.FWOnetVectors && typeof FWOnetVectors.clearRankedCache === 'function') {
      FWOnetVectors.clearRankedCache();
    }
  }

  /** Rank all hub careers for quiz binder reveal (same scoring as Career Hub). */
  function rankCareersFromQuizScores(scores) {
    return careers.map(function (c) {
      const component = computeIndustryComponent(c.id, scores);
      let fit = c.fitScore;
      if (component !== null) {
        fit = blendFitScore(c.id, component, baseFitScores[c.id]);
      }
      return { id: c.id, score: fit, career: c };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  /** Quiz industry keys → hub career ids (for industry breakdown links). */
  function careersForIndustry(industryKey) {
    return careers.filter(function (c) {
      return (careerToQuizKeys[c.id] || []).indexOf(industryKey) !== -1;
    });
  }

  /** Client-side fit breakdown for deep-dive quiz metrics (before AI "closer look"). */
  function getCareerFitBreakdown(careerId, scores) {
    const career = careers.find(function (c) { return String(c.id) === String(careerId); });
    if (!career || !scores) return null;
    const keys = careerToQuizKeys[careerId] || [];
    const component = computeIndustryComponent(careerId, scores);
    if (component === null) return null;
    const percent = blendFitScore(careerId, component, baseFitScores[careerId]);
    const mapped = keys.map(function (k) {
      return { key: k, score: typeof scores[k] === 'number' ? Math.round(scores[k]) : 0 };
    }).sort(function (a, b) { return b.score - a.score; });
    const strengths = mapped.filter(function (m) { return m.score >= 55; }).slice(0, 4)
      .map(function (m) { return titleCaseIndustry(m.key) + ' (' + m.score + '%)'; });
    const gaps = mapped.filter(function (m) { return m.score < 45; }).slice(0, 3)
      .map(function (m) { return titleCaseIndustry(m.key) + ' (' + m.score + '%)'; });
    const topIndustries = Object.entries(scores)
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 5)
      .map(function (e) { return { key: e[0], score: Math.round(e[1]) }; });
    return {
      careerId: careerId,
      careerName: career.name,
      percent: percent,
      mappedIndustries: mapped,
      strengths: strengths,
      gaps: gaps,
      topIndustries: topIndustries,
    };
  }

  function titleCaseIndustry(key) {
    return String(key || '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  // Canonical alias table lives in onet-catalog.js (FWOnetCatalog.SLUG_ALIASES);
  // this copy is only a fallback for load order / catalog absence. Keep in sync
  // with it and the server copy in functions/_lib/roadmap-sync.js.
  var SLUG_ALIASES = {
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

  function normalizeCareerSlug(slug) {
    if (window.FWOnetCatalog && typeof FWOnetCatalog.normalizeSlug === 'function') {
      var normalized = FWOnetCatalog.normalizeSlug(slug);
      if (normalized) return normalized;
    }
    return SLUG_ALIASES[slug] || slug;
  }

  function careerIdFromSlug(slug) {
    const normalized = normalizeCareerSlug(slug);
    const hit = careers.find(function (c) { return slugify(c.name) === normalized; });
    return hit ? hit.id : null;
  }

  var careerSlugById = {};
  careers.forEach(function (c) {
    careerSlugById[c.id] = slugify(c.name);
    c.slug = careerSlugById[c.id];
  });

  function careerSlug(id) {
    return careerSlugById[id] || '';
  }

  function initPersonalization() {
    const params = new URLSearchParams(window.location.search);
    let name = params.get('name') || '';

    const fromUrl = readQuizStateFromUrl();
    const fromStorage = fromUrl ? null : readQuizStateFromStorage();
    const quizState = fromUrl || fromStorage;

    if (quizState && quizState.name) name = quizState.name;
    const userName = (name || 'Student').trim() || 'Student';

    if (fromUrl && fromUrl.scores) {
      try {
        localStorage.removeItem('fw_hub_base_scores_v1');
        var stored = {
          name: userName,
          scores: fromUrl.scores,
          scoresRaw: fromUrl.scoresRaw || null,
          resumeSummary: fromUrl.resumeSummary || '',
          resumeBoosts: fromUrl.resumeBoosts || {},
          characterSummary: fromUrl.characterSummary || '',
          customAnswers: fromUrl.customAnswers || [],
          enrichBoosts: fromUrl.enrichBoosts || {},
          profile: fromUrl.profile || null,
        };
        if (window.FWSectorFitSheet && typeof FWSectorFitSheet.ensureSectorFitSheet === 'function') {
          FWSectorFitSheet.ensureSectorFitSheet(stored);
        }
        localStorage.setItem(HUB_QUIZ_KEY, JSON.stringify(stored));
      } catch (e) { /* quota */ }
    }

    let hubQuizScores = null;
    var quizForScores = null;
    try {
      var rawQuiz = localStorage.getItem(HUB_QUIZ_KEY);
      if (rawQuiz) quizForScores = JSON.parse(rawQuiz);
    } catch (e) { /* ignore */ }
    if (!quizForScores && quizState) quizForScores = quizState;
    if (quizForScores && window.FWSectorFitSheet && typeof FWSectorFitSheet.ensureSectorFitSheet === 'function') {
      FWSectorFitSheet.ensureSectorFitSheet(quizForScores);
      try { localStorage.setItem(HUB_QUIZ_KEY, JSON.stringify(quizForScores)); } catch (e) { /* quota */ }
    }
    if (quizForScores && quizForScores.scores && typeof quizForScores.scores === 'object') {
      hubQuizScores = (window.FWSectorFitSheet && typeof FWSectorFitSheet.getCanonicalScores === 'function')
        ? FWSectorFitSheet.getCanonicalScores(quizForScores)
        : quizForScores.scores;
      applyQuizScores(hubQuizScores);
    }

    return {
      userName: userName,
      hubQuizScores: hubQuizScores,
      resumeSummary: (quizState && quizState.resumeSummary) || '',
      characterSummary: (quizState && quizState.characterSummary) || '',
      customAnswers: (quizState && quizState.customAnswers) || [],
      profileBuildingAnswers: profileBuildingAnswersFromState(quizState),
    };
  }

  function profileBuildingAnswersFromState(quizState) {
    if (!quizState || !quizState.profileBuilding) return [];
    if (window.FWAuth && typeof FWAuth.profileBuildingAnswersForApi === 'function') {
      return FWAuth.profileBuildingAnswersForApi(quizState.profileBuilding);
    }
    var pb = quizState.profileBuilding;
    if (!Array.isArray(pb.answers)) return [];
    return pb.answers.filter(function (a) { return a && a.prompt && a.answer; }).slice(0, 8);
  }

  window.FWHubCareers = {
    HUB_QUIZ_KEY: HUB_QUIZ_KEY,
    careers: careers,
    careerToQuizKeys: careerToQuizKeys,
    subBranchNames: subBranchNames,
    applyQuizScores: applyQuizScores,
    resetFitScores: resetFitScores,
    rankCareersFromQuizScores: rankCareersFromQuizScores,
    careersForIndustry: careersForIndustry,
    getCareerFitBreakdown: getCareerFitBreakdown,
    careerIdFromSlug: careerIdFromSlug,
    careerSlug: careerSlug,
    careerSlugById: careerSlugById,
    normalizeCareerSlug: normalizeCareerSlug,
    SLUG_ALIASES: SLUG_ALIASES,
    slugify: slugify,
    initPersonalization: initPersonalization,
    readQuizStateFromUrl: readQuizStateFromUrl
  };
})();
