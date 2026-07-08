#!/usr/bin/env node
/**
 * Local PDF resume extraction smoke test.
 * Usage: node scripts/test-resume-extract.mjs [path/to/resume.pdf]
 * Requires GEMINI_API_KEY in .dev.vars or environment.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function loadDevVars() {
  const env = { ...process.env };
  const varsPath = join(ROOT, '.dev.vars');
  if (!existsSync(varsPath)) return env;
  const text = readFileSync(varsPath, 'utf8');
  text.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!env[key]) env[key] = val;
  });
  return env;
}

const pdfPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(homedir(), 'Downloads', 'Jacob_Klugerman_Resume.pdf');

if (!existsSync(pdfPath)) {
  console.error('PDF not found:', pdfPath);
  process.exit(1);
}

const env = loadDevVars();
if (!env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set. Add it to .dev.vars or export it.');
  process.exit(1);
}

const { extractResumeDocument } = await import(
  new URL('../functions/_lib/resume-extract.js', import.meta.url).href
);

const buf = readFileSync(pdfPath);
const base64 = buf.toString('base64');
const fileName = pdfPath.split('/').pop();

console.log('Testing resume extraction');
console.log('  file:', pdfPath);
console.log('  size:', buf.length, 'bytes');
console.log('  model:', env.GEMINI_RESUME_MODEL || 'gemini-2.0-flash (default)');
console.log('');

const start = Date.now();
const result = await extractResumeDocument(env, {
  base64,
  mimeType: 'application/pdf',
  fileName,
});
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

console.log('Result:');
console.log('  ok:', result.ok);
console.log('  method:', result.method);
console.log('  elapsed:', elapsed + 's');
console.log('  resumeText chars:', (result.resumeText || '').length);
if (result.structured) {
  console.log('  experience:', Array.isArray(result.structured.experience) ? result.structured.experience.length : 0);
  console.log('  education:', Array.isArray(result.structured.education) ? result.structured.education.length : 0);
  console.log('  skills:', Array.isArray(result.structured.skills) ? result.structured.skills.length : 0);
}
if (result.error) console.log('  error:', result.error);
console.log('');
console.log('--- first 500 chars ---');
console.log((result.resumeText || result.extractedText || '').slice(0, 500));
console.log('--- end preview ---');

process.exit(result.ok && (result.resumeText || '').length >= 40 ? 0 : 1);
