// Six decided students, shared by `npm run test:vectors` (acceptance gate) and
// `npm run fit:calibrate` (the offline calibration tool). They are one fixture
// set on purpose: a persona the calibrator tunes against but the gate does not
// assert is a number nobody defends.
//
// Each is quiz sector scores + a sharpen answer set + a know-you/resume text,
// hydrated through the real pipeline against the real O*NET artifacts.
// `expect` lists SOCs that must exist in careers.json — verified by the suite.
//
// There is deliberately no `opposite` / ceiling field any more: since D2 the
// suite asserts every OTHER persona's cluster sits 20 points below this one's
// (masterplan Part 6 criterion 3), which is a claim about all five at once
// rather than about a single hand-picked foil.

const PERSONAS = [
  {
    key: 'quant-finance',
    homeZone: 'business-finance',
    // business-finance is the merged 115-career macro-sector and overlaps every
    // other desk zone, so under the mean-centered cosine its margin over the
    // median zone capped at ~10 points at ANY setting of the seed constants
    // (measured across the full sweep, 2026-07-20) and it needed a per-persona
    // exemption. Under distinctive fit it measures 57 against a uniform floor
    // of 40 — the exemption is gone.
    expect: ['13-2051.00', '13-2054.00', '13-2099.01', '13-2031.00', '13-2041.00', '13-2011.00', '13-2061.00'],
    quiz: {
      scores: { finance: 95, business: 78, tech: 62, law: 40, science: 35, creative: 12, trades: 5 },
      refine: {
        hours: 75, intensity: 80, creative: 25, social: 55,
        workday: 1, problem: 0, path: 0, subjects: ['math', 'economics', 'business'],
      },
      academics: { gpa: 3.8, major: 'economics statistics', liked: 'calculus probability financial markets' },
      resumeText: 'Investment banking summer analyst: built discounted cash flow models, '
        + 'equity research comps, portfolio risk reporting in Excel and Python. '
        + 'Treasurer of the student investment fund.',
    },
  },
  {
    key: 'healthcare',
    homeZone: 'healthcare',
    expect: ['29-1141.00', '29-1071.00', '29-1215.00', '29-1123.00', '29-1051.00', '29-1171.00', '29-1021.00'],
    quiz: {
      scores: { healthcare: 96, science: 74, social: 66, education: 45, government: 30, finance: 10, trades: 8 },
      refine: {
        hours: 65, intensity: 70, creative: 30, social: 85,
        workday: 3, problem: 3, path: 1, subjects: ['science', 'medicine', 'psych'],
      },
      academics: { gpa: 3.7, major: 'biology neuroscience', liked: 'anatomy physiology patient care' },
      resumeText: 'Clinical volunteer in an emergency department: patient intake, vitals, '
        + 'assisting nurses. Research assistant in a public health lab studying diagnosis '
        + 'and treatment outcomes.',
    },
  },
  {
    key: 'creative',
    homeZone: 'creative-media',
    expect: ['27-1024.00', '27-1011.00', '27-1013.00', '27-1014.00', '27-1021.00', '27-2012.00', '27-1025.00'],
    quiz: {
      scores: { creative: 94, media: 80, marketing: 70, tech: 38, business: 30, science: 12, healthcare: 5 },
      refine: {
        hours: 55, intensity: 50, creative: 95, social: 60,
        workday: 2, problem: 1, path: 4, subjects: ['art', 'film', 'writing'],
      },
      academics: { gpa: 3.4, major: 'visual arts design', liked: 'illustration typography film production' },
      resumeText: 'Freelance graphic designer and illustrator: brand identity, poster and '
        + 'album art, motion graphics for short films. Art director of the campus magazine.',
    },
  },
  {
    key: 'trades',
    homeZone: 'trades',
    expect: ['51-4041.00', '51-4121.00', '51-4111.00', '51-8013.00', '51-8021.00', '51-4061.00', '51-4031.00'],
    quiz: {
      scores: { trades: 95, engineering: 66, operations: 58, agriculture: 40, tech: 25, business: 10, creative: 8 },
      refine: {
        hours: 85, intensity: 60, creative: 40, social: 35,
        workday: 2, problem: 1, path: 4, subjects: ['hands', 'engineering'],
      },
      academics: { gpa: 3.1, major: 'welding technology machining', liked: 'shop class blueprints fabrication' },
      resumeText: 'Machine shop apprentice: CNC setup, manual lathe and mill work, MIG and '
        + 'TIG welding, reading blueprints, maintaining hydraulic and pneumatic equipment.',
    },
  },
  // tech and education join for the distinctive-fit work: with only the four
  // above, every "own vs other" claim in the suite runs through trades, and the
  // desk-vs-desk separation this plan exists to create had nothing asserting it.
  {
    key: 'tech',
    homeZone: 'tech',
    // Under the mean-centered cosine this persona measured 31 against the trades
    // cluster where the other desk personas sat at 9-18 — tech genuinely shares
    // the technical/troubleshooting/equipment dims with the trades, and mean-
    // centering cannot subtract what they have in common. It needed a raised
    // ceiling to pass. Distinctive fit reads it at 1.
    expect: ['15-1252.00', '15-1251.00', '15-1243.00', '15-1244.00', '15-1211.00', '15-1254.00', '15-2051.00'],
    quiz: {
      scores: { tech: 96, engineering: 70, science: 58, business: 40, creative: 25, healthcare: 8, trades: 5 },
      refine: {
        hours: 70, intensity: 75, creative: 45, social: 40,
        workday: 1, problem: 0, path: 2, subjects: ['math', 'computer science', 'engineering'],
      },
      academics: { gpa: 3.7, major: 'computer science', liked: 'algorithms distributed systems databases' },
      resumeText: 'Software engineering intern: built backend services in Go and Python, '
        + 'designed relational schemas, wrote unit and integration tests, shipped a '
        + 'React dashboard. Maintainer of an open-source CLI tool.',
    },
  },
  {
    key: 'education',
    homeZone: 'education',
    // 25-2052.00 (the probe's original pick) is not in careers.json — the suite
    // asserts every `expect` SOC resolves so a dead code cannot silently
    // shrink a persona's cluster to the ones that happen to exist.
    expect: ['25-2021.00', '25-2022.00', '25-2031.00', '25-2011.00', '25-2012.00', '25-3011.00', '25-9031.00'],
    quiz: {
      scores: { education: 95, social: 72, healthcare: 45, creative: 38, government: 30, finance: 8, trades: 5 },
      refine: {
        hours: 60, intensity: 55, creative: 60, social: 92,
        workday: 3, problem: 2, path: 1, subjects: ['english', 'history', 'psych'],
      },
      academics: { gpa: 3.6, major: 'elementary education english', liked: 'literacy curriculum child development' },
      resumeText: 'Student teacher in a public elementary school: planned and delivered '
        + 'literacy and math lessons, differentiated instruction for mixed reading levels, '
        + 'ran parent conferences. Three summers as a camp counselor.',
    },
  },
];

module.exports = { PERSONAS };
