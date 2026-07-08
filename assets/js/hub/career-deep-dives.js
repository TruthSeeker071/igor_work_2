/**
 * Deep-dive profiles for all Career Hub careers.
 * Loaded after hub-careers.js; consumed by showCareer() in app-pages.js.
 */
(function () {
  if (!window.FWHubCareers) return;

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
    Hospitality: ['$42k', '$70k', '$115k+']
  };

  const TECH_SCORE = {
    Technology: 88, Finance: 52, Healthcare: 48, Education: 22, Law: 28,
    Government: 25, Creative: 32, Trades: 55, Design: 40, Media: 28,
    Business: 35, Engineering: 72, 'Social Impact': 18, Science: 65,
    Hospitality: 20
  };

  function titleCase(s) {
    return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function dayTemplate(career) {
    return [
      { time: '9:00 AM', title: 'Morning focus', desc: 'Tackle the highest-priority work for your ' + career.name.toLowerCase() + ' role.' },
      { time: '11:00 AM', title: 'Collaboration', desc: 'Meet with teammates or stakeholders to align on next steps.' },
      { time: '1:00 PM', title: 'Deep work', desc: 'Apply your core skills in ' + (career.skills[0] || 'your specialty') + ' to move projects forward.' },
      { time: '3:00 PM', title: 'Review & refine', desc: 'Iterate on deliverables, documentation, or client-facing output.' },
      { time: '4:30 PM', title: 'Plan ahead', desc: 'Set priorities for tomorrow and capture lessons from today.' }
    ];
  }

  function buildProfile(career) {
    const sal = SALARY[career.industry] || ['$50k', '$85k', '$125k+'];
    const core = career.skills.slice(0, 3).map(titleCase);
    const tech = TECH_SCORE[career.industry] || 40;
    const aiAuto = tech > 70 ? 42 : tech > 45 ? 32 : 22;
    return {
      title: career.name,
      entrySalary: sal[0],
      midSalary: sal[1],
      seniorSalary: sal[2],
      jobGrowth: '+11%',
      jobGrowthLabel: 'Faster than average',
      technicalScore: tech,
      aiAutomation: aiAuto,
      aiRiskLevel: aiAuto > 45 ? 'med' : 'low',
      tagline: career.description.split('.')[0] + '.',
      overview: career.description,
      dayInLife: dayTemplate(career),
      coreSkills: core.length ? core : ['Communication', 'Problem solving', 'Focus'],
      otherSkills: career.skills.map(titleCase),
      sidebar: {
        'Degree required': 'Varies by employer',
        'Common majors': career.industry,
        'Remote availability': career.industry === 'Technology' ? 'High' : 'Moderate',
        'Work-life balance': 'Varies',
        Travel: career.industry === 'Finance' ? 'Moderate' : 'Low'
      },
      aiOutlook: 'AI will automate routine tasks in ' + career.name.toLowerCase() + ' workflows, but judgment, relationships, and domain expertise remain distinctly human.',
      aiTasks: [
        { task: 'Routine reporting', risk: 'high' },
        { task: 'Research & drafts', risk: 'med' },
        { task: 'Stakeholder relationships', risk: 'low' },
        { task: 'Strategic decisions', risk: 'low' },
        { task: 'Quality review', risk: 'med' }
      ]
    };
  }

  const profiles = {};
  FWHubCareers.careers.forEach(function (c) {
    const slug = FWHubCareers.careerSlug(c.id);
    profiles[slug] = buildProfile(c);
  });

  if (FWHubCareers.SLUG_ALIASES) {
    Object.keys(FWHubCareers.SLUG_ALIASES).forEach(function (oldKey) {
      const target = FWHubCareers.SLUG_ALIASES[oldKey];
      if (profiles[target] && !profiles[oldKey]) profiles[oldKey] = profiles[target];
    });
  }

  function buildZoneMetrics(hubZone, careerName) {
    const HUB_ZONE_TO_INDUSTRY = {
      tech: 'Technology', cybersecurity: 'Technology', healthcare: 'Healthcare',
      finance: 'Finance', science: 'Science', engineering: 'Engineering',
      creative: 'Creative', business: 'Business', marketing: 'Creative',
      education: 'Education', law: 'Law', social: 'Social Impact', media: 'Media',
      government: 'Government', operations: 'Business', trades: 'Trades',
      agriculture: 'Science', hospitality: 'Hospitality',
    };
    const industry = HUB_ZONE_TO_INDUSTRY[String(hubZone || '').toLowerCase()];
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
      aiOutlook: 'AI will automate routine tasks in ' + name + ' workflows, but judgment, relationships, and domain expertise remain distinctly human.',
      aiTasks: [
        { task: 'Routine reporting', risk: 'high' },
        { task: 'Research & drafts', risk: 'med' },
        { task: 'Stakeholder relationships', risk: 'low' },
      ],
    };
  }

  var ZONE_LABELS = {
    tech: 'Tech', healthcare: 'Healthcare', finance: 'Finance', science: 'Science',
    engineering: 'Engineering', creative: 'Creative', business: 'Business',
    marketing: 'Marketing', education: 'Education', law: 'Law', social: 'Social',
    media: 'Media', government: 'Government', operations: 'Operations',
    trades: 'Trades', agriculture: 'Agriculture', cybersecurity: 'Cybersecurity',
    hospitality: 'Hospitality',
  };

  var JOB_ZONE_LABELS = {
    1: 'Zone 1 — Little preparation needed',
    2: 'Zone 2 — Some preparation needed',
    3: 'Zone 3 — Medium preparation needed',
    4: 'Zone 4 — Considerable preparation needed',
    5: 'Zone 5 — Extensive preparation needed',
  };

  var JOB_ZONE_EDUCATION = {
    1: 'High school or less',
    2: 'High school + training',
    3: 'Associate degree or equivalent',
    4: "Bachelor's degree typical",
    5: 'Graduate degree typical',
  };

  var COLLAR_LABELS = {
    gold: 'Professional (gold collar)',
    blue: 'Skilled trades (blue collar)',
    new: 'Emerging / hybrid (new collar)',
  };

  function zoneDisplayLabel(hubZone) {
    if (window.FWHubZoneFit && typeof FWHubZoneFit.zoneLabel === 'function') {
      return FWHubZoneFit.zoneLabel(hubZone);
    }
    return ZONE_LABELS[String(hubZone || '').toLowerCase()]
      || titleCase(String(hubZone || '').replace(/-/g, ' '));
  }

  function derivedNoteForSoc(soc) {
    if (!soc || !window.FWOnetCatalog) return '';
    var map = FWOnetCatalog.getHubMap ? FWOnetCatalog.getHubMap() : null;
    if (!map || !map.careers) return '';
    var keys = Object.keys(map.careers);
    for (var i = 0; i < keys.length; i += 1) {
      var entry = map.careers[keys[i]];
      if (!entry || !entry.derivedNote || !entry.socs) continue;
      for (var j = 0; j < entry.socs.length; j += 1) {
        if (entry.socs[j] && entry.socs[j].soc === soc) return entry.derivedNote;
      }
    }
    return '';
  }

  function buildOnetDeepDiveProfile(row) {
    if (!row) return null;
    var metrics = buildZoneMetrics(row.hubZone, row.title) || {
      entrySalary: '—',
      midSalary: '—',
      seniorSalary: '—',
      jobGrowth: '—',
      jobGrowthLabel: '—',
      technicalScore: 40,
      aiAutomation: 28,
      aiOutlook: 'Automation risk varies by task mix in this role.',
      aiTasks: [
        { task: 'Routine reporting', risk: 'high' },
        { task: 'Research & drafts', risk: 'med' },
        { task: 'Stakeholder relationships', risk: 'low' },
      ],
    };
    var desc = row.description || row.title || '';
    var dotIdx = desc.indexOf('.');
    var tagline = dotIdx >= 0 ? desc.slice(0, dotIdx + 1) : desc;
    var jz = Number(row.jobZone);
    var jobZoneLabel = JOB_ZONE_LABELS[jz] || (jz ? ('Job zone ' + jz) : '—');
    var eduPrep = JOB_ZONE_EDUCATION[jz] || 'Varies by employer';
    var collar = COLLAR_LABELS[row.collarCategory] || (row.collarCategory ? titleCase(row.collarCategory) : '—');
    var sector = zoneDisplayLabel(row.hubZone);
    var nameLower = String(row.title || 'this role').toLowerCase();
    var socMajor = row.socMajor ? ('Major group ' + row.socMajor) : '—';
    return Object.assign({}, metrics, {
      title: row.title,
      tagline: tagline,
      overview: desc,
      soc: row.soc || null,
      derivedNote: derivedNoteForSoc(row.soc),
      dayInLife: [
        { time: '9:00 AM', title: 'Morning focus', desc: 'Tackle priority work for your ' + nameLower + ' role.' },
        { time: '1:00 PM', title: 'Collaboration', desc: 'Meet with teammates or stakeholders to align on next steps.' },
        { time: '4:00 PM', title: 'Plan ahead', desc: 'Set priorities for tomorrow and capture lessons from today.' },
      ],
      coreSkills: [],
      otherSkills: [],
      sidebar: {
        Sector: sector,
        'Job zone': jobZoneLabel,
        'Education prep': eduPrep,
        'Collar type': collar,
        'SOC major': socMajor,
        'O*NET SOC': row.soc || '—',
      },
    });
  }

  window.FWHubStaticMetrics = {
    forHubZone: buildZoneMetrics,
    forOnetRow: function (row) {
      if (!row) return null;
      return buildZoneMetrics(row.hubZone, row.title);
    },
    buildOnetDeepDiveProfile: buildOnetDeepDiveProfile,
    derivedNoteForSoc: derivedNoteForSoc,
    jobZoneEducation: JOB_ZONE_EDUCATION,
  };

  window.FWHubDeepDives = profiles;
})();
