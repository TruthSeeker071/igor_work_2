/* QZ_SALARY_TIERS loaded from salary-tiers.js */

const careers = {
  "product-management": { title: "Product Management", entrySalary: "$95k", midSalary: "$155k", seniorSalary: "$200k+", jobGrowth: "+12%", jobGrowthLabel: "Faster than average", technicalScore: 45, aiAutomation: 25, aiRiskLevel: "low",
    tagline: "Own the vision. Coordinate engineering, design, and business to ship products people love.",
    overview: "Product managers sit at the intersection of business, technology, and user experience. You define what gets built, why it matters, and how success is measured.",
    dayInLife: [{time:"9:00 AM",title:"Standup",desc:"Sync with engineering on sprint progress."},{time:"10:00 AM",title:"User research",desc:"Analyze interview transcripts and usage data."},{time:"11:30 AM",title:"Roadmap planning",desc:"Prioritize features based on impact and effort."},{time:"1:00 PM",title:"Design review",desc:"Give feedback on wireframes and prototypes."},{time:"3:00 PM",title:"Metrics deep-dive",desc:"Review product analytics and KPIs."},{time:"4:30 PM",title:"Strategy doc",desc:"Draft a product brief for next quarter."}],
    coreSkills: ["Strategic thinking","Data analysis","Communication"], otherSkills: ["SQL basics","Wireframing","A/B testing","Stakeholder management","User research","Agile/Scrum"],
    sidebar: {"Degree required":"Not strictly","Common majors":"Business, CS, Eng.","Remote availability":"High","Work-life balance":"Moderate","Travel":"Low"},
    aiOutlook: "AI will augment PMs by automating data analysis and generating PRDs, but strategic judgment and cross-functional leadership remain human.", aiTasks: [{task:"Writing PRDs",risk:"med"},{task:"User interview analysis",risk:"med"},{task:"Strategic prioritization",risk:"low"},{task:"Stakeholder alignment",risk:"low"},{task:"Competitive research",risk:"high"}]
  },
  "software-engineering": { title: "Software Engineering", entrySalary: "$105k", midSalary: "$165k", seniorSalary: "$220k+", jobGrowth: "+17%", jobGrowthLabel: "Much faster than average", technicalScore: 95, aiAutomation: 40, aiRiskLevel: "med",
    tagline: "Build the systems that power everything. From web apps to infrastructure to AI.",
    overview: "Software engineers design, build, and maintain code that runs applications, platforms, and systems. Strong problem-solving and comfort with ambiguity are essential.",
    dayInLife: [{time:"9:30 AM",title:"Code review",desc:"Review pull requests and leave feedback."},{time:"10:30 AM",title:"Feature dev",desc:"Write and test code for a new API endpoint."},{time:"12:00 PM",title:"Architecture",desc:"Whiteboard a scalable microservice approach."},{time:"1:30 PM",title:"Debugging",desc:"Fix a production performance issue."},{time:"3:00 PM",title:"Pair programming",desc:"Collaborate on a complex integration."},{time:"4:30 PM",title:"Deploy",desc:"Merge feature branch and monitor pipeline."}],
    coreSkills: ["Data structures","System design","Problem solving"], otherSkills: ["Git","Testing","Cloud (AWS/GCP)","Databases","APIs","CI/CD"],
    sidebar: {"Degree required":"Preferred","Common majors":"CS, Math, ECE","Remote availability":"Very high","Work-life balance":"Varies","Travel":"Minimal"},
    aiOutlook: "AI coding assistants handle boilerplate and testing, but complex system design and novel debugging remain human.", aiTasks: [{task:"Boilerplate code",risk:"high"},{task:"Unit tests",risk:"high"},{task:"Simple bug fixes",risk:"med"},{task:"System architecture",risk:"low"},{task:"Complex debugging",risk:"low"}]
  },
  "data-science": { title: "Data Science", entrySalary: "$90k", midSalary: "$140k", seniorSalary: "$185k+", jobGrowth: "+35%", jobGrowthLabel: "Much faster than average", technicalScore: 85, aiAutomation: 45, aiRiskLevel: "med",
    tagline: "Extract meaning from data. Build models that drive decisions across every industry.",
    overview: "Data scientists combine statistics, programming, and domain expertise to extract insights from complex datasets.",
    dayInLife: [{time:"9:00 AM",title:"Data exploration",desc:"SQL queries and Python scripts on a new dataset."},{time:"10:30 AM",title:"Model iteration",desc:"Tune hyperparameters and evaluate metrics."},{time:"12:00 PM",title:"Stakeholder meeting",desc:"Present findings to the marketing team."},{time:"1:30 PM",title:"Feature engineering",desc:"Create variables to improve predictions."},{time:"3:00 PM",title:"A/B test analysis",desc:"Determine statistical significance."},{time:"4:30 PM",title:"Documentation",desc:"Write up methodology and results."}],
    coreSkills: ["Statistics","Python / R","Machine learning"], otherSkills: ["SQL","Visualization","Deep learning","Experimental design","Feature engineering","Communication"],
    sidebar: {"Degree required":"Usually (MS preferred)","Common majors":"Stats, CS, Math","Remote availability":"High","Work-life balance":"Good","Travel":"Minimal"},
    aiOutlook: "AI automates EDA and basic modeling, but framing questions, designing experiments, and communicating insights remain human.", aiTasks: [{task:"Exploratory analysis",risk:"high"},{task:"Basic modeling",risk:"high"},{task:"Experiment design",risk:"low"},{task:"Communication",risk:"low"},{task:"Feature engineering",risk:"med"}]
  },
  "ux-design": { title: "UX Design", entrySalary: "$75k", midSalary: "$120k", seniorSalary: "$165k+", jobGrowth: "+16%", jobGrowthLabel: "Much faster than average", technicalScore: 35, aiAutomation: 30, aiRiskLevel: "low",
    tagline: "Shape how people experience products. Research, prototype, and design with empathy.",
    overview: "UX designers research user needs, create wireframes and prototypes, and conduct usability testing to ensure products are intuitive.",
    dayInLife: [{time:"9:00 AM",title:"User interviews",desc:"Moderated research sessions."},{time:"10:30 AM",title:"Synthesis",desc:"Organize notes into insight statements."},{time:"12:00 PM",title:"Wireframing",desc:"Sketch flows for onboarding."},{time:"1:30 PM",title:"Design critique",desc:"Present work for feedback."},{time:"3:00 PM",title:"Prototyping",desc:"Interactive prototypes in Figma."},{time:"4:30 PM",title:"Handoff",desc:"Annotate designs for engineering."}],
    coreSkills: ["User research","Interaction design","Prototyping"], otherSkills: ["Figma/Sketch","Info architecture","Usability testing","Design systems","Accessibility","Visual design"],
    sidebar: {"Degree required":"No (portfolio matters)","Common majors":"Design, HCI, Psych","Remote availability":"High","Work-life balance":"Good","Travel":"Low"},
    aiOutlook: "AI generates UI layouts but understanding human behavior and crafting cohesive experiences remain human.", aiTasks: [{task:"UI mockups",risk:"med"},{task:"Asset creation",risk:"high"},{task:"Research synthesis",risk:"low"},{task:"Design systems",risk:"low"},{task:"Usability testing",risk:"low"}]
  },
  "management-consulting": { title: "Management Consulting", entrySalary: "$95k", midSalary: "$160k", seniorSalary: "$250k+", jobGrowth: "+10%", jobGrowthLabel: "Average", technicalScore: 30, aiAutomation: 30, aiRiskLevel: "low",
    tagline: "Solve business problems for the world's largest organizations.",
    overview: "Consultants help organizations solve complex strategic, operational, and organizational challenges.",
    dayInLife: [{time:"8:30 AM",title:"Team check-in",desc:"Align on workstream progress."},{time:"9:30 AM",title:"Client interviews",desc:"Understand department pain points."},{time:"11:00 AM",title:"Analysis",desc:"Build financial models in Excel."},{time:"1:00 PM",title:"Slide creation",desc:"Structure findings into a deck."},{time:"3:00 PM",title:"Working session",desc:"Collaborate on implementation plan."},{time:"5:00 PM",title:"Partner review",desc:"Present draft recommendations."}],
    coreSkills: ["Structured thinking","Communication","Business acumen"], otherSkills: ["Excel modeling","Slide storytelling","Market sizing","Stakeholder management","Research","Implementation"],
    sidebar: {"Degree required":"Usually (MBA common)","Common majors":"Business, Econ, Eng.","Remote availability":"Low","Work-life balance":"Demanding","Travel":"Heavy"},
    aiOutlook: "AI accelerates research and analysis, but relationship-driven advisory and organizational judgment remain human.", aiTasks: [{task:"Market research",risk:"high"},{task:"Data analysis",risk:"med"},{task:"Client relationships",risk:"low"},{task:"Org diagnosis",risk:"low"},{task:"Deck creation",risk:"med"}]
  },
  "investment-banking": { title: "Investment Banking", entrySalary: "$110k", midSalary: "$200k", seniorSalary: "$400k+", jobGrowth: "+7%", jobGrowthLabel: "Average", technicalScore: 55, aiAutomation: 35, aiRiskLevel: "med",
    tagline: "Advise corporations on M&A, capital raises, and high-stakes financial transactions.",
    overview: "Investment bankers advise companies on mergers, acquisitions, IPOs, and debt offerings. Hours are long but compensation is top-tier.",
    dayInLife: [{time:"9:00 AM",title:"Market briefing",desc:"Review overnight market moves."},{time:"10:00 AM",title:"Financial modeling",desc:"Build a DCF for an acquisition target."},{time:"12:00 PM",title:"Pitch book",desc:"Create slides for client presentation."},{time:"2:00 PM",title:"Due diligence",desc:"Discuss findings with lawyers."},{time:"4:00 PM",title:"Comp analysis",desc:"Update comparable transactions."},{time:"7:00 PM",title:"VP review",desc:"Finalize deliverables."}],
    coreSkills: ["Financial modeling","Valuation","Attention to detail"], otherSkills: ["Excel (advanced)","PowerPoint","Accounting","Capital markets","M&A process","Due diligence"],
    sidebar: {"Degree required":"Yes","Common majors":"Finance, Econ","Remote availability":"Low","Work-life balance":"Very demanding","Travel":"Moderate"},
    aiOutlook: "AI automates comp tables and data room review, but deal negotiation and client advisory are deeply human.", aiTasks: [{task:"Comp tables",risk:"high"},{task:"Data room review",risk:"high"},{task:"Financial modeling",risk:"med"},{task:"Deal negotiation",risk:"low"},{task:"Client advisory",risk:"low"}]
  },
  "marketing-strategy": { title: "Marketing Strategy", entrySalary: "$65k", midSalary: "$115k", seniorSalary: "$165k+", jobGrowth: "+10%", jobGrowthLabel: "Average", technicalScore: 30, aiAutomation: 45, aiRiskLevel: "med",
    tagline: "Drive growth by understanding markets, positioning brands, and optimizing channels.",
    overview: "Marketing strategists develop go-to-market plans, define brand positioning, and optimize acquisition channels.",
    dayInLife: [{time:"9:00 AM",title:"Performance review",desc:"Analyze campaign dashboards."},{time:"10:00 AM",title:"Channel planning",desc:"Allocate budget across channels."},{time:"11:30 AM",title:"Creative brief",desc:"Write brief for brand campaign."},{time:"1:00 PM",title:"Content review",desc:"Review blog posts and ad creatives."},{time:"2:30 PM",title:"Competitive intel",desc:"Research competitor positioning."},{time:"4:00 PM",title:"Strategy meeting",desc:"Present Q3 growth plan."}],
    coreSkills: ["Brand strategy","Data analysis","Creative direction"], otherSkills: ["Google Analytics","Paid media","SEO","Content strategy","CRM","Market research"],
    sidebar: {"Degree required":"No","Common majors":"Marketing, Comms","Remote availability":"High","Work-life balance":"Good","Travel":"Low"},
    aiOutlook: "AI transforms ad copy and targeting, but brand strategy and cultural understanding require human judgment.", aiTasks: [{task:"Ad copy",risk:"high"},{task:"Reporting",risk:"high"},{task:"Brand strategy",risk:"low"},{task:"Creative direction",risk:"low"},{task:"Segmentation",risk:"med"}]
  },
  "business-analytics": { title: "Business Analytics", entrySalary: "$70k", midSalary: "$115k", seniorSalary: "$155k+", jobGrowth: "+23%", jobGrowthLabel: "Much faster than average", technicalScore: 60, aiAutomation: 50, aiRiskLevel: "med",
    tagline: "Turn data into decisions. Help organizations find opportunities.",
    overview: "Business analysts bridge data and decision-making with dashboards, trend analysis, and compelling data storytelling.",
    dayInLife: [{time:"9:00 AM",title:"Dashboard check",desc:"Review overnight metrics."},{time:"10:00 AM",title:"SQL queries",desc:"Pull data for churn analysis."},{time:"11:30 AM",title:"Stakeholder sync",desc:"Clarify reporting requirements."},{time:"1:00 PM",title:"Visualization",desc:"Build charts in Tableau."},{time:"2:30 PM",title:"Root cause analysis",desc:"Investigate conversion drop."},{time:"4:00 PM",title:"Recommendation doc",desc:"Write up findings."}],
    coreSkills: ["SQL","Data visualization","Business acumen"], otherSkills: ["Tableau","Excel","Python basics","Statistics","Communication","Process mapping"],
    sidebar: {"Degree required":"Preferred","Common majors":"Business, Econ, Stats","Remote availability":"High","Work-life balance":"Good","Travel":"Minimal"},
    aiOutlook: "AI automates routine dashboards and SQL, shifting the role toward strategic interpretation.", aiTasks: [{task:"Standard reporting",risk:"high"},{task:"SQL queries",risk:"high"},{task:"Dashboards",risk:"med"},{task:"Strategic interpretation",risk:"low"},{task:"Stakeholder advising",risk:"low"}]
  },
  "corporate-strategy": { title: "Corporate Strategy", entrySalary: "$90k", midSalary: "$150k", seniorSalary: "$220k+", jobGrowth: "+8%", jobGrowthLabel: "Average", technicalScore: 35, aiAutomation: 25, aiRiskLevel: "low",
    tagline: "Shape long-term company direction. Think like a CEO.",
    overview: "Corporate strategists evaluate market opportunities, support M&A, and define long-term business direction from inside the company.",
    dayInLife: [{time:"9:00 AM",title:"Industry scan",desc:"Review market reports."},{time:"10:30 AM",title:"CEO prep",desc:"Draft board meeting talking points."},{time:"12:00 PM",title:"M&A screening",desc:"Evaluate acquisition targets."},{time:"1:30 PM",title:"Cross-functional",desc:"Align product and finance."},{time:"3:00 PM",title:"Scenario modeling",desc:"Build financial scenarios."},{time:"4:30 PM",title:"Strategy memo",desc:"Write expansion recommendation."}],
    coreSkills: ["Strategic frameworks","Financial analysis","Executive communication"], otherSkills: ["Market sizing","Competitive intel","M&A evaluation","Scenario planning","Board presentations","Cross-functional leadership"],
    sidebar: {"Degree required":"Usually (MBA)","Common majors":"Business, Econ, Eng.","Remote availability":"Moderate","Work-life balance":"Moderate","Travel":"Low-moderate"},
    aiOutlook: "AI speeds research and modeling, but strategic judgment and executive influence remain deeply human.", aiTasks: [{task:"Competitive research",risk:"high"},{task:"Market sizing",risk:"med"},{task:"Executive recs",risk:"low"},{task:"Org alignment",risk:"low"},{task:"Scenario modeling",risk:"med"}]
  },
  "financial-analysis": { title: "Financial Analysis", entrySalary: "$65k", midSalary: "$105k", seniorSalary: "$150k+", jobGrowth: "+9%", jobGrowthLabel: "Average", technicalScore: 50, aiAutomation: 55, aiRiskLevel: "med",
    tagline: "Forecast, budget, and analyze financial performance.",
    overview: "Financial analysts prepare budgets, forecasts, and variance analyses that help organizations allocate resources.",
    dayInLife: [{time:"8:30 AM",title:"Month-end close",desc:"Reconcile accounts."},{time:"10:00 AM",title:"Variance analysis",desc:"Investigate budget differences."},{time:"11:30 AM",title:"Forecasting",desc:"Update rolling 12-month forecast."},{time:"1:00 PM",title:"Business partner",desc:"Walk ops through their P&L."},{time:"2:30 PM",title:"Modeling",desc:"Scenario model for headcount."},{time:"4:00 PM",title:"CFO deck",desc:"Prepare weekly financial summary."}],
    coreSkills: ["Financial modeling","Excel","Accounting"], otherSkills: ["ERP systems","Forecasting","Variance analysis","Budgeting","Visualization","Business partnering"],
    sidebar: {"Degree required":"Preferred","Common majors":"Finance, Accounting","Remote availability":"Moderate","Work-life balance":"Good","Travel":"Minimal"},
    aiOutlook: "Routine reports and forecasting are increasingly automatable. Role is shifting toward strategic finance partnering.", aiTasks: [{task:"Report generation",risk:"high"},{task:"Variance explanations",risk:"high"},{task:"Forecasting",risk:"med"},{task:"Business partnering",risk:"low"},{task:"Strategic planning",risk:"low"}]
  },
  "healthcare-admin": { title: "Healthcare Administration", entrySalary: "$60k", midSalary: "$95k", seniorSalary: "$145k+", jobGrowth: "+28%", jobGrowthLabel: "Much faster than average", technicalScore: 20, aiAutomation: 20, aiRiskLevel: "low",
    tagline: "Run the business side of healthcare.",
    overview: "Healthcare administrators manage operations, finances, staffing, and regulatory compliance of hospitals and health systems.",
    dayInLife: [{time:"8:00 AM",title:"Ops huddle",desc:"Review patient volume and staffing."},{time:"9:30 AM",title:"Budget review",desc:"Analyze department spending."},{time:"11:00 AM",title:"Compliance",desc:"Review HIPAA documentation."},{time:"1:00 PM",title:"Vendor negotiation",desc:"Renegotiate supply contracts."},{time:"2:30 PM",title:"Staff meeting",desc:"Address operational concerns."},{time:"4:00 PM",title:"Quality metrics",desc:"Review patient satisfaction scores."}],
    coreSkills: ["Healthcare operations","Regulatory knowledge","Leadership"], otherSkills: ["Budgeting","HIPAA","EHR systems","Staff management","Policy analysis","Quality improvement"],
    sidebar: {"Degree required":"Usually (MHA/MBA)","Common majors":"Health Admin, Public Health","Remote availability":"Low","Work-life balance":"Moderate","Travel":"Low"},
    aiOutlook: "AI helps with scheduling and claims, but heavy human interaction and regulatory judgment make this highly AI-resilient.", aiTasks: [{task:"Scheduling",risk:"med"},{task:"Claims processing",risk:"med"},{task:"Staff management",risk:"low"},{task:"Regulatory compliance",risk:"low"},{task:"Stakeholder relations",risk:"low"}]
  },
  "legal-operations": { title: "Legal Operations", entrySalary: "$70k", midSalary: "$120k", seniorSalary: "$170k+", jobGrowth: "+14%", jobGrowthLabel: "Faster than average", technicalScore: 30, aiAutomation: 35, aiRiskLevel: "med",
    tagline: "Optimize how legal teams work. Bridge law, business, and technology.",
    overview: "Legal ops manages budgets, technology, vendor management, and process improvement for legal departments.",
    dayInLife: [{time:"9:00 AM",title:"Budget tracking",desc:"Review outside counsel spend."},{time:"10:00 AM",title:"Process design",desc:"Map contract review workflow."},{time:"11:30 AM",title:"Tech evaluation",desc:"Demo a new CLM platform."},{time:"1:00 PM",title:"Vendor management",desc:"Negotiate law firm rates."},{time:"2:30 PM",title:"Reporting",desc:"Build dashboard for GC."},{time:"4:00 PM",title:"Cross-functional",desc:"Align with procurement on templates."}],
    coreSkills: ["Process optimization","Vendor management","Legal technology"], otherSkills: ["Contract lifecycle mgmt.","Budget management","Analytics","Project management","Legal knowledge","Change management"],
    sidebar: {"Degree required":"No","Common majors":"Business, Pre-law, Ops","Remote availability":"High","Work-life balance":"Good","Travel":"Low"},
    aiOutlook: "AI is transforming contract review and legal research. Legal ops professionals who implement these tools will be in high demand.", aiTasks: [{task:"Contract review",risk:"high"},{task:"Legal research",risk:"high"},{task:"Process optimization",risk:"low"},{task:"Vendor relations",risk:"low"},{task:"Tech strategy",risk:"low"}]
  }
};

const studentCareers = ["product-management","software-engineering","data-science","ux-design","management-consulting","investment-banking","marketing-strategy","business-analytics"];
const educatorCareers = [...studentCareers,"corporate-strategy","financial-analysis","healthcare-admin","legal-operations"];

function renderCareerChips(id, list) {
  const el = document.getElementById(id); if (!el) return;
  el.innerHTML = list.map(k => {
    const c = careers[k];
    return `<div class="career-chip" onclick="showCareer('${k}','${id==='student-careers'?'students':'educators'}')"><h5>${c.title}</h5><span class="salary">${c.entrySalary} &ndash; ${c.seniorSalary}</span><span class="chip-arrow">View deep dive &rarr;</span></div>`;
  }).join('');
}

function careerBackHtml(backTo) {
  if (backTo === 'hub') {
    return '<div class="career-hero-top"><a class="back-btn career-back-link" href="dashboard.html"><span aria-hidden="true">←</span> Career Hub</a></div>';
  }
  return '<div class="career-hero-top"><button type="button" class="back-btn career-back-link" onclick="showPage(\'' + backTo + '\')"><span aria-hidden="true">←</span> Back</button></div>';
}

function metricDisplay(val, fallback) {
  if (val == null || val === '' || String(val) === 'undefined') return fallback != null ? fallback : '—';
  return val;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildOnetShell(row) {
  if (!row) return null;
  if (window.FWHubStaticMetrics && typeof FWHubStaticMetrics.buildOnetDeepDiveProfile === 'function') {
    return FWHubStaticMetrics.buildOnetDeepDiveProfile(row);
  }
  const metrics = window.FWHubStaticMetrics ? FWHubStaticMetrics.forOnetRow(row) : null;
  const desc = row.description || row.title;
  const tagline = desc.split('.')[0] + (desc.indexOf('.') >= 0 ? '.' : '');
  const base = {
    title: row.title,
    tagline: tagline,
    overview: desc,
    dayInLife: [],
    coreSkills: [],
    otherSkills: [],
    aiTasks: [],
    sidebar: { Sector: row.hubZone || '—' },
  };
  return metrics ? Object.assign(base, metrics) : base;
}

function showCareer(key, backTo, opts) {
  opts = opts || {};
  const socParam = opts.soc || '';
  let c = careers[key] || (window.FWHubDeepDives && FWHubDeepDives[key]);
  if (!c && window.FWOnetCatalog) {
    const row = (socParam && FWOnetCatalog.getBySoc)
      ? FWOnetCatalog.getBySoc(socParam)
      : (FWOnetCatalog.getBySlug ? FWOnetCatalog.getBySlug(key) : null);
    if (row) c = buildOnetShell(row);
  }
  if (!c) return;
  const contentEl = document.getElementById('career-content');
  if (!contentEl) {
    var careerUrl = ((window.FWPageBoot && FWPageBoot.URLS.career) || 'career.html')
      + '?slug=' + encodeURIComponent(key);
    if (socParam) careerUrl += '&soc=' + encodeURIComponent(socParam);
    location.href = careerUrl;
    return;
  }
  const dayLife = Array.isArray(c.dayInLife) ? c.dayInLife : [];
  const coreSkills = Array.isArray(c.coreSkills) ? c.coreSkills : [];
  const otherSkills = Array.isArray(c.otherSkills) ? c.otherSkills : [];
  const aiTasks = Array.isArray(c.aiTasks) ? c.aiTasks : [];
  const aiAuto = metricDisplay(c.aiAutomation, 28);
  const techScore = metricDisplay(c.technicalScore, 40);
  const aiBarClass = Number(aiAuto) <= 30 ? 'ai-bar-low' : Number(aiAuto) <= 50 ? 'ai-bar-med' : 'ai-bar-high';
  const proxyNote = c.derivedNote
    ? '<p class="career-proxy-note fade-in" data-career-proxy-note>' + String(c.derivedNote).replace(/</g, '&lt;') + '</p>'
    : '<p class="career-proxy-note fade-in" data-career-proxy-note hidden></p>';
  let fitScore = c.fitScore != null ? c.fitScore : null;
  if (fitScore == null && window.FWHubCareers && FWHubCareers.careerSlug) {
    const hubCareer = FWHubCareers.careers.find(function (h) { return FWHubCareers.careerSlug(h.id) === key; });
    if (hubCareer) fitScore = hubCareer.fitScore;
  }
  var roadmapHref = 'roadmap.html?career=' + encodeURIComponent(key);
  if (socParam) roadmapHref += '&soc=' + encodeURIComponent(socParam);
  var onetEyebrow = 'Career Deep Dive';
  // Provenance for "Additional Careers" (AI-derived, not in O*NET). Resolve the
  // catalog row by SOC/slug so the line renders even when `c` came from a
  // static deep-dive map rather than a live catalog row.
  var provRow = window.FWOnetCatalog
    ? ((socParam && FWOnetCatalog.getBySoc && FWOnetCatalog.getBySoc(socParam))
      || (FWOnetCatalog.getBySlug && FWOnetCatalog.getBySlug(key)))
    : null;
  var provenanceHtml = '';
  if (provRow && provRow.aiDerived) {
    var baseTitle = provRow.derivedFrom && provRow.derivedFrom.title
      ? esc(provRow.derivedFrom.title) : '';
    provenanceHtml = '<p class="career-ai-derived fade-in" data-career-ai-derived>AI-derived'
      + (baseTitle ? ' from ' + baseTitle : '') + '</p>';
  }
  var skillsPlaceholder = coreSkills.length
    ? coreSkills.concat(otherSkills).map(function (s) {
      return '<span class="skill-pill" style="--skill-fill:0%"><span class="skill-pill-fill" aria-hidden="true"></span><span class="skill-pill-label">' + esc(s) + '</span></span>';
    }).join('')
    : '<span class="skill-pill skill-pill--skeleton fw-skeleton" aria-hidden="true"></span>'
      + '<span class="skill-pill skill-pill--skeleton fw-skeleton" aria-hidden="true"></span>'
      + '<span class="skill-pill skill-pill--skeleton fw-skeleton" aria-hidden="true"></span>';
  document.getElementById('career-content').innerHTML = `
    <section class="career-hero">${careerBackHtml(backTo)}<div class="career-hero-eyebrow fade-in"><span class="section-tag career-eyebrow-tag">${onetEyebrow}<span id="career-personal-suffix" hidden> · Personalized for you</span></span></div><h1 class="fade-in">${esc(c.title)}</h1>${provenanceHtml}<p class="tagline fade-in">${esc(c.tagline)}</p>
      ${proxyNote}
      <div class="metrics-row fade-in">
        <div class="metric-card"><div class="metric-label">Entry Salary</div><div class="metric-value" data-career-metric="entrySalary">${metricDisplay(c.entrySalary)}</div><div class="metric-sub">0-2 years</div></div>
        <div class="metric-card"><div class="metric-label">Mid-Career</div><div class="metric-value" data-career-metric="midSalary">${metricDisplay(c.midSalary)}</div><div class="metric-sub">5-10 years</div></div>
        <div class="metric-card"><div class="metric-label">Job Growth (10yr)</div><div class="metric-value" data-career-metric="jobGrowth">${metricDisplay(c.jobGrowth)}</div><div class="metric-sub" data-career-metric="jobGrowthLabel">${metricDisplay(c.jobGrowthLabel, '')}</div></div>
        <div class="metric-card"><div class="metric-label">Technical Level</div><div class="metric-value"><span data-career-metric="technicalScore">${techScore}</span><span class="metric-technical-suffix" style="font-size:0.9rem;font-family:Inter;font-weight:400;color:var(--text-tertiary)">/100</span></div><div class="scale-bar-container"><div class="scale-bar"><div class="scale-bar-fill" data-career-tech-bar style="width:0%" data-target="${techScore}"></div></div><div class="scale-bar-labels"><span>Non-technical</span><span>Highly technical</span></div></div></div>
        <div class="metric-card" data-career-ai-metric><div class="metric-label">AI Exposure</div><div class="metric-value"><span data-career-ai-risk>${aiAuto}</span><span style="font-size:0.9rem;font-family:Inter;font-weight:400;color:var(--text-tertiary)">%</span></div><div class="scale-bar-container"><div class="scale-bar"><div class="scale-bar-fill ${aiBarClass}" data-career-ai-bar style="width:0%" data-target="${aiAuto}"></div></div><div class="scale-bar-labels"><span>Lower exposure</span><span>Higher exposure</span></div></div></div>
      </div></section>
    <section class="career-section career-overview-section"><div class="section-inner"><div class="overview-grid"><div class="overview-text career-card fade-in" data-career-personal="overview"><h3 class="career-card-title">What you'll actually do</h3><p>${c.overview}</p><div class="overview-resp" data-career-personal-resp hidden><h4 class="career-card-title">Core responsibilities</h4><ul class="career-resp-list" data-career-personal="responsibilities"></ul></div></div><div class="overview-sidebar career-card fade-in"><h4 class="career-card-title">Quick facts</h4><div data-career-personal="quickFacts">${Object.entries(c.sidebar).map(([l,v])=>`<div class="sidebar-item"><span class="label">${l}</span><span class="value${l==='O*NET SOC'?' sidebar-value--soc':''}">${v}</span></div>`).join('')}</div></div></div></div></section>
    <section class="career-section career-onet-block career-section--disclosure" data-career-onet-section${socParam ? '' : ' hidden'}><div class="section-inner"><details class="career-disclosure"><summary class="career-disclosure-summary"><span class="career-card-title">O*NET Profile — what this role requires</span><span class="career-disclosure-hint"><span class="cd-label cd-show">Show</span><span class="cd-label cd-hide">Hide</span></span></summary><div class="career-disclosure-body"><div class="onet-profile-card fade-in"><div class="onet-profile-tabs" data-career-onet="profileTabs" role="tablist"></div><div class="onet-domain-pills" data-career-onet="profilePanels"></div></div></div></details></div></section>
    <section class="career-section career-onet-block career-section--disclosure" data-career-onet="matchSection" hidden><div class="section-inner"><details class="career-disclosure"><summary class="career-disclosure-summary"><span class="career-card-title">How you compare on O*NET dimensions</span><span class="career-disclosure-hint"><span class="cd-label cd-show">Show</span><span class="cd-label cd-hide">Hide</span></span></summary><div class="career-disclosure-body"><p class="onet-match-note fade-in">“You” blends resume/academic background (75%) and quiz personality (25%) when available.</p><div class="onet-profile-card onet-match-panel fade-in"><div data-career-onet="matchPanel"><p class="onet-dim-empty">Sign in and complete the quiz to see your O*NET match profile.</p></div></div></div></details></div></section>
    <section class="career-fit-section" style="display:none"><div class="section-inner"><div class="career-fit-header fade-in"><h2 class="career-card-title">How this career fits you</h2></div><div class="fit-analysis-stack fade-in"><div class="fit-panel fit-panel--assessed" data-career-personal="assessedFit"></div><div class="fit-panel fit-panel--ai" data-career-personal="aiProfile" hidden></div></div></div></section>
    <div class="career-pair-grid">
      <section class="career-section career-related-section" data-career-personal="relatedCareers" hidden><div class="section-inner"><h2 class="career-card-title fade-in">You might also consider</h2><div class="career-related-chips fade-in" data-career-personal="relatedList"></div></div></section>
      <section class="career-section"><div class="section-inner"><h2 class="career-card-title fade-in">Skills you need to learn</h2><div class="skills-pills fade-in" data-career-personal="skills">${skillsPlaceholder}</div></div></section>
    </div>
    <section class="career-section"><div class="section-inner"><h2 class="career-card-title fade-in">A day in the life</h2><div class="timeline fade-in" data-career-personal="daySchedule">${dayLife.map(i=>`<div class="timeline-item"><div class="timeline-time">${i.time}</div><div class="timeline-content"><h5>${i.title}</h5><p>${i.desc}</p></div></div>`).join('')}</div><p class="day-schedule-note" data-career-personal="dayScheduleNote" hidden></p><div class="fade-in career-day-cta"><a class="cta-btn" href="simulation.html?slug=${encodeURIComponent(key)}">Don’t just read the day — try it (2 min) →</a></div></div></section>
    <section class="cta-section"><div class="section-inner"><h2 class="section-title fade-in">Interested in ${esc(c.title)}?</h2><div class="fade-in cta-row"><a class="cta-btn" href="${roadmapHref}">Build Career Roadmap</a><a class="cta-btn cta-btn-outline" href="quiz.html">Take the Career Quiz</a><a class="cta-btn cta-btn-outline" href="coach.html">Talk to Marco</a><a class="cta-btn cta-btn-outline" href="simulation.html?slug=${encodeURIComponent(key)}">Try This Career</a></div></div></section>`;
  if (typeof showPage === 'function') showPage('career');
  if (window.FWPageVeil) FWPageVeil.release();
  setTimeout(()=>{document.querySelectorAll('.scale-bar-fill[data-target],.ai-bar-big-fill[data-target]').forEach(b=>{b.style.width=b.dataset.target+'%'});},400);
  if (window.FWCareerPersonalize) {
    FWCareerPersonalize.hydrateDeepDive(key, c.title, fitScore, {
      entrySalary: c.entrySalary,
      midSalary: c.midSalary,
      seniorSalary: c.seniorSalary,
      jobGrowth: c.jobGrowth,
      jobGrowthLabel: c.jobGrowthLabel,
      technicalScore: c.technicalScore,
      aiAutomation: c.aiAutomation,
      aiOutlook: c.aiOutlook,
      aiTasks: c.aiTasks,
      sidebar: c.sidebar,
      coreSkills: c.coreSkills,
    }, { soc: socParam });
  }
}

let qzOrigin = 'index';
let _dfPrevPage = 'index';

function qzGoBack() {
  var origin = qzOrigin || '';
  if (origin === 'portal' || origin === 'roadmap' || origin === 'coach') {
    showPage(origin);
    try { history.replaceState(null, '', '#' + origin); } catch (_) { /* ignore */ }
    return;
  }
  window.location.href = 'index.html';
}

function showPage(page) {
  if (page === 'quiz') qzOrigin = _dfPrevPage;
  if (page === 'profile-build' && window.FWProfileBuilding && typeof FWProfileBuilding.render === 'function') {
    FWProfileBuilding.render();
  }
  if (page === 'portal' && window.FWPortal && typeof FWPortal.render === 'function') {
    FWPortal.render();
  }
  if (page === 'roadmap' && window.FWRoadmap && typeof FWRoadmap.render === 'function') {
    FWRoadmap.render();
  }
  _dfPrevPage = page;
  if (page !== 'roadmap') {
    if (window.FWRoadmapTree && typeof FWRoadmapTree.closeDrawer === 'function') {
      FWRoadmapTree.closeDrawer();
    }
    if (window.FWRoadmap && typeof FWRoadmap.closeRefineChat === 'function') {
      FWRoadmap.closeRefineChat();
    }
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  if (!el) return;
  el.classList.add('active');
  if (page !== 'roadmap' && window.FWRoadmap && typeof FWRoadmap.syncRefineFabVisibility === 'function') {
    FWRoadmap.syncRefineFabVisibility();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (window.FWAppNav) {
    var navKey = page === 'coach' ? 'advisor' : page === 'quiz' ? 'quiz' : page === 'roadmap' ? 'roadmap' : null;
    FWAppNav.sync(navKey);
  }
  setTimeout(() => {
    observeElements();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }, 200);
}

function observeElements() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.fade-in:not(.visible)').forEach(el => obs.observe(el));
}

document.querySelectorAll('.quiz-item').forEach(item => {
  item.addEventListener('click', function() {
    this.parentElement.querySelectorAll('.quiz-item').forEach(i => i.classList.remove('selected'));
    this.classList.add('selected');
  });
});

renderCareerChips('educator-careers', educatorCareers);
observeElements();

// Initialize Lucide icons
if (typeof lucide !== 'undefined') lucide.createIcons();
