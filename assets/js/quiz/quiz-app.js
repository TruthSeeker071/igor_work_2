/* QZ_IND loaded from quiz-data.js */

// Browser scripts use globalThis/window; Safari has no Node-style `global`.
var global = typeof globalThis !== 'undefined' ? globalThis : window;

function qzClr(name, fallback) {
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (_) { return fallback; }
}
function qzPrimary() { return qzClr('--primary-solid', 'rgb(210, 85, 40)'); }
function qzPrimaryDark() { return qzClr('--primary-hover-solid', 'rgb(235, 115, 65)'); }
function qzTrack() { return qzClr('--border-solid', '#e2e8f0'); }
function qzSliderBg(pct) {
  return 'linear-gradient(90deg,' + qzPrimary() + ' ' + pct + '%,' + qzTrack() + ' ' + pct + '%)';
}

// Map quiz industries → Flightway career deep-dive keys
const QZ_TO_CAREER = {
  tech: ['software-engineering','data-science','ux-design'],
  healthcare: ['healthcare-admin'],
  finance: ['investment-banking','financial-analysis'],
  creative: ['ux-design'],
  education: [],
  business: ['management-consulting','corporate-strategy','business-analytics','product-management'],
  law: ['legal-operations'],
  engineering: ['software-engineering'],
  science: ['data-science'],
  startups: ['product-management'],
  social: [],
  marketing: ['marketing-strategy'],
  trades: [],
  media: ['marketing-strategy'],
  government: [],
  cybersecurity: ['software-engineering'],
  operations: ['business-analytics','corporate-strategy'],
  hospitality: [],
  aerospace: ['software-engineering'],
  pharmaceutical: ['healthcare-admin','data-science'],
  sports: [],
  realestate: ['business-analytics'],
  hr: ['corporate-strategy'],
  agriculture: ['data-science']
};

const QZ_SCHOOLS = [
  {m:['mit','massachusetts institute'], name:'MIT', city:'Cambridge, MA', p:{
    tech:{maj:'Course 6 — EECS',cl:'6.100A Intro to CS, 6.1010 Fundamentals of Programming, 6.390 ML',w:"MIT essentially built modern computer science. Course 6 is the most influential CS program on earth — and you're in it."},
    engineering:{maj:'Mechanical or Aerospace Engineering',cl:'2.001 Mechanics, 16.001 Unified Engineering',w:"MIT engineering doesn't just teach — it ships. You'll graduate having actually built things real engineers respect."},
    science:{maj:'Physics or Biology',cl:'8.01 Physics I, 7.012 Intro Biology',w:"More Nobel laureates have walked your halls than at almost any university. The rigor here is legendary."},
    startups:{maj:'Management Science / 6-14',cl:'15.390 New Enterprises, MAS.531',w:"MIT has launched more billion-dollar startups than nearly any school. The ecosystem here is rocket fuel."}
  }},
  {m:['stanford'], name:'Stanford', city:'Palo Alto, CA', p:{
    tech:{maj:'Computer Science',cl:'CS106B, CS107, CS229 Machine Learning',w:"Stanford literally birthed Silicon Valley. The CS department here is the closest thing to a startup factory in education."},
    startups:{maj:'CS + Management Science & Engineering',cl:'MS&E 178 Entrepreneurial Thought Leaders, the d.school',w:"You're at the epicenter. Stanford's d.school and STVP have launched Google, Instagram, Snap, Netflix — the list is endless."},
    business:{maj:'Economics or MS&E',cl:'ECON 1, MS&E 180',w:"Stanford GSB and the MS&E program are the bench from which every consulting and tech leadership team recruits hardest."},
    creative:{maj:'Product Design (ME 115)',cl:'ME 115A Intro to Product Design, the d.school crash courses',w:"Stanford's Product Design program is the rare place where engineering and creativity actually live together."}
  }},
  {m:['harvard'], name:'Harvard', city:'Cambridge, MA', p:{
    law:{maj:'Government + pre-law track',cl:'Gov 10, Gov 1295, Ethical Reasoning 22',w:"Harvard's pipeline to top law schools and policy roles is unmatched. Doors don't just open here — they're already open."},
    business:{maj:'Economics',cl:'Ec 10a/b, Ec 1010, Gen Ed: Justice',w:"Harvard Econ is the most influential undergrad pipeline into finance and consulting in the world. You're tracked for the C-suite."},
    healthcare:{maj:'Human Developmental & Regenerative Biology',cl:'LS1a, MCB 80, HEB 1330',w:"Harvard Medical School is the world's most prestigious. Your undergrad gives you direct access to that ecosystem."},
    finance:{maj:'Applied Math + Economics',cl:'Ec 1010a, Stat 110, Applied Math 22a',w:"Wall Street recruits Harvard like it recruits no one else. Your resume is already half-written."}
  }},
  {m:['yale'], name:'Yale', city:'New Haven, CT', p:{
    law:{maj:'Political Science or Ethics, Politics & Economics',cl:'PLSC 114, EP&E 245, Directed Studies',w:"Yale Law is the #1 law school in America, full stop. Yale undergrads have a uniquely clear path there."},
    creative:{maj:'Theater & Performance Studies / Art',cl:'THST 110, ART 114, Yale School of Drama survey',w:"Yale's drama and arts tradition has shaped global culture for a century. The community here punches far above its size."},
    social:{maj:'Ethics, Politics & Economics',cl:'EP&E 245, Global Affairs 200',w:"Yale produces a disproportionate share of America's nonprofit and policy leaders. The DNA fits you perfectly."},
    education:{maj:'Humanities + Education Studies',cl:'EDST 110, Directed Studies',w:"Yale's commitment to teaching and the humanities is unrivaled — and Education Studies gives you the credential."}
  }},
  {m:['princeton'], name:'Princeton', city:'Princeton, NJ', p:{
    finance:{maj:'Operations Research & Financial Engineering (ORFE)',cl:'ORF 245, ORF 309, ORF 405',w:"ORFE is one of the most respected quantitative finance pipelines in the world. Wall Street treats it like a golden ticket."},
    science:{maj:'Physics or Molecular Biology',cl:'PHY 105, MOL 214, MOL 348',w:"Princeton's physics and bio departments are quietly elite — small classes, world-class faculty, real research as an undergrad."},
    engineering:{maj:'Mechanical or Computer Science (BSE)',cl:'COS 226, MAE 305',w:"Princeton engineering combines elite rigor with the freedom of a liberal arts setting — a rare and powerful combo."},
    law:{maj:'School of Public & International Affairs (SPIA)',cl:'SPI 200, POL 240',w:"SPIA is the country's premier undergrad policy program. Every senator-track and law-track student should know this."}
  }},
  {m:['berkeley','uc berkeley','cal'], name:'UC Berkeley', city:'Berkeley, CA', p:{
    tech:{maj:'EECS or Data Science',cl:'CS 61A, CS 61B, Data 8, CS 188',w:"Berkeley CS rivals Stanford and MIT for industry placement. Big Tech recruits here harder than almost anywhere."},
    engineering:{maj:'Mechanical or Civil Engineering',cl:'E 7, ME 104, CE 30',w:"Berkeley engineering has been a powerhouse for a century. The reputation in industry is rock-solid."},
    social:{maj:'Public Policy or Sociology',cl:'PUB POL 101, SOC 1, ETH STD 21AC',w:"Berkeley is the philosophical home of social movements in America. If you want to change systems, this is the place."},
    science:{maj:'Molecular & Cell Biology or Physics',cl:'MCB 102, PHYS 7A, CHEM 1A',w:"Berkeley produces more PhDs in the sciences than nearly any school. The research firepower is staggering."}
  }},
  {m:['ucla'], name:'UCLA', city:'Los Angeles, CA', p:{
    creative:{maj:'Film & Television',cl:'FTV 33, FTV 106A, FTV 122',w:"UCLA's film school is one of the top three in the world — Coppola, Lucas territory. Hollywood literally pulls from your classrooms."},
    healthcare:{maj:'Human Biology & Society / Physiological Sciences',cl:'LIFESCI 7A, PHYSCI 121, HBIOL 110',w:"UCLA's medical school is top-10, and undergrads have unique access to research at the Ronald Reagan Medical Center."},
    marketing:{maj:'Communication Studies',cl:'COMM 10, COMM 130, COMM 158',w:"UCLA's location and alumni network in media give Communications majors here an outsized advantage in marketing and PR."},
    social:{maj:'Sociology or Psychology',cl:'SOC 1, PSYCH 10, GENDER 10',w:"UCLA's social science research is among the most-cited in the world. You're embedded in serious scholarship."}
  }},
  {m:['usc','southern california'], name:'USC', city:'Los Angeles, CA', p:{
    creative:{maj:'School of Cinematic Arts',cl:'CTPR 290, CTWR 412, CTPR 310',w:"SCA is the #1 film school in America. The alumni network in Hollywood is the single most powerful in entertainment."},
    business:{maj:'Marshall School of Business',cl:'BUAD 304, BUAD 307, BUAD 311',w:"Marshall's connections to entertainment, real estate, and West Coast finance are unmatched among undergrad business programs."},
    marketing:{maj:'Annenberg Communications + Marshall Marketing',cl:'COMM 200, BUAD 307, JOUR 207',w:"Annenberg + Marshall is a uniquely strong PR/marketing pipeline — the LA media industry runs on this graph."},
    engineering:{maj:'Viterbi Engineering',cl:'ITP 115, CSCI 102, EE 101',w:"Viterbi has quietly become a top engineering school, with strong ties to space, gaming, and aerospace industries."}
  }},
  {m:['nyu','new york university'], name:'NYU', city:'New York, NY', p:{
    creative:{maj:'Tisch School of the Arts',cl:'OART-UT 1, FILM-UT 1, ITPG-GT 2003',w:"Tisch is one of the world's most respected arts schools, and being in NYC means the city itself is your studio."},
    finance:{maj:'Stern School of Business — Finance',cl:'FINC-UB 2, FINC-UB 7, FINC-UB 27',w:"Stern is literally on Wall Street. The proximity and recruiting access into finance is unrivaled in undergrad."},
    business:{maj:'Stern — Marketing or Management',cl:'MKTG-UB 1, MGMT-UB 1, MULT-UB 32',w:"Stern's location in Manhattan gives you live-fire access to the world's largest concentration of corporate HQs."},
    marketing:{maj:'Stern Marketing + Steinhardt Media',cl:'MKTG-UB 1, MCC-UE 1, MCC-UE 1011',w:"NYU's marketing pipeline into ad agencies and consumer brands is one of the strongest in the country."}
  }},
  {m:['columbia'], name:'Columbia', city:'New York, NY', p:{
    finance:{maj:'Economics-Math or Financial Economics',cl:'ECON UN1105, ECON UN3211, STAT UN1201',w:"Columbia's location and Ivy network funnel grads to Wall Street with extraordinary regularity. The pipeline is engineered."},
    law:{maj:'Political Science + History',cl:'POLS UN1201, POLS UN3651',w:"Columbia Law is top-5 nationally, and Columbia undergrads have an obvious advantage in admissions."},
    creative:{maj:'Creative Writing + Journalism',cl:'ENGL UN3001, JOUR BC3105',w:"Columbia Journalism School is the gold standard worldwide. Even undergrads get pulled into that orbit."},
    marketing:{maj:'Journalism + Sociology',cl:'JOUR BC3105, SOCI UN1000',w:"Columbia produces a disproportionate share of America's editors, communications leads, and brand strategists."}
  }},
  {m:['upenn','pennsylvania','wharton'], name:'UPenn', city:'Philadelphia, PA', p:{
    finance:{maj:'Wharton — Finance concentration',cl:'FNCE 100, FNCE 101, FNCE 250',w:"Wharton is THE preeminent undergrad finance program in the world. Period. You're in the most competitive room in finance."},
    business:{maj:'Wharton — Management or Marketing',cl:'MGMT 100, MKTG 101, MGMT 230',w:"Wharton's brand opens every business door, anywhere. Few credentials in academia match its market value."},
    healthcare:{maj:'Health & Societies or Nursing (Penn Nursing)',cl:'HSOC 010, NURS 101, BIOL 121',w:"Penn Nursing is consistently #1 in the country, and Penn Medicine is a global research powerhouse."},
    engineering:{maj:'Bioengineering (Penn Engineering)',cl:'BE 100, BE 220, ENGR 105',w:"Penn's bioengineering is rare in being co-housed with one of the world's top med schools — translational research is everywhere."}
  }},
  {m:['cornell'], name:'Cornell', city:'Ithaca, NY', p:{
    engineering:{maj:'Engineering + Operations Research',cl:'ENGRG 1050, ORIE 3120, CS 2110',w:"Cornell engineering competes head-to-head with MIT and Stanford in many specialties — and the rigor here is brutal in the best way."},
    business:{maj:'Dyson School (Applied Economics & Management)',cl:'AEM 1200, AEM 2400, AEM 3230',w:"Dyson is an Ivy League undergrad business program — extraordinarily rare and tightly recruited from."},
    science:{maj:'Biology + Society / Biological Sciences',cl:'BIOG 1140, BIOMG 1350, BIOMI 2900',w:"Cornell's biological sciences span the most comprehensive set of departments in the country — your options here are vast."},
    creative:{maj:'College of Architecture, Art & Planning',cl:'ARCH 1101, ART 1103, CRP 1101',w:"AAP is one of the top architecture programs in America, with a deep tradition of fine arts and urban design."}
  }},
  {m:['michigan','umich','university of michigan'], name:'Michigan', city:'Ann Arbor, MI', p:{
    engineering:{maj:'Aerospace, Mechanical, or Computer Engineering',cl:'ENGR 100, EECS 280, MECHENG 211',w:"Michigan engineering is consistently top-10 in the world. Big Tech, automotive, and aerospace recruit here ferociously."},
    business:{maj:'Ross School of Business',cl:'BBA core: STRATEGY 290, MO 300, FIN 300',w:"Ross is a top-5 undergrad business program. Consulting firms treat it as a primary recruiting target."},
    tech:{maj:'CS + Information',cl:'EECS 280, EECS 281, SI 110',w:"Michigan's CS + Information combination is one of the most flexible tech pipelines in the country."},
    healthcare:{maj:'Public Health (BS) or Movement Science',cl:'PUBHLTH 200, MOVESCI 110, BIO 171',w:"Michigan Medicine is a top-10 hospital and one of the largest research institutions in the country."}
  }},
  {m:['georgia tech','gatech'], name:'Georgia Tech', city:'Atlanta, GA', p:{
    engineering:{maj:'Mechanical or Industrial Engineering',cl:'ME 1670, ISYE 2027, ME 2110',w:"Georgia Tech is the workhorse engineering school of America — its grads are everywhere companies actually build things."},
    tech:{maj:'Computer Science (College of Computing)',cl:'CS 1331, CS 1332, CS 2110',w:"Georgia Tech's CS program is top-5 in the country and produces some of the most employable graduates in tech, full stop."}
  }},
  {m:['carnegie mellon','cmu'], name:'Carnegie Mellon', city:'Pittsburgh, PA', p:{
    tech:{maj:'School of Computer Science',cl:'15-112, 15-122, 15-150',w:"CMU's SCS is widely considered the #1 CS program in America. Period. The bar is brutally high — and you're meeting it."},
    creative:{maj:'School of Drama or Design',cl:'54-181, 51-101, 51-261',w:"CMU's Drama is one of the most legendary conservatories in America, and Design here blends with HCI uniquely."},
    engineering:{maj:'Electrical & Computer Engineering',cl:'18-100, 18-202, 18-213',w:"CMU ECE produces engineers who go straight into the most ambitious tech and hardware companies in the world."}
  }},
  {m:['ut austin','university of texas','texas'], name:'UT Austin', city:'Austin, TX', p:{
    business:{maj:'McCombs School of Business',cl:'MAN 336, FIN 357, MKT 320F',w:"McCombs is a top-10 undergrad business program and the dominant talent pipeline into Texas's booming corporate scene."},
    engineering:{maj:'Cockrell School of Engineering',cl:'EE 302, ME 205, BME 311',w:"Cockrell is top-10 nationally and uniquely well-connected to Austin's massive tech-and-energy industries."},
    tech:{maj:'Computer Science',cl:'CS 312, CS 313E, CS 314',w:"UT Austin CS punches at the top tier. Austin's tech boom — Tesla, Oracle, Apple — runs on UT grads."},
    marketing:{maj:'Moody College — Advertising',cl:'ADV 318J, ADV 339, RTF 305',w:"Moody College has one of the best advertising and media programs in the country. The agency pipeline is enormous."}
  }},
  {m:['notre dame'], name:'Notre Dame', city:'Notre Dame, IN', p:{
    business:{maj:'Mendoza College of Business',cl:'MGT 20200, FIN 20150, MKT 20200',w:"Mendoza has been the top-ranked undergrad business school multiple years running. The alumni network is famously loyal and powerful."},
    law:{maj:'Political Science + Constitutional Studies',cl:'POLS 10100, POLS 30750',w:"Notre Dame Law has a strong national profile, and the undergrad path through Constitutional Studies is uniquely rigorous."}
  }},
  {m:['boston college','bc'], name:'Boston College', city:'Chestnut Hill, MA', p:{
    business:{maj:'Carroll School of Management',cl:'MGMT 1021, FINC 1151, MKTG 1021',w:"Carroll is a top-15 undergrad business school with an extraordinarily loyal alumni base in Boston and NYC."},
    education:{maj:'Lynch School of Education',cl:'EDUC 1030, EDUC 2241',w:"BC's Lynch School is a top-10 education school, and the Jesuit tradition produces uniquely thoughtful educators."},
    healthcare:{maj:'Connell School of Nursing',cl:'NURS 1020, NURS 2272',w:"BC Nursing places near the top of national rankings and feeds Boston's massive medical ecosystem."}
  }},
  {m:['washington','uw','udub'], name:'University of Washington', city:'Seattle, WA', p:{
    tech:{maj:'Paul G. Allen School of CS',cl:'CSE 142, CSE 143, CSE 311',w:"UW CS is top-10 in the country and feeds directly into Microsoft, Amazon, and the entire Pacific Northwest tech scene."}
  }},
  {m:['unc','unc chapel hill','north carolina','chapel hill'], name:'UNC Chapel Hill', city:'Chapel Hill, NC', p:{
    business:{maj:'Kenan-Flagler Business School',cl:'BUSI 101, BUSI 405, BUSI 407',w:"Kenan-Flagler is one of the most respected business schools in the South — and its alumni network in consulting and finance punches far above its size."},
    law:{maj:'Political Science or Public Policy',cl:'POLI 101, POLI 281, PLCY 101',w:"UNC's pipeline to top law schools is legitimate — the political science faculty here is among the most published in the country, and Chapel Hill puts you steps from Research Triangle's legal corridors."},
    healthcare:{maj:'Public Health (Gillings School)',cl:'BIOS 600, EPID 600, HPM 411',w:"Gillings is a top-5 public health school in America. You have direct access to one of the most respected research hospitals in the Southeast."},
    marketing:{maj:'Hussman School of Media and Journalism',cl:'MEJO 101, MEJO 137, MEJO 360',w:"Hussman is nationally recognized and its location in the Research Triangle puts graduates inside one of the most dynamic innovation economies in the country."}
  }},
  {m:['duke'], name:'Duke', city:'Durham, NC', p:{
    finance:{maj:'Economics or Statistical Science',cl:'ECON 101D, ECON 201D, STA 230',w:"Duke Economics feeds Fuqua and Wall Street with extraordinary regularity. The quantitative rigor here is genuinely elite — and the brand opens doors before you even interview."},
    engineering:{maj:'Pratt School of Engineering',cl:'EGR 101L, ECE 110L, BME 153L',w:"Pratt is consistently top-25 nationally and has world-class biomedical and electrical engineering programs. The Duke-UNC research corridor is one of the richest in the country."},
    healthcare:{maj:'Neuroscience or Pre-med track',cl:'NEUROSCI 101, BIO 201L, CHEM 101DL',w:"Duke Hospital is one of the top research hospitals in the world — and you're embedded in it from day one. Few schools give undergrads this level of clinical and research access."},
    law:{maj:'Political Science + Philosophy',cl:'POLSCI 101, PHIL 101, PPS 111',w:"Duke Law is a top-15 school, and Duke undergrads have a real advantage. The joint JD/MBA track here has produced an outsized number of corporate and policy leaders."}
  }},
  {m:['northwestern'], name:'Northwestern', city:'Evanston, IL', p:{
    marketing:{maj:'Medill School of Journalism, Integrated Marketing',cl:'JOUR 201, IMC 301, JOUR 301',w:"Medill is the most celebrated journalism and IMC program in America. Its alumni run the comms and marketing functions at the world's most recognizable brands."},
    business:{maj:'Weinberg Economics + Kellogg feeder',cl:'ECON 201, ECON 202, MMSS 211',w:"Kellogg is the #1 MBA program in strategy — and Northwestern undergrads have a uniquely clear path there. Being in Chicago means finance and consulting firms are recruiting on campus constantly."},
    engineering:{maj:'McCormick School of Engineering',cl:'GEN ENG 205-1, CHEM ENG 241, COMP SCI 111',w:"McCormick is top-20 nationally with some of the strongest materials science and biomedical engineering programs in the world. Its proximity to Chicago's tech scene is a real advantage."},
    creative:{maj:'Theatre + Radio/TV/Film',cl:'THEATRE 101, RTVF 190, PERF 200',w:"Northwestern's performance and film programs are the stuff of legend. Nearly every major comedy writer and showrunner of the last 30 years has walked through here."}
  }},
  {m:['georgetown'], name:'Georgetown', city:'Washington, DC', p:{
    law:{maj:'Government + Philosophy',cl:'GOVT 060, GOVT 040, PHIL 141',w:"Georgetown Law is top-15 nationally, and your DC location means you're already in the room where policy and law intersect. These doors open differently than anywhere else."},
    business:{maj:'McDonough School of Business',cl:'MGMT 200, FINC 201, STRT 301',w:"McDonough's network in consulting, government relations, and finance is exceptionally powerful — and its alumni in the public-private space are everywhere you want to be."},
    social:{maj:'School of Foreign Service',cl:'GOVT 060, INAF 100, SFS 101',w:"The School of Foreign Service is the most prestigious international affairs program on earth. Foreign ministers, ambassadors, and CEOs all came from exactly where you are sitting."},
    finance:{maj:'Finance at McDonough',cl:'FINC 201, FINC 351, ACCT 201',w:"Georgetown's proximity to Treasury, the Fed, and top DC-based financial institutions gives finance students unmatched access to real-world capital markets."}
  }},
  {m:['vanderbilt','vandy'], name:'Vanderbilt', city:'Nashville, TN', p:{
    business:{maj:'Owen School feeder / Economics',cl:'ECON 1010, ECON 1020, LAW 3010',w:"Vanderbilt Economics is the clearest path into Owen (top-20 MBA) and into Nashville's booming financial and healthcare business ecosystem. The alumni loyalty here is extraordinary."},
    healthcare:{maj:'Neuroscience or Molecular & Cellular Biology',cl:'NS 2201, BSCI 1510, CHEM 1601',w:"Vanderbilt Medical Center is world-class — and the most ambitious pre-med students in the South come here for exactly this access. Few undergrad programs match this research proximity."},
    law:{maj:'Political Science or Philosophy',cl:'PSCI 1150, PHIL 1111',w:"Vanderbilt Law is a legitimate top-20 program. Its alumni network in corporate law and the Southeast is one of the most cohesive in American legal academia."},
    engineering:{maj:'School of Engineering',cl:'ES 1401, EECE 2123, MECH ENG 2201',w:"Vanderbilt's engineering school is tightly connected to Nashville's healthcare industry — biomedical engineering in particular is extraordinary here."}
  }},
  {m:['university of florida','uf','florida','florida gators','gainesville'], name:'University of Florida', city:'Gainesville, FL', p:{
    business:{maj:'Warrington College of Business',cl:'MAR 3023, MAN 3025, FIN 3403',w:"Warrington is one of the top-25 public business schools in America and the dominant pipeline into Florida's massive financial and real estate industries."},
    engineering:{maj:'Herbert Wertheim College of Engineering',cl:'EEL 3003, EGM 3520, CDA 3101',w:"Wertheim is a top-10 public engineering school and the primary feeder into Florida's aerospace, defense, and tech sectors."},
    healthcare:{maj:'Health Sciences feeder / College of Medicine',cl:'BSC 2010, CHM 2045, PCB 3023',w:"UF Health is Florida's flagship academic medical center. The research infrastructure here is matched by almost no other public university in the South."},
    marketing:{maj:'College of Journalism and Communications',cl:'MMC 2100, ADV 3001, PUR 3000',w:"UF Journalism is one of the top-ranked programs in the country — its advertising and PR pipeline into Miami and Atlanta is extremely well-established."}
  }},
  {m:['ohio state','osu','ohio state university'], name:'Ohio State', city:'Columbus, OH', p:{
    business:{maj:'Fisher College of Business',cl:'BUSOBA 1321, FINA 3220, MGMT 3200',w:"Fisher is a top-20 public business school and the most powerful talent pipeline in the Midwest into consulting, banking, and corporate leadership."},
    engineering:{maj:'College of Engineering',cl:'ENGR 1100, ECE 2020, CSE 2321',w:"Ohio State engineering is a Big Ten powerhouse — its graduates dominate the automotive, aerospace, and tech industries across the Midwest and beyond."},
    marketing:{maj:'School of Communication',cl:'COMM 2110, COMM 3310, JOUR 2100',w:"Ohio State's communications program is one of the largest in the country and its alumni network in media, advertising, and PR runs deep."},
    healthcare:{maj:'Public Health / Pre-med',cl:'PUBHHBP 2010, BIOL 1113, CHEM 1210',w:"The Ohio State Wexner Medical Center is one of the top-10 research hospitals in America. The public health and pre-med pipeline here is formidable."}
  }},
  {m:['illinois','uiuc','u of i','university of illinois'], name:'UIUC', city:'Champaign, IL', p:{
    tech:{maj:'Computer Science (Grainger College)',cl:'CS 101, CS 225, CS 233',w:"UIUC CS is one of the top-5 programs in the country, full stop. Tech companies recruit here as aggressively as anywhere outside Stanford and MIT."},
    engineering:{maj:'Grainger College of Engineering',cl:'PHYS 211, MATH 221, ECE 110',w:"Grainger is consistently ranked among the top-3 engineering programs in the country. The depth of specializations here is extraordinary."},
    business:{maj:'Gies College of Business',cl:'ACCY 200, FIN 221, BADM 210',w:"Gies has emerged as a top-20 public business program — its accounting and finance tracks are among the most heavily recruited in the country."},
    science:{maj:'Chemistry or Physics (LAS)',cl:'CHEM 102, PHYS 211, MCB 150',w:"UIUC's chemistry and physics programs have produced more Nobel laureates and Fortune 500 CEOs than almost any peer. The research depth here is unparalleled."}
  }},
  {m:['purdue'], name:'Purdue', city:'West Lafayette, IN', p:{
    engineering:{maj:'College of Engineering',cl:'ENGR 131, ME 270, ECE 201',w:"Purdue is an engineering powerhouse — 25+ astronauts, the engineers behind Apollo, and a direct pipeline into aerospace, defense, and advanced manufacturing."},
    tech:{maj:'Computer Science',cl:'CS 180, CS 251, CS 307',w:"Purdue CS is a top-10 program for job placement. Amazon, Microsoft, and Google recruit here at scale — and the startup ecosystem in the Midwest runs on Purdue grads."},
    science:{maj:'College of Science',cl:'BIOL 110, CHEM 115, PHYS 172',w:"Purdue's pharmaceutical sciences, chemistry, and physics programs are among the strongest of any public university in the country."},
    business:{maj:'Krannert School of Management',cl:'MGMT 200, ECON 251, OBHR 301',w:"Krannert punches above its weight — its quantitative management and supply chain programs feed directly into Fortune 500 C-suites."}
  }},
  {m:['uva','virginia','university of virginia'], name:'UVA', city:'Charlottesville, VA', p:{
    business:{maj:'McIntire School of Commerce',cl:'COMM 2010, COMM 3010, COMM 4010',w:"McIntire is the most prestigious undergrad commerce program in the South — and one of the top-10 in the country. Wall Street and consulting recruit here like clockwork."},
    law:{maj:'Politics + Rhetoric & Communication Studies',cl:'PLAP 1010, RHET 1510, PLCP 2010',w:"UVA Law is a top-10 law school, and the undergraduate politics program feeds it with a consistency that rivals any Ivy."},
    finance:{maj:'Commerce at McIntire — Finance track',cl:'COMM 3010, COMM 3020, COMM 3030',w:"McIntire's finance track places graduates directly into investment banking and private equity at a rate that is genuinely elite for a public university."},
    engineering:{maj:'School of Engineering and Applied Science',cl:'APMA 3100, ECE 2630, CS 2150',w:"UVA Engineering is small, rigorous, and well-connected to the DC tech corridor — a combination that produces unusually well-rounded engineers."}
  }},
  {m:['ucsd','uc san diego','san diego'], name:'UC San Diego', city:'La Jolla, CA', p:{
    tech:{maj:'Computer Science or Cognitive Science',cl:'CSE 11, CSE 12, COGS 108',w:"UCSD CS is a top-10 program nationally and one of San Diego's most powerful pipelines into Big Tech. Qualcomm, Apple, and Google all recruit here aggressively."},
    science:{maj:'Biosciences or Neuroscience',cl:'BILD 1, CHEM 6A, PSYC 106',w:"UCSD is among the top-5 research universities in the world for biological sciences. The proximity to the Salk Institute and Scripps Research is extraordinary."},
    engineering:{maj:'Jacobs School of Engineering',cl:'MAE 8, ECE 15, SE 1',w:"Jacobs is top-15 nationally and one of the best-connected engineering schools to San Diego's massive defense and biotech industries."},
    healthcare:{maj:'Public Health or Biosciences',cl:'FMPH 40, BILD 26, PHYS 2A',w:"UCSD Health is one of the top-15 research medical centers in the country. The pre-med and public health pathways here are genuinely exceptional."}
  }},
  {m:['wisconsin','uw madison','university of wisconsin','madison'], name:'UW Madison', city:'Madison, WI', p:{
    business:{maj:'Wisconsin School of Business',cl:'GEN BUS 306, FINANCE 300, MARKETNG 300',w:"Wisconsin Business is a top-25 program with a uniquely strong actuarial and finance track. The alumni network in Chicago finance is legendary."},
    engineering:{maj:'College of Engineering',cl:'E C E 230, M E 361, CHEM ENG 324',w:"Wisconsin engineering is a Big Ten powerhouse — its chemical, nuclear, and industrial engineering programs are among the best in the country."},
    science:{maj:'College of Letters & Science',cl:'CHEM 103, PHYSICS 201, BIOCHEM 501',w:"Wisconsin is an AAU research powerhouse — its biochemistry, genetics, and physics programs have produced a staggering number of Nobel laureates."},
    social:{maj:'La Follette School of Public Affairs',cl:'POLS 104, SOC 101, PUBLAFR 225',w:"La Follette is one of the premier public affairs programs in America — its alumni lead state governments, federal agencies, and major nonprofits across the country."}
  }},
  {m:['penn state','psu','pennsylvania state'], name:'Penn State', city:'State College, PA', p:{
    business:{maj:'Smeal College of Business',cl:'BA 100, ACCTG 211, FIN 301',w:"Smeal is a top-25 public business school with an extraordinary alumni network — the Penn State alumni association is one of the most active and powerful in American higher education."},
    engineering:{maj:'College of Engineering',cl:'CMPSC 101, E MCH 213, EE 210',w:"Penn State engineering is one of the largest and most recruited in the country — particularly strong in materials, nuclear, and aerospace engineering."},
    marketing:{maj:'Donald P. Bellisario College of Communications',cl:'COMM 100, COMM 260, ADV 100',w:"Bellisario is nationally recognized — its alumni hold senior positions at every major media company and agency in the country."},
    education:{maj:'College of Education',cl:'ED PSYCH 010, CI 295, ED THRY 211',w:"Penn State's education programs are among the top public university options in the country, with a massive alumni network in public school systems and ed-tech."}
  }},
  {m:['bu','boston university','boston u'], name:'Boston University', city:'Boston, MA', p:{
    business:{maj:'Questrom School of Business',cl:'SM 131, FE 323, MK 323',w:"Questrom's location puts you inside one of the densest concentrations of financial firms, biotech companies, and startups in the world. The alumni network in Boston is formidable."},
    engineering:{maj:'College of Engineering',cl:'EK 100, EK 127, EC 311',w:"BU Engineering has exceptional biomedical and systems programs — and the proximity to MIT, Harvard, and Longwood Medical Area makes collaboration uniquely easy."},
    healthcare:{maj:'School of Public Health',cl:'SPH EP 713, SPH BS 723, SPH GH 850',w:"BU's School of Public Health is top-15 nationally, and its location gives students direct access to Boston's world-class hospital and research ecosystem."},
    marketing:{maj:'College of Communication',cl:'COM CM 215, COM CM 311, COM PR 216',w:"COM is one of the most respected communications schools in New England — its PR and advertising alumni are placed at the top agencies in Boston, NYC, and beyond."}
  }},
  {m:['northeastern','neu'], name:'Northeastern', city:'Boston, MA', p:{
    tech:{maj:'Khoury College of Computer Sciences',cl:'CS 2500, CS 2510, CS 3500',w:"Khoury is among the most innovative CS programs in the country — and Northeastern's famous co-op means you graduate with up to 18 months of real industry experience."},
    engineering:{maj:'College of Engineering',cl:'EECE 2160, ME 2340, CHME 2315',w:"Northeastern engineering's co-op model is unique: you'll have worked at 2-3 real engineering companies before you graduate. Employers treat that very differently."},
    business:{maj:"D'Amore-McKim School of Business",cl:'ACCT 1201, FINA 2201, MKTG 2201',w:"D'Amore-McKim's co-op emphasis produces graduates who are unusually ready for day one — and Boston's dense business ecosystem makes every placement count."},
    startups:{maj:'Entrepreneurship + Khoury CS',cl:'ENTR 2150, ENTR 3395, CS 2500',w:"Northeastern's co-op model is essentially a built-in startup accelerator. You test ideas in real companies, then come back and build your own. The IDEA network here is serious."}
  }},
  {m:['emory'], name:'Emory', city:'Atlanta, GA', p:{
    business:{maj:'Goizueta Business School',cl:'BUS 101, ACCT 201, FIN 301',w:"Goizueta is a top-25 business school and the primary feeder into Atlanta's massive financial, consulting, and media industries. The alumni network is unusually tight."},
    healthcare:{maj:'Pre-med / Neuroscience',cl:'BIOL 141, CHEM 141, NBB 301',w:"Emory Medical School is top-25 and one of the premier research hospitals in the Southeast. Undergrads have remarkable access to faculty research — and Atlanta is home to the CDC."},
    law:{maj:'Political Science or Philosophy',cl:'POLS 101, PHIL 115, POLS 385',w:"Emory Law is a top-25 school with exceptional strength in corporate and public interest law — and Atlanta's growing status as a legal market makes its placement even more impressive."},
    social:{maj:'Rollins School of Public Health',cl:'GH 200, BSHE 510, EPI 530',w:"Rollins is a top-10 public health school, and Atlanta's role as the home of the CDC gives Emory students connections that no other university can replicate."}
  }},
  {m:['tulane'], name:'Tulane', city:'New Orleans, LA', p:{
    business:{maj:'Freeman School of Business',cl:'BUSA 1010, FINE 3010, MKTG 3010',w:"Freeman is a top-30 business school with extraordinary strength in energy, real estate, and international business — and New Orleans is a uniquely rich environment for understanding global commerce."},
    law:{maj:'Political Science + Pre-law',cl:'POLS 1010, POLS 3310, PHIL 1010',w:"Tulane Law is a top-50 school with particular strength in maritime, energy, and civil law — areas where its New Orleans location gives it a genuine advantage over any other program."},
    social:{maj:'School of Public Health and Social Work',cl:'SPHU 1010, GLOS 1010, POLS 1010',w:"Tulane has a powerful public health and social impact tradition — and New Orleans itself is one of the most dynamic laboratories for community development work in the country."},
    healthcare:{maj:'School of Public Health and Tropical Medicine',cl:'SPHU 1010, BIOS 6040, ENHS 6040',w:"Tulane's tropical medicine program is among the top-ranked in the world, built on decades of work in global and underserved communities."}
  }},
  {m:['michigan state','msu','spartan'], name:'Michigan State', city:'East Lansing, MI', p:{
    business:{maj:'Broad College of Business',cl:'MGT 201, MKT 327, FI 311',w:"Broad is a top-30 public business school with exceptional supply chain, accounting, and finance programs — and its alumni network in the Midwest corporate world is one of the strongest anywhere."},
    education:{maj:'College of Education',cl:'TE 150, ED 870, CEP 240',w:"MSU's College of Education is one of the top-5 in the country. Its teacher training and education research programs are nationally recognized — its alumni lead school systems across the US."},
    engineering:{maj:'College of Engineering',cl:'EGR 100, ME 201, ECE 201',w:"MSU Engineering has deep roots in automotive, packaging, and environmental engineering — and its proximity to Detroit creates unmatched internship and job access."},
    science:{maj:'College of Natural Science',cl:'ISP 205, CEM 141, MMG 401',w:"MSU is an AAU research university with exceptional programs in plant science, genetics, and nuclear physics — its FRIB facility is one of the most significant physics installations in the world."}
  }},
  {m:['ucsb','uc santa barbara','santa barbara'], name:'UC Santa Barbara', city:'Santa Barbara, CA', p:{
    science:{maj:'Physics, Chemistry, or Biology',cl:'PHYS 1, CHEM 1A, BIOL 93',w:"UCSB has more Nobel laureates per faculty than almost any university in the world. The physics and chemistry departments are genuinely world-class — and you're already in them."},
    tech:{maj:'Computer Science or ECE',cl:'CMPSC 16, CMPSC 24, ECE 15A',w:"UCSB CS is a top-20 program with particularly strong ties to Silicon Valley and an alumni network in semiconductor and networking companies that outperforms its ranking."},
    creative:{maj:'Film & Media Studies',cl:'FILM 1, FILM 100, FILM 105',w:"UCSB's film program benefits from proximity to LA and a deep faculty bench. The creative writing and screenwriting tracks here have launched a remarkable number of working professionals."},
    engineering:{maj:'College of Engineering',cl:'ECE 1A, ME 14, CMPSC 16',w:"UCSB Engineering is a top-20 program and the home of Nobel Prize-winning work in LED technology. Its materials and electrical engineering departments are as strong as anywhere in the UC system."}
  }},
  {m:['asu','arizona state','arizona state university'], name:'Arizona State', city:'Tempe, AZ', p:{
    business:{maj:'W. P. Carey School of Business',cl:'MGT 300, MKT 300, FIN 300',w:"W.P. Carey is a top-30 public business school — its supply chain program is consistently ranked #1 nationally and its Phoenix location puts you inside one of the fastest-growing corporate ecosystems in America."},
    engineering:{maj:'Ira A. Fulton Schools of Engineering',cl:'EEE 120, CSE 110, MAE 213',w:"Fulton is one of the largest and most innovative engineering schools in the US — and Arizona is home to Intel, TSMC, and a booming semiconductor industry that recruits heavily here."},
    marketing:{maj:'Walter Cronkite School of Journalism',cl:'JMC 101, JMC 301, JMC 360',w:"Cronkite is one of the top journalism schools in America, and Phoenix's booming media market gives students access to real newsrooms and agencies from their first semester."},
    tech:{maj:'Computer Science (Fulton Schools)',cl:'CSE 110, CSE 205, CSE 310',w:"ASU CS is one of the largest and most innovative programs in the country — strong industry ties to Intel, Amazon, and the growing Phoenix tech scene give graduates a real edge."}
  }},
  {m:['umd','maryland','university of maryland','college park'], name:'University of Maryland', city:'College Park, MD', p:{
    tech:{maj:'Computer Science (College of CMNS)',cl:'CMSC 131, CMSC 132, CMSC 250',w:"UMD CS is a top-15 program nationally and sits 12 miles from DC — Amazon, NSA, Leidos, and Booz Allen recruit here more heavily than at almost any school in the Mid-Atlantic."},
    business:{maj:'Robert H. Smith School of Business',cl:'BMGT 220, BMGT 340, BMGT 350',w:"Smith is a top-25 public business school with exceptional finance and supply chain programs — its DC-adjacent location makes government contracting and policy consulting uniquely accessible."},
    engineering:{maj:'A. James Clark School of Engineering',cl:'ENEE 150, ENES 100, MATH 140',w:"Clark School is a top-20 engineering program and the leading feeder into the federal government's massive defense and intelligence contractor ecosystem in the DC-Maryland corridor."},
    science:{maj:'College of Computer, Math, and Natural Sciences',cl:'BSCI 170A, CHEM 131, PHYS 141',w:"UMD STEM programs benefit from unique proximity to NIST, NIH, and NASA Goddard — giving you research access that simply isn't available at any other university in the country."}
  }},
  // ── Additional schools (dropdown coverage) ───────────────────────────────
  {m:['dartmouth'],name:'Dartmouth',city:'Hanover, NH'},
  {m:['brown'],name:'Brown',city:'Providence, RI'},
  {m:['rice'],name:'Rice',city:'Houston, TX'},
  {m:['johns hopkins','jhu','hopkins'],name:'Johns Hopkins',city:'Baltimore, MD'},
  {m:['caltech','california institute of technology'],name:'Caltech',city:'Pasadena, CA'},
  {m:['uchicago','university of chicago','u chicago'],name:'University of Chicago',city:'Chicago, IL'},
  {m:['wash u','washu','washington university','washington university in st louis'],name:'Washington University in St. Louis',city:'St. Louis, MO'},
  {m:['rochester','university of rochester'],name:'University of Rochester',city:'Rochester, NY'},
  {m:['case western','cwru'],name:'Case Western Reserve',city:'Cleveland, OH'},
  {m:['rpi','rensselaer'],name:'Rensselaer Polytechnic',city:'Troy, NY'},
  {m:['virginia tech','vt','vtech'],name:'Virginia Tech',city:'Blacksburg, VA'},
  {m:['ucd','uc davis','davis'],name:'UC Davis',city:'Davis, CA'},
  {m:['uci','uc irvine','irvine'],name:'UC Irvine',city:'Irvine, CA'},
  {m:['indiana','iu','indiana university'],name:'Indiana University',city:'Bloomington, IN'},
  {m:['rutgers'],name:'Rutgers',city:'New Brunswick, NJ'},
  {m:['minnesota','umn','university of minnesota'],name:'University of Minnesota',city:'Minneapolis, MN'},
  {m:['colorado','cu boulder','university of colorado','boulder'],name:'CU Boulder',city:'Boulder, CO'},
  {m:['arizona','university of arizona','u of a'],name:'University of Arizona',city:'Tucson, AZ'},
  {m:['oregon','university of oregon','uo'],name:'University of Oregon',city:'Eugene, OR'},
  {m:['oregon state','osu corvallis'],name:'Oregon State',city:'Corvallis, OR'},
  {m:['iowa','university of iowa'],name:'University of Iowa',city:'Iowa City, IA'},
  {m:['iowa state'],name:'Iowa State',city:'Ames, IA'},
  {m:['kansas','ku','university of kansas'],name:'University of Kansas',city:'Lawrence, KS'},
  {m:['missouri','mizzou','university of missouri'],name:'University of Missouri',city:'Columbia, MO'},
  {m:['nebraska','university of nebraska'],name:'University of Nebraska',city:'Lincoln, NE'},
  {m:['tennessee','university of tennessee','ut knoxville'],name:'University of Tennessee',city:'Knoxville, TN'},
  {m:['kentucky','university of kentucky','uk'],name:'University of Kentucky',city:'Lexington, KY'},
  {m:['alabama','university of alabama','bama'],name:'University of Alabama',city:'Tuscaloosa, AL'},
  {m:['auburn'],name:'Auburn',city:'Auburn, AL'},
  {m:['georgia','uga','university of georgia'],name:'University of Georgia',city:'Athens, GA'},
  {m:['south carolina','university of south carolina','usc columbia'],name:'University of South Carolina',city:'Columbia, SC'},
  {m:['clemson'],name:'Clemson',city:'Clemson, SC'},
  {m:['nc state','north carolina state','ncsu'],name:'NC State',city:'Raleigh, NC'},
  {m:['lsu','louisiana state'],name:'LSU',city:'Baton Rouge, LA'},
  {m:['ole miss','university of mississippi','mississippi'],name:'University of Mississippi',city:'Oxford, MS'},
  {m:['baylor'],name:'Baylor',city:'Waco, TX'},
  {m:['tcu','texas christian'],name:'TCU',city:'Fort Worth, TX'},
  {m:['texas a&m','texas am','tamu','aggies'],name:'Texas A&M',city:'College Station, TX'},
  {m:['smu','southern methodist'],name:'SMU',city:'Dallas, TX'},
  {m:['houston','university of houston','uh'],name:'University of Houston',city:'Houston, TX'},
  {m:['utah','university of utah'],name:'University of Utah',city:'Salt Lake City, UT'},
  {m:['byu','brigham young'],name:'BYU',city:'Provo, UT'},
  {m:['nevada','unlv','las vegas'],name:'UNLV',city:'Las Vegas, NV'},
  {m:['hawaii','university of hawaii'],name:'University of Hawaii',city:'Honolulu, HI'},
  {m:['fsu','florida state'],name:'Florida State',city:'Tallahassee, FL'},
  {m:['miami','university of miami','um'],name:'University of Miami',city:'Coral Gables, FL'},
  {m:['ucf','central florida'],name:'UCF',city:'Orlando, FL'},
  {m:['usf','south florida'],name:'University of South Florida',city:'Tampa, FL'},
  {m:['fordham'],name:'Fordham',city:'New York, NY'},
  {m:['syracuse','cuse'],name:'Syracuse',city:'Syracuse, NY'},
  {m:['villanova','nova'],name:'Villanova',city:'Villanova, PA'},
  {m:['drexel'],name:'Drexel',city:'Philadelphia, PA'},
  {m:['temple'],name:'Temple',city:'Philadelphia, PA'},
  {m:['pitt','pittsburgh','university of pittsburgh'],name:'University of Pittsburgh',city:'Pittsburgh, PA'},
  {m:['uconn','connecticut'],name:'UConn',city:'Storrs, CT'},
  {m:['umass','massachusetts amherst','umass amherst'],name:'UMass Amherst',city:'Amherst, MA'},
  {m:['tufts'],name:'Tufts',city:'Medford, MA'},
  {m:['brandeis'],name:'Brandeis',city:'Waltham, MA'},
  {m:['wake forest'],name:'Wake Forest',city:'Winston-Salem, NC'},
  {m:['american','american university'],name:'American University',city:'Washington, DC'},
  {m:['george washington','gwu','gw'],name:'George Washington',city:'Washington, DC'},
  {m:['howard'],name:'Howard',city:'Washington, DC'},
  {m:['spelman'],name:'Spelman',city:'Atlanta, GA'},
  {m:['morehouse'],name:'Morehouse',city:'Atlanta, GA'},
  {m:['santa clara','scu'],name:'Santa Clara',city:'Santa Clara, CA'},
  {m:['pepperdine'],name:'Pepperdine',city:'Malibu, CA'},
  {m:['loyola marymount','lmu'],name:'Loyola Marymount',city:'Los Angeles, CA'},
  {m:['sdsu','san diego state'],name:'San Diego State',city:'San Diego, CA'},
  {m:['cal poly','cal poly slo'],name:'Cal Poly SLO',city:'San Luis Obispo, CA'},
  {m:['ucsc','uc santa cruz','santa cruz'],name:'UC Santa Cruz',city:'Santa Cruz, CA'},
  {m:['ucr','uc riverside','riverside'],name:'UC Riverside',city:'Riverside, CA'},
  {m:['ucm','uc merced','merced'],name:'UC Merced',city:'Merced, CA'},
  {m:['stony brook','suny stony brook'],name:'Stony Brook',city:'Stony Brook, NY'},
  {m:['buffalo','suny buffalo','ub'],name:'University at Buffalo',city:'Buffalo, NY'},
  {m:['binghamton','suny binghamton'],name:'Binghamton',city:'Binghamton, NY'},
  // --- Additional US News Top-100 National Universities ---
  {m:['william and mary','william & mary','w&m','wm'],name:'William & Mary',city:'Williamsburg, VA'},
  {m:['lehigh'],name:'Lehigh',city:'Bethlehem, PA'},
  {m:['stevens','stevens institute'],name:'Stevens Institute of Technology',city:'Hoboken, NJ'},
  {m:['worcester','wpi','worcester polytechnic'],name:'Worcester Polytechnic (WPI)',city:'Worcester, MA'},
  {m:['rit','rochester institute'],name:'Rochester Institute of Technology (RIT)',city:'Rochester, NY'},
  {m:['colorado mines','school of mines','mines','colorado school of mines'],name:'Colorado School of Mines',city:'Golden, CO'},
  {m:['nyu poly tandon','tandon'],name:'NYU Tandon',city:'Brooklyn, NY'},
  {m:['miami ohio','miami university','miami of ohio'],name:'Miami University (Ohio)',city:'Oxford, OH'},
  {m:['marquette'],name:'Marquette',city:'Milwaukee, WI'},
  {m:['saint louis','slu','st louis university'],name:'Saint Louis University',city:'St. Louis, MO'},
  {m:['loyola chicago','loyola university chicago'],name:'Loyola University Chicago',city:'Chicago, IL'},
  {m:['depaul'],name:'DePaul',city:'Chicago, IL'},
  {m:['clark university'],name:'Clark University',city:'Worcester, MA'},
  {m:['yeshiva'],name:'Yeshiva University',city:'New York, NY'},
  {m:['the new school','new school','parsons'],name:'The New School',city:'New York, NY'},
  {m:['iit','illinois tech','illinois institute'],name:'Illinois Institute of Technology (IIT)',city:'Chicago, IL'},
  {m:['texas tech','ttu'],name:'Texas Tech',city:'Lubbock, TX'},
  {m:['oklahoma','university of oklahoma','ou'],name:'University of Oklahoma',city:'Norman, OK'},
  {m:['oklahoma state','okstate'],name:'Oklahoma State',city:'Stillwater, OK'},
  {m:['kansas state','k-state','ksu'],name:'Kansas State',city:'Manhattan, KS'},
  {m:['new hampshire','unh','university of new hampshire'],name:'University of New Hampshire',city:'Durham, NH'},
  {m:['vermont','uvm','university of vermont'],name:'University of Vermont',city:'Burlington, VT'},
  {m:['delaware','udel','university of delaware'],name:'University of Delaware',city:'Newark, DE'},
  {m:['drake'],name:'Drake',city:'Des Moines, IA'},
  {m:['denver','university of denver','du'],name:'University of Denver',city:'Denver, CO'},
  {m:['university of san diego','usd'],name:'University of San Diego',city:'San Diego, CA'},
  {m:['gonzaga'],name:'Gonzaga',city:'Spokane, WA'},
  {m:['creighton'],name:'Creighton',city:'Omaha, NE'},
  {m:['duquesne'],name:'Duquesne',city:'Pittsburgh, PA'},
  {m:['seton hall'],name:'Seton Hall',city:'South Orange, NJ'},
  {m:['catholic university','cua'],name:'Catholic University of America',city:'Washington, DC'},
  {m:['hofstra'],name:'Hofstra',city:'Hempstead, NY'},
  {m:['st johns','st johns university','saint johns'],name:"St. John's University",city:'Queens, NY'},
  {m:['tulsa','university of tulsa'],name:'University of Tulsa',city:'Tulsa, OK'},
  {m:['new mexico','unm','university of new mexico'],name:'University of New Mexico',city:'Albuquerque, NM'},
  {m:['washington state','wsu','wazzu'],name:'Washington State',city:'Pullman, WA'},
  {m:['mississippi state'],name:'Mississippi State',city:'Starkville, MS'},
  {m:['arkansas','university of arkansas'],name:'University of Arkansas',city:'Fayetteville, AR'},
  {m:['west virginia','wvu'],name:'West Virginia University',city:'Morgantown, WV'},
  {m:['rhode island','uri','university of rhode island'],name:'University of Rhode Island',city:'Kingston, RI'},
  {m:['maine','university of maine','umaine'],name:'University of Maine',city:'Orono, ME'},
  {m:['montana','university of montana'],name:'University of Montana',city:'Missoula, MT'},
  {m:['wyoming','university of wyoming'],name:'University of Wyoming',city:'Laramie, WY'},
  {m:['idaho','university of idaho'],name:'University of Idaho',city:'Moscow, ID'},
  {m:['north dakota','und','university of north dakota'],name:'University of North Dakota',city:'Grand Forks, ND'},
  {m:['south dakota','usd vermillion','university of south dakota'],name:'University of South Dakota',city:'Vermillion, SD'},
  {m:['cincinnati','uc cincinnati','university of cincinnati'],name:'University of Cincinnati',city:'Cincinnati, OH'},
  {m:['ohio university','ohio u'],name:'Ohio University',city:'Athens, OH'},
  {m:['kent state'],name:'Kent State',city:'Kent, OH'},
  {m:['louisville','university of louisville'],name:'University of Louisville',city:'Louisville, KY'},
  {m:['vcu','virginia commonwealth'],name:'Virginia Commonwealth (VCU)',city:'Richmond, VA'},
  {m:['george mason','gmu'],name:'George Mason',city:'Fairfax, VA'},
  {m:['old dominion','odu'],name:'Old Dominion',city:'Norfolk, VA'},
  {m:['james madison','jmu'],name:'James Madison',city:'Harrisonburg, VA'},
  {m:['fau','florida atlantic'],name:'Florida Atlantic',city:'Boca Raton, FL'},
  {m:['fiu','florida international'],name:'Florida International (FIU)',city:'Miami, FL'},
  {m:['georgia state','gsu'],name:'Georgia State',city:'Atlanta, GA'},
  {m:['ut dallas','utd','texas dallas'],name:'UT Dallas',city:'Richardson, TX'},
  {m:['ut arlington','uta'],name:'UT Arlington',city:'Arlington, TX'},
  {m:['utsa','ut san antonio'],name:'UT San Antonio',city:'San Antonio, TX'},
  {m:['colorado state','csu'],name:'Colorado State',city:'Fort Collins, CO'},
  // --- US News Top-100 National Liberal Arts Colleges ---
  {m:['williams','williams college'],name:'Williams College',city:'Williamstown, MA'},
  {m:['amherst','amherst college'],name:'Amherst College',city:'Amherst, MA'},
  {m:['swarthmore'],name:'Swarthmore',city:'Swarthmore, PA'},
  {m:['pomona'],name:'Pomona',city:'Claremont, CA'},
  {m:['wellesley'],name:'Wellesley',city:'Wellesley, MA'},
  {m:['bowdoin'],name:'Bowdoin',city:'Brunswick, ME'},
  {m:['carleton'],name:'Carleton',city:'Northfield, MN'},
  {m:['claremont mckenna','cmc'],name:'Claremont McKenna',city:'Claremont, CA'},
  {m:['middlebury'],name:'Middlebury',city:'Middlebury, VT'},
  {m:['davidson'],name:'Davidson',city:'Davidson, NC'},
  {m:['washington and lee','w&l','wlu'],name:'Washington and Lee',city:'Lexington, VA'},
  {m:['hamilton','hamilton college'],name:'Hamilton College',city:'Clinton, NY'},
  {m:['colby'],name:'Colby',city:'Waterville, ME'},
  {m:['haverford'],name:'Haverford',city:'Haverford, PA'},
  {m:['vassar'],name:'Vassar',city:'Poughkeepsie, NY'},
  {m:['smith','smith college'],name:'Smith College',city:'Northampton, MA'},
  {m:['grinnell'],name:'Grinnell',city:'Grinnell, IA'},
  {m:['wesleyan','wesleyan university'],name:'Wesleyan University',city:'Middletown, CT'},
  {m:['bates'],name:'Bates',city:'Lewiston, ME'},
  {m:['colgate'],name:'Colgate',city:'Hamilton, NY'},
  {m:['harvey mudd','mudd'],name:'Harvey Mudd',city:'Claremont, CA'},
  {m:['barnard'],name:'Barnard',city:'New York, NY'},
  {m:['macalester'],name:'Macalester',city:'St. Paul, MN'},
  {m:['bryn mawr'],name:'Bryn Mawr',city:'Bryn Mawr, PA'},
  {m:['scripps'],name:'Scripps',city:'Claremont, CA'},
  {m:['richmond','university of richmond'],name:'University of Richmond',city:'Richmond, VA'},
  {m:['soka','soka university'],name:'Soka University of America',city:'Aliso Viejo, CA'},
  {m:['colorado college'],name:'Colorado College',city:'Colorado Springs, CO'},
  {m:['kenyon'],name:'Kenyon',city:'Gambier, OH'},
  {m:['mount holyoke','holyoke'],name:'Mount Holyoke',city:'South Hadley, MA'},
  {m:['oberlin'],name:'Oberlin',city:'Oberlin, OH'},
  {m:['bucknell'],name:'Bucknell',city:'Lewisburg, PA'},
  {m:['college of the holy cross','holy cross'],name:'Holy Cross',city:'Worcester, MA'},
  {m:['lafayette','lafayette college'],name:'Lafayette College',city:'Easton, PA'},
  {m:['skidmore'],name:'Skidmore',city:'Saratoga Springs, NY'},
  {m:['occidental'],name:'Occidental',city:'Los Angeles, CA'},
  {m:['pitzer'],name:'Pitzer',city:'Claremont, CA'},
  {m:['trinity college','trinity ct'],name:'Trinity College',city:'Hartford, CT'},
  {m:['franklin and marshall','f&m'],name:'Franklin & Marshall',city:'Lancaster, PA'},
  {m:['dickinson'],name:'Dickinson',city:'Carlisle, PA'},
  {m:['denison'],name:'Denison',city:'Granville, OH'},
  {m:['whitman'],name:'Whitman',city:'Walla Walla, WA'},
  {m:['union college','union ny'],name:'Union College',city:'Schenectady, NY'},
  {m:['connecticut college','conn college'],name:'Connecticut College',city:'New London, CT'},
  {m:['gettysburg'],name:'Gettysburg',city:'Gettysburg, PA'},
  {m:['lawrence','lawrence university'],name:'Lawrence University',city:'Appleton, WI'},
  {m:['sewanee','university of the south'],name:'Sewanee',city:'Sewanee, TN'},
  {m:['reed','reed college'],name:'Reed College',city:'Portland, OR'},
  {m:['st olaf','saint olaf'],name:'St. Olaf',city:'Northfield, MN'},
  {m:['centre','centre college'],name:'Centre College',city:'Danville, KY'},
  {m:['bard'],name:'Bard',city:'Annandale-on-Hudson, NY'},
  {m:['depauw'],name:'DePauw',city:'Greencastle, IN'},
  {m:['furman'],name:'Furman',city:'Greenville, SC'},
  {m:['rhodes','rhodes college'],name:'Rhodes College',city:'Memphis, TN'},
  {m:['kalamazoo'],name:'Kalamazoo',city:'Kalamazoo, MI'},
  {m:['wofford'],name:'Wofford',city:'Spartanburg, SC'},
  {m:['st lawrence','saint lawrence'],name:'St. Lawrence',city:'Canton, NY'},
  {m:['wabash'],name:'Wabash',city:'Crawfordsville, IN'},
  {m:['hillsdale'],name:'Hillsdale',city:'Hillsdale, MI'},
  {m:['berea'],name:'Berea',city:'Berea, KY'},
  {m:['agnes scott'],name:'Agnes Scott',city:'Decatur, GA'},
  {m:['beloit'],name:'Beloit',city:'Beloit, WI'},
  {m:['knox','knox college'],name:'Knox College',city:'Galesburg, IL'},
  {m:['lewis and clark','lewis & clark'],name:'Lewis & Clark',city:'Portland, OR'},
  {m:['willamette'],name:'Willamette',city:'Salem, OR'},
  {m:['earlham'],name:'Earlham',city:'Richmond, IN'},
  {m:['college of wooster','wooster'],name:'College of Wooster',city:'Wooster, OH'},
  {m:['allegheny'],name:'Allegheny',city:'Meadville, PA'},
  {m:['muhlenberg'],name:'Muhlenberg',city:'Allentown, PA'},
  {m:['ursinus'],name:'Ursinus',city:'Collegeville, PA'},
  {m:['st johns college','st johns annapolis'],name:"St. John's College",city:'Annapolis, MD'},
  {m:['hampshire','hampshire college'],name:'Hampshire College',city:'Amherst, MA'},
  {m:['wheaton il','wheaton college'],name:'Wheaton College (IL)',city:'Wheaton, IL'},
  {m:['gustavus adolphus'],name:'Gustavus Adolphus',city:'St. Peter, MN'},
  {m:['hope college'],name:'Hope College',city:'Holland, MI'},
  {m:['hendrix'],name:'Hendrix',city:'Conway, AR'},
  {m:['cornell college'],name:'Cornell College',city:'Mount Vernon, IA'},
  {m:['luther college'],name:'Luther College',city:'Decorah, IA'},
  {m:['ohio wesleyan'],name:'Ohio Wesleyan',city:'Delaware, OH'},
  {m:['transylvania'],name:'Transylvania',city:'Lexington, KY'},
  {m:['austin college'],name:'Austin College',city:'Sherman, TX'},
  {m:['southwestern','southwestern university'],name:'Southwestern University',city:'Georgetown, TX'},
  {m:['st marys college maryland','st marys maryland'],name:"St. Mary's College of Maryland",city:'St. Marys City, MD'},
  {m:['goucher'],name:'Goucher',city:'Baltimore, MD'},
  {m:['juniata'],name:'Juniata',city:'Huntingdon, PA'},
  {m:['st michaels','saint michaels'],name:"St. Michael's College",city:'Colchester, VT'},
  {m:['hobart','william smith','hobart and william smith'],name:'Hobart & William Smith',city:'Geneva, NY'},
  {m:['college of the atlantic'],name:'College of the Atlantic',city:'Bar Harbor, ME'}
];

const QZ_Qs = [
  {id:0,type:'cards',q:"I am a…",sub:"Quick start — this tailors your major and class recommendations.",key:'stage',
    cards:[{l:'Freshman',k:'freshman'},{l:'Sophomore',k:'sophomore'},{l:'Junior',k:'junior'},{l:'Senior',k:'senior'}]},
  {id:1,type:'tags',q:"What subjects light you up?",sub:"Tap everything that excites you. Pick at least 4.",key:'subjects',min:4,max:10,
    tags:[{t:'🧮 Math',s:{tech:2,science:2,finance:3,engineering:2,cybersecurity:1}},{t:'✍️ Writing',s:{creative:3,marketing:2,education:2,law:1,media:2}},{t:'🔬 Science',s:{science:4,healthcare:2,engineering:1,pharmaceutical:2,agriculture:1}},{t:'🎨 Art & Design',s:{creative:4,marketing:2}},{t:'🎵 Music',s:{creative:3,education:1,media:1}},{t:'💼 Business',s:{business:3,finance:2,startups:1,operations:1,hr:1}},{t:'💻 Tech / Coding',s:{tech:4,engineering:2,cybersecurity:2,startups:1}},{t:'🧠 Psychology',s:{healthcare:2,social:2,education:2,marketing:1,hr:2}},{t:'📜 History',s:{education:2,law:2,creative:1,government:1}},{t:'🗣️ Languages',s:{social:2,education:2,creative:1,media:1}},{t:'⚖️ Politics',s:{law:3,social:2,education:1,government:2}},{t:'🏃 Sports',s:{marketing:1,business:1,sports:3}},{t:'🌿 Nature',s:{science:2,social:1,agriculture:3}},{t:'🩺 Medicine',s:{healthcare:4,science:1,pharmaceutical:2}},{t:'🏗️ Engineering',s:{engineering:4,tech:1,aerospace:2,trades:1}},{t:'🤔 Philosophy',s:{education:2,law:2,creative:1}},{t:'📈 Economics',s:{finance:3,business:3,realestate:1}},{t:'🎬 Film',s:{creative:3,marketing:2,media:3}},{t:'📷 Photography',s:{creative:3,marketing:1,media:2}},{t:'🌍 Global Issues',s:{social:3,law:2,government:1}},{t:'🔧 Hands-on Building',s:{trades:4,engineering:2,operations:1}},{t:'🛡️ Cybersecurity',s:{cybersecurity:4,tech:2}},{t:'✈️ Aviation',s:{aerospace:4,engineering:2}},{t:'🏨 Hospitality',s:{hospitality:4,business:1}}]},
  {id:2,type:'text',q:"What university are you enrolled at?",sub:"Type your school's name — we'll match majors and classes to it.",key:'school',placeholder:'e.g., UCLA, NYU, Boston College…'},
  {id:20,type:'multi',q:"Where in your career journey are you?",sub:"Select all that apply.",key:'goals',min:1,
    opts:[{t:'Choosing a college / university course'},{t:'Deciding my major'},{t:'Deciding on careers'},{t:'Learning about my personality'},{t:'Looking for internships'},{t:'Joining extracurriculars'},{t:'Pursuing passion projects'}]},
  {id:21,type:'multi',q:"What are you hoping to get from Flightway?",sub:"Select all that apply.",key:'goals2',min:1,
    opts:[{t:'Clarity on career direction'},{t:'Increased self-awareness'},{t:'Find matching careers'},{t:'A concrete action plan'},{t:'Mentor guidance'},{t:'Explore new fields'},{t:'Skills development'},{t:'All of the above',all:true}]},
  {id:9,type:'gpa',q:"What's your current GPA?",sub:"On a 4.0 scale. This helps us calibrate recommendations.",key:'gpa'},
  {id:3,type:'pairs',q:"Quick gut check — which matters more to you?",sub:"Go with your first instinct.",key:'pairs',
    pairs:[{a:{t:'Making a lot of money',s:{finance:3,business:2,law:2,realestate:1}},b:{t:'Making a real difference',s:{social:3,healthcare:2,education:2}}},{a:{t:'Clear structure',s:{law:2,finance:2,engineering:2,healthcare:1,government:2}},b:{t:'Creative freedom',s:{creative:3,startups:1,marketing:1,media:2}}},{a:{t:'Leave weekends for relaxing',s:{education:2,social:2,healthcare:1}},b:{t:'More hours, more money',s:{finance:3,law:2,business:2}}},{a:{t:'Impress the relatives',s:{law:2,finance:2,business:2,marketing:1}},b:{t:'Do something I love',s:{creative:3,social:2,education:1,startups:1}}}]},
  {id:4,type:'tot',q:"This or that — follow your gut.",sub:"Both have real appeal. Pick the one that pulls harder.",
    cards:[
      {a:{t:'🌴 Leave weekends for relaxing',s:{education:2,social:2,healthcare:1}},  b:{t:'💰 More hours, more money',s:{finance:3,law:2,business:2}}},
      {a:{t:'🤝 Help those in need',s:{social:3,healthcare:3,education:2}},            b:{t:'🏆 Impress the relatives',s:{law:2,finance:2,business:2,marketing:1}}},
      {a:{t:'🏗️ Build something from scratch',s:{startups:3,engineering:2,tech:2}},   b:{t:'✨ Polish something to perfection',s:{creative:3,marketing:2,engineering:1}}},
      {a:{t:'🗣️ Know everyone in the building',s:{business:2,marketing:2,social:1}},  b:{t:'🎧 Deep focus, headphones on',s:{science:2,tech:2,engineering:2}}},
      {a:{t:'✈️ Travel the world for your work',s:{business:2,marketing:2,startups:1}},b:{t:'🌱 Plant roots, build lasting impact',s:{education:2,social:2,healthcare:1}}},
      {a:{t:'🧠 Be the expert everyone calls',s:{science:2,law:2,healthcare:2,tech:1}},b:{t:'⚡ Lead the team everyone follows',s:{business:3,startups:2,marketing:1}}},
      {a:{t:'🔒 Steady paycheck, no surprises',s:{healthcare:1,education:2,engineering:2}},b:{t:'🚀 Bet on yourself, big upside',s:{startups:3,finance:2,creative:1}}},
      {a:{t:'🎨 Creative freedom every day',s:{creative:3,marketing:2,startups:1}},    b:{t:'📐 Clear structure, predictable wins',s:{engineering:2,finance:2,law:1}}}
    ]},
  {id:5,type:'multi',q:"What type of work environment do you think would suit you best?",sub:"Select all that apply.",key:'env',min:1,
    opts:[{t:'Startup (fast-paced)',s:{startups:4,tech:2,marketing:1}},{t:'Corporate (structured)',s:{finance:3,business:3,law:2,hr:1}},{t:'Non-profit (mission-driven)',s:{social:4,education:2,healthcare:1}},{t:'Academic (research-focused)',s:{science:4,education:3,healthcare:1}},{t:'Creative (artistic)',s:{creative:4,marketing:2,media:2}},{t:'Small business (family-owned)',s:{business:2,trades:2,operations:1}},{t:'Remote (distributed)',s:{tech:3,creative:2,marketing:2,cybersecurity:1}},{t:'Entrepreneur (self-employed)',s:{startups:4,business:2,creative:1}},{t:'Freelance (self-employed)',s:{creative:3,marketing:2,tech:1,media:1}},{t:'Other (not sure yet)',s:{}}]},
  {id:6,type:'mc',q:"When you tackle a hard problem, your instinct is to:",sub:'',
    opts:[{t:'Crunch the data and find the pattern',s:{tech:3,finance:3,science:3}},{t:'Sketch wild ideas and prototype',s:{creative:3,startups:3,marketing:2}},{t:'Talk to people and build consensus',s:{business:3,law:2,education:2,social:2}},{t:'Apply proven frameworks methodically',s:{engineering:3,healthcare:2,law:2,finance:1}}]},
  {id:7,type:'sl',q:"How risk-tolerant are you in career decisions?",ll:'Risk-averse',rl:'Risk-loving',key:'risk',
    score:v=>{const x=v/100;return{startups:qzR(x*3),finance:qzR(x*3),tech:qzR(x*2),aerospace:qzR(x*2),healthcare:qzR((1-x)*3),law:qzR((1-x)*2),education:qzR((1-x)*2),government:qzR((1-x)*2),trades:qzR((1-x)*2)}}},
  {id:8,type:'map2d',q:"Where do you sit on these two dimensions?",sub:"Click or drag anywhere on the grid.",key:'map',
    yTop:'Highly Creative',yBot:'Highly Structured',xLeft:'Solo Worker',xRight:'Team Player',
    score:p=>{const cx=p.x/100,cy=p.y/100;return{creative:qzR(cy*3),startups:qzR(cy*2),marketing:qzR(cy*2+cx*1),law:qzR((1-cy)*3),finance:qzR((1-cy)*2),engineering:qzR((1-cy)*2),tech:qzR((1-cx)*2),science:qzR((1-cx)*3),business:qzR(cx*3),healthcare:qzR(cx*2),social:qzR(cx*2),education:qzR(cx*1)}}},
  {id:10,type:'emoji',q:"How do you react to these scenarios?",sub:"Pick the emoji that captures your gut feeling.",key:'emoji',
    rows:[{t:"Spending all day in spreadsheets, hunting for insights",ind:['finance','tech','science']},{t:"Leading a tense client negotiation",ind:['business','law','marketing']},{t:"Writing a long research paper",ind:['education','science','law']},{t:"Helping someone through a personal crisis",ind:['healthcare','social','education']},{t:"Pitching a wild idea to skeptical investors",ind:['startups','business','marketing']},{t:"Designing a brand identity from a blank canvas",ind:['creative','marketing','startups']}]},
  {id:11,type:'dial',q:"What work intensity actually energizes you?",sub:"Drag the slider or click the dial. Chill flow vs. high-stakes pressure.",key:'intensity',
    labels:['Calm & steady','Engaged but easy','Active & purposeful','High-tempo','Pressure-cooker'],
    score:v=>{const x=v/100;return{startups:qzR(x*4),finance:qzR(x*2),business:qzR(x*2),law:qzR(x*2),education:qzR((1-x)*3),social:qzR((1-x)*2),science:qzR((1-x)*2)}}},
  {id:12,type:'yesno',q:"Quick check — how do you act in groups?",sub:"Five honest statements. No wrong answers.",
    items:[
      {t:"I raise my hand and speak up — usually one of the most vocal in the room.",yes:{business:2,law:2,marketing:2,startups:1},no:{tech:1,science:1,engineering:1}},
      {t:"I watch lectures and videos at 1.5× or 2× speed.",yes:{tech:2,startups:2,engineering:1,finance:1},no:{education:1,social:1}},
      {t:"My social life is intense and unpredictable — a total rollercoaster.",yes:{startups:2,creative:2,marketing:1},no:{science:1,engineering:1,education:1}},
      {t:"When a group project kicks off, I'm usually the one who takes charge.",yes:{business:2,law:2,startups:1,marketing:1},no:{tech:1,science:2,engineering:1}},
      {t:"I regularly stay up late reading or researching things I'm curious about — even when I don't have to.",yes:{science:3,education:2,tech:1},no:{business:1,marketing:1}}
    ]},
  {id:13,type:'spec',q:"Which career trajectory sounds most YOU?",sub:"Pick the path that feels right.",key:'path',
    stops:[{l:'Stable corporate ladder',s:{finance:3,business:2,law:2,healthcare:1}},{l:'Professional craft',s:{healthcare:2,education:2,law:1,engineering:2}},{l:'Balanced growth path',s:{business:1,tech:1,marketing:1,education:1}},{l:'Fast-moving company',s:{tech:2,marketing:2,startups:2}},{l:'Bold founder/builder',s:{startups:4,creative:1,tech:1}}]},
  {id:15,type:'swipe',q:"Yes or no — how do you feel about these statements?",sub:"5 quick swipes. Auto-advances after last.",key:'swipes',
    cards:[{t:'I love being the center of attention',y:{marketing:2,creative:2,law:1,business:1},n:{tech:1,science:1,engineering:1}},{t:"I'd rather build than manage",y:{tech:2,engineering:2,creative:1,startups:1},n:{business:2,law:1}},{t:'Deadlines genuinely energize me',y:{startups:2,marketing:2,business:1,creative:1},n:{education:1,science:1,healthcare:1}},{t:'I want to be known as THE expert in my field',y:{science:2,law:2,healthcare:1,tech:1},n:{startups:1,marketing:1}},{t:'I trust my instincts more than the data',y:{creative:2,startups:2,marketing:1},n:{science:2,finance:2,engineering:1,tech:1}}]},
  {id:16,type:'rank',q:"Rank these activities by how appealing they sound.",sub:"Tap in order — 1 is most appealing.",key:'activities',
    items:[{t:'Writing code to build something new',s:{tech:3,engineering:1,startups:1}},{t:'Diagnosing and treating a patient',s:{healthcare:4}},{t:'Closing a high-stakes deal',s:{business:3,finance:2,law:1}},{t:'Designing a beautiful interface or product',s:{creative:3,marketing:1,tech:1}},{t:'Teaching a class that changes someone\'s life',s:{education:4,social:1}},{t:'Running an experiment that proves a hypothesis',s:{science:4,tech:1}}]},
  {id:17,type:'mc',q:"What's your biggest career fear?",sub:'One last gut check.',other:true,otherKey:'fear',
    opts:[{t:'Being stuck in something boring forever',s:{startups:3,creative:2,marketing:2,tech:1}},{t:'Not earning enough to live the life I want',s:{finance:3,business:2,law:2,tech:1}},{t:'Not making a meaningful impact',s:{social:3,healthcare:3,education:2}},{t:'Picking the wrong field and starting over',s:{business:1,tech:1,marketing:1}},{t:'Burning out under pressure',s:{education:2,social:1,creative:1}}]},
  {id:18,type:'mc',q:"Which sounds most like your ideal workday?",sub:'',
    opts:[{t:'Heads-down building, coding, or engineering something new',s:{tech:4,engineering:3,science:1}},{t:'Meetings, presentations, negotiations, strategy',s:{business:4,law:3,finance:2,marketing:2}},{t:'Designing, creating, or producing original work',s:{creative:4,marketing:2,startups:1}},{t:'Working directly with patients, clients, or students',s:{healthcare:4,social:3,education:3}},{t:'Research, analysis, writing, deep thought',s:{science:4,education:2,law:1,tech:1}}]},
  {id:22,type:'mc',q:"How much social interaction do you want in your work?",sub:'',
    opts:[{t:'As little as possible. Let me work alone.',s:{tech:3,science:2,engineering:2,creative:1}},{t:'Minimal — just enough to get by.',s:{tech:2,science:2,engineering:1}},{t:'Balanced. Some solo, some people time.',s:{business:1,healthcare:1,education:1,marketing:1}},{t:'I like being around others regularly.',s:{business:2,healthcare:2,education:2,marketing:1,hr:1}},{t:'I need constant interaction to stay energized.',s:{business:3,marketing:3,social:2,hr:2,law:1}}]},
  {id:23,type:'name',q:"Last one — what's your first name?",sub:"So we can personalize your Career Hub.",key:'name',placeholder:'Your first name'},
  {id:24,type:'leaning',q:"Already have a career in mind?",sub:"Most people come in with a leaning — tell us and we'll take it seriously. Totally fine to skip if you're wide open.",key:'leaning',placeholder:'e.g. Lawyer, software engineer, nurse…'}
];

// ── INITIAL vs HUB split ──────────────────────────────────────────────────
// The initial quiz is intentionally short + fun (lowest friction → the reveal).
// Everything else moves to the Career Hub "Sharpen your matches" panel.
// QZ_ACTIVE is the ordered list the quiz actually plays; QZ_HUB is the rest.
// Scoring (qzComputeScores) keys off question `id`, so it works regardless of
// which screen captured the answer.
//
// V2 S6 (D8): the pre-signup set now carries EIGHT scoring maps (was four —
// only 3/5/17/22 scored, so a generic profile could not be told apart). The 8
// scored ids are 1,18,3,5,6,22,16,17; leaning (24) opens and feeds a score boost
// but carries no s:{}; goals2 (21) closes for personalization. Name/school/grade
// (old ids 23/2/0) are OUT of the scored flow — collected post-signup (name at
// the gate; year+school in the Academic Profile step). Everything downstream
// degrades gracefully when they are absent: qzBuildHubPayload falls back
// (name→'Student', year/school→null), academics uses its `_default` major copy,
// and the school-dependent blurbs simply omit (qzSchoolBlurb returns '').
const QZ_INITIAL_IDS = [24, 1, 18, 3, 5, 6, 22, 16, 17, 21];
const QZ_ACTIVE = QZ_INITIAL_IDS.map(id => QZ_Qs.find(q => q.id === id)).filter(Boolean);
const QZ_HUB = QZ_Qs.filter(q => QZ_INITIAL_IDS.indexOf(q.id) === -1);

const QZ_COMBOS = [
  {id:'tech-creative',lbl:'Rare!',color:'#7c3aed',title:'The Technical Creative',
   desc:"You blend analytical precision with creative vision. Fewer than 1 in 12 profiles hit this combo — and the modern economy desperately wants it.",
   check:s=>{const m=s.answers.map;return m && m.y>65 && (s.budget.flex>20||s.sliders.risk>65)}},
  {id:'bold-autonomy',lbl:'Bold!',color:'#dc2626',title:'Entrepreneurial Force',
   desc:"High risk tolerance plus a drive for independence is a rare combination. You're not built to be managed — you're built to build.",
   check:s=>s.sliders.risk>70 && (s.budget.salary||0)<25 && s.spectrum>=3},
  {id:'purpose-driven',lbl:'Inspiring!',color:'#059669',title:'Purpose-Driven Leader',
   desc:"You put meaning above money and ambition above ease. That combination produces the most resilient, beloved careers of all.",
   check:s=>(s.budget.purpose||0)>=25 && (s.budget.salary||0)<=15},
  {id:'productive',lbl:'Productive!',color:'var(--primary-solid)',title:'High-Output Optimizer',
   desc:"You want top-tier compensation AND time for life. That's disciplined ambition — and it's how the best modern careers are built.",
   check:s=>(s.budget.salary||0)>=25 && (s.budget.flex||0)>=20},
  {id:'unicorn',lbl:'Unicorn!',color:'#0891b2',title:'Technical Empath',
   desc:"Technical strength PLUS strong people orientation — this is the rarest professional profile on earth. Companies fight to hire you.",
   check:s=>{const m=s.answers.map;return m && m.x>65 && s.subjects.includes('💻 Tech / Coding')}},
  {id:'scholar',lbl:'Brilliant!',color:'#7c3aed',title:'The Scholar',
   desc:"Deep curiosity plus the patience for hard, long-term work. The world runs out of people like you — and pays accordingly.",
   check:s=>s.gpa>=3.85 && s.subjects.some(t=>['🔬 Science','🤔 Philosophy','📜 History'].includes(t))},
  {id:'dynamo',lbl:'Dynamo!',color:'#d97706',title:'High-Velocity Leader',
   desc:"Fast pace plus a drive to lead from the front. That's the signature of high-performing executives. You move fast and bring people with you.",
   check:s=>s.sliders.intensity>72 && (s.budget.recog||0)>=18}
];

// Quiz state
let qzCur=0, qzAns={}, qzSliders={};
let qzAnswers={pairs:{},pairsOwn:{},tot:{},env:[],map:null,emoji:{},swipes:{},yesno:{},rank:{},spectrum:null,subjects:[],multi:{},mcOther:{}};
let qzName='';
let qzLeaning='';
// Resolved from qzLeaning against the catalog (async, best-effort). The zone
// feeds a sector-score boost in qzComputeScores (recomputed fresh, same idiom
// as qzResumeBoosts); the SOC is persisted so ranking can bonus the exact pick.
let qzLeaningZone=null, qzLeaningSoc=null;
function qzResolveLeaning(){
  const text=(qzLeaning||'').trim();
  if(!text || !window.FWOnetCatalog || typeof FWOnetCatalog.load!=='function') return Promise.resolve();
  return FWOnetCatalog.load().then(function(){
    const hit=(FWOnetCatalog.searchByTitle(text,1)||[])[0];
    if(hit){ qzLeaningZone=hit.hubZone||null; qzLeaningSoc=hit.soc||null; }
  }).catch(function(){ /* leaning stays a copy-level ack only */ });
}
let qzBudget={salary:17,purpose:17,flex:16,growth:17,recog:16,security:17};
let qzGpa=null, qzSchool=null, qzSchoolMatch=null, qzStage=null;
let qzShownCombos=new Set();
let qzPairsIdx=0, qzSwipeIdx=0, qzYesNoIdx=0, qzTotIdx=0, qzSelectedBItem=null, qzSelectedTItem=null;
let qzYesNoCustomOpen=new Set();
let qzResumeText=null, qzResumeBoosts={}, qzResumeSummary='', qzObjectiveSkipped=false, qzResumeFile=null, qzResumeApplying=false;
let qzEnrichBoosts={}, qzCharacterSummary='', qzEnrichTraits=[], qzEnrichDone=false;
let qzAudioCtx=null, qzRevealTimers=[], qzParticleRAF=null, qzPlacementPct={}, qzPlacementSoc={};
// Resolves when the signup-gate confetti has fully finished — the post-signup
// résumé prompt waits on this so it never fights the celebration.
let qzConfettiDonePromise=Promise.resolve();
let qzResumeStepResolve=null;

function qzR(x){return Math.round(x)}

function qzStart(){
  document.getElementById('qz-intro').classList.add('qz-hidden');
  document.getElementById('qz-quiz').classList.remove('qz-hidden');
  qzStartedAt = Date.now(); qzLastViewedIdx = -1;
  try { if (global.FWEvents) FWEvents.log('quiz_start', {}); } catch (_) {}
  qzRenderQ(0);
}

// Eased progress: fills fast at the start, crawls through the last ~20%.
// p^0.45 is concave (big early jumps, small late ones) — keeps momentum high
// while the finish line feels "just one more" near the end.
function qzProgressPct(idx,total){
  const p=(idx+1)/total;
  return Math.round(Math.pow(p,0.45)*100);
}

function qzRenderQ(idx){
  const q=QZ_ACTIVE[idx];
  // Guarded on idx: this renderer re-runs on every keystroke in the school field
  // and every checkbox/pair toggle, so an unguarded log would be hundreds of
  // views per run. Back-then-forward legitimately re-fires the idx.
  try { if (qzLastViewedIdx !== idx) { qzLastViewedIdx = idx; if (global.FWEvents) FWEvents.log('quiz_q_view', { idx: idx, phase: 'initial' }); } } catch (_) {}
  const pct=qzProgressPct(idx,QZ_ACTIVE.length);
  const lbl=document.getElementById('qz-q-label'); if(lbl) lbl.textContent='About you';
  const pctEl=document.getElementById('qz-q-pct'); if(pctEl) pctEl.textContent='';
  document.getElementById('qz-prog-fill').style.width=`${pct}%`;

  let h=`<div class="qz-q-text">${q.q}</div>`;
  if(q.sub) h+=`<div class="qz-q-sub">${q.sub}</div>`;
  let inputHtml='';
  try { inputHtml=qzRenderInput(q,idx); }
  catch(err){ console.error('Quiz render error on Q'+(idx+1)+':',err); inputHtml=`<div style="padding:30px;background:#fef2f2;border:2px solid #fecaca;border-radius:12px;text-align:center;color:#991b1b"><div style="font-weight:700;margin-bottom:8px">This question had a rendering issue.</div><div style="font-size:13px;margin-bottom:14px">You can skip ahead — your earlier answers are saved.</div><button class="qz-btn-next" onclick="qzForceNext()">Skip this question →</button></div>`; }
  h+=inputHtml;

  const isLast=idx===QZ_ACTIVE.length-1;
  const ok=qzCanNext(q);
  h+=`<div class="qz-nav-buttons">
    <button class="qz-btn-back" onclick="qzGoBack()" style="${idx===0?'visibility:hidden':''}">← Back</button>
    <button class="qz-btn-next" id="qz-btn-next" onclick="qzGoNext()" ${ok?'':'disabled'}>${isLast?'See Results →':'Next →'}</button>
  </div>`;
  document.getElementById('qz-qcard').innerHTML=h;
  qzUpdateEncouragement(idx);
  if(q.type==='map2d') qzSetupMap();
  if(q.type==='name'){ const ni=document.getElementById('qz-name-q-in'); if(ni) setTimeout(()=>{ni.focus();ni.setSelectionRange(ni.value.length,ni.value.length);},60); }
}

function qzUpdateEncouragement(idx){
  const el=document.getElementById('qz-encouragement');
  if(!el) return;
  el.textContent='';
  el.className='qz-encouragement';
}

function qzRenderInput(q,idx){
  if(q.type==='cards'){
    const letters=['A','B','C','D','E','F'];
    return `<div class="opts">${q.cards.map((c,i)=>`<button class="opt ${qzStage===c.k?'sel':''}" onclick="qzPickCard('${c.k}')"><span class="opt-letter">${letters[i]}</span><span class="opt-text">${c.l}</span></button>`).join('')}</div>`;
  }
  if(q.type==='tags'){
    return `<div class="qtags">${q.tags.map((t,i)=>{const sel=qzAnswers.subjects.includes(t.t);return `<span class="qtag ${sel?'sel':''}" onclick="qzToggleTag(${i})">${t.t}</span>`}).join('')}</div><div class="tag-counter">Selected: ${qzAnswers.subjects.length} (need at least ${q.min})</div>`;
  }
  if(q.type==='text'){
    let sugHtml='';
    if(qzSchool && qzSchool.length>0 && !qzSchoolMatch){
      const lc=qzSchool.toLowerCase();
      const matches=QZ_SCHOOLS.filter(s=>s.m.some(m=>m.includes(lc))||s.name.toLowerCase().includes(lc)).slice(0,6);
      if(matches.length) sugHtml=`<div class="school-suggest">${matches.map(m=>`<div class="sug-item" onclick="qzPickSchool('${m.name.replace(/'/g,"\\'")}')">${m.name}<span class="sug-city">${m.city}</span></div>`).join('')}</div>`;
    }
    const metaTxt=qzSchoolMatch?`✓ ${qzSchoolMatch.name} — ${qzSchoolMatch.city}`:'';
    return `<div class="text-input-wrap"><input class="text-input" id="qz-school-in" type="text" placeholder="${q.placeholder}" value="${(qzSchool||'').replace(/"/g,'&quot;')}" oninput="qzHandleSchool(this.value)" autocomplete="off">${sugHtml}<div class="text-meta">${metaTxt}</div></div>`;
  }
  if(q.type==='name'){
    return `<div class="text-input-wrap"><input class="text-input" id="qz-name-q-in" type="text" placeholder="${q.placeholder}" value="${(qzName||'').replace(/"/g,'&quot;')}" oninput="qzHandleNameInput(this.value)" onkeydown="if(event.key==='Enter'&&qzCanNext(QZ_ACTIVE[qzCur]))qzGoNext()" autocomplete="given-name"></div>`;
  }
  if(q.type==='leaning'){
    return `<div class="text-input-wrap"><input class="text-input" id="qz-leaning-in" type="text" placeholder="${q.placeholder}" value="${(qzLeaning||'').replace(/"/g,'&quot;')}" oninput="qzHandleLeaningInput(this.value)" onkeydown="if(event.key==='Enter')qzGoNext()" autocomplete="off"><div class="text-meta">Optional — leave blank to explore wide open.</div></div>`;
  }
  if(q.type==='pairs'){
    if(qzPairsIdx>=q.pairs.length) return `<div style="text-align:center;padding:30px 0"><div style="font-size:48px;margin-bottom:14px">✓</div><div style="font-size:16px;font-weight:700;color:var(--q-green)">All done! Continuing...</div></div>`;
    const p=q.pairs[qzPairsIdx];
    const ownVal=(qzAnswers.pairsOwn&&qzAnswers.pairsOwn[qzPairsIdx])||'';
    return `<div class="pairs-prog">Round ${qzPairsIdx+1} of ${q.pairs.length}</div><div class="pair-vs"><div class="pair-card" onclick="qzPickPair(${qzPairsIdx},'a')">${p.a.t}</div><div class="pair-vs-mid">vs</div><div class="pair-card" onclick="qzPickPair(${qzPairsIdx},'b')">${p.b.t}</div></div><div class="pair-own"><input class="pair-own-input" id="qz-pair-own" type="text" placeholder="Or enter your own answer…" value="${ownVal.replace(/"/g,'&quot;')}" oninput="qzPairOwnInput(${qzPairsIdx},this.value)" onkeydown="if(event.key==='Enter')qzPickPairOwn(${qzPairsIdx})"><button class="pair-own-btn" onclick="qzPickPairOwn(${qzPairsIdx})">Continue →</button></div>`;
  }
  if(q.type==='tot'){
    if(qzTotIdx>=q.cards.length) return `<div style="text-align:center;padding:30px 0"><div style="font-size:48px;margin-bottom:14px">✓</div><div style="font-size:16px;font-weight:700;color:var(--q-green)">All done! Continuing...</div></div>`;
    const card=q.cards[qzTotIdx];
    return `<div class="pairs-prog">Pair ${qzTotIdx+1} of ${q.cards.length}</div><div class="pair-vs"><div class="tot-card" onclick="qzPickTot(${qzTotIdx},'a')">${card.a.t}</div><div class="tot-or">or</div><div class="tot-card" onclick="qzPickTot(${qzTotIdx},'b')">${card.b.t}</div></div>`;
  }
  if(q.type==='vpicker'){
    const picked=qzAnswers.env;
    return `<div class="vpicker">${q.options.map((o,i)=>{const pi=picked.indexOf(i);const sel=pi!==-1?'sel':'';const dis=picked.length>=q.pick&&pi===-1?'disabled':'';return `<div class="vpick ${sel} ${dis}" onclick="qzPickEnv(${i})">${pi!==-1?`<div class="vpick-num">${pi+1}</div>`:''}<div class="vpick-icon">${o.icon}</div><div class="vpick-lbl">${o.l}</div></div>`}).join('')}</div><div class="vpicker-hint">${picked.length} of ${q.pick} selected</div>`;
  }
  if(q.type==='multi'){
    const picked=qzAnswers.multi[q.id]||[];
    const hint=q.max?`${picked.length} of ${q.max} selected`:`${picked.length} selected`;
    return `<div class="qz-multi">${q.opts.map((o,i)=>{const pi=picked.indexOf(i);const sel=pi!==-1?'sel':'';const dis=q.max&&picked.length>=q.max&&pi===-1?'disabled':'';return `<button class="qz-multi-opt ${sel} ${dis}" onclick="qzPickMulti(${q.id},${i})"><span class="qz-multi-check">${pi!==-1?'✓':''}</span><span class="qz-multi-text">${o.t}</span></button>`}).join('')}</div><div class="qz-multi-hint">${hint}</div>`;
  }
  if(q.type==='mc'){
    const letters=['A','B','C','D','E','F'];
    let h=`<div class="opts">${q.opts.map((o,i)=>{const sel=qzAns[q.id]===i?'sel':'';return `<button class="opt ${sel}" onclick="qzPickMC(${q.id},${i})"><span class="opt-letter">${letters[i]}</span><span class="opt-text">${o.t}</span></button>`}).join('')}</div>`;
    if(q.other){
      const ov=(qzAnswers.mcOther[q.id]||'');
      h+=`<div class="qz-mc-other"><textarea class="qz-mc-other-input" rows="2" placeholder="Other (optional) — tell us in your own words…" oninput="qzMcOtherInput(${q.id},this.value)">${ov.replace(/</g,'&lt;')}</textarea></div>`;
    }
    return h;
  }
  if(q.type==='sl'){
    const v=qzSliders[q.key]??50;
    const bg=qzSliderBg(v);
    return `<div class="slider-wrap"><div class="slider-labels"><span>${q.ll}</span><span>${q.rl}</span></div><input type="range" min="0" max="100" value="${v}" id="qz-sl-${q.id}" oninput="qzHandleSl(${q.id},'${q.key}',this.value)" style="background:${bg}"><div class="slider-val" id="qz-sval-${q.id}">${qzSlLabel(q,v)}</div></div>`;
  }
  if(q.type==='map2d'){
    const p=qzAnswers.map||{x:50,y:50};
    return `<div class="map2d-wrap"><div class="map2d" id="qz-map2d"><div class="map-axis-h"></div><div class="map-axis-v"></div><div class="map-lbl top">${q.yTop}</div><div class="map-lbl bot">${q.yBot}</div><div class="map-lbl left">${q.xLeft}</div><div class="map-lbl right">${q.xRight}</div><div class="map-dot" id="qz-map-dot" style="left:${p.x}%;top:${100-p.y}%"></div></div><div class="map-hint">Click anywhere to place yourself</div></div>`;
  }
  if(q.type==='gpa'){
    const v=qzGpa??3.0;
    const bg=qzSliderBg(v/4*100);
    const fb=qzGpaFeedback(v);
    return `<div class="gpa-wrap"><div class="gpa-display" id="qz-gpa-disp">${v.toFixed(2)} <span style="font-size:0.55em;font-family:Inter,sans-serif;font-weight:600;opacity:0.7">(${qzGpaLetter(v)})</span></div><div class="gpa-feedback ${fb.cls}" id="qz-gpa-fb">${fb.txt}</div><input type="range" min="0" max="40" step="1" value="${v*10}" id="qz-gpa-sl" oninput="qzHandleGpa(this.value)" style="background:${bg}"><div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px;color:var(--text-tertiary)"><span>0.0</span><span>2.0</span><span>4.0</span></div></div>`;
  }
  if(q.type==='emoji'){
    const emos=['😍','🤔','😴','😬'];
    return `<div class="emoji-rows">${q.rows.map((row,i)=>`<div class="emoji-row"><div class="emoji-statement">${row.t}</div><div class="emoji-pick">${emos.map((e,j)=>`<button class="emo-btn ${qzAnswers.emoji[i]===j?'sel':''}" onclick="qzPickEmoji(${i},${j})">${e}</button>`).join('')}</div></div>`).join('')}</div>`;
  }
  if(q.type==='dial'){
    if(qzSliders[q.key]===undefined) qzSliders[q.key]=50;
    const v=qzSliders[q.key];
    const labels=Array.isArray(q.labels)?q.labels:['Calm','Easy','Active','High','Pressure'];
    const lblIdx=Math.max(0,Math.min(labels.length-1,Math.floor(v/(100/labels.length))));
    const angleRad=(v/100*180-180)*Math.PI/180;
    const cx=120,cy=120,rad=100;
    const rx=cx+rad*Math.cos(angleRad), ry=cy+rad*Math.sin(angleRad);
    const bg=qzSliderBg(v);
    return `<div class="dial-wrap"><svg class="dial-svg" viewBox="0 0 240 140" id="qz-dial-svg" onclick="qzDialClick(event)"><path d="M 20 120 A 100 100 0 0 1 220 120" stroke="${qzTrack()}" stroke-width="10" fill="none" stroke-linecap="round"/><path d="M 20 120 A 100 100 0 0 1 ${rx.toFixed(2)} ${ry.toFixed(2)}" stroke="${qzPrimary()}" stroke-width="10" fill="none" stroke-linecap="round"/><line x1="${cx}" y1="${cy}" x2="${rx.toFixed(2)}" y2="${ry.toFixed(2)}" stroke="${qzPrimaryDark()}" stroke-width="4" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="10" fill="${qzPrimaryDark()}"/></svg><div class="dial-val">${v}</div><div class="dial-lbl">${labels[lblIdx]}</div><input type="range" min="0" max="100" value="${v}" style="width:240px;margin-top:14px;background:${bg}" oninput="qzDialSlide(this.value)"></div>`;
  }
  if(q.type==='yesno'){
    if(qzYesNoIdx>=q.items.length) return `<div style="text-align:center;padding:30px 0"><div style="font-size:48px;margin-bottom:14px">✓</div><div style="font-size:16px;font-weight:700;color:var(--q-green)">All done! Continuing...</div></div>`;
    const item=q.items[qzYesNoIdx];
    const customOpen=qzYesNoCustomOpen.has(qzYesNoIdx);
    const ans=qzAnswers.yesno[qzYesNoIdx];
    const customText=(ans&&typeof ans==='object')?ans.custom:'';
    const hasCustomText=!!(ans&&typeof ans==='object'&&ans.custom);
    let customHtml=customOpen
      ?`<div style="margin:0 0 14px"><textarea class="yn-custom-input" rows="2" placeholder="Describe your answer…" oninput="qzYesNoCustomInput(${qzYesNoIdx},this.value)">${customText}</textarea>${hasCustomText?`<button class="qz-btn-next" style="margin-top:8px;width:100%;padding:12px" onclick="qzYesNoAdvance()">Next →</button>`:''}</div>`
      :`<div style="text-align:center;margin-bottom:12px"><button class="yn-custom-btn" onclick="qzYesNoToggleCustom(${qzYesNoIdx})">✏ write my own</button></div>`;
    return `<div class="swipe-prog">Statement ${qzYesNoIdx+1} of ${q.items.length}</div><div class="swipe-card">${item.t}</div>${customHtml}<div class="swipe-btns"><button class="sw-btn sw-no" onclick="qzPickYesNo(${qzYesNoIdx},'no')">✕ No</button><button class="sw-btn sw-yes" onclick="qzPickYesNo(${qzYesNoIdx},'yes')">✓ Yes</button></div>`;
  }
  if(q.type==='spec'){
    const sel=qzAnswers.spectrum;
    return `<div class="spec-track-wrap"><div class="spec-track">${q.stops.map((s,i)=>`<div class="spec-marker ${sel===i?'sel':''}" style="left:${i/(q.stops.length-1)*100}%" onclick="qzPickSpec(${i})"></div>`).join('')}</div><div class="spec-stops">${q.stops.map((s,i)=>`<div class="spec-stop ${sel===i?'sel':''}" onclick="qzPickSpec(${i})">${s.l}</div>`).join('')}</div><div class="spec-display">${sel!==null?'Selected: '+q.stops[sel].l:'Tap a stop along the spectrum'}</div></div>`;
  }
  if(q.type==='budget'){
    const total=Object.values(qzBudget).reduce((a,b)=>a+b,0);
    return `<div class="budget-info"><span>Total allocated</span><span class="budget-rem">${total} / 100</span></div><div class="budget-rows">${q.categories.map(c=>{const v=qzBudget[c.k];return `<div class="budget-row"><div class="budget-lbl">${c.l}</div><div class="budget-bar-wrap"><div class="budget-bar"><div class="budget-fill" style="width:${v}%"></div></div><input type="range" min="0" max="100" value="${v}" oninput="qzHandleBudget('${c.k}',this.value)"></div><div class="budget-val">${v}</div></div>`}).join('')}</div>`;
  }
  if(q.type==='swipe'){
    if(qzSwipeIdx>=q.cards.length) return `<div style="text-align:center;padding:30px 0"><div style="font-size:48px;margin-bottom:14px">✓</div><div style="font-size:16px;font-weight:700;color:var(--q-green)">All done! Continuing...</div></div>`;
    const card=q.cards[qzSwipeIdx];
    return `<div class="swipe-prog">Card ${qzSwipeIdx+1} of ${q.cards.length}</div><div class="swipe-card">${card.t}</div><div class="swipe-btns"><button class="sw-btn sw-no" onclick="qzSwipe(${qzSwipeIdx},false)">✕ No</button><button class="sw-btn sw-yes" onclick="qzSwipe(${qzSwipeIdx},true)">✓ Yes</button></div>`;
  }
  if(q.type==='rank'){
    const ranked=qzAnswers.rank[q.id]||[];
    let h=`<div class="rank-list">`;
    q.items.forEach((item,i)=>{const ri=ranked.indexOf(i);const rked=ri!==-1?'rked':'';h+=`<div class="rank-item ${rked}" onclick="qzHandleRank(${q.id},${i})"><div class="rank-badge">${ri!==-1?ri+1:''}</div><div class="rank-text">${item.t}</div></div>`});
    return h+`</div>`;
  }
  return '';
}

function qzSlLabel(q,v){v=parseInt(v);if(v<20)return q.ll;if(v<42)return`Leaning: ${q.ll}`;if(v<58)return'Balanced';if(v<80)return`Leaning: ${q.rl}`;return q.rl;}
function qzGpaLetter(v){
  if(v>=4.0) return 'A+';
  if(v>=3.7) return 'A';
  if(v>=3.3) return 'A-';
  if(v>=3.0) return 'B+';
  if(v>=2.7) return 'B';
  if(v>=2.3) return 'B-';
  if(v>=2.0) return 'C+';
  if(v>=1.7) return 'C';
  if(v>=1.3) return 'C-';
  if(v>=1.0) return 'D+';
  if(v>=0.7) return 'D';
  if(v>=0.3) return 'D-';
  return 'F';
}
function qzGpaFeedback(v){
  if(v>=3.9) return {cls:'elite',txt:'🏆 Elite — every door is wide open for you.'};
  if(v>=3.7) return {cls:'great',txt:'⭐ Outstanding — top programs will compete for you.'};
  if(v>=3.4) return {cls:'good',txt:'✓ Strong — you have your pick of solid programs.'};
  if(v>=3.0) return {cls:'',txt:'Solid foundation — focus and direction matter more than perfection.'};
  return {cls:'',txt:"Numbers don't define trajectory. What you build next does."};
}

function qzPickCard(k){qzStage=k;qzAnswers.stage=k;qzRenderQ(qzCur);qzCheckCombos();}
function qzToggleTag(i){const q=qzById(1);const t=q.tags[i].t;const idx=qzAnswers.subjects.indexOf(t);if(idx>-1)qzAnswers.subjects.splice(idx,1);else if(qzAnswers.subjects.length<q.max)qzAnswers.subjects.push(t);qzRenderQ(qzCur);qzCheckCombos();}
function qzHandleSchool(v){qzSchool=v;qzSchoolMatch=null;if(v&&v.length>0){const lc=v.toLowerCase().trim();qzSchoolMatch=QZ_SCHOOLS.find(s=>s.m.some(m=>lc===m)||s.name.toLowerCase()===lc);}qzRenderQ(qzCur);setTimeout(()=>{const inp=document.getElementById('qz-school-in');if(inp){inp.focus();inp.setSelectionRange(v.length,v.length);}},0);}
function qzPickSchool(name){qzSchool=name;qzSchoolMatch=QZ_SCHOOLS.find(s=>s.name===name);qzRenderQ(qzCur);}

function qzPickPair(idx,which){
  qzAnswers.pairs[idx]=which;
  if(qzAnswers.pairsOwn) delete qzAnswers.pairsOwn[idx];
  qzPairsIdx++;
  qzRenderQ(qzCur);
  qzCheckCombos();
  // Auto-advance after last pair
  if(qzPairsIdx>=QZ_ACTIVE[qzCur].pairs.length){
    const snap=qzCur; setTimeout(()=>{ if(qzCur===snap) qzGoNext(); },700);
  }
}
// Store a custom gut-check answer without re-rendering so the input keeps focus.
function qzPairOwnInput(idx,val){
  if(!qzAnswers.pairsOwn) qzAnswers.pairsOwn={};
  if(val&&val.trim()) qzAnswers.pairsOwn[idx]=val;
  else delete qzAnswers.pairsOwn[idx];
}
// Submit a custom gut-check answer — recorded as 'own' (neutral, no career scores).
function qzPickPairOwn(idx){
  const el=document.getElementById('qz-pair-own');
  const val=el?el.value:'';
  if(!val||!val.trim()) return;
  if(!qzAnswers.pairsOwn) qzAnswers.pairsOwn={};
  qzAnswers.pairsOwn[idx]=val;
  qzAnswers.pairs[idx]='own';
  qzPairsIdx++;
  qzRenderQ(qzCur);
  qzCheckCombos();
  if(qzPairsIdx>=QZ_ACTIVE[qzCur].pairs.length){
    const snap=qzCur; setTimeout(()=>{ if(qzCur===snap) qzGoNext(); },700);
  }
}

function qzPickTot(i,choice){
  qzAnswers.tot[i]=choice;
  qzTotIdx++;
  qzRenderQ(qzCur); qzCheckCombos();
  if(qzTotIdx>=QZ_ACTIVE[qzCur].cards.length){
    const snap=qzCur; setTimeout(()=>{if(qzCur===snap)qzGoNext();},700);
  }
}
function qzPickEnv(i){const q=QZ_ACTIVE[qzCur];const pi=qzAnswers.env.indexOf(i);if(pi!==-1)qzAnswers.env.splice(pi,1);else if(qzAnswers.env.length<q.pick)qzAnswers.env.push(i);qzRenderQ(qzCur);qzCheckCombos();}
function qzPickMC(qId,i){qzAns[qId]=i;qzRenderQ(qzCur);qzCheckCombos();}
function qzPickMulti(qId,i){
  const q=qzById(qId);
  const opt=q.opts[i];
  const allIdx=q.opts.findIndex(o=>o.all);
  let arr=qzAnswers.multi[qId]?[...qzAnswers.multi[qId]]:[];
  // "All of the above" toggles every option at once.
  if(opt&&opt.all){
    const allOn=arr.length===q.opts.length;
    arr=allOn?[]:q.opts.map((_,k)=>k);
    qzAnswers.multi[qId]=arr;
    qzRenderQ(qzCur);
    return;
  }
  const pi=arr.indexOf(i);
  if(pi!==-1) arr.splice(pi,1);
  else if(!q.max||arr.length<q.max) arr.push(i);
  // If a real option is deselected, drop "All of the above" too.
  if(allIdx!==-1){
    const ai=arr.indexOf(allIdx);
    const allShouldBeOn=q.opts.every((_,k)=>k===allIdx||arr.indexOf(k)!==-1);
    if(allShouldBeOn && ai===-1) arr.push(allIdx);
    if(!allShouldBeOn && ai!==-1) arr.splice(arr.indexOf(allIdx),1);
  }
  qzAnswers.multi[qId]=arr;
  qzRenderQ(qzCur);
}
// Free-text "Other" on an MC question — store without re-rendering so the
// textarea keeps focus while typing (it's optional, never gates Next).
function qzMcOtherInput(qId,val){
  if(val&&val.trim()) qzAnswers.mcOther[qId]=val;
  else delete qzAnswers.mcOther[qId];
}
// First-name question — store without re-rendering so the input keeps focus.
// Only toggle the Next button enabled/disabled state.
function qzHandleNameInput(val){
  qzName=val;
  const btn=document.getElementById('qz-btn-next');
  if(btn) btn.disabled=!(qzName&&qzName.trim().length>=1);
}
function qzHandleLeaningInput(val){ qzLeaning=val; }
function qzHandleSl(qId,key,val){val=parseInt(val);qzSliders[key]=val;const el=document.getElementById(`qz-sl-${qId}`);if(el)el.style.background=qzSliderBg(val);const disp=document.getElementById(`qz-sval-${qId}`);if(disp)disp.textContent=qzSlLabel(qzById(qId),val);qzCheckCombos();}

function qzSetupMap(){
  const m=document.getElementById('qz-map2d');if(!m)return;
  const handle=e=>{const rect=m.getBoundingClientRect();const ev=e.touches?e.touches[0]:e;const x=Math.max(0,Math.min(100,(ev.clientX-rect.left)/rect.width*100));const y=Math.max(0,Math.min(100,100-(ev.clientY-rect.top)/rect.height*100));qzAnswers.map={x:qzR(x),y:qzR(y)};const d=document.getElementById('qz-map-dot');if(d){d.style.left=x+'%';d.style.top=(100-y)+'%';}qzCheckCombos();const btn=document.getElementById('qz-btn-next');if(btn)btn.disabled=false;};
  m.addEventListener('click',handle);
  let dragging=false;
  m.addEventListener('mousedown',()=>dragging=true);
  document.addEventListener('mouseup',()=>dragging=false);
  m.addEventListener('mousemove',e=>{if(dragging)handle(e);});
  m.addEventListener('touchstart',handle,{passive:true});
  m.addEventListener('touchmove',handle,{passive:true});
}

function qzHandleGpa(v){v=parseFloat(v)/10;qzGpa=v;const d=document.getElementById('qz-gpa-disp');if(d)d.innerHTML=v.toFixed(2)+` <span style="font-size:0.55em;font-family:Inter,sans-serif;font-weight:600;opacity:0.7">(${qzGpaLetter(v)})</span>`;const fb=qzGpaFeedback(v);const fbEl=document.getElementById('qz-gpa-fb');if(fbEl){fbEl.textContent=fb.txt;fbEl.className=`gpa-feedback ${fb.cls}`;}const sl=document.getElementById('qz-gpa-sl');if(sl)sl.style.background=qzSliderBg(v/4*100);qzCheckCombos();const btn=document.getElementById('qz-btn-next');if(btn)btn.disabled=false;}

function qzPickEmoji(rIdx,eIdx){qzAnswers.emoji[rIdx]=eIdx;qzRenderQ(qzCur);qzCheckCombos();}

function qzDialClick(e){
  const svg=document.getElementById('qz-dial-svg');if(!svg)return;
  const rect=svg.getBoundingClientRect();
  const x=(e.clientX-rect.left)/rect.width*240, y=(e.clientY-rect.top)/rect.height*140;
  const dx=x-120, dy=y-120;
  let angle=Math.atan2(dy,dx)*180/Math.PI;
  if(angle>0) angle = dx<0 ? -180 : 0;
  const v=Math.max(0,Math.min(100,((angle+180)/180)*100));
  qzSliders.intensity=qzR(v);
  // Sync the range input value too, then update visuals in-place.
  const wrap=document.getElementById('qz-dial-svg')?.parentElement;
  const range=wrap?.querySelector('input[type=range]');
  if(range) range.value=qzSliders.intensity;
  qzDialSlide(qzSliders.intensity);
}
function qzDialSlide(v){
  v=parseInt(v);
  qzSliders.intensity=v;
  // Update dial visuals in-place WITHOUT re-rendering the whole question
  // (re-rendering destroys the <input type=range> mid-drag and breaks the slider).
  const svg=document.getElementById('qz-dial-svg');
  if(svg){
    const labels=['Calm','Easy','Active','High','Pressure'];
    const lblIdx=Math.max(0,Math.min(labels.length-1,Math.floor(v/(100/labels.length))));
    const angleRad=(v/100*180-180)*Math.PI/180;
    const cx=120,cy=120,rad=100;
    const rx=cx+rad*Math.cos(angleRad), ry=cy+rad*Math.sin(angleRad);
    const paths=svg.querySelectorAll('path');
    if(paths[1]) paths[1].setAttribute('d',`M 20 120 A 100 100 0 0 1 ${rx.toFixed(2)} ${ry.toFixed(2)}`);
    const line=svg.querySelector('line');
    if(line){line.setAttribute('x2',rx.toFixed(2));line.setAttribute('y2',ry.toFixed(2));}
    const wrap=svg.parentElement;
    if(wrap){
      const valEl=wrap.querySelector('.dial-val'); if(valEl) valEl.textContent=v;
      const lblEl=wrap.querySelector('.dial-lbl'); if(lblEl) lblEl.textContent=labels[lblIdx];
      const range=wrap.querySelector('input[type=range]');
      if(range) range.style.background=qzSliderBg(v);
    }
  }
  qzCheckCombos();
}

function qzPickYesNo(i,val){
  qzAnswers.yesno[i]=val;
  qzYesNoCustomOpen.delete(i);
  qzYesNoIdx++;
  qzRenderQ(qzCur); qzCheckCombos();
  if(qzYesNoIdx>=QZ_ACTIVE[qzCur].items.length){
    const snap=qzCur; setTimeout(()=>{if(qzCur===snap)qzGoNext();},700);
  }
}
function qzYesNoAdvance(){
  qzYesNoIdx++;
  qzRenderQ(qzCur); qzCheckCombos();
  if(qzYesNoIdx>=QZ_ACTIVE[qzCur].items.length){
    const snap=qzCur; setTimeout(()=>{if(qzCur===snap)qzGoNext();},700);
  }
}
function qzYesNoToggleCustom(i){
  if(qzYesNoCustomOpen.has(i)){
    qzYesNoCustomOpen.delete(i);
    if(typeof qzAnswers.yesno[i]==='object') delete qzAnswers.yesno[i];
  } else {
    qzYesNoCustomOpen.add(i);
    if(qzAnswers.yesno[i]==='yes'||qzAnswers.yesno[i]==='no') delete qzAnswers.yesno[i];
  }
  qzRenderQ(qzCur);
}
function qzYesNoCustomInput(i,val){
  // Store raw value (preserve whitespace while typing). Only treat fully-empty
  // (after trim) as "no answer" so the Next button hides, but do NOT re-render
  // the whole question on every keystroke — that destroys the textarea and
  // makes it lose focus after each character.
  const had=!!(qzAnswers.yesno[i]&&typeof qzAnswers.yesno[i]==='object'&&qzAnswers.yesno[i].custom);
  if(val&&val.trim()) qzAnswers.yesno[i]={custom:val};
  else delete qzAnswers.yesno[i];
  const hasNow=!!(qzAnswers.yesno[i]&&typeof qzAnswers.yesno[i]==='object'&&qzAnswers.yesno[i].custom);
  // Toggle the inline Next button without re-rendering, to keep focus.
  if(had!==hasNow){
    const ta=document.activeElement;
    const wrap=ta&&ta.classList&&ta.classList.contains('yn-custom-input')?ta.parentElement:null;
    if(wrap){
      const existing=wrap.querySelector('button.qz-btn-next');
      if(hasNow && !existing){
        const btn=document.createElement('button');
        btn.className='qz-btn-next';
        btn.setAttribute('style','margin-top:8px;width:100%;padding:12px');
        btn.textContent='Next →';
        btn.onclick=qzYesNoAdvance;
        wrap.appendChild(btn);
      } else if(!hasNow && existing){
        existing.remove();
      }
    }
  }
  qzCheckCombos();
}
function qzPickSpec(i){qzAnswers.spectrum=i;qzRenderQ(qzCur);qzCheckCombos();}

// AUTO-BALANCE BUDGET — keeps total at exactly 100 by scaling others proportionally
function qzHandleBudget(k,v){
  v=Math.max(0,Math.min(100,parseInt(v)));
  const others=Object.keys(qzBudget).filter(key=>key!==k);
  const otherTotal=100-v;
  const currentOtherTotal=others.reduce((sum,key)=>sum+qzBudget[key],0);
  qzBudget[k]=v;
  if(currentOtherTotal===0){others.forEach(key=>{qzBudget[key]=Math.floor(otherTotal/others.length);});}
  else{const scale=otherTotal/currentOtherTotal;others.forEach(key=>{qzBudget[key]=Math.max(0,Math.round(qzBudget[key]*scale));});}
  // Fix rounding so total is exactly 100
  let total=Object.values(qzBudget).reduce((a,b)=>a+b,0);
  const diff=100-total;
  if(diff!==0){const largest=others.reduce((a,b)=>qzBudget[a]>qzBudget[b]?a:b);qzBudget[largest]=Math.max(0,qzBudget[largest]+diff);}
  qzRenderQ(qzCur); qzCheckCombos();
}

function qzSwipe(idx,yes){
  qzAnswers.swipes[idx]=yes;
  qzSwipeIdx++;
  qzRenderQ(qzCur);
  qzCheckCombos();
  // Auto-advance after last swipe
  if(qzSwipeIdx>=QZ_ACTIVE[qzCur].cards.length){
    const snap=qzCur; setTimeout(()=>{ if(qzCur===snap) qzGoNext(); },700);
  }
}

function qzHandleRank(qId,itemIdx){
  let ranked=qzAnswers.rank[qId]?[...qzAnswers.rank[qId]]:[];
  if(ranked.includes(itemIdx)) ranked=ranked.filter(x=>x!==itemIdx);
  else ranked.push(itemIdx);
  qzAnswers.rank[qId]=ranked;
  qzRenderQ(qzCur);
}

function qzCanNext(q){
  if(q.type==='cards') return qzStage!==null;
  if(q.type==='tags') return qzAnswers.subjects.length>=q.min;
  if(q.type==='text') return qzSchool && qzSchool.trim().length>=2;
  if(q.type==='name') return !!(qzName && qzName.trim().length>=1);
  if(q.type==='leaning') return true; // optional — a stated leaning is welcome, never required
  if(q.type==='pairs') return qzPairsIdx>=q.pairs.length;
  if(q.type==='tot') return Object.keys(qzAnswers.tot||{}).length===q.cards.length;
  if(q.type==='vpicker') return qzAnswers.env.length===q.pick;
  if(q.type==='multi') return (qzAnswers.multi[q.id]||[]).length>=(q.min||1);
  if(q.type==='mc') return qzAns[q.id]!==undefined;
  if(q.type==='sl') return true;
  if(q.type==='map2d') return qzAnswers.map!==null;
  if(q.type==='gpa') return qzGpa!==null;
  if(q.type==='emoji') return Object.keys(qzAnswers.emoji).length===q.rows.length;
  if(q.type==='dial') return qzSliders.intensity!==undefined;
  if(q.type==='yesno') return q.items.every((_,i)=>qzAnswers.yesno[i]!==undefined);
  if(q.type==='spec') return qzAnswers.spectrum!==null;
  if(q.type==='budget') return Object.values(qzBudget).reduce((a,b)=>a+b,0)===100;
  if(q.type==='swipe') return qzSwipeIdx>=q.cards.length;
  if(q.type==='rank') return (qzAnswers.rank[q.id]||[]).length===q.items.length;
  return true;
}

// Guards against double-advance (e.g. button click + auto-advance firing together):
// no two forward navigations within 250ms.
let qzLastNav=0;
// Funnel telemetry state. qzStartedAt stamps the run so quiz_complete can carry
// a duration; qzLastViewedIdx is the de-dupe key for quiz_q_view, because
// qzRenderQ re-runs on every edit within a question (see the guard there).
// Both are reset in qzStart, NOT here — qzRestart() re-shows the intro without
// clearing either, so the reset has to live on the path a new run actually takes.
let qzStartedAt=0, qzLastViewedIdx=-1;
function qzGoNext(){
  if(!qzCanNext(QZ_ACTIVE[qzCur])) return;
  const now=Date.now();
  if(now-qzLastNav<250) return;
  qzLastNav=now;
  // Deliberately AFTER the debounce stamp — the pairs auto-advance timer and a
  // live Next click would otherwise log the same commit twice. idx only.
  try { if (global.FWEvents) FWEvents.log('quiz_q_answer', { idx: qzCur }); } catch (_) {}
  if(qzCur===QZ_ACTIVE.length-1){qzFinishInitialQuiz();return;}
  qzSlide(()=>{qzCur++;qzRenderQ(qzCur);});
}
function qzGoBack(){
  const q=QZ_ACTIVE[qzCur];
  // During a gut-check (pairs), Back steps back one pair, not the whole question.
  if(q&&q.type==='pairs'&&qzPairsIdx>0){
    qzPairsIdx--;
    delete qzAnswers.pairs[qzPairsIdx];
    qzRenderQ(qzCur);
    return;
  }
  if(qzCur===0)return;
  qzSlide(()=>{qzCur--;qzRenderQ(qzCur);},true);
}
function qzForceNext(){const now=Date.now();if(now-qzLastNav<250)return;qzLastNav=now;if(qzCur===QZ_ACTIVE.length-1){qzFinishInitialQuiz();return;}qzSlide(()=>{qzCur++;qzRenderQ(qzCur);});}

// End of the short initial quiz → straight to the signup gate (lowest friction).
// The résumé upload used to live here, before the gate; it now runs AFTER the
// account is created (see qzShowPostSignupResume) so the celebration comes first.
function qzFinishInitialQuiz(){
  // ms falls back to 0 when qzStartedAt was never stamped (a #r= restore or a
  // dev run that skipped qzStart) so we can't emit an epoch-sized duration.
  // n is the run LENGTH, not a count of real answers — reconcile with quiz_q_answer.
  try { if (global.FWEvents) FWEvents.log('quiz_complete', { ms: qzStartedAt ? (Date.now() - qzStartedAt) : 0, n: QZ_ACTIVE.length }); } catch (_) {}
  qzResolveLeaning(); qzShowReveal();
}

// "One last thing" résumé step, shown AFTER registration once the gate confetti
// has finished. Returns a promise that resolves when the user continues or skips;
// résumé input lands in qzResumeText/qzResumeFile for the caller to apply.
// "Sharpen your matches" step — the deeper personality questions that used to
// live in a Career Hub drawer now run here, right after signup and BEFORE the
// resume step. FWHubRefine owns the questions, scoring, and persistence
// (sector-fit-sheet patches + persistQuizVectors), so this is pure hosting.
function qzShowSharpenStep(){
  return new Promise(function(resolve){
    const step=document.getElementById('qz-sharpen');
    const root=document.getElementById('qz-sharpen-root');
    if(!step || !root || !global.FWHubRefine || typeof FWHubRefine.mount!=='function'){ resolve(); return; }
    ['qz-quiz','qz-reveal','qz-gate','qz-results','qz-resume','qz-academics'].forEach(function(id){
      const el=document.getElementById(id); if(el) el.classList.add('qz-hidden');
    });
    step.classList.remove('qz-hidden');
    window.scrollTo({top:0,behavior:'smooth'});
    const contBtn=document.getElementById('qz-sharpen-continue');
    const skipBtn=document.getElementById('qz-sharpen-skip');
    const statusEl=document.getElementById('qz-sharpen-status');
    FWHubRefine.mount(root,{
      onProgress:function(done,total){
        if(contBtn) contBtn.textContent = done>0 ? 'Save & continue →' : 'Continue →';
      }
    });
    function finish(save){
      step.classList.add('qz-hidden');
      if(save && FWHubRefine.answeredCount()>0){
        try{ FWHubRefine.commit(); }catch(err){ console.warn('sharpen commit failed', err); }
        if(statusEl) statusEl.textContent='';
      }
      resolve();
    }
    if(contBtn && !contBtn._qzBound){ contBtn._qzBound=true; contBtn.addEventListener('click',function(){ finish(true); }); }
    if(skipBtn && !skipBtn._qzBound){ skipBtn._qzBound=true; skipBtn.addEventListener('click',function(){ finish(false); }); }
  });
}

// "Academic Profile" step — the academics panel that used to live in a Career
// Hub drawer now runs here, immediately after Sharpen Matches. FWHubAcademics
// owns the questions, scoring, and persistence (sector-fit-sheet patches +
// persistQuizVectors), so this is pure hosting.
function qzShowAcademicsStep(){
  return new Promise(function(resolve){
    const step=document.getElementById('qz-academics');
    const root=document.getElementById('qz-academics-root');
    if(!step || !root || !global.FWHubAcademics || typeof FWHubAcademics.mount!=='function'){ resolve(); return; }
    ['qz-quiz','qz-reveal','qz-gate','qz-results','qz-sharpen','qz-resume'].forEach(function(id){
      const el=document.getElementById(id); if(el) el.classList.add('qz-hidden');
    });
    step.classList.remove('qz-hidden');
    window.scrollTo({top:0,behavior:'smooth'});
    const contBtn=document.getElementById('qz-academics-continue');
    const skipBtn=document.getElementById('qz-academics-skip');
    FWHubAcademics.mount(root,{
      onProgress:function(done){
        if(contBtn) contBtn.textContent = done>0 ? 'Save & continue →' : 'Continue →';
      }
    });
    function finish(save){
      step.classList.add('qz-hidden');
      // Commit if a scored question OR the About-you (year/school) block was
      // touched — the latter is not in answeredCount but must still persist.
      var hasAbout = typeof FWHubAcademics.hasAboutYou === 'function' && FWHubAcademics.hasAboutYou();
      if(save && (FWHubAcademics.answeredCount()>0 || hasAbout)){
        try{ FWHubAcademics.commit(); }catch(err){ console.warn('academics commit failed', err); }
      }
      resolve();
    }
    if(contBtn && !contBtn._qzBound){ contBtn._qzBound=true; contBtn.addEventListener('click',function(){ finish(true); }); }
    if(skipBtn && !skipBtn._qzBound){ skipBtn._qzBound=true; skipBtn.addEventListener('click',function(){ finish(false); }); }
  });
}

function qzShowPostSignupResume(){
  return new Promise(function(resolve){
    const step=document.getElementById('qz-resume');
    if(!step || !global.FWResumeIngest){ resolve(); return; }
    qzResumeStepResolve=resolve;
    document.getElementById('qz-quiz').classList.add('qz-hidden');
    var qzRevealEl=document.getElementById('qz-reveal'); if(qzRevealEl) qzRevealEl.classList.add('qz-hidden');
    document.getElementById('qz-gate').classList.add('qz-hidden');
    document.getElementById('qz-results').classList.add('qz-hidden');
    // Reframe the step as a warm post-signup welcome rather than a quiz question.
    const titleEl=step.querySelector('.qz-resume-title');
    const subEl=step.querySelector('.qz-resume-sub');
    const badgeEl=step.querySelector('.qz-resume-badge');
    if(titleEl) titleEl.textContent='One last thing';
    if(subEl) subEl.innerHTML="We'd love to see what experience you already have. Add a resume and we'll tune your matches to it — or skip and jump straight in.";
    if(badgeEl) badgeEl.textContent='Step 3 of 3 · Optional';
    const skipEl=step.querySelector('#qz-resume-skip');
    if(skipEl) skipEl.textContent='Skip for now';
    step.classList.remove('qz-hidden');
    window.scrollTo({top:0,behavior:'smooth'});
  const root=document.getElementById('qz-resume-ingest-root');
  const continueBtn=document.getElementById('qz-resume-continue');
  const skipBtn=document.getElementById('qz-resume-skip');
  const statusEl=document.getElementById('qz-resume-status');
  if(global.FWOnetVectors && typeof FWOnetVectors.loadZoneDimensionProfiles === 'function'){
    FWOnetVectors.loadZoneDimensionProfiles().catch(function(){});
  }
  if(root && global.FWResumeIngest){
    root.innerHTML=FWResumeIngest.uploadHtml({ summary: qzResumeSummary || '' });
    function updateContinueBtn(){
      if(!continueBtn) return;
      var ready=FWResumeIngest.hasValidInput(qzResumeText, qzResumeFile);
      continueBtn.disabled=!ready || qzResumeApplying;
    }
    FWResumeIngest.bindUploadUi(root,{
      onTextChange:function(text){
        qzResumeText=String(text||'').trim();
        if(qzResumeText.length>=40){
          qzResumeBoosts=FWResumeIngest.parseIndustryBoosts(qzResumeText);
          qzResumeFile=null;
        }
        updateContinueBtn();
      },
      onFileReady:function(payload){
        if(payload && payload.file && payload.file.isPdf){
          qzResumeFile=payload.file;
        } else if(payload && payload.text && payload.text.length>=40){
          qzResumeText=payload.text;
          qzResumeBoosts=FWResumeIngest.parseIndustryBoosts(qzResumeText);
          qzResumeFile=null;
        }
        updateContinueBtn();
      }
    });
    const ta=root.querySelector('[data-resume-paste]');
    if(ta && qzResumeText) ta.value=qzResumeText;
    updateContinueBtn();
  }
  if(continueBtn && !continueBtn._qzBound){
    continueBtn._qzBound=true;
    continueBtn.addEventListener('click',function(){
      if(qzResumeApplying) return;
      var ready=global.FWResumeIngest && FWResumeIngest.hasValidInput(qzResumeText, qzResumeFile);
      if(!ready) return;
      qzObjectiveSkipped=false;
      // Immediate busy feedback: the résumé parse + vector rebuild that follow
      // can take tens of seconds, and the step stays on screen the whole time.
      qzResumeApplying=true;
      continueBtn.disabled=true;
      continueBtn.textContent='Reading your resume…';
      if(skipBtn) skipBtn.disabled=true;
      if(statusEl){
        statusEl.textContent='Tuning your matches to your experience — this can take a moment. Hang tight!';
      }
      if(qzResumeStepResolve){ var r=qzResumeStepResolve; qzResumeStepResolve=null; r(); }
    });
  }
  if(skipBtn && !skipBtn._qzBound){
    skipBtn._qzBound=true;
    skipBtn.addEventListener('click',function(){
      qzObjectiveSkipped=true;
      qzResumeText=null;
      qzResumeFile=null;
      if(global.FWResumeIngest) FWResumeIngest.clearPendingFile();
      qzResumeBoosts={};
      qzResumeSummary='';
      if(statusEl) statusEl.textContent='';
      if(qzResumeStepResolve){ var r=qzResumeStepResolve; qzResumeStepResolve=null; r(); }
    });
  }
  });
}

function qzSlide(cb,back=false){
  const card=document.getElementById('qz-qcard');
  card.style.opacity='0';
  card.style.transform=`translateX(${back?'30px':'-30px'})`;
  setTimeout(()=>{
    cb();
    card.style.transition='none';
    card.style.transform=`translateX(${back?'-30px':'30px'})`;
    card.style.opacity='0';
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      card.style.transition='opacity .22s,transform .22s';
      card.style.transform='translateX(0)';
      card.style.opacity='1';
    }));
  },200);
}

function qzById(id){return QZ_Qs.find(q=>q.id===id);}
function qzComputeScores(){
  const sc={};
  Object.keys(QZ_IND).forEach(k=>sc[k]=0);
  const add=(s,m=1)=>{if(!s)return;Object.entries(s).forEach(([k,v])=>{if(sc[k]!==undefined)sc[k]+=v*m})};

  // Tags (id:1)
  const tagQ=qzById(1);
  qzAnswers.subjects.forEach(t=>{const tag=tagQ.tags.find(x=>x.t===t);if(tag)add(tag.s);});
  // Pairs (id:3)
  const pq=qzById(3);
  Object.entries(qzAnswers.pairs).forEach(([i,w])=>{const p=pq.pairs[i];if(p&&p[w])add(p[w].s,2);/* 'own' = custom answer, neutral */});
  // This or That (id:4)
  const totq=qzById(4);
  if(totq) Object.entries(qzAnswers.tot||{}).forEach(([i,choice])=>{const card=totq.cards[i];if(card)add(card[choice].s,2);});
  // Work environment multi-select (id:5)
  const vq=qzById(5);
  (qzAnswers.multi[5]||[]).forEach(i=>{const o=vq.opts[i];if(o)add(o.s);});
  // MCs (id:6, id:17, id:18)
  [6,17,18].forEach(qId=>{const q=qzById(qId);if(q&&qzAns[qId]!==undefined)add(q.opts[qzAns[qId]].s,2);});
  // Slider risk (id:7)
  const slQ=qzById(7);
  if(qzSliders.risk!==undefined) add(slQ.score(qzSliders.risk));
  // Map (id:8)
  const mapQ=qzById(8);
  if(qzAnswers.map) add(mapQ.score(qzAnswers.map));
  // Emoji (id:10)
  const eq=qzById(10);
  Object.entries(qzAnswers.emoji).forEach(([i,e])=>{const row=eq.rows[i];const mult=[3,1,0,-1][e];row.ind.forEach(ind=>{if(sc[ind]!==undefined)sc[ind]+=mult});});
  // Dial (id:11)
  const dialQ=qzById(11);
  if(qzSliders.intensity!==undefined) add(dialQ.score(qzSliders.intensity));
  // Yes/No group questions (id:12)
  const ynq=qzById(12);
  if(ynq) Object.entries(qzAnswers.yesno||{}).forEach(([i,ans])=>{const item=ynq.items[i];if(!item)return;if(ans==='yes')add(item.yes);else if(ans==='no')add(item.no);/* custom answer = neutral, no scores */});
  // Spectrum (id:13)
  const specQ=qzById(13);
  if(qzAnswers.spectrum!==null&&qzAnswers.spectrum!==undefined) add(specQ.stops[qzAnswers.spectrum].s,2);
  // Swipes (id:15)
  const sw=qzById(15);
  Object.entries(qzAnswers.swipes).forEach(([i,y])=>{const card=sw.cards[i];add(y?card.y:card.n);});
  // Rank (id:16)
  const rq=qzById(16);
  const ranked=qzAnswers.rank[16]||[];
  ranked.slice(0,3).forEach((itemIdx,rank)=>{const w=[3,2,1][rank];add(rq.items[itemIdx].s,w);});
  // Resume boosts
  if(qzResumeBoosts) Object.entries(qzResumeBoosts).forEach(([k,v])=>{if(sc[k]!==undefined) sc[k]+=v;});
  // Custom-answer enrich boosts
  if(qzEnrichBoosts) Object.entries(qzEnrichBoosts).forEach(([k,v])=>{if(sc[k]!==undefined) sc[k]+=v;});
  // Stated-interest boost: the sector of the career the user said they're
  // leaning toward gets a real bump, so the leaning visibly shapes the map.
  if(qzLeaningZone && sc[qzLeaningZone]!==undefined) sc[qzLeaningZone]+=8;
  return sc;
}

function qzCollectCustomAnswers(){
  const out=[];
  const ynq=qzById(12);
  if(ynq) Object.entries(qzAnswers.yesno||{}).forEach(([i,ans])=>{
    if(!ans||typeof ans!=='object'||!ans.custom) return;
    const item=ynq.items[Number(i)];
    if(!item) return;
    const text=String(ans.custom).trim();
    if(!text) return;
    out.push({itemIndex:Number(i),prompt:item.t,answer:text});
  });
  // Free-text "Other" on MC questions (e.g. the career-fear closer)
  Object.entries(qzAnswers.mcOther||{}).forEach(([qId,val])=>{
    const q=qzById(Number(qId));
    const text=String(val||'').trim();
    if(!q||!text) return;
    out.push({itemIndex:`mc-${qId}`,prompt:q.q,answer:text});
  });
  return out;
}

function qzHasCustomAnswers(){ return qzCollectCustomAnswers().length>0; }

function qzNeedsQuizEnrich(){
  if(!qzHasCustomAnswers()) return false;
  return !qzEnrichDone||!Object.keys(qzEnrichBoosts).length;
}

function qzComputeBaseScores(){
  const saved=qzEnrichBoosts;
  qzEnrichBoosts={};
  const sc=qzComputeScores();
  qzEnrichBoosts=saved;
  return sc;
}

function qzParseResumeBoosts(text){
  if(global.FWResumeIngest && typeof FWResumeIngest.parseIndustryBoosts==='function'){
    return FWResumeIngest.parseIndustryBoosts(text);
  }
  const t=text.toLowerCase();
  const map={
    finance:['finance','accounting','investment','banking','equity','trading','financial analyst','cfa','cpa','bloomberg','goldman','morgan stanley','jp morgan','blackrock','hedge fund','private equity','portfolio','valuation'],
    tech:['software','programming','python','javascript','typescript','java','react','node','developer','engineer','github','sql','machine learning','data science','api','aws','cloud','devops','backend','frontend','full stack','pytorch','tensorflow'],
    engineering:['engineering','mechanical','electrical','civil','cad','solidworks','matlab','circuits','structural','manufacturing','hardware','embedded','systems engineer'],
    healthcare:['healthcare','medical','hospital','clinical','patient','nursing','biology','chemistry','pre-med','mcat','research','lab','pharmacology','anatomy','public health','physician','intern'],
    law:['law','legal','attorney','paralegal','policy','compliance','litigation','contract','regulatory','moot court','bar exam','judicial','legislation','amendment'],
    business:['management','consulting','strategy','operations','mba','project management','leadership','business development','b2b','enterprise','stakeholder','p&l','revenue'],
    marketing:['marketing','brand','social media','content','campaign','advertising','seo','growth','communications','pr','public relations','copywriting','influencer','email marketing'],
    startups:['startup','founder','venture','entrepreneurship','product manager','innovation','launched','built','co-founded','y combinator','techstars','series a','seed','saas','mvp'],
    creative:['design','creative','ux','ui','figma','adobe','photoshop','illustrator','art director','branding','typography','motion','creative director','portfolio'],
    education:['teaching','tutoring','education','curriculum','mentoring','instructed','coach','academic','professor','lesson','classroom','school','pedagogy'],
    social:['nonprofit','volunteer','community','social work','counseling','advocacy','outreach','humanitarian','ngo','foundation','mission','underserved'],
    science:['research','laboratory','thesis','publication','experiment','analysis','biology','chemistry','physics','neuroscience','genomics','climate','geology','astronomy'],
    trades:['electrician','plumber','welding','hvac','carpentry','construction','apprentice','journeyman','blueprint','fabrication'],
    media:['broadcast','journalism','video production','podcast','filmmaking','reporter','anchor','documentary','editing','premiere'],
    government:['public policy','municipal','federal','civil service','legislative','city council','public administration','grant writing'],
    cybersecurity:['cybersecurity','infosec','penetration test','soc analyst','siem','incident response','cissp','security operations'],
    operations:['supply chain','logistics','warehouse','procurement','inventory','lean six sigma','operations manager','fulfillment'],
    hospitality:['hospitality','hotel management','restaurant','chef','culinary','event planning','tourism','guest services'],
    aerospace:['aerospace','aviation','aircraft','flight test','nasa','spacex','boeing','pilot','aeronautical'],
    pharmaceutical:['pharmaceutical','pharma','biotech','clinical trial','fda','pharmacology','drug development','gxp'],
    sports:['athletics','coaching','sports management','kinesiology','personal trainer','ncaa','fitness','physical therapy'],
    realestate:['real estate','realtor','broker','property management','leasing','commercial real estate','mls'],
    hr:['human resources','talent acquisition','recruiting','people operations','onboarding','employee relations','hrbp'],
    agriculture:['agriculture','sustainable farming','agtech','crop science','conservation','forestry','soil science'],
  };
  const boosts={};
  Object.entries(map).forEach(([ind,kws])=>{
    const hits=kws.filter(kw=>t.includes(kw)).length;
    if(hits>0) boosts[ind]=Math.min(hits*2,10);
  });
  return boosts;
}

// Confident-professional representation per industry (person + the gear/prop of the job)
const qzCAREER_META = {
  tech:        {person:'🧑‍💻', accent:'#2563eb'},
  healthcare:  {person:'🧑‍⚕️', accent:'#0891b2'},
  finance:     {person:'🧑‍💼', accent:'var(--primary-solid)'},
  creative:    {person:'🧑‍🎨', accent:'#db2777'},
  education:   {person:'🧑‍🏫', accent:'#d97706'},
  business:    {person:'🧑‍💼', accent:'#6366f1'},
  law:         {person:'🧑‍⚖️', accent:'#7c3aed'},
  engineering: {person:'👷',   accent:'#ea580c'},
  science:     {person:'🧑‍🔬', accent:'#0d9488'},
  startups:    {person:'🧑‍🚀', accent:'#dc2626'},
  social:      {person:'🦸',   accent:'#16a34a'},
  marketing:   {person:'🧑‍🎤', accent:'#f97316'},
  trades:      {person:'🧑‍🔧', accent:'#78716c'},
  media:       {person:'🧑‍💻', accent:'#0ea5e9'},
  government:  {person:'🧑‍💼', accent:'#475569'},
  cybersecurity:{person:'🧑‍💻', accent:'#059669'},
  operations:  {person:'🧑‍🏭', accent:'#ca8a04'},
  hospitality: {person:'🧑‍🍳', accent:'#e11d48'},
  aerospace:   {person:'👨‍✈️', accent:'#0284c7'},
  pharmaceutical:{person:'🧑‍🔬', accent:'#7c3aed'},
  sports:      {person:'🏃',   accent:'#16a34a'},
  realestate:  {person:'🧑‍💼', accent:'#b45309'},
  hr:          {person:'🧑‍💼', accent:'#6366f1'},
  agriculture: {person:'🧑‍🌾', accent:'#65a30d'}
};

// Rarity tier by ACTUAL match strength (not rank) — drives colors + particle
// count (loot-box style). Thresholds mirror the fit-rarity ladder so a strong
// fit reads legendary and a middling one honestly doesn't.
// Thresholds calibrated to the mean-centered cosine fit scale (canonical in
// FWOnetMath.FIT_TIERS: legendary 56 / epic 46 / rare 34). LEGENDARY maps to
// legendary+mythic, EPIC to epic, GREAT to rare, SOLID to uncommon/common.
function qzTierFor(pct){
  const p = Number(pct) || 0;
  const T = FWOnetMath.FIT_TIERS;
  if (p >= T.legendary) return {name:'LEGENDARY', label:'★ LEGENDARY FIT', color:'#f5b301', particles:120};
  if (p >= T.epic)      return {name:'EPIC',      label:'EPIC MATCH',      color:'#7c3aed', particles:90};
  if (p >= T.rare)      return {name:'GREAT',     label:'GREAT MATCH',     color:'#2563eb', particles:60};
  if (p >= T.uncommon)  return {name:'SOLID',     label:'SOLID MATCH',     color:'#16a34a', particles:40};
  // Below the bottom gate there is no match to congratulate. "SOLID MATCH" used
  // to be the floor, so a 0% career was announced as solid.
  return                       {name:'EARLY',     label:'EARLY MATCH',     color:'#9AA0AD', particles:20};
}

// Per-industry illustration params for the parametric SVG portrait generator
const qzCAREER_ART = {
  tech:        {skin:'#f1c27d', hair:'#3b2a1a', hairStyle:'short',  outfit:'#1e293b', shirt:'#e2e8f0', prop:'laptop'},
  healthcare:  {skin:'#e8b98a', hair:'#1f1410', hairStyle:'bob',    outfit:'#0e7490', shirt:'#ffffff', prop:'stetho'},
  finance:     {skin:'#ffdbac', hair:'#2b2b2b', hairStyle:'short',  outfit:'#1e3a8a', shirt:'#ffffff', prop:'briefcase'},
  creative:    {skin:'#c68642', hair:'#6d28d9', hairStyle:'curly',  outfit:'#be185d', shirt:'#fce7f3', prop:'palette'},
  education:   {skin:'#f1c27d', hair:'#7c4a1e', hairStyle:'bob',    outfit:'#b45309', shirt:'#fef3c7', prop:'books'},
  business:    {skin:'#e0ac69', hair:'#1a1a1a', hairStyle:'short',  outfit:'#4338ca', shirt:'#eef2ff', prop:'briefcase'},
  law:         {skin:'#8d5524', hair:'#10100f', hairStyle:'buzz',   outfit:'#5b21b6', shirt:'#ffffff', prop:'gavel'},
  engineering: {skin:'#ffdbac', hair:'#3b2a1a', hairStyle:'hardhat',outfit:'#c2410c', shirt:'#fed7aa', prop:'wrench'},
  science:     {skin:'#e8b98a', hair:'#2b2b2b', hairStyle:'curly',  outfit:'#0f766e', shirt:'#ffffff', prop:'flask'},
  startups:    {skin:'#c68642', hair:'#1a1a1a', hairStyle:'short',  outfit:'#b91c1c', shirt:'#fee2e2', prop:'rocket'},
  social:      {skin:'#8d5524', hair:'#241a12', hairStyle:'curly',  outfit:'#15803d', shirt:'#dcfce7', prop:'heart'},
  marketing:   {skin:'#ffdbac', hair:'#9a3412', hairStyle:'bob',    outfit:'#ea580c', shirt:'#ffedd5', prop:'mic'},
  trades:      {skin:'#e0ac69', hair:'#3b2a1a', hairStyle:'hardhat',outfit:'#57534e', shirt:'#fafaf9', prop:'wrench'},
  media:       {skin:'#f1c27d', hair:'#1a1a1a', hairStyle:'short',  outfit:'#0369a1', shirt:'#e0f2fe', prop:'mic'},
  government:  {skin:'#ffdbac', hair:'#2b2b2b', hairStyle:'short',  outfit:'#334155', shirt:'#f8fafc', prop:'briefcase'},
  cybersecurity:{skin:'#e8b98a', hair:'#10100f', hairStyle:'buzz',   outfit:'#047857', shirt:'#ecfdf5', prop:'laptop'},
  operations:  {skin:'#c68642', hair:'#3b2a1a', hairStyle:'short',  outfit:'#a16207', shirt:'#fef9c3', prop:'briefcase'},
  hospitality: {skin:'#f1c27d', hair:'#7c4a1e', hairStyle:'bob',    outfit:'#be123c', shirt:'#fff1f2', prop:'books'},
  aerospace:   {skin:'#ffdbac', hair:'#1f1410', hairStyle:'short',  outfit:'#0369a1', shirt:'#e0f2fe', prop:'rocket'},
  pharmaceutical:{skin:'#e8b98a', hair:'#2b2b2b', hairStyle:'curly', outfit:'#6d28d9', shirt:'#f5f3ff', prop:'flask'},
  sports:      {skin:'#8d5524', hair:'#1a1a1a', hairStyle:'buzz',   outfit:'#15803d', shirt:'#dcfce7', prop:'heart'},
  realestate:  {skin:'#e0ac69', hair:'#3b2a1a', hairStyle:'short',  outfit:'#92400e', shirt:'#fffbeb', prop:'briefcase'},
  hr:          {skin:'#f1c27d', hair:'#241a12', hairStyle:'bob',    outfit:'#4f46e5', shirt:'#eef2ff', prop:'briefcase'},
  agriculture: {skin:'#c68642', hair:'#3b2a1a', hairStyle:'curly',  outfit:'#4d7c0f', shirt:'#ecfccb', prop:'flask'}
};

// Profession prop drawn (white) on an accent badge centered at (150,150)
function qzPropSVG(prop,accent){
  const P={
    laptop:    `<path d="M139 159 h22 l3 5 h-28z" fill="#fff"/><rect x="142" y="143" width="16" height="13" rx="1.5" fill="#fff"/>`,
    stetho:    `<path d="M142 141 v8 a6 6 0 0 0 12 0 v-8" fill="none" stroke="#fff" stroke-width="2.6"/><circle cx="158" cy="156" r="3.6" fill="#fff"/>`,
    briefcase: `<rect x="138" y="148" width="24" height="15" rx="2" fill="#fff"/><path d="M145 148 v-3 h10 v3" fill="none" stroke="#fff" stroke-width="2.6"/><rect x="138" y="153" width="24" height="2.4" fill="${accent}"/>`,
    palette:   `<ellipse cx="150" cy="151" rx="13" ry="11" fill="#fff"/><circle cx="145" cy="147" r="1.7" fill="${accent}"/><circle cx="151" cy="145" r="1.7" fill="${accent}"/><circle cx="156" cy="150" r="1.7" fill="${accent}"/><circle cx="148" cy="155" r="2.4" fill="${accent}"/>`,
    books:     `<rect x="139" y="146" width="22" height="4.4" rx="1" fill="#fff"/><rect x="140" y="151.5" width="20" height="4.4" rx="1" fill="#fff"/><rect x="141" y="157" width="18" height="4.4" rx="1" fill="#fff"/>`,
    gavel:     `<g transform="rotate(42 150 151)"><rect x="147" y="139" width="6" height="20" rx="2" fill="#fff"/><rect x="142" y="137" width="16" height="8" rx="2" fill="#fff"/></g>`,
    wrench:    `<path d="M156 142 a6 6 0 0 0 -8 8 l-9 9 4 4 9 -9 a6 6 0 0 0 8 -8 l-4 4 -4 -4z" fill="#fff"/>`,
    flask:     `<path d="M147 140 h6 v8 l6 12 a2 2 0 0 1 -2 3 h-14 a2 2 0 0 1 -2 -3 l6 -12z" fill="#fff"/><rect x="146" y="138" width="8" height="2.6" rx="1" fill="#fff"/>`,
    rocket:    `<path d="M150 139 q7 6 7 15 h-14 q0 -9 7 -15z" fill="#fff"/><path d="M143 154 l-4 7 6 -2z" fill="#fff"/><path d="M157 154 l4 7 -6 -2z" fill="#fff"/><circle cx="150" cy="149" r="2.4" fill="${accent}"/>`,
    heart:     `<path d="M150 162 l-10 -10 a5.4 5.4 0 0 1 10 -3.4 a5.4 5.4 0 0 1 10 3.4z" fill="#fff"/>`,
    mic:       `<rect x="146.5" y="139" width="7" height="13" rx="3.5" fill="#fff"/><path d="M142 150 a8 8 0 0 0 16 0" fill="none" stroke="#fff" stroke-width="2.4"/><line x1="150" y1="158" x2="150" y2="163" stroke="#fff" stroke-width="2.4"/>`
  };
  return `<circle cx="150" cy="150" r="23" fill="${accent}" stroke="#fff" stroke-width="3"/>${P[prop]||P.briefcase}`;
}

// Hair shapes by style
function qzHairSVG(style,hair){
  switch(style){
    case 'bob':   return `<path d="M60 96 Q58 48 100 48 Q142 48 140 96 L140 110 Q132 86 132 78 Q116 66 100 68 Q84 66 68 78 Q68 86 60 110 Z" fill="${hair}"/>`;
    case 'curly': return `<g fill="${hair}"><circle cx="70" cy="70" r="16"/><circle cx="90" cy="56" r="17"/><circle cx="112" cy="56" r="17"/><circle cx="132" cy="72" r="15"/><circle cx="78" cy="88" r="12"/><circle cx="126" cy="88" r="12"/></g>`;
    case 'buzz':  return `<path d="M64 92 Q64 56 100 56 Q136 56 136 92 Q120 78 100 78 Q80 78 64 92 Z" fill="${hair}" opacity=".92"/>`;
    case 'hardhat':return `<path d="M58 96 Q58 58 100 58 Q142 58 142 96 Z" fill="#facc15"/><rect x="54" y="93" width="92" height="9" rx="4" fill="#eab308"/><rect x="96" y="60" width="8" height="34" fill="#eab308"/>`;
    default:      return `<path d="M62 92 Q62 52 100 52 Q138 52 138 92 Q122 74 100 76 Q78 74 62 92 Z" fill="${hair}"/>`;
  }
}

// Assemble a confident-professional portrait for an industry
function qzCareerSVG(key){
  const a=qzCAREER_ART[key]||qzCAREER_ART.business;
  const meta=qzCAREER_META[key]||{accent:'var(--primary-solid)'};
  return `<svg viewBox="0 0 200 200" role="img" aria-label="${(QZ_IND[key]||{}).name||'Career'} professional">
    <circle cx="100" cy="100" r="100" fill="#eef3f9"/>
    <path d="M30 200 Q34 150 70 140 L78 150 Q100 162 122 150 L130 140 Q166 150 170 200 Z" fill="${a.outfit}"/>
    <path d="M78 150 L100 178 L122 150 L100 142 Z" fill="${a.shirt}"/>
    <path d="M92 145 L100 170 L108 145 Z" fill="${a.outfit}"/>
    <rect x="90" y="120" width="20" height="28" rx="9" fill="${a.skin}"/>
    <circle cx="100" cy="98" r="40" fill="${a.skin}"/>
    <ellipse cx="62" cy="100" rx="6" ry="9" fill="${a.skin}"/><ellipse cx="138" cy="100" rx="6" ry="9" fill="${a.skin}"/>
    ${qzHairSVG(a.hairStyle,a.hair)}
    <path d="M82 90 q6 -4 12 0" fill="none" stroke="#3a2a1f" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M106 90 q6 -4 12 0" fill="none" stroke="#3a2a1f" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="88" cy="98" r="4.2" fill="#23303f"/><circle cx="112" cy="98" r="4.2" fill="#23303f"/>
    <circle cx="89.4" cy="96.6" r="1.3" fill="#fff"/><circle cx="113.4" cy="96.6" r="1.3" fill="#fff"/>
    <path d="M84 112 Q100 126 116 112" fill="none" stroke="#9c4a3c" stroke-width="3.4" stroke-linecap="round"/>
    <ellipse cx="78" cy="110" rx="5" ry="3.5" fill="#f9a8a8" opacity=".5"/><ellipse cx="122" cy="110" rx="5" ry="3.5" fill="#f9a8a8" opacity=".5"/>
    ${qzPropSVG(a.prop, meta.accent)}
  </svg>`;
}

// Quiz results link to the real deep-dive page. quiz.html never loads
// app-pages.js, so the old onclick="showCareer(...)" handlers threw
// ReferenceError and the buttons did nothing. career.html resolves legacy
// slugs to O*NET careers via the catalog aliases.
function qzCareerHref(slug){
  return 'career.html?slug=' + encodeURIComponent(String(slug || ''));
}

// `careers` (app-pages.js) and `FWHubDeepDives` (career-deep-dives.js) are not
// loaded on quiz.html — referencing them bare threw a ReferenceError that
// killed the whole results-breakdown render. Guard with typeof and fall back
// to a title-cased slug.
function qzCareerTitleForSlug(slug){
  try {
    if (typeof careers !== 'undefined' && careers[slug] && careers[slug].title) return careers[slug].title;
    if (typeof FWHubDeepDives !== 'undefined' && FWHubDeepDives[slug] && FWHubDeepDives[slug].title) return FWHubDeepDives[slug].title;
  } catch (_) { /* ignore */ }
  return String(slug || '').split('-').map(function(w){ return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
}

function qzResolveCareer(key){
  const meta=qzCAREER_META[key]||{person:'🧑‍💼',accent:'var(--primary-solid)'};
  const careerKey=(QZ_TO_CAREER[key]||[])[0]||null;
  const title=careerKey?qzCareerTitleForSlug(careerKey):QZ_IND[key].name;
  const salary=(careerKey && typeof careers!=='undefined' && careers[careerKey])?careers[careerKey].midSalary:'';
  return {key,careerKey,title,salary,meta};
}

// SOC major group (first two digits of the code) → quiz industry key. O*NET
// careers from rankOnetCareersFromVectors carry a synthetic id ('soc:15-1252.00'),
// NOT a hub-careers numeric id, so FWHubCareers.careerToQuizKeys misses them and
// every reveal/results card used to fall back to 'business' — a Software Engineer
// shown as "Business & Entrepreneurship". Deriving from the SOC group gives the
// right sector + portrait with no async catalog lookup.
const SOC_MAJOR_TO_QZ = {
  '11': 'business', '13': 'finance', '15': 'tech', '17': 'engineering', '19': 'science',
  '21': 'social', '23': 'law', '25': 'education', '27': 'creative', '29': 'healthcare',
  '31': 'healthcare', '33': 'government', '35': 'hospitality', '37': 'trades',
  '39': 'hospitality', '41': 'marketing', '43': 'operations', '45': 'agriculture',
  '47': 'trades', '49': 'trades', '51': 'operations', '53': 'operations', '55': 'government'
};
function qzIndustryKeyForCareer(career) {
  if (career && window.FWHubCareers && FWHubCareers.careerToQuizKeys) {
    const mapped = FWHubCareers.careerToQuizKeys[career.id];
    if (mapped && mapped[0]) return mapped[0];
  }
  const soc = career && career.soc;
  if (soc) { const mg = String(soc).slice(0, 2); if (SOC_MAJOR_TO_QZ[mg]) return SOC_MAJOR_TO_QZ[mg]; }
  return 'business';
}

function qzResolveHubCareer(career) {
  const industryKey = qzIndustryKeyForCareer(career);
  const meta = qzCAREER_META[industryKey] || { person: '🧑‍💼', accent: 'var(--primary-solid)' };
  const slug = (window.FWHubCareers && FWHubCareers.careerSlug)
    ? FWHubCareers.careerSlug(career.id)
    : '';
  const deep = slug && window.FWHubDeepDives ? FWHubDeepDives[slug] : null;
  return {
    key: industryKey,
    careerKey: slug || null,
    title: career.name,
    salary: deep ? deep.midSalary : '',
    meta: meta,
    desc: career.description
      || (career.soc && window.FWOnetCatalog && typeof FWOnetCatalog.descriptionFor === 'function'
        ? FWOnetCatalog.descriptionFor(career.soc) : '')
      || ''
  };
}

function qzBinderHtml(rank, careerOrKey, pct, isHubCareer){
  const r = isHubCareer ? qzResolveHubCareer(careerOrKey) : qzResolveCareer(careerOrKey);
  const desc = isHubCareer ? r.desc : qzIndustryWhy(careerOrKey);
  const salaryHtml=r.salary?`<div class="placement-salary">Median pay ~${r.salary} · ${rank===1?'your strongest match so far':'a close second'}</div>`:'';
  const btn=r.careerKey
    ? `<a class="placement-btn" href="${qzCareerHref(r.careerKey)}">Explore this career →</a>`
    : `<button class="placement-btn" onclick="document.getElementById('full-breakdown').scrollIntoView({behavior:'smooth'})">See why it fits →</button>`;
  const sx=[8,84,15,80], sy=[10,15,78,72], se=['✨','⭐','💫','🌟'];
  const sparkles=se.map((s,i)=>`<span class="binder-sparkle" style="left:${sx[i]}%;top:${sy[i]}%;animation-delay:${i*0.12}s">${s}</span>`).join('');
  qzPlacementPct[rank]=pct;
  qzPlacementSoc[rank]=(isHubCareer && careerOrKey && careerOrKey.soc)?careerOrKey.soc:null;
  const tier=qzTierFor(pct);
  return `<div class="binder-slot" id="binder-slot-${rank}" style="--accent:${r.meta.accent};--tier-color:${tier.color}">
    <div class="rank-ribbon">${rank===1?'★ #1 Match so far':'#2 Runner-up'}</div>
    <div class="binder" id="binder-${rank}">
      <div class="ray-burst"></div>
      ${sparkles}
      <div class="placement-card">
        <div class="placement-portrait">${qzCareerSVG(r.key)}</div>
        <div class="placement-title">${r.title}</div>
        <div class="placement-pct">${pct}% match</div>
        ${salaryHtml}
        <div class="placement-desc">${desc}</div>
        <div class="placement-why" id="placement-why-${rank}"></div>
        ${btn}
      </div>
      <div class="binder-cover">
        <div class="binder-rings"><span class="binder-ring"></span><span class="binder-ring"></span><span class="binder-ring"></span></div>
        <div class="cover-emoji">📁</div>
        <div class="cover-label">Career #${rank}</div>
        <div class="cover-sub">${rank===1?'Best Fit':'Runner-up'}</div>
      </div>
    </div>
    <div class="tier-banner">${tier.label}</div>
  </div>`;
}

function qzSalaryArenaHtml(industryKey){
  const t = QZ_SALARY_TIERS[industryKey] || QZ_SALARY_TIERS['tech'];
  const rows = [
    {cls:'sal-elite', badge:'⚡ Boss Tier', firms:t.elite.firms, range:t.elite.range, bar:t.elite.bar},
    {cls:'sal-mid',   badge:'🔹 Mid Tier',  firms:t.mid.firms,   range:t.mid.range,   bar:t.mid.bar},
    {cls:'sal-small', badge:'◽ Entry',      firms:t.small.firms, range:t.small.range, bar:t.small.bar},
  ];
  const barsHtml = rows.map(r=>`
    <div class="sal-bar-row ${r.cls}">
      <div class="sal-bar-meta">
        <span class="sal-tier-badge">${r.badge}</span>
        <span class="sal-firm-name">${r.firms}</span>
        <span class="sal-range">${r.range}</span>
      </div>
      <div class="sal-track"><div class="sal-fill" style="--sal-w:${r.bar}%"></div></div>
    </div>`).join('');

  // Bell curve as inline SVG — hand-tuned bezier path
  const W=340, H=110;
  // bell curve path (normalised to W×H): peak at ~52%, most-people zone shaded
  const bellPath=`M0,${H} C20,${H} 40,${H} 60,${H-4} C90,${H-10} 110,${H-55} 130,${H-85} C150,${H-105} 160,${H-108} 175,${H-108} C190,${H-108} 200,${H-105} 215,${H-85} C235,${H-55} 255,${H-10} 285,${H-4} C310,${H} 325,${H} ${W},${H}`;
  // right-tail highlight path (from x≈250 rightward)
  const tailPath=`M250,${H} C265,${H-6} 275,${H-4} 285,${H-4} C305,${H} 320,${H} ${W},${H} Z`;

  const svgHtml=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;overflow:visible">
    <defs>
      <linearGradient id="bellGrad" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%"   stop-color="#3b4570" stop-opacity=".35"/>
        <stop offset="75%"  stop-color="#3b4570" stop-opacity=".55"/>
        <stop offset="100%" stop-color="#00e87a" stop-opacity=".18"/>
      </linearGradient>
    </defs>
    <!-- full bell fill -->
    <path d="${bellPath} Z" fill="url(#bellGrad)"/>
    <!-- bell outline -->
    <path d="${bellPath}" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="1.5"/>
    <!-- right-tail elite glow -->
    <path d="${tailPath}" fill="rgba(0,232,122,.22)"/>
    <path d="M250,${H} C265,${H-6} 275,${H-4} 285,${H-4}" fill="none" stroke="#00e87a" stroke-width="1.5" stroke-opacity=".6"/>
    <!-- "most people" annotation -->
    <text x="175" y="${H-114}" text-anchor="middle" font-family="Courier New,monospace" font-size="9" font-weight="700" fill="rgba(255,255,255,.4)" letter-spacing="1">MOST PEOPLE</text>
    <line x1="175" y1="${H-110}" x2="175" y2="${H-92}" stroke="rgba(255,255,255,.2)" stroke-width="1" stroke-dasharray="2,2"/>
  </svg>`;

  return `<div class="salary-arena">
    <div class="sal-arena-eye">// SALARY BATTLEFIELD //</div>
    <div class="sal-arena-title">The Salary Landscape</div>
    <div class="sal-arena-sub">Real compensation across firm tiers — for your #1 matched industry.</div>
    <div class="sal-bars">${barsHtml}</div>
    <div class="salary-dist">
      <div class="dist-svg-wrap">
        ${svgHtml}
        <div class="dist-your-tag">
          <span class="dist-your-star">⭐</span>
          <span class="dist-your-label">You could be here</span>
        </div>
      </div>
      <div class="dist-axis">
        <span class="dist-axis-label">Entry</span>
        <span class="dist-axis-label">Average</span>
        <span class="dist-axis-label">Elite Firms</span>
      </div>
    </div>
    <div class="sal-cta-box">
      <div class="sal-cta-stat"><strong>78% of people</strong> never reach elite-tier pay.<br>The other 22% had a plan.</div>
      <button class="salary-unlock-btn" onclick="coachOpenFromNav()">⚔️ &nbsp;Talk to Marco, your AI advisor →</button>
    </div>
  </div>`;
}

// FW trust pass — acknowledge the user's stated leaning before suggesting.
// Interview finding: most users arrive with a career in mind and get upset when
// an algorithm silently overrides it. Lead with their pick, score it honestly,
// and frame our #1 as a related comparison — never a flat replacement.
function qzRenderLeaningAck(hubTop1){
  const el=document.getElementById('qz-leaning-ack');
  const text=(qzLeaning||'').trim();
  if(!el || !text) return;
  const esc=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const show=html=>{ el.innerHTML=html; el.hidden=false; };
  if(!window.FWOnetCatalog || typeof FWOnetCatalog.searchByTitle!=='function' || typeof FWOnetCatalog.load!=='function'){
    show(`You mentioned <strong>${esc(text)}</strong> — keep it on the table as you explore below.`);
    return;
  }
  FWOnetCatalog.load().then(()=>{
    const hit=(FWOnetCatalog.searchByTitle(text,1)||[])[0];
    if(!hit){
      show(`You mentioned <strong>${esc(text)}</strong> — we'll keep that in mind. Your matches below are a comparison point, not a replacement.`);
      return;
    }
    const href=qzCareerHref(hit.slug||'');
    const link=`<a href="${href}">${esc(hit.name||hit.title)}</a>`;
    const topSoc=hubTop1 && hubTop1.career && hubTop1.career.soc;
    if(topSoc && topSoc===hit.soc){
      show(`You told us you were leaning toward <strong>${esc(hit.name||hit.title)}</strong> — your answers back that up. It comes out as your #1 match.`);
      return;
    }
    const ranked=(window.FWOnetVectors && typeof FWOnetVectors.getCachedOnetRank==='function')
      ? FWOnetVectors.getCachedOnetRank() : null;
    let rankLine='';
    if(ranked && ranked.length){
      const idx=ranked.findIndex(r=>r.soc===hit.soc);
      if(idx>=0) rankLine=` It ranks #${idx+1} of ${ranked.length} for you`+(ranked[idx].score!=null?` (${Math.max(0,Math.min(100,Math.round(ranked[idx].score)))}% fit)`:'')+'.';
    }
    show(`You mentioned <strong>${link}</strong> — that's a real option, and it stays on the table.${rankLine} The matches below build on many of the same strengths — compare them side by side, don't treat them as a replacement.`);
  }).catch(()=>{
    show(`You mentioned <strong>${esc(text)}</strong> — keep it on the table as you explore below.`);
  });
}

// FW trust pass — "why this match" at the first reveal. Reuses the same
// comparison rows + drawer the career.html deep dive already renders, so the
// very first % a user sees carries a tap-to-expand explanation instead of
// standing alone as a verdict. Additive: any failure leaves the reveal as-is.
function qzInjectWhy(){
  if(!window.FWWhyMatch || !window.FWOnetVectors
    || typeof FWOnetVectors.userVsCareerDimensions!=='function'
    || typeof FWOnetVectors.readQuizVectors!=='function') return;
  let vecs=null;
  try{ vecs=FWOnetVectors.readQuizVectors(); }catch(_){ return; }
  const personality=vecs && vecs.personality && vecs.personality.values;
  if(!personality || !personality.length) return;
  const objective=vecs.objective && vecs.objective.values;
  const confidence=vecs.personality.confidence;
  const objActive=!!(objective && objective.some(v=>Number(v)>1));
  [1,2].forEach(rank=>{
    const soc=qzPlacementSoc[rank];
    const mount=document.getElementById('placement-why-'+rank);
    if(!soc || !mount) return;
    FWOnetVectors.userVsCareerDimensions(soc, personality, objective, confidence).then(match=>{
      if(!match || !match.comparisons || !match.comparisons.length) return;
      FWWhyMatch.inject(mount, match.comparisons, qzPlacementPct[rank], {k:3});
      if(!objActive && !mount.querySelector('.placement-basis')){
        const basis=document.createElement('div');
        basis.className='placement-basis';
        basis.textContent='A starting read from your quiz answers — we\'ll sharpen it together right after you sign up.';
        mount.appendChild(basis);
      }
    }).catch(()=>{});
  });
}

function qzShowResults(){
  document.getElementById('qz-quiz').classList.add('qz-hidden');
  document.getElementById('qz-results').classList.remove('qz-hidden');
  const sc=qzComputeScores();

  function renderWithRanking(careerRanked) {
  const sorted=Object.entries(sc).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const maxSc=sorted[0][1]||1;
  const top1=sorted[0], top2=sorted[1];
  const pct1=Math.round((top1[1]/maxSc)*100), pct2=Math.round((top2[1]/maxSc)*100);
  const hubTop1 = careerRanked[0];
  const hubTop2 = careerRanked[1];
  // Use the ABSOLUTE 0-100 fit score, not a ratio to the winner — dividing by
  // the top score forced every #1 to read 100% + "legendary" regardless of fit.
  const clampFit = function (s) { return Math.max(0, Math.min(100, Math.round(Number(s) || 0))); };
  const hubPct1 = hubTop1 ? clampFit(hubTop1.score) : pct1;
  const hubPct2 = hubTop2 ? clampFit(hubTop2.score) : pct2;

  // ── Lead with the dramatic binder reveal (top 2 hub careers) ──
  let h=`<div class="reveal-stage">
    <div class="reveal-eye">Your Starting Matches</div>
    <div class="reveal-headline" id="reveal-headline">Tallying your results…</div>
    <div class="reveal-tagline" id="reveal-tagline">Hold tight — your career binders are loading.</div>
    <button class="skip-reveal" onclick="qzSkipReveal()">Skip the reveal →</button>
    <div id="qz-leaning-ack" class="qz-leaning-ack" hidden></div>
    ${hubTop2 ? qzBinderHtml(2, hubTop2.career, hubPct2, true) : qzBinderHtml(2, top2[0], pct2, false)}
    ${hubTop1 ? qzBinderHtml(1, hubTop1.career, hubPct1, true) : qzBinderHtml(1, top1[0], pct1, false)}
  </div>`;

  // ── Full breakdown (revealed after the binders open) ──
  let fb=`<div class="res-hdr"><div class="res-eye">The Full Picture</div><div class="res-title">Your Top Industry Matches</div><div class="res-sub">Personalized from 19 data points about how you think, work, and lead.</div><p class="qz-fit-footnote">Percentiles show how strongly you match each path vs other careers. In Career Hub, add academics or a transcript to unlock objective fit alongside personality fit.</p></div>`;
  if(qzGpa!==null){ const g=qzGpaFeedback(qzGpa); fb+=`<div class="gpa-banner ${g.cls||'solid'}">${qzGpaMessage()}</div>`; }
  fb+=qzSalaryArenaHtml(sorted[0][0]);
  if(qzResumeText && Object.keys(qzResumeBoosts).length>0){
    const topBoosts=Object.entries(qzResumeBoosts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>QZ_IND[k]?.name||k);
    fb+=`<div class="qz-resume-insight"><div class="qz-ri-title">📄 Resume factored in</div><div class="qz-ri-text">Your background strengthened your match in <strong>${topBoosts.join(', ')}</strong>. The school recommendations and career paths below reflect your actual experience — not just your quiz answers.</div></div>`;
  }
  if(qzEnrichDone&&Object.keys(qzEnrichBoosts).length>0){
    const enrichBoosts=Object.entries(qzEnrichBoosts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>QZ_IND[k]?.name||k);
    const charNote=qzCharacterSummary?` ${qzCharacterSummary}`:'';
    fb+=`<div class="qz-resume-insight"><div class="qz-ri-title">✏️ Your own words factored in</div><div class="qz-ri-text">What you wrote about how you act in groups shaped your matches${enrichBoosts.length?` — especially <strong>${enrichBoosts.join(', ')}</strong>`:''}.${charNote}</div></div>`;
  }
  sorted.forEach(([key,score],i)=>{
    const ind=QZ_IND[key];
    const pct=Math.round((score/maxSc)*100);
    const why=qzIndustryWhy(key);
    const schoolBlock=qzSchoolBlurb(key);
    const careersList=QZ_TO_CAREER[key]||[];
    const hubMatches = (window.FWHubCareers && FWHubCareers.careersForIndustry)
      ? FWHubCareers.careersForIndustry(key).slice(0, 4)
      : [];
    const hubLinksHtml = hubMatches.map(function (hc) {
      const slug = FWHubCareers.careerSlug ? FWHubCareers.careerSlug(hc.id) : '';
      if (!slug) return '';
      return `<a class="ind-career-link" href="${qzCareerHref(slug)}">${hc.name} guide →</a>`;
    }).join('');
    const legacyLinksHtml = careersList.map(ck=>`<a class="ind-career-link" href="${qzCareerHref(ck)}">${qzCareerTitleForSlug(ck)} guide →</a>`).join('');
    const careerLinksHtml = (hubLinksHtml || legacyLinksHtml)
      ? `<div class="ind-careers">${hubLinksHtml || legacyLinksHtml}</div>` : '';
    fb+=`<div class="ind-card ${i===0?'top':''}">
      <div class="ind-head"><div class="ind-rank">${i+1}</div><div class="ind-name">${ind.icon} ${ind.name}</div><div class="ind-pct">${pct}%</div></div>
      <div class="ind-bar"><div class="ind-bar-fill" style="width:${pct}%"></div></div>
      <div class="ind-why">${why}</div>
      ${schoolBlock}
      ${careerLinksHtml}
    </div>`;
  });
  fb+=`<div style="text-align:center;margin-top:30px;padding-top:24px;border-top:1px solid var(--border-light);display:flex;flex-wrap:wrap;gap:12px;justify-content:center"><a class="cta-btn" onclick="qzOpenCareerHub()">Open Career Hub →</a><a class="cta-btn cta-btn-outline" onclick="coachOpenFromNav()">Talk to Marco →</a></div>`;
  fb+=`<button class="qz-restart" onclick="qzRestart()">↺ Retake Assessment</button>`;

  h+=`<div class="full-breakdown" id="full-breakdown">${fb}</div>`;
  document.getElementById('qz-rcard').innerHTML=h;
  window.scrollTo({top:0,behavior:'smooth'});
  qzRevealTimers.forEach(clearTimeout); qzRevealTimers=[];
  if(qzParticleRAF){ cancelAnimationFrame(qzParticleRAF); qzParticleRAF=null; }
  qzFxLayer();
  qzRunReveal();
  qzRenderLeaningAck(hubTop1);
  const persisted=qzPersistHubQuiz();
  if(persisted && typeof persisted.then==='function') persisted.then(qzInjectWhy).catch(()=>qzInjectWhy());
  else qzInjectWhy();
  }

  if (window.FWOnetVectors && typeof FWOnetVectors.rankOnetCareersFromVectors === 'function') {
    FWOnetVectors.rankOnetCareersFromVectors({ scores: sc, limit: 12 }).then(function (ranked) {
      var careerRanked = ranked
        ? ranked.map(function (m) { return { career: m.career, score: m.score }; })
        : [];
      renderWithRanking(careerRanked);
    }).catch(function () {
      renderWithRanking([]);
    });
    return;
  }

  if (window.FWOnetVectors && typeof FWOnetVectors.rankFeaturedFromVectors === 'function') {
    FWOnetVectors.rankFeaturedFromVectors({ scores: sc, limit: 12 }).then(function (ranked) {
      var careerRanked = ranked
        ? ranked.map(function (m) { return { career: m.career, score: m.score }; })
        : [];
      renderWithRanking(careerRanked);
    }).catch(function () {
      renderWithRanking([]);
    });
    return;
  }

  const careerRanked = (window.FWHubCareers && FWHubCareers.rankCareersFromQuizScores)
    ? FWHubCareers.rankCareersFromQuizScores(sc)
    : [];
  renderWithRanking(careerRanked);
}

function qzPersistHubQuiz(){
  var payload = qzBuildHubPayload();
  var save = function (p) {
    try { if (window.FWUser) FWUser.putBlob(p); } catch (_) {}
  };
  var done = window.FWOnetQuizSeed
    ? FWOnetQuizSeed.attachVectorsToPayload(payload).then(save)
    : Promise.resolve(save(payload));
  done = done.catch(function () { save(payload); });
  if (window.FWAuth && FWAuth.authEmail && FWAuth.authEmail()) {
    FWAuth.syncQuizProfile()
      .then(function () {
        if (typeof FWAuth.refreshPortalSnapshot === 'function') {
          return FWAuth.refreshPortalSnapshot({ force: true });
        }
      })
      .catch(function (err) { console.warn('quiz profile sync failed', err); });
  }
  return done;
}

function qzSleep(ms){return new Promise(res=>{const id=setTimeout(res,ms);qzRevealTimers.push(id);});}

// Synthesized "anticipation riser" leading up to each binder
function qzPlayAnticipation(){
  try{
    if(!qzAudioCtx) qzAudioCtx=new (window.AudioContext||window.webkitAudioContext)();
    const ctx=qzAudioCtx; if(ctx.state==='suspended') ctx.resume();
    const now=ctx.currentTime;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='sawtooth';
    o.frequency.setValueAtTime(196, now);
    o.frequency.exponentialRampToValueAtTime(622, now+0.78);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.09, now+0.12);
    g.gain.exponentialRampToValueAtTime(0.15, now+0.66);
    g.gain.exponentialRampToValueAtTime(0.0001, now+0.84);
    o.connect(g); g.connect(ctx.destination);
    o.start(now); o.stop(now+0.9);
  }catch(e){}
}

// Synthesized happy "ta-da" fanfare when a binder pops open
function qzPlayReveal(){
  try{
    if(!qzAudioCtx) qzAudioCtx=new (window.AudioContext||window.webkitAudioContext)();
    const ctx=qzAudioCtx; if(ctx.state==='suspended') ctx.resume();
    const now=ctx.currentTime;
    const notes=[523.25,659.25,783.99,1046.50]; // C5 E5 G5 C6 — bright major
    notes.forEach((f,i)=>{
      const t=now+i*0.12, o=ctx.createOscillator(), g=ctx.createGain();
      o.type='triangle'; o.frequency.value=f;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001,t);
      g.gain.exponentialRampToValueAtTime(0.24,t+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001,t+0.4);
      o.start(t); o.stop(t+0.42);
    });
    const t2=now+notes.length*0.12; // shimmer chord
    [1046.50,1318.51,1567.98].forEach(f=>{
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type='sine'; o.frequency.value=f;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001,t2);
      g.gain.exponentialRampToValueAtTime(0.13,t2+0.04);
      g.gain.exponentialRampToValueAtTime(0.0001,t2+0.75);
      o.start(t2); o.stop(t2+0.8);
    });
  }catch(e){}
}

// Building sub-bass rumble + riser during the charge-up
function qzPlayCharge(){
  try{
    if(!qzAudioCtx) qzAudioCtx=new (window.AudioContext||window.webkitAudioContext)();
    const ctx=qzAudioCtx; if(ctx.state==='suspended') ctx.resume();
    const now=ctx.currentTime, dur=1.4;
    // low rumble
    const lo=ctx.createOscillator(), lg=ctx.createGain();
    lo.type='sawtooth';
    lo.frequency.setValueAtTime(42, now);
    lo.frequency.exponentialRampToValueAtTime(96, now+dur);
    lg.gain.setValueAtTime(0.0001, now);
    lg.gain.exponentialRampToValueAtTime(0.16, now+dur*0.7);
    lg.gain.exponentialRampToValueAtTime(0.32, now+dur);
    lo.connect(lg); lg.connect(ctx.destination);
    lo.start(now); lo.stop(now+dur+0.05);
    // riser sweep on top
    const hi=ctx.createOscillator(), hg=ctx.createGain();
    hi.type='triangle';
    hi.frequency.setValueAtTime(220, now);
    hi.frequency.exponentialRampToValueAtTime(1320, now+dur);
    hg.gain.setValueAtTime(0.0001, now);
    hg.gain.exponentialRampToValueAtTime(0.06, now+0.2);
    hg.gain.exponentialRampToValueAtTime(0.14, now+dur);
    hg.gain.exponentialRampToValueAtTime(0.0001, now+dur+0.12);
    hi.connect(hg); hg.connect(ctx.destination);
    hi.start(now); hi.stop(now+dur+0.15);
  }catch(e){}
}

// Impact "boom" + noise burst, then the bright fanfare
function qzPlayImpact(tier){
  try{
    if(!qzAudioCtx) qzAudioCtx=new (window.AudioContext||window.webkitAudioContext)();
    const ctx=qzAudioCtx; if(ctx.state==='suspended') ctx.resume();
    const now=ctx.currentTime;
    // boom: descending sine thump
    const bo=ctx.createOscillator(), bg=ctx.createGain();
    bo.type='sine';
    bo.frequency.setValueAtTime(180, now);
    bo.frequency.exponentialRampToValueAtTime(46, now+0.32);
    bg.gain.setValueAtTime(0.4, now);
    bg.gain.exponentialRampToValueAtTime(0.0001, now+0.5);
    bo.connect(bg); bg.connect(ctx.destination);
    bo.start(now); bo.stop(now+0.55);
    // short noise burst
    const len=Math.floor(ctx.sampleRate*0.22), buf=ctx.createBuffer(1,len,ctx.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
    const src=ctx.createBufferSource(), ng=ctx.createGain();
    src.buffer=buf; ng.gain.setValueAtTime(0.22, now); ng.gain.exponentialRampToValueAtTime(0.0001, now+0.22);
    src.connect(ng); ng.connect(ctx.destination); src.start(now);
  }catch(e){}
  qzPlayReveal();
}

// ── FX overlay + canvas particle burst ──
function qzFxLayer(){
  let fx=document.getElementById('qz-fx');
  if(!fx){
    fx=document.createElement('div'); fx.id='qz-fx';
    fx.innerHTML='<div class="fx-dim"></div><canvas id="fx-particles"></canvas><div class="fx-flash"></div>';
    document.body.appendChild(fx);
  }
  return fx;
}
function qzFxTeardown(){
  if(qzParticleRAF){ cancelAnimationFrame(qzParticleRAF); qzParticleRAF=null; }
  const fx=document.getElementById('qz-fx'); if(fx) fx.remove();
}
function qzFxFlash(){
  const f=document.querySelector('#qz-fx .fx-flash'); if(!f) return;
  f.classList.remove('fire'); void f.offsetWidth; f.classList.add('fire');
}
function qzBurstParticles(cx,cy,tier){
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas=document.getElementById('fx-particles'); if(!canvas) return;
  const ctx=canvas.getContext('2d'); const dpr=window.devicePixelRatio||1;
  canvas.width=innerWidth*dpr; canvas.height=innerHeight*dpr; ctx.scale(dpr,dpr);
  const cols=tier.name==='LEGENDARY'
    ? ['#f5b301','#ffd966','#fff3c4','#ffffff','#ffb703']
    : ['#7c3aed','#a78bfa','#c4b5fd','#ffffff','#e9d5ff'];
  const N=tier.particles, ps=[];
  for(let i=0;i<N;i++){
    const ang=Math.random()*Math.PI*2, sp=4+Math.random()*11;
    ps.push({x:cx,y:cy,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp-3,
      g:0.18+Math.random()*0.12, life:1, decay:0.008+Math.random()*0.012,
      size:5+Math.random()*7, rot:Math.random()*6.28, vr:(Math.random()-0.5)*0.4,
      col:cols[(Math.random()*cols.length)|0], streak:Math.random()<0.18});
  }
  function frame(){
    ctx.clearRect(0,0,innerWidth,innerHeight);
    let alive=false;
    for(const p of ps){
      if(p.life<=0) continue; alive=true;
      p.vy+=p.g; p.x+=p.vx; p.y+=p.vy; p.vx*=0.99; p.rot+=p.vr; p.life-=p.decay;
      ctx.save(); ctx.globalAlpha=Math.max(0,p.life); ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.fillStyle=p.col;
      if(p.streak){ ctx.fillRect(-1.5,-p.size*1.8,3,p.size*3.6); }
      else { ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*0.6); }
      ctx.restore();
    }
    if(alive){ qzParticleRAF=requestAnimationFrame(frame); }
    else { qzParticleRAF=null; ctx.clearRect(0,0,innerWidth,innerHeight); }
  }
  if(qzParticleRAF) cancelAnimationFrame(qzParticleRAF);
  qzParticleRAF=requestAnimationFrame(frame);
}

// Charge up one binder then burst it open (loot-box style)
async function qzRevealOne(rank, chargeMs){
  const slot=document.getElementById('binder-slot-'+rank);
  const binder=document.getElementById('binder-'+rank);
  if(!slot||!binder) return;
  const tier=qzTierFor(qzPlacementPct[rank]!=null?qzPlacementPct[rank]:0);
  const dim=document.querySelector('#qz-fx .fx-dim');

  slot.classList.add('show');
  try{ slot.scrollIntoView({behavior:'smooth',block:'center'}); }catch(e){}
  await qzSleep(450);
  // charge-up
  if(dim) dim.classList.add('on');
  qzPlayCharge();
  binder.classList.add('charging');
  await qzSleep(chargeMs);
  // CLIMAX
  binder.classList.remove('charging');
  qzFxFlash();
  qzPlayImpact(tier);
  const card=document.getElementById('qz-rcard');
  if(card){ card.classList.remove('shake-screen'); void card.offsetWidth; card.classList.add('shake-screen'); }
  const rect=binder.getBoundingClientRect();
  qzBurstParticles(rect.left+rect.width/2, rect.top+rect.height/2, tier);
  binder.classList.add('open');
  await qzSleep(380);
  if(dim) dim.classList.remove('on');
}

async function qzRunReveal(){
  const head=document.getElementById('reveal-headline');
  const tag=document.getElementById('reveal-tagline');
  if(!document.getElementById('binder-slot-2')||!document.getElementById('binder-slot-1')) return;

  // Runner-up first (EPIC)
  if(head) head.textContent='Counting down your matches…';
  if(tag) tag.textContent='Charging up your runner-up…';
  await qzSleep(550);
  await qzRevealOne(2, 1300);
  if(tag) tag.textContent='✦ Your #2 career fit';
  await qzSleep(1500);

  // The big one (LEGENDARY)
  if(head) head.textContent='And your #1 match is…';
  if(tag) tag.textContent='Drumroll… this is the big one.';
  await qzSleep(700);
  await qzRevealOne(1, 1700);
  if(head) head.textContent='🎉 Your top match — so far';
  if(tag) tag.textContent='A starting read from your answers, not a final verdict. Tap a card for the full guide — we\'ll ask a few sharper questions after you sign up.';
  await qzSleep(1100);

  const breakdown=document.getElementById('full-breakdown');
  if(breakdown) breakdown.classList.add('show');
}

function qzSkipReveal(){
  qzRevealTimers.forEach(clearTimeout); qzRevealTimers=[];
  if(qzParticleRAF){ cancelAnimationFrame(qzParticleRAF); qzParticleRAF=null; }
  const fx=document.getElementById('qz-fx'); if(fx) fx.remove();
  ['binder-slot-2','binder-slot-1'].forEach(id=>{const e=document.getElementById(id); if(e) e.classList.add('show');});
  ['binder-2','binder-1'].forEach(id=>{const e=document.getElementById(id); if(e){e.classList.remove('glowing','shaking','charging'); e.classList.add('open');}});
  const head=document.getElementById('reveal-headline'); if(head) head.textContent='🎉 Your Top Career Matches';
  const tag=document.getElementById('reveal-tagline'); if(tag) tag.textContent='Tap either card to dive into the full guide.';
  const bd=document.getElementById('full-breakdown'); if(bd) bd.classList.add('show');
}

function qzGpaMessage(){
  if(qzGpa>=3.9) return `🏆 With a ${qzGpa.toFixed(2)} GPA, every elite program in America is realistically within reach. Don't undersell yourself — top consulting firms, top med schools, top law schools, and top grad programs will all take your application seriously.`;
  if(qzGpa>=3.7) return `⭐ A ${qzGpa.toFixed(2)} GPA is an exceptional asset. You're competitive for top-tier graduate programs and the most selective recruiting tracks at top companies.`;
  if(qzGpa>=3.4) return `✓ A ${qzGpa.toFixed(2)} GPA gives you real optionality. Strong graduate programs and competitive employers will look at you carefully — and what you build outside the classroom matters more from here.`;
  if(qzGpa>=3.0) return `Your ${qzGpa.toFixed(2)} GPA is a solid foundation. From here, what differentiates you isn't grades — it's the specific things you build, lead, and ship.`;
  return `Your GPA is one input among many. Some of the most successful people in every industry below had average grades — what mattered was relentless work outside the classroom.`;
}

function qzIndustryWhy(key){
  const reasons=[];
  const subs=qzAnswers.subjects;
  const map=qzAnswers.map||{x:50,y:50};
  if(key==='tech'){
    if(subs.includes('💻 Tech / Coding')||subs.includes('🧮 Math')) reasons.push(`Your love of ${subs.includes('💻 Tech / Coding')?'tech':'math'} maps directly into the field.`);
    if(map.y<50) reasons.push("Your structured thinking is exactly what software engineering rewards.");
    if((qzBudget.flex||0)>=18) reasons.push("Tech offers more flexibility and remote optionality than almost any field.");
    if(qzSliders.risk>60) reasons.push("Your risk tolerance suits an industry where moving fast pays.");
  } else if(key==='healthcare'){
    if(subs.includes('🩺 Medicine')||subs.includes('🔬 Science')) reasons.push("Your interest in medicine and science is the foundation of this work.");
    if(map.x>50) reasons.push("Healthcare is fundamentally about people — your collaborative energy fits.");
    if((qzBudget.purpose||0)>=18) reasons.push("Few fields offer more direct, tangible impact on individual lives.");
    if((qzBudget.security||0)>=18) reasons.push("Healthcare careers offer some of the highest job security in the economy.");
  } else if(key==='finance'){
    if(subs.includes('📈 Economics')||subs.includes('🧮 Math')) reasons.push("Your quantitative interests map directly to finance's core skill set.");
    if((qzBudget.salary||0)>=22) reasons.push("Few industries pay as well as finance for top performers — your goals fit.");
    if(map.y<50) reasons.push("Your appreciation for structure is essential to thriving in finance.");
    if(qzSliders.intensity>60) reasons.push("Finance rewards high-intensity work — and that's the pace you want.");
  } else if(key==='creative'){
    if(subs.some(s=>['🎨 Art & Design','🎵 Music','🎬 Film','✍️ Writing','📷 Photography'].includes(s))) reasons.push("Your creative interests are obvious — this isn't a stretch, it's a calling.");
    if(map.y>55) reasons.push("You scored as highly creative — this field is built for people like you.");
    if((qzBudget.flex||0)>=18) reasons.push("Creative work tends to allow the autonomy and flexibility you want.");
  } else if(key==='education'){
    if(subs.some(s=>['🤔 Philosophy','📜 History','✍️ Writing','🌍 Global Issues','🧠 Psychology'].includes(s))) reasons.push("Your intellectual interests are the soil from which great teachers grow.");
    if((qzBudget.purpose||0)>=18) reasons.push("Education is one of the highest-leverage ways to make lasting impact.");
    if(map.x>50) reasons.push("Teaching is fundamentally relational — your people-orientation fits.");
  } else if(key==='business'){
    if(subs.includes('💼 Business')||subs.includes('📈 Economics')) reasons.push("Your interest in business and economics is a direct fit.");
    if(map.x>55) reasons.push("Consulting and business leadership reward your collaborative style.");
    if((qzBudget.growth||0)>=18) reasons.push("Few fields offer faster early-career growth than top business roles.");
    if((qzBudget.recog||0)>=18) reasons.push("Business leadership offers the visibility and recognition you value.");
  } else if(key==='law'){
    if(subs.some(s=>['⚖️ Politics','📜 History','🤔 Philosophy','✍️ Writing'].includes(s))) reasons.push("Your interests in argument, history, and reasoning are the bedrock of legal thinking.");
    if(map.y<50) reasons.push("Your preference for structure and precision suits legal work perfectly.");
    if((qzBudget.recog||0)>=18) reasons.push("Law offers prestige and recognition few professions match.");
  } else if(key==='engineering'){
    if(subs.includes('🏗️ Engineering')||subs.includes('🧮 Math')||subs.includes('🔬 Science')) reasons.push("Your technical and analytical interests are exactly what engineering demands.");
    if(map.y<55) reasons.push("Your structured thinking is essential for engineering rigor.");
    if((qzBudget.security||0)>=15) reasons.push("Engineering offers strong, stable career paths with high earning potential.");
  } else if(key==='science'){
    if(subs.includes('🔬 Science')||subs.includes('🌿 Nature')||subs.includes('🩺 Medicine')) reasons.push("Your scientific curiosity is the prerequisite — and you have it in abundance.");
    if(qzGpa>=3.7) reasons.push("Your GPA signals you can handle rigorous graduate-level research.");
    if(qzSliders.intensity<55) reasons.push("Research rewards patience and sustained focus — your work style fits.");
  } else if(key==='startups'){
    if(qzSliders.risk>60) reasons.push("Your risk tolerance is essential for the startup path — most can't handle it.");
    if((qzBudget.growth||0)>=20) reasons.push("Startups offer the steepest learning curve in any career.");
    if((qzBudget.salary||0)<20) reasons.push("Your willingness to delay reward fits the startup payout curve.");
    if(map.y>55) reasons.push("Your creative orientation suits the build-from-nothing nature of startups.");
  } else if(key==='social'){
    if(subs.some(s=>['🌍 Global Issues','🧠 Psychology','📜 History','⚖️ Politics'].includes(s))) reasons.push("Your interests in people, systems, and justice point straight here.");
    if((qzBudget.purpose||0)>=22) reasons.push("Mission-driven work is exactly what your values point you toward.");
    if(map.x>55) reasons.push("Social impact is built on collaboration — your team orientation fits.");
  } else if(key==='marketing'){
    if(subs.some(s=>['🎬 Film','✍️ Writing','🎨 Art & Design','📷 Photography'].includes(s))) reasons.push("Your creative interests give you natural intuition for what moves audiences.");
    if(map.x>50) reasons.push("Marketing is fundamentally about understanding people — your orientation fits.");
    if((qzBudget.flex||0)>=18) reasons.push("Modern marketing offers remote and flexible career structures.");
  } else if(key==='trades'){
    if(subs.includes('🔧 Hands-on Building')||subs.includes('🏗️ Engineering')) reasons.push("Your hands-on interests align with skilled trades that reward practical mastery.");
    if(map.y<50) reasons.push("Trades reward structure, precision, and showing up consistently — your profile fits.");
    if((qzBudget.security||0)>=15) reasons.push("Licensed trades offer strong job security and upward earning potential.");
  } else if(key==='media'){
    if(subs.some(s=>['🎬 Film','📷 Photography','✍️ Writing'].includes(s))) reasons.push("Your storytelling interests map directly into media production and broadcasting.");
    if((qzBudget.recog||0)>=16) reasons.push("Media careers reward visibility and audience connection — both matter to you.");
    if(map.x>55) reasons.push("Media is collaborative at its best — your team orientation is an asset.");
  } else if(key==='government'){
    if(subs.some(s=>['⚖️ Politics','🌍 Global Issues','📜 History'].includes(s))) reasons.push("Your civic interests point toward public service and policy work.");
    if((qzBudget.purpose||0)>=18) reasons.push("Government roles offer systemic impact at scale — aligned with your values.");
    if(map.y<50) reasons.push("Public institutions reward process, rigor, and long-term thinking.");
  } else if(key==='cybersecurity'){
    if(subs.includes('🛡️ Cybersecurity')||subs.includes('💻 Tech / Coding')) reasons.push("Your technical interests are the foundation of modern security work.");
    if(map.y<50) reasons.push("Security rewards structured thinking and adversarial problem-solving.");
    if((qzBudget.salary||0)>=20) reasons.push("Cybersecurity is one of the fastest-growing, highest-paying tech specializations.");
  } else if(key==='operations'){
    if(subs.includes('💼 Business')||subs.includes('🔧 Hands-on Building')) reasons.push("Operations sits at the intersection of people, process, and execution — your interests fit.");
    if(qzSliders.intensity>55) reasons.push("High-tempo operational roles reward the pace you prefer.");
    if(map.y<50) reasons.push("Strong operators thrive on systems, metrics, and continuous improvement.");
  } else if(key==='hospitality'){
    if(subs.includes('🏨 Hospitality')) reasons.push("Your interest in hospitality signals a natural fit for guest experience and service leadership.");
    if(map.x>55) reasons.push("Hospitality is deeply people-oriented — your collaborative energy fits.");
    if((qzBudget.flex||0)>=15) reasons.push("Many hospitality paths offer dynamic, people-first work environments.");
  } else if(key==='aerospace'){
    if(subs.includes('✈️ Aviation')||subs.includes('🏗️ Engineering')) reasons.push("Aerospace demands the engineering rigor and curiosity you bring.");
    if((qzBudget.salary||0)>=20) reasons.push("Aviation and aerospace offer elite compensation for top technical talent.");
    if(qzSliders.risk>55) reasons.push("Aerospace rewards calculated risk-taking on frontier projects.");
  } else if(key==='pharmaceutical'){
    if(subs.includes('🩺 Medicine')||subs.includes('🔬 Science')) reasons.push("Your science and health interests are prerequisites for pharma and biotech.");
    if(qzGpa>=3.5) reasons.push("Your academic strength supports rigorous lab and clinical pathways.");
    if((qzBudget.security||0)>=15) reasons.push("Pharma offers stable career ladders with meaningful health impact.");
  } else if(key==='sports'){
    if(subs.includes('🏃 Sports')) reasons.push("Your athletic interests align with coaching, management, and sports business roles.");
    if((qzBudget.recog||0)>=16) reasons.push("Sports careers often reward competitive drive and public performance.");
    if(map.x>55) reasons.push("Team sports culture maps to collaborative leadership paths.");
  } else if(key==='realestate'){
    if(subs.includes('📈 Economics')||subs.includes('💼 Business')) reasons.push("Real estate blends business acumen with relationship skills — your profile fits.");
    if((qzBudget.salary||0)>=22) reasons.push("Top performers in real estate can earn well above average — matching your ambitions.");
    if(map.x>55) reasons.push("Real estate is a relationship business — your people orientation helps.");
  } else if(key==='hr'){
    if(subs.includes('🧠 Psychology')||subs.includes('💼 Business')) reasons.push("HR rewards understanding people and organizational dynamics — your interests align.");
    if(map.x>55) reasons.push("People operations is fundamentally collaborative.");
    if((qzBudget.purpose||0)>=16) reasons.push("HR leaders shape culture and employee wellbeing at scale.");
  } else if(key==='agriculture'){
    if(subs.includes('🌿 Nature')||subs.includes('🔬 Science')) reasons.push("Your interest in nature and science supports sustainable agriculture pathways.");
    if((qzBudget.purpose||0)>=18) reasons.push("Ag and sustainability work offers tangible environmental impact.");
    if(map.y<50) reasons.push("Modern agriculture increasingly blends data, engineering, and field science.");
  }
  if(reasons.length===0) reasons.push("Your overall profile shows strong alignment with this field's core demands.");
  return reasons.slice(0,3).join(' ');
}

function qzSchoolBlurb(industryKey){
  if(!qzSchool) return '';
  if(qzSchoolMatch){
    const prog=qzSchoolMatch.p && qzSchoolMatch.p[industryKey];
    if(prog){
      return `<div class="ind-school"><strong>Why ${qzSchoolMatch.name} is the right place</strong><div class="major">Recommended major: ${prog.maj}</div><div>${prog.w}</div><div class="ind-classes"><strong>Try these classes:</strong> ${prog.cl}</div></div>`;
    }
    return `<div class="ind-school"><strong>${qzSchoolMatch.name} for this path</strong><div>${qzSchoolMatch.name} has a strong tradition that supports students entering ${QZ_IND[industryKey].name.toLowerCase()}. Talk to advisors about cross-listed coursework — flexibility here is an advantage.</div></div>`;
  }
  return `<div class="ind-school"><strong>Making ${qzSchool} work for you</strong><div>${qzSchool} has people who've gone into ${QZ_IND[industryKey].name.toLowerCase()} — find them. Look for majors that overlap with ${QZ_IND[industryKey].name.split(' ')[0]}, and seek mentors who've made the leap. Your school is what you make of it.</div></div>`;
}

function qzCheckCombos(){
  const state={answers:qzAnswers,sliders:qzSliders,budget:qzBudget,gpa:qzGpa??0,school:qzSchool,subjects:qzAnswers.subjects,spectrum:qzAnswers.spectrum};
  QZ_COMBOS.forEach(c=>{if(!qzShownCombos.has(c.id)&&c.check(state)){qzShownCombos.add(c.id);setTimeout(()=>qzShowCombo(c),300);}});
}

function qzShowCombo(c){
  const lbl=document.getElementById('qz-clbl');
  lbl.textContent=c.lbl;
  lbl.style.background=`linear-gradient(135deg,${c.color},#f59e0b)`;
  lbl.style.webkitBackgroundClip='text';
  lbl.style.webkitTextFillColor='transparent';
  lbl.style.backgroundClip='text';
  document.getElementById('qz-ctitle').textContent=c.title;
  document.getElementById('qz-cdesc').textContent=c.desc;
  document.getElementById('qz-combo-overlay').classList.add('vis');
}
function qzCloseCombo(){document.getElementById('qz-combo-overlay').classList.remove('vis');}

function qzRestart(){
  qzCur=0; qzAns={}; qzSliders={};
  qzAnswers={pairs:{},pairsOwn:{},tot:{},env:[],map:null,emoji:{},swipes:{},yesno:{},rank:{},spectrum:null,subjects:[],multi:{},mcOther:{}};
  qzYesNoCustomOpen=new Set();
  qzBudget={salary:17,purpose:17,flex:16,growth:17,recog:16,security:17};
  qzGpa=null; qzSchool=null; qzSchoolMatch=null; qzStage=null;
  qzShownCombos=new Set();
  qzPairsIdx=0; qzSwipeIdx=0; qzYesNoIdx=0; qzTotIdx=0; qzSelectedBItem=null; qzSelectedTItem=null;
  qzResumeText=null; qzResumeBoosts={}; qzResumeSummary=''; qzObjectiveSkipped=false; qzResumeFile=null;
  if(global.FWResumeIngest) FWResumeIngest.clearPendingFile();
  qzEnrichBoosts={}; qzCharacterSummary=''; qzEnrichTraits=[]; qzEnrichDone=false;
  qzRevealTimers.forEach(clearTimeout); qzRevealTimers=[];
  qzFxTeardown();
  const resumeInput=document.getElementById('qz-resume-input'); if(resumeInput) resumeInput.value='';
  document.getElementById('qz-results').classList.add('qz-hidden');
  const gateEl=document.getElementById('qz-gate'); if(gateEl) gateEl.classList.add('qz-hidden');
  document.getElementById('qz-intro').classList.remove('qz-hidden');
  document.getElementById('qz-quiz').classList.add('qz-hidden');
}

/* Post-quiz: assessment signup gate, hub deep links (#r= token), send-results email. */

const QZ_SEND_RESULTS_EP = '/send-results';

// Multicolored confetti raining down for ~5s — celebratory moment on the signup gate.
function qzConfetti(){
  let confettiDone;
  qzConfettiDonePromise=new Promise(function(res){ confettiDone=res; });
  const cv=document.createElement('canvas');
  cv.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  document.body.appendChild(cv);
  const ctx=cv.getContext('2d');
  const dpr=window.devicePixelRatio||1;
  function size(){cv.width=innerWidth*dpr;cv.height=innerHeight*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}
  size();
  const colors=['#e8623d','#f5a623','#4caf50','#2196f3','#9c27b0','#ffeb3b','#ff4081','#00bcd4'];
  const N=160;
  const pieces=[];
  for(let i=0;i<N;i++){
    pieces.push({
      x:Math.random()*innerWidth,
      y:Math.random()*-innerHeight,
      w:6+Math.random()*6, h:8+Math.random()*8,
      color:colors[(Math.random()*colors.length)|0],
      vy:2+Math.random()*3, vx:-1+Math.random()*2,
      rot:Math.random()*Math.PI, vr:-0.15+Math.random()*0.3
    });
  }
  const start=Date.now();
  const DUR=5000, FADE=600;
  function frame(){
    const elapsed=Date.now()-start;
    ctx.clearRect(0,0,innerWidth,innerHeight);
    const alpha=elapsed>DUR-FADE?Math.max(0,(DUR-elapsed)/FADE):1;
    ctx.globalAlpha=alpha;
    pieces.forEach(p=>{
      p.x+=p.vx; p.y+=p.vy; p.rot+=p.vr;
      if(p.y>innerHeight+20){p.y=-20;p.x=Math.random()*innerWidth;}
      ctx.save();
      ctx.translate(p.x,p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle=p.color;
      ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
      ctx.restore();
    });
    if(elapsed<DUR){requestAnimationFrame(frame);}
    else{cv.remove();window.removeEventListener('resize',size);if(confettiDone)confettiDone();}
  }
  window.addEventListener('resize',size);
  requestAnimationFrame(frame);
}

// ── The reveal (V2 S6, D5) ─────────────────────────────────────────────────
// Value BEFORE the wall. After the final answer we render the top-3 REAL career
// matches (full "why" on #1), matches 4–10 BLURRED with no real data in the DOM
// (placeholders only — devtools cannot defeat the gate), and the signup gate
// below. Computed locally from qzComputeScores() through the SAME ranking chain
// the emailed full-results screen (qzShowResults) uses, so the pre-signup preview
// and the post-signup hub agree.
var qzRevealSoc = {}, qzRevealPct = {}, qzRevealWhyDone = {};

function qzEsc(t){
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function qzTrimTo(s, n){
  s = String(s || '');
  if (s.length <= n) return s;
  var cut = s.slice(0, n), sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut) + '…';
}

// Same fallback chain as qzShowResults: O*NET vector rank → featured-vector rank
// → the static hub-careers ranking. Always resolves to [{career, score}].
function qzRankCareersForReveal(sc, limit){
  limit = limit || 10;
  var V = window.FWOnetVectors;
  var sync = function(){
    return (window.FWHubCareers && typeof FWHubCareers.rankCareersFromQuizScores === 'function')
      ? FWHubCareers.rankCareersFromQuizScores(sc).slice(0, limit)
      : [];
  };
  var toShape = function(r){ return (r && r.length) ? r.map(function(m){ return { career: m.career, score: m.score }; }) : sync(); };
  if (V && typeof V.rankOnetCareersFromVectors === 'function') {
    return V.rankOnetCareersFromVectors({ scores: sc, limit: limit }).then(toShape).catch(sync);
  }
  if (V && typeof V.rankFeaturedFromVectors === 'function') {
    return V.rankFeaturedFromVectors({ scores: sc, limit: limit }).then(toShape).catch(sync);
  }
  return Promise.resolve(sync());
}

function qzShowReveal(){
  try { if (global.FWEvents) FWEvents.log('reveal_view', {}); } catch (_) {}
  var quizEl = document.getElementById('qz-quiz'); if (quizEl) quizEl.classList.add('qz-hidden');
  var resumeEl = document.getElementById('qz-resume'); if (resumeEl) resumeEl.classList.add('qz-hidden');
  var resultsEl = document.getElementById('qz-results'); if (resultsEl) resultsEl.classList.add('qz-hidden');
  var stage = document.getElementById('qz-reveal');
  if (!stage) { qzShowGate(); return; }             // graceful fallback: bare gate
  stage.classList.remove('qz-hidden');
  var gateEl = document.getElementById('qz-gate'); if (gateEl) gateEl.classList.remove('qz-hidden');
  // The gate is shown as part of the reveal now — count its view here (qzShowGate
  // is only the no-markup fallback path, which fires its own gate_view). The
  // Google button is already wired by google-auth.js's own load-time mount().
  try { if (global.FWEvents) FWEvents.log('gate_view', {}); } catch (_) {}
  window.scrollTo({ top: 0, behavior: 'smooth' });
  var cards = document.getElementById('qz-reveal-cards');
  if (cards) cards.innerHTML = '<div class="qz-reveal-loading">Reading your answers…</div>';
  var sc = qzComputeScores();
  qzRankCareersForReveal(sc, 10)
    .then(function(ranked){ qzRenderReveal(ranked || []); })
    .catch(function(){ qzRenderReveal([]); });
  qzConfetti();
}

function qzRenderReveal(careerRanked){
  var cards = document.getElementById('qz-reveal-cards');
  if (!cards) return;
  qzRevealSoc = {}; qzRevealPct = {}; qzRevealWhyDone = {};
  var top = (careerRanked || []).slice(0, 3);
  if (!top.length) { cards.innerHTML = ''; return; }   // extremely defensive
  var clampFit = function(s){ return Math.max(0, Math.min(100, Math.round(Number(s) || 0))); };
  var html = '';
  top.forEach(function(item, i){ html += qzRevealCardHtml(i + 1, item.career, clampFit(item.score)); });
  // Matches 4–10: fixed blurred placeholders. NONE of careerRanked[3..] reaches
  // the DOM — the blurred set carries zero real career data by construction.
  var TOTAL = 10;
  for (var rank = top.length + 1; rank <= TOTAL; rank++) html += qzRevealBlurredHtml(rank);
  cards.innerHTML = html;
  try { qzRenderLeaningAck({ career: top[0].career }); } catch (_) {}
  // Persist locally (not authed yet → local putBlob only) so readQuizVectors has
  // the seeded personality vector for the "why" breakdown. Same proven path the
  // #r= results screen uses; the signup payload rebuilds it deterministically.
  var persisted = qzPersistHubQuiz();
  if (persisted && typeof persisted.then === 'function') persisted.then(function(){ qzInjectRevealWhyFor(1); }).catch(function(){ qzInjectRevealWhyFor(1); });
  else qzInjectRevealWhyFor(1);
}

function qzRevealCardHtml(rank, career, pct){
  var r = qzResolveHubCareer(career);
  var key = r.key;
  var ind = QZ_IND[key] || { name: '', icon: '' };
  var tier = qzTierFor(pct);
  var desc = qzTrimTo(r.desc || '', 150);
  qzRevealPct[rank] = pct;
  qzRevealSoc[rank] = (career && career.soc) ? career.soc : null;
  var whyBtn = rank === 1
    ? ''   // #1's factor breakdown is shown expanded by default
    : '<button type="button" class="qz-mc-whytoggle" onclick="qzToggleRevealWhy(' + rank + ')">Why this fits <span class="qz-mc-caret" aria-hidden="true">▾</span></button>';
  return '<div class="qz-match-card' + (rank === 1 ? ' is-top' : '') + '" style="--accent:' + r.meta.accent + ';--tier:' + tier.color + '">'
    + '<div class="qz-mc-top">'
    +   '<div class="qz-mc-rank">#' + rank + '</div>'
    +   '<div class="qz-mc-portrait">' + qzCareerSVG(key) + '</div>'
    +   '<div class="qz-mc-info">'
    +     '<div class="qz-mc-name">' + qzEsc(r.title) + '</div>'
    +     '<div class="qz-mc-sector">' + (ind.icon || '') + ' ' + qzEsc(ind.name) + '</div>'
    +     '<div class="qz-mc-fit"><span class="qz-mc-pct">' + pct + '%</span><span class="qz-mc-tier" style="--tier:' + tier.color + '">' + tier.label + '</span></div>'
    +   '</div>'
    + '</div>'
    + '<div class="qz-mc-why">' + qzEsc(desc) + '</div>'
    + whyBtn
    + '<div class="qz-mc-breakdown' + (rank === 1 ? ' is-open' : '') + '" id="qz-reveal-why-' + rank + '"></div>'
    + '</div>';
}

function qzRevealBlurredHtml(rank){
  // No name, sector, or score — a locked placeholder only. Real career data for
  // ranks 4–10 never enters the DOM, so the gate cannot be defeated via devtools.
  return '<div class="qz-match-card qz-match-card--locked" aria-hidden="true">'
    + '<div class="qz-mc-top">'
    +   '<div class="qz-mc-rank">#' + rank + '</div>'
    +   '<div class="qz-mc-lockrows"><span class="qz-mc-lockbar"></span><span class="qz-mc-lockbar qz-mc-lockbar--sm"></span></div>'
    +   '<div class="qz-mc-lockchip">🔒</div>'
    + '</div>'
    + '</div>';
}

function qzToggleRevealWhy(rank){
  var el = document.getElementById('qz-reveal-why-' + rank);
  if (!el) return;
  var open = !el.classList.contains('is-open');
  el.classList.toggle('is-open', open);
  var card = el.closest && el.closest('.qz-match-card');
  if (card) card.classList.toggle('is-why-open', open);
  if (open) {
    try { if (global.FWEvents) FWEvents.log('reveal_card_expand', { rank: rank }); } catch (_) {}
    qzInjectRevealWhyFor(rank);
  }
}

// Reuses the same comparison rows + drawer the career.html deep dive renders,
// so the very first % a visitor sees carries a tap-to-expand explanation rather
// than standing alone as a verdict. Additive: any failure leaves the card as-is.
function qzInjectRevealWhyFor(rank){
  if (qzRevealWhyDone[rank]) return;                       // inject once per card
  if (!window.FWWhyMatch || !window.FWOnetVectors
    || typeof FWOnetVectors.userVsCareerDimensions !== 'function'
    || typeof FWOnetVectors.readQuizVectors !== 'function') return;
  var soc = qzRevealSoc[rank];
  var mount = document.getElementById('qz-reveal-why-' + rank);
  if (!soc || !mount) return;
  var vecs = null;
  try { vecs = FWOnetVectors.readQuizVectors(); } catch (_) { return; }
  var personality = vecs && vecs.personality && vecs.personality.values;
  if (!personality || !personality.length) return;
  var objective = vecs.objective && vecs.objective.values;
  var confidence = vecs.personality.confidence;
  var objActive = !!(objective && objective.some(function(v){ return Number(v) > 1; }));
  qzRevealWhyDone[rank] = true;
  FWOnetVectors.userVsCareerDimensions(soc, personality, objective, confidence).then(function(match){
    if (!match || !match.comparisons || !match.comparisons.length) { qzRevealWhyDone[rank] = false; return; }
    FWWhyMatch.inject(mount, match.comparisons, qzRevealPct[rank], { k: 3 });
    if (!objActive && !mount.querySelector('.placement-basis')) {
      var basis = document.createElement('div');
      basis.className = 'placement-basis';
      basis.textContent = 'A starting read from your quiz answers — we\'ll sharpen it together right after you sign up.';
      mount.appendChild(basis);
    }
  }).catch(function(){ qzRevealWhyDone[rank] = false; });
}

function qzShowGate(){
  // Its own funnel stage (quiz_complete → gate_view → signup_complete). Only one
  // caller today, so it looks redundant — a second gate entry point must not
  // silently go dark, which is exactly what folding it into quiz_complete does.
  try { if (global.FWEvents) FWEvents.log('gate_view', {}); } catch (_) {}
  document.getElementById('qz-quiz').classList.add('qz-hidden');
  const resumeEl=document.getElementById('qz-resume');
  if(resumeEl) resumeEl.classList.add('qz-hidden');
  document.getElementById('qz-results').classList.add('qz-hidden');
  document.getElementById('qz-gate').classList.remove('qz-hidden');
  window.scrollTo({top:0,behavior:'smooth'});
  qzConfetti();
}

function qzCaptureState(){
  return {
    v: 1,
    answers: qzAnswers,
    sliders: qzSliders,
    budget: qzBudget,
    gpa: qzGpa,
    name: qzName || '',
    school: qzSchool,
    schoolMatch: qzSchoolMatch ? qzSchoolMatch.name : null,
    resumeBoosts: qzResumeBoosts || {},
    resumeSummary: qzResumeSummary || '',
    resumeText: qzResumeText || '',
    objectiveSkipped: !!qzObjectiveSkipped,
    resumeFileName: (qzResumeFile && qzResumeFile.name) || '',
    enrichBoosts: qzEnrichBoosts || {},
    characterSummary: qzCharacterSummary || '',
    customAnswers: qzCollectCustomAnswers(),
    enrichDone: qzEnrichDone,
    ans: qzAns
  };
}

function qzRestoreState(s){
  if(!s || typeof s!=='object') return false;
  try{
    qzAnswers = Object.assign({pairs:{},pairsOwn:{},tot:{},env:[],map:null,emoji:{},swipes:{},yesno:{},rank:{},spectrum:null,subjects:[],multi:{},mcOther:{}}, s.answers||{});
    qzSliders = s.sliders || {};
    qzBudget = Object.assign({salary:17,purpose:17,flex:16,growth:17,recog:16,security:17}, s.budget||{});
    qzGpa = (s.gpa===null||s.gpa===undefined) ? null : s.gpa;
    qzName = s.name || qzName || '';
    qzSchool = s.school || null;
    if(s.schoolMatch && Array.isArray(QZ_SCHOOLS)){
      qzSchoolMatch = QZ_SCHOOLS.find(x=>x.name===s.schoolMatch) || null;
    } else { qzSchoolMatch = null; }
    qzResumeBoosts = s.resumeBoosts || {};
    qzResumeSummary = s.resumeSummary || '';
    qzResumeText = s.resumeText || qzResumeText || '';
    qzObjectiveSkipped = !!s.objectiveSkipped;
    if(s.resumeFileName) qzResumeFile={ name: s.resumeFileName };
    qzEnrichBoosts = s.enrichBoosts || {};
    qzCharacterSummary = s.characterSummary || '';
    qzEnrichDone = !!s.enrichDone || Object.keys(qzEnrichBoosts).length > 0;
    qzAns = s.ans || {};
    return true;
  } catch(e){ console.warn('qz state restore failed', e); return false; }
}

// Base64URL helpers that handle Unicode safely
function qzB64UrlEncode(str){
  const bytes = new TextEncoder().encode(str);
  let bin='';
  for(let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function qzB64UrlDecode(s){
  s = s.replace(/-/g,'+').replace(/_/g,'/');
  while(s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function qzBuildResultsUrl(){
  const state = qzCaptureState();
  const token = qzB64UrlEncode(JSON.stringify(state));
  const base = window.location.origin + window.location.pathname;
  return { url: base + '#r=' + token, token };
}

function qzNormalizeScores(sc){
  const max = Math.max(...Object.values(sc || {}), 1);
  const scores = {};
  Object.entries(sc || {}).forEach(([k, v]) => {
    scores[k] = Math.round((Number(v) / max) * 100);
  });
  return scores;
}

function qzBuildHubPayload(){
  const sc = (typeof qzComputeScores === 'function') ? qzComputeScores() : {};
  return {
    name: (qzName || 'Student').trim() || 'Student',
    scores: qzNormalizeScores(sc),
    scoresRaw: sc,
    resumeSummary: qzResumeSummary || '',
    resumeBoosts: qzResumeBoosts || {},
    resumeText: qzResumeText || '',
    objectiveSkipped: !!qzObjectiveSkipped,
    characterSummary: qzCharacterSummary || '',
    customAnswers: qzCollectCustomAnswers(),
    enrichBoosts: qzEnrichBoosts || {},
    traits: qzEnrichTraits || [],
    // Surface what the initial quiz already captured so the Career Hub (and the
    // academics panel) can read year / GPA / school / subjects without re-asking.
    profile: {
      year: qzAnswers.stage || null,                          // freshman|sophomore|junior|senior
      gpa: (qzGpa === null || qzGpa === undefined) ? null : qzGpa,
      school: qzSchoolMatch ? qzSchoolMatch.name : (qzSchool || null),
      schoolCity: qzSchoolMatch ? qzSchoolMatch.city : null,
      subjects: (qzAnswers.subjects || []).slice(),
      careerLeaning: (qzLeaning || '').trim().slice(0, 120) || null,
    },
    careerLeaningSoc: qzLeaningSoc || null,
  };
}

function qzRegisterProfilePayload(hubPayload) {
  const full = hubPayload || qzBuildHubPayload();
  const slim = {
    name: full.name,
    scores: full.scores,
    traits: Array.isArray(full.traits) ? full.traits.slice(0, 12) : [],
    characterSummary: String(full.characterSummary || '').slice(0, 2000),
    resumeSummary: String(full.resumeSummary || '').slice(0, 1200),
    profile: full.profile,
  };
  if (full.sectorFitSheet) slim.sectorFitSheet = full.sectorFitSheet;
  if (full.vectorSchemaId) slim.vectorSchemaId = full.vectorSchemaId;
  if (full.personalityVector) slim.personalityVector = full.personalityVector;
  if (full.objectiveVector) slim.objectiveVector = full.objectiveVector;
  if (full.objectiveSkipped) slim.objectiveSkipped = true;
  if (full.resumeText) slim.resumeText = String(full.resumeText).slice(0, 12000);
  if (full.profileBuilding && typeof full.profileBuilding === 'object') {
    const pb = full.profileBuilding;
    slim.profileBuilding = {
      version: pb.version || 1,
      answers: Array.isArray(pb.answers)
        ? pb.answers.slice(0, 8).map(function (a) {
          return {
            id: a.id,
            prompt: String(a.prompt || '').slice(0, 240),
            answer: String(a.answer || '').slice(0, 400),
          };
        })
        : [],
    };
  }
  return slim;
}

function qzApplyObjectiveToPayload(enriched){
  if(!enriched || !global.FWOnetVectors) return enriched;
  if(qzObjectiveSkipped){
    enriched.objectiveSkipped=true;
    enriched.objectiveVector={
      schemaId: FWOnetVectors.SCHEMA||'onet-lv-161-v1',
      values: FWOnetVectors.emptyVector(),
      sources: [],
      updatedAt: new Date().toISOString(),
      source: 'skipped',
      skipped: true,
    };
    enriched.resumeText='';
    return enriched;
  }
  if(qzResumeText && qzResumeText.length>=40){
    enriched.resumeText=qzResumeText.slice(0,12000);
    enriched.objectiveSkipped=false;
    var profiles = (FWOnetVectors.getZoneProfilesSync && FWOnetVectors.getZoneProfilesSync()) || null;
    enriched.objectiveVector=FWOnetVectors.applyResumeToObjective(
      enriched.objectiveVector||{ schemaId: FWOnetVectors.SCHEMA, values: FWOnetVectors.emptyVector(), sources: [] },
      qzResumeText,
      profiles
    );
    if(global.FWResumeIngest) enriched.resumeBoosts=FWResumeIngest.parseIndustryBoosts(qzResumeText);
  }
  return enriched;
}

async function qzApplyResumeRules(){
  if(qzObjectiveSkipped) return null;
  if(!global.FWResumeIngest || !FWResumeIngest.hasValidInput(qzResumeText, qzResumeFile)) return null;
  if(global.FWOnetVectors && typeof FWOnetVectors.loadZoneDimensionProfiles === 'function'){
    await FWOnetVectors.loadZoneDimensionProfiles();
  }
  if(qzResumeText && qzResumeText.length >= 40){
    const built = await qzBuildHubUrl();
    return built.payload;
  }
  return null;
}

function qzBuildHubUrl(){
  const payload = qzBuildHubPayload();
  if (global.FWSectorFitSheet && typeof FWSectorFitSheet.ensureSectorFitSheet === 'function') {
    FWSectorFitSheet.ensureSectorFitSheet(payload);
  }
  // The #r= token crosses to the dashboard as the v2 user shape (the reader
  // accepts both during rollout); local storage stays the v1 working blob via
  // the facade until Phase 4 flips it.
  var tokenBody = function (p) {
    return (window.FWUser && typeof FWUser.normalizeUser === 'function') ? FWUser.normalizeUser(p) : p;
  };
  if (global.FWOnetQuizSeed && typeof FWOnetQuizSeed.attachVectorsToPayload === 'function') {
    return FWOnetQuizSeed.attachVectorsToPayload(payload).then(function (enriched) {
      qzApplyObjectiveToPayload(enriched);
      const token = qzB64UrlEncode(JSON.stringify(tokenBody(enriched)));
      const url = window.location.origin + '/dashboard.html#r=' + token;
      try { if (window.FWUser) FWUser.putBlob(enriched); } catch (_) {}
      return { url: url, token: token, payload: enriched };
    });
  }
  qzApplyObjectiveToPayload(payload);
  const token = qzB64UrlEncode(JSON.stringify(tokenBody(payload)));
  const url = window.location.origin + '/dashboard.html#r=' + token;
  try { if (window.FWUser) FWUser.putBlob(payload); } catch(_){}
  return Promise.resolve({ url, token, payload });
}

function qzOpenCareerHub(){
  Promise.resolve(qzBuildHubUrl()).then(function (built) {
    window.location.href = built.url;
  });
}

function qzValidateEmail(e){
  if(!e || typeof e!=='string') return false;
  // Simple but adequate RFC-ish check
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
}

// ── "Assessment complete" account creation ─────────────────────────────────
// Creates the account, opens the Career Hub, and emails the results link in the background.
let qzSignupBusy = false;
const QZ_SEND_RESULTS_TIMEOUT_MS = 12000;

function qzSendResultsInBackground(email, url, token) {
  var signal = (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
    ? AbortSignal.timeout(QZ_SEND_RESULTS_TIMEOUT_MS)
    : null;
  var opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, results_url: url, token: token }),
  };
  if (signal) opts.signal = signal;
  fetch(QZ_SEND_RESULTS_EP, opts).catch(function (err) {
    console.warn('send-results background failed', err);
  });
}

// The reveal gate's "Continue with Google" click. Navigation itself is wired by
// FWGoogleAuth.mount (google-auth.js) when googleAuthEnabled; this only records
// the funnel intent, so it no-ops silently while the flag is dark (button hidden).
function qzGateGoogleClick(){
  try { if (global.FWEvents) FWEvents.log('gate_google_click', {}); } catch (_) {}
}

async function qzCreateAccount(ev){
  if (ev && ev.preventDefault) ev.preventDefault();
  if (qzSignupBusy) return;
  // Before the email/password validation on purpose: an attempt that dies on a
  // typo is still gate intent, and that gap is the conversion loss worth seeing.
  try { if (global.FWEvents) FWEvents.log('gate_signup_click', { cta: 'create' }); } catch (_) {}
  const emailEl = document.getElementById('qz-su-email');
  const pwEl = document.getElementById('qz-su-password');
  const nameEl = document.getElementById('qz-su-name');
  const errEl = document.getElementById('qz-su-error');
  const btn = document.getElementById('qz-su-btn');
  const email = (emailEl.value || '').trim();
  const password = pwEl ? pwEl.value : '';
  // Name is optional and OUT of the scored quiz (D8) — collected here at the
  // account moment for personalization. Empty → qzBuildHubPayload falls back to
  // 'Student'. year/school are collected later in the Academic Profile step.
  if (nameEl) { const nm = (nameEl.value || '').trim(); if (nm) qzName = nm.slice(0, 40); }
  errEl.textContent = '';
  errEl.classList.remove('qz-signup-warn');
  if (!qzValidateEmail(email)) { errEl.textContent = 'Please enter a valid email address.'; return; }
  if (!window.FWAuth || !FWAuth.isValidPassword(password)) { errEl.textContent = 'Password must be at least 8 characters.'; return; }

  qzSignupBusy = true;
  emailEl.disabled = true; if (pwEl) pwEl.disabled = true;
  const restoreBtn = window.FWButtonBusy ? FWButtonBusy.start(btn, { label: 'Creating account…' }) : function () {};

  try {
    const built = await qzBuildHubUrl();
    // Slim register payload crosses as v2 (the server normalizes both shapes).
    await FWAuth.authRegister(email, password,
      window.FWUser ? FWUser.normalizeUser(qzRegisterProfilePayload(built.payload)) : qzRegisterProfilePayload(built.payload),
      { source: 'quiz' });

    // Account created — let the gate confetti finish, then offer the "one last
    // thing" résumé upload before dropping them into the hub.
    if (btn) btn.textContent = 'Account created ✓';
    try { await qzConfettiDonePromise; } catch (_) {}
    await qzShowSharpenStep();
    await qzShowAcademicsStep();
    await qzShowPostSignupResume();

    // Apply whatever résumé they added (or nothing, if skipped) to the objective vector.
    try { await qzApplyResumeRules(); } catch (applyErr) { console.warn('resume rules apply failed', applyErr); }
    if (!qzObjectiveSkipped && global.FWResumeIngest) {
      var rulesOpts = {
        rulesOnly: true,
        userName: (built.payload && built.payload.name) || qzName || 'Student',
        customAnswers: qzCollectCustomAnswers(),
      };
      if (qzResumeText && qzResumeText.length >= 40) {
        rulesOpts.resumeText = qzResumeText;
        rulesOpts.timeoutMs = FWResumeIngest.PARSE_RULES_TIMEOUT_MS || 15000;
        FWResumeIngest.parseOnServer(rulesOpts).catch(function (resumeErr) {
          console.warn('resume rules sync after signup failed', resumeErr);
        });
      } else if (qzResumeFile && qzResumeFile.base64) {
        try {
          await FWResumeIngest.parseOnServer({
            resumeText: qzResumeText || '',
            resumeFileBase64: qzResumeFile.base64,
            mimeType: qzResumeFile.mimeType || 'application/pdf',
            rulesOnly: true,
            timeoutMs: FWResumeIngest.PARSE_RULES_FILE_TIMEOUT_MS || 45000,
            userName: rulesOpts.userName,
            customAnswers: rulesOpts.customAnswers,
          });
        } catch (resumeErr) {
          console.warn('resume PDF rules parse after signup failed', resumeErr);
        }
      }
    }

    // Rebuild the hub link so it carries the résumé-tuned objective vector.
    (function(){
      var st=document.getElementById('qz-resume-status');
      var cb=document.getElementById('qz-resume-continue');
      if(st) st.textContent='All set — opening your Career Hub…';
      if(cb) cb.textContent='Opening your Career Hub…';
    })();
    const finalBuilt = await qzBuildHubUrl();
    qzSendResultsInBackground(email, finalBuilt.url, finalBuilt.token);
    window.location.href = finalBuilt.url;
  } catch (err) {
    errEl.classList.remove('qz-signup-warn');
    errEl.textContent = window.FWErr
      ? FWErr.forUser(err, 'Something went wrong. Please try again.')
      : 'Something went wrong. Please try again.';
    qzSignupBusy = false;
    emailEl.disabled = false; if (pwEl) pwEl.disabled = false;
    restoreBtn();
  }
}

// "Already have an account? Log in" — hand off to the coach sign-in flow.
function qzSignupLogin(ev){
  if (ev && ev.preventDefault) ev.preventDefault();
  // Same event as the create CTA so the gate's two exits are one comparable
  // metric — returning users taking this branch otherwise read as abandonment.
  try { if (global.FWEvents) FWEvents.log('gate_signup_click', { cta: 'signin' }); } catch (_) {}
  // Persist results so they're waiting after login, then open sign-in.
  try { Promise.resolve(qzBuildHubUrl()).catch(function () {}); } catch (_) {}
  if (typeof showPage === 'function') { showPage('signin'); try { history.replaceState(null,'','#signin'); } catch(_){} }
  else {
    var authUrl = (window.FWPageBoot && FWPageBoot.authSignInUrl)
      ? FWPageBoot.authSignInUrl('quiz.html')
      : 'auth.html#signin?next=' + encodeURIComponent('quiz.html');
    window.location.href = authUrl;
  }
}

// On initial page load, if URL has #r=<token>, decode it and jump straight
// to the results screen (this is the link sent in the email).
function qzBootFromHash(){
  const h = window.location.hash || '';
  const m = h.match(/^#r=([A-Za-z0-9_-]+)$/);
  if(!m) return false;
  try{
    const json = qzB64UrlDecode(m[1]);
    const state = JSON.parse(json);
    if(!qzRestoreState(state)) return false;
    if(typeof showPage==='function') showPage('quiz');
    document.getElementById('qz-intro').classList.add('qz-hidden');
    document.getElementById('qz-quiz').classList.add('qz-hidden');
    const gateEl=document.getElementById('qz-gate'); if(gateEl) gateEl.classList.add('qz-hidden');
    qzShowResults();
    return true;
  } catch(e){
    console.warn('Bad results token in URL hash', e);
    return false;
  }
}

// quiz.html#sharpen — standalone entry for returning users (portal's "Sharpen
// matches" action): sharpen → academics, then back to the hub.
// quiz.html#academics jumps straight to the Academic Profile step (portal's
// "Academics" action — the panel no longer lives on the hub).
(function(){
  function bootStandalone(){
    var hash=(window.location.hash||'');
    if(hash!=='#sharpen' && hash!=='#academics') return;
    var intro=document.getElementById('qz-intro');
    if(intro) intro.classList.add('qz-hidden');
    var flow=(hash==='#sharpen')
      ? qzShowSharpenStep().then(function(){ return qzShowAcademicsStep(); })
      : qzShowAcademicsStep();
    flow.then(function(){ window.location.href='dashboard.html'; });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', bootStandalone);
  else bootStandalone();
})();
