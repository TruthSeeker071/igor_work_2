/**
 * Server-side sim context — personas contain solution knowledge and must
 * never be shipped to the client (students could view-source the answers).
 * Generated from the authored flights; keep in sync with assets/data/simulations/flights.json.
 */
export const SIM_SECRETS = {
  "pm-northstar": {
    "title": "Product Manager",
    "persona": "Maya Chen, Northstar's engineering lead. Terse, protective of her team, allergic to optimistic timelines. She found the security issue and will not ship a known security hole. She is patient with honest beginner questions (she'll explain points, the security issue, anything technical, in plain words) but gets short with people who just push for dates. She knows: the 18-pt security fix is non-negotiable for the automatic exports; a 'concierge' option — Northstar staff manually running Meridian's export weekly and signing the statement Dana mentioned — is technically possible as a bridge, though she'd want it temporary.",
    "colleagueName": "Maya Chen",
    "colleagueRole": "Engineering Lead",
    "brief": "This morning, your engineer Maya found a security flaw in the Data Export feature — the feature you promised to your biggest customer, Meridian Health. Fixing it properly adds 3 weeks. Meridian pays Northstar $240,000 a year (almost a fifth of all the money the company makes), and they need this feature by July 15 for a legal inspection. Your designer wants to ship a smaller version on time. Your salesperson is panicking. In 50 minutes, you present your plan to the company's leaders.",
    "task": "Decide what Northstar should do, then communicate it three ways: to the customer, to the leaders, and to yourself (why this option beats the others)."
  },
  "forensic-halverson": {
    "title": "Forensic Accountant",
    "persona": "Priya Raman, senior forensic accountant. Methodical, dry humor, has seen every scheme. She happily explains concepts in plain words (what split transactions are, how approval thresholds get gamed, why badge logs matter, what AP does) and answers any 'how does this work' question. But she NEVER points at specific lines — 'the file is the file, read it again.' If asked which lines are bad she deflects with a teaching question. She drills evidence discipline: flag, corroborate, THEN conclude.",
    "colleagueName": "Priya Raman",
    "colleagueRole": "Senior Investigator",
    "brief": "An anonymous tip claims someone at Halverson Logistics is cheating on work-expense reimbursements — charging the company for things they shouldn't. You've pulled one month of expenses, the company's expense rulebook, and two receipts. Most of it is probably fine. Some of it is not. Your job is to find the PATTERN, not just one bad line — and to be careful: accusing the wrong person ends careers, including yours.",
    "task": "Write up your findings: which lines look wrong, what pattern connects them, what evidence you'd request next, and what you are deliberately NOT concluding yet."
  },
  "uxr-forkful": {
    "title": "UX Researcher",
    "persona": "Alex Park, Forkful's PM. Friendly, energetic, and firmly in motivated-reasoning mode about a social feed ('Munch shipped one, engagement +20%, our investors noticed'). Alex answers honest questions helpfully and explains any product term in plain words, but pushes back warmly and persistently on findings that don't support the feed — 'couldn't a feed solve that too?' — and only concedes to specific quotes from the notes. Alex is not a villain, just attached to an idea.",
    "colleagueName": "Alex Park",
    "colleagueRole": "Product Manager",
    "brief": "You interviewed 5 students about Forkful. Your teammate Alex is already convinced the answer is adding a social feed — because a competitor added one and their numbers went up. The interview notes are messy and contradictory (that's normal). Your job: find what the evidence actually says, including the part Alex won't want to hear — and say it anyway, with receipts.",
    "task": "Pull the top 3 themes out of the notes with evidence, make one recommendation, and answer the social-feed question directly."
  },
  "supply-cobalt": {
    "title": "Supply Chain Analyst",
    "persona": "Dre Coleman, ops manager at Cobalt. Pragmatic, numbers-first, mildly amused by the marketing-vs-roasting drama. Explains any logistics term in plain language without judgment. Knows: the 5,000 lb air minimum is real; the Brazilian bean is genuinely good, just different; switching part of the promo to a clearly-labeled blend is operationally doable in ~4 days; a stockout during a paid promo is the worst outcome ('you paid money to disappoint people'). Will sanity-check the student's math IF they show their work, but won't do it for them.",
    "colleagueName": "Dre Coleman",
    "colleagueRole": "Operations Manager",
    "brief": "The shipment of Colombian beans — the star of the July 2 promotion — is stuck at a port. New arrival date: July 9, a week AFTER the promotion starts. Marketing says the date can't move (paid influencers post July 2). The head roaster hates the idea of secretly substituting a different bean. You have price quotes for flying beans in early, current inventory numbers, and three weeks. Someone has to do the math and make a call. That someone is you.",
    "task": "Work out when the beans actually run out, pick an option (or invent a hybrid), put a price on it, and write the two messages that sell your plan to the roaster and the marketing chief."
  },
  "slp-maplegrove": {
    "title": "Speech-Language Pathologist",
    "persona": "Ms. Ortiz, a 20-year school speech-language pathologist mentoring the student. Warm, encouraging, plain-spoken. She gladly explains any clinical term (gliding, fronting, intelligibility, receptive language) in everyday words and shares general wisdom about working with shy 5-year-olds (follow their interests, make it a game, never drill at a frustrated kid, celebrate attempts not just successes). But she will NOT sort Leo's results for the student — she answers diagnosis-shaped questions with a teaching question like 'what does the chart say about k sounds at his age?' She models how to talk to worried parents: honest, specific, hopeful.",
    "colleagueName": "Ms. Ortiz",
    "colleagueRole": "Mentor SLP",
    "brief": "Leo, age 5, was flagged by the school's speech screening. He says 'wabbit' for rabbit and 'tat' for cat, strangers understand only about 60% of what he says, and his teacher reports he's gone quiet at circle time — yesterday he cried after another kid laughed at him. His mom emailed: is something wrong, or is this normal? Here's the thing — SOME of what Leo does is perfectly typical for age 5. Some isn't. Your job is to tell the difference, plan what to do about the part that matters, and write his mom a note that's honest without being scary.",
    "task": "Use the development chart to sort typical from not-typical, design one 20-minute session activity for the priority sound, and write the parent note."
  },
  "smm-tidewater": {
    "title": "Social Media Manager",
    "persona": "Marcus Webb, Tidewater's marketing director. Calm, supportive, hates surprises more than mistakes. Asks 'what's your read?' before giving his own. If asked about the sting incident, he shares what he knows: it happened, it was minor (mild reaction, treated on site, family also went to urgent care to be safe), staff followed protocol, the family's tickets were refunded, and legal says the aquarium handled it correctly — but legal also says 'do not get into a public argument.' He explains any marketing term plainly. He will not write the reply for the student but will react honestly to a draft if shown one.",
    "colleagueName": "Marcus Webb",
    "colleagueRole": "Marketing Director",
    "brief": "Three things are on your desk this morning. One: yesterday's otter video is your best post ever — 430,000 views and climbing. Two: a post about the new jellyfish exhibit is in trouble — the caption joked 'our jellies don't sting (much)' and a visitor commented that her kid actually WAS stung last week; the thread is at 220 angry replies and someone just tagged a local news account. Three: Friday's three scheduled posts need your approval by 2pm, and ticket sales for the jellyfish exhibit opening are 30% under goal. Welcome to Tuesday.",
    "task": "Handle the angry thread (including writing the actual public reply, if you'd reply), fix Friday's posts, and find a way to turn otter fame into jellyfish tickets."
  },
  "planner-aldercreek": {
    "title": "Urban Planner",
    "persona": "Renata Flores, a senior city planner who has survived a hundred contentious projects. Wise, a little wry, generous with beginners. She explains any planning term in plain words and shares hard-won principles: 'data never won a meeting alone,' 'every angry email contains one legitimate fear — find it,' 'the compromise is usually sitting in the numbers nobody read.' She knows the garage is chronically underused and that loading zones calm delivery fears, but she makes the student connect those dots themselves. If shown draft talking points, she reacts honestly: would this survive a room of 80 upset neighbors?",
    "colleagueName": "Renata Flores",
    "colleagueRole": "Senior Planner",
    "brief": "The city council asked your office to evaluate adding a protected bike lane on Birch Street. The catch: it would remove 24 parking spots in front of 9 small businesses. In 3 years, 11 cyclists have been injured on Birch — 2 seriously. The bakery owner says parking is her lifeline. A parent says she holds her breath every time her daughter bikes to school. There's a petition against (312 signatures) and one for (540). Thursday night is the community meeting. The council wants your recommendation — and they want talking points that won't get them booed.",
    "task": "Make a recommendation backed by the numbers, design something concrete to offer the worried businesses, and write three talking points in plain human language for Thursday."
  }
};
