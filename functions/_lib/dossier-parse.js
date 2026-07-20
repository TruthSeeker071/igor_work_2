import { isValidDossier } from '../_lib.js';

const FIELD_PREFIXES = [
  'top_industries:',
  'archetype:',
  'recommended_majors:',
  'school:',
  'gpa:',
  'year:',
  'subjects_major:',
  'career_leaning:',
  'quiz_strengths:',
  'quiz_weaknesses:',
  'interests:',
  'goals:',
  'constraints:',
  'context:',
  'target_career:',
  'recent:',
  'notes:',
  'prior_focus:',
  'archived_interests:',
  'personality_signals:',
  'career_signals:',
  'new_dossier_fields:',
];

export function tokenizeList(value) {
  return String(value || '')
    .split(/[,;]/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && t !== '(none yet)' && t !== '(unknown)');
}

export function parseDossierFields(dossier) {
  const text = String(dossier || '');
  const fields = {};
  if (!text) return fields;

  const lines = text.split('\n');
  let currentKey = null;
  let currentVal = [];

  function flush() {
    if (!currentKey) return;
    fields[currentKey] = currentVal.join('\n').trim();
    currentKey = null;
    currentVal = [];
  }

  lines.forEach((line) => {
    const hit = FIELD_PREFIXES.find((p) => line.startsWith(p));
    if (hit) {
      flush();
      currentKey = hit.slice(0, -1);
      currentVal = [line.slice(hit.length).trim()];
    } else if (currentKey) {
      currentVal.push(line);
    }
  });
  flush();
  return fields;
}

export function patchDossierLine(dossier, prefix, newValue) {
  const p = String(prefix).endsWith(':') ? prefix : `${prefix}:`;
  const val = String(newValue || '').trim();
  let lines = String(dossier || '').split('\n');
  let found = false;
  lines = lines.map((line) => {
    if (line.startsWith(p)) {
      found = true;
      return `${p} ${val}`;
    }
    return line;
  });
  if (!found) {
    const recentIdx = lines.findIndex((l) => l.startsWith('recent:'));
    if (recentIdx >= 0) lines.splice(recentIdx, 0, `${p} ${val}`);
    else lines.push(`${p} ${val}`);
  }
  return lines.join('\n');
}

export function applyDossierPatches(dossier, patches) {
  let out = String(dossier || '');
  if (!patches || typeof patches !== 'object') return out;
  Object.entries(patches).forEach(([key, value]) => {
    if (value == null) return;
    out = patchDossierLine(out, key, value);
  });
  return out;
}

export function normalizeSectorToken(token) {
  return String(token || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/&/g, 'and');
}

export function extractSectorTokensFromText(text) {
  const raw = normalizeSectorToken(text);
  const tokens = new Set();
  tokenizeList(raw).forEach((t) => tokens.add(t));
  const sectorAliases = {
    tech: ['technology', 'software', 'coding', 'computer science', 'cs', 'engineering software'],
    finance: ['financial', 'banking', 'investment', 'quant', 'quantitative finance'],
    creative: ['design', 'graphic', 'visual', 'brand', 'illustration'],
    marketing: ['content', 'advertising', 'copywriting'],
    startups: ['startup', 'entrepreneur'],
    science: ['scientific', 'research', 'mathematics', 'math', 'statistics'],
    media: ['journalism', 'journalist', 'broadcast'],
    healthcare: ['medical', 'medicine', 'nurse'],
    law: ['legal', 'lawyer'],
    education: ['teaching', 'teacher'],
  };
  Object.entries(sectorAliases).forEach(([sector, aliases]) => {
    if (raw.includes(sector)) tokens.add(sector);
    aliases.forEach((a) => {
      if (raw.includes(a)) tokens.add(sector);
    });
  });
  return tokens;
}

export function validatePatchedDossier(dossier) {
  const cleaned = String(dossier || '').trim();
  if (!isValidDossier(cleaned)) return null;
  return cleaned;
}
