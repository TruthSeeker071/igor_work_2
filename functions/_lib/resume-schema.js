// Resume Builder v2 — canonical resume JSON (schema v1) validator/normalizer.
// The contract between Layer 1 (content generation) and Layer 2 (ATS-safe
// rendering). validateResume() strips unknown keys, clamps sizes, and enforces
// fixed ATS-standard headings per section kind — the renderer refuses unknown
// kinds rather than improvising. Pure module: no env, no DOM, importable from
// Node tests via dynamic import().

export const RESUME_JSON_MAX_BYTES = 40 * 1024;

export const BULLET_SRC = ['manual', 'dossier', 'resume', 'artifact', 'sim_trial', 'experience'];

// kind → fixed ATS-standard heading. Unknown kinds are rejected.
export const SECTION_HEADINGS = {
  experience: 'Work Experience',
  education: 'Education',
  projects: 'Projects',
  skills: 'Skills',
};

const LIMITS = {
  title: 120,
  name: 120,
  contactField: 160,
  link: 200,
  links: 5,
  summary: 1200,
  sections: 8,
  itemsPerSection: 20,
  bulletsPerItem: 12,
  bulletText: 400,
  dimsPerBullet: 6,
  dimName: 80,
  skillsFlat: 60,
  skillText: 80,
  itemField: 140,
  template: 40,
};

function str(v, max) {
  if (typeof v !== 'string') return '';
  return v.slice(0, max).trim();
}

function cleanBullet(raw, errors, path) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`${path}: bullet must be an object`);
    return null;
  }
  const text = str(raw.text, LIMITS.bulletText);
  if (!text) return null; // empty bullets are dropped, not an error
  const src = BULLET_SRC.includes(raw.src) ? raw.src : 'manual';
  if (raw.src !== undefined && raw.src !== src) {
    errors.push(`${path}: unknown src "${String(raw.src).slice(0, 40)}"`);
  }
  const dims = Array.isArray(raw.dims)
    ? raw.dims
        .filter((d) => typeof d === 'string' && d.trim())
        .slice(0, LIMITS.dimsPerBullet)
        .map((d) => d.slice(0, LIMITS.dimName).trim())
    : [];
  return { text, src, dims };
}

function cleanItem(raw, errors, path) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`${path}: item must be an object`);
    return null;
  }
  const bullets = [];
  if (raw.bullets !== undefined && !Array.isArray(raw.bullets)) {
    errors.push(`${path}.bullets: must be an array`);
  } else if (Array.isArray(raw.bullets)) {
    for (let i = 0; i < raw.bullets.length && bullets.length < LIMITS.bulletsPerItem; i++) {
      const b = cleanBullet(raw.bullets[i], errors, `${path}.bullets[${i}]`);
      if (b) bullets.push(b);
    }
  }
  return {
    org: str(raw.org, LIMITS.itemField),
    role: str(raw.role, LIMITS.itemField),
    start: str(raw.start, 40),
    end: str(raw.end, 40),
    bullets,
  };
}

function cleanSection(raw, errors, idx) {
  const path = `sections[${idx}]`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`${path}: must be an object`);
    return null;
  }
  const kind = raw.kind;
  const heading = SECTION_HEADINGS[kind];
  if (!heading) {
    errors.push(`${path}: unknown kind "${String(kind).slice(0, 40)}"`);
    return null;
  }
  if (typeof raw.heading === 'string' && raw.heading.trim() && raw.heading.trim() !== heading) {
    errors.push(`${path}: heading must be "${heading}" for kind "${kind}"`);
  }
  if (kind === 'skills') {
    const flat = Array.isArray(raw.flat)
      ? raw.flat
          .filter((s) => typeof s === 'string' && s.trim())
          .slice(0, LIMITS.skillsFlat)
          .map((s) => s.slice(0, LIMITS.skillText).trim())
      : [];
    return { kind, heading, flat };
  }
  const items = [];
  if (Array.isArray(raw.items)) {
    for (let i = 0; i < raw.items.length && items.length < LIMITS.itemsPerSection; i++) {
      const item = cleanItem(raw.items[i], errors, `${path}.items[${i}]`);
      if (item) items.push(item);
    }
  }
  return { kind, heading, items };
}

// → { ok, resume, errors }. `resume` is the normalized document (unknown keys
// stripped, fixed headings applied) — persist THAT, never the raw input.
export function validateResume(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, resume: null, errors: ['resume must be an object'] };
  }
  if (input.v !== 1) errors.push('v must be 1');

  const rawContact = input.contact && typeof input.contact === 'object' && !Array.isArray(input.contact)
    ? input.contact
    : {};
  const contact = {
    name: str(rawContact.name, LIMITS.name),
    email: str(rawContact.email, LIMITS.contactField),
    phone: str(rawContact.phone, LIMITS.contactField),
    location: str(rawContact.location, LIMITS.contactField),
    links: Array.isArray(rawContact.links)
      ? rawContact.links
          .filter((l) => typeof l === 'string' && l.trim())
          .slice(0, LIMITS.links)
          .map((l) => l.slice(0, LIMITS.link).trim())
      : [],
  };

  const sections = [];
  if (!Array.isArray(input.sections)) {
    errors.push('sections must be an array');
  } else {
    const seen = new Set();
    for (let i = 0; i < input.sections.length && sections.length < LIMITS.sections; i++) {
      const s = cleanSection(input.sections[i], errors, i);
      if (!s) continue;
      if (seen.has(s.kind)) {
        errors.push(`sections[${i}]: duplicate kind "${s.kind}"`);
        continue;
      }
      seen.add(s.kind);
      sections.push(s);
    }
  }

  const resume = {
    v: 1,
    contact,
    summary: str(input.summary, LIMITS.summary),
    sections,
  };
  // Optional client-chosen template/variant id (e.g. "project-forward",
  // "latex-onepager"). Omitted entirely when absent so a resume saved
  // before this field existed still round-trips unchanged.
  const template = str(input.template, LIMITS.template);
  if (template) resume.template = template;

  const bytes = new TextEncoder().encode(JSON.stringify(resume)).length;
  if (bytes > RESUME_JSON_MAX_BYTES) {
    errors.push(`resume too large (${bytes} bytes > ${RESUME_JSON_MAX_BYTES})`);
  }

  return { ok: errors.length === 0, resume: errors.length === 0 ? resume : null, errors };
}
