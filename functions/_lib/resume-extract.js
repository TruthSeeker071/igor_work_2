import {
  geminiConfigFromEnv,
  resolveGeminiModels,
  geminiGenerateContent,
  geminiTextFromResponse,
  GEMINI_SAFETY_SETTINGS,
} from '../_lib.js';
import { callGeminiJson } from './gemini-json.js';

const RETRYABLE_STATUS = new Set([429, 500, 503]);
const RETRY_DELAYS_MS = [800, 2000];
const MIN_RESUME_CHARS = 40;
const MAX_RAW_EXTRACT_CHARS = 12000;

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function resumeModelsFromEnv(env) {
  return resolveGeminiModels(env, { includeResume: true });
}

function buildMultimodalBody({ parts, temperature, maxTokens, jsonMode }) {
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
    safetySettings: GEMINI_SAFETY_SETTINGS,
  };
  if (jsonMode) body.generationConfig.responseMimeType = 'application/json';
  return body;
}

/**
 * Multimodal Gemini call with model fallback and retry (text + optional inline file).
 */
export async function callGeminiMultimodal(env, opts) {
  const {
    textPrompt,
    base64,
    mimeType = 'application/pdf',
    temperature = 0.1,
    maxTokens = 4096,
    jsonMode = false,
    label = 'gemini-multimodal',
    softFail = false,
  } = opts || {};

  const { apiKey } = geminiConfigFromEnv(env);
  if (!apiKey) {
    const err = Object.assign(new Error('GEMINI_API_KEY is not configured.'), { _userFacing: true });
    if (softFail) return { ok: false, error: err.message };
    throw err;
  }

  const parts = [{ text: textPrompt }];
  if (base64) {
    parts.push({ inlineData: { mimeType, data: base64 } });
  }

  const models = resumeModelsFromEnv(env);
  let lastErr = null;

  for (const m of models) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
      try {
        const data = await geminiGenerateContent({
          apiKey,
          model: m,
          body: buildMultimodalBody({ parts, temperature, maxTokens, jsonMode }),
          logMeta: { label, gemini_resume_model: m },
        });
        const finishReason = data?.candidates?.[0]?.finishReason || '';
        const text = geminiTextFromResponse(data);
        if (!text) {
          const blocked = finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS';
          throw Object.assign(
            new Error(blocked ? `Gemini blocked response (${finishReason}).` : 'Gemini returned an empty response.'),
            { status: blocked ? 503 : undefined, finishReason },
          );
        }
        return { ok: true, text: String(text).trim(), model: m, finishReason };
      } catch (err) {
        lastErr = err;
        console.warn(`${label} [${m}] attempt ${attempt + 1} failed:`, err?.message || err);
        if (RETRYABLE_STATUS.has(err.status)) continue;
        break;
      }
    }
  }

  const error = lastErr?.message || 'Gemini multimodal request failed.';
  const retryable = !!(lastErr && RETRYABLE_STATUS.has(lastErr.status));
  if (softFail) return { ok: false, error, retryable };
  throw lastErr || new Error(error);
}

const PHASE1_PROMPT = `You are a resume OCR and text extraction system.

Read the ENTIRE document — every page, column, sidebar, header, footer, and text box.
The layout may be non-standard (multi-column, Canva/design-tool export, scanned image, etc.).
Do NOT assume where sections appear or what they are called.

Extract ALL readable content: name, contact info, summary, experience, education, skills, projects, certifications, awards, and any other text.
If text is embedded as images or vector paths, perform OCR on it.
Preserve facts exactly; do not invent or summarize.

Return ONLY the extracted plain text, with sections separated by blank lines. No commentary.`;

const PHASE2_PROMPT_PREFIX = `You are a resume parser. Given resume content, structure it into JSON.

Do not invent facts. Use empty arrays/strings for missing sections.
Include every fact from the source in fullText or the appropriate section.

Return ONLY valid JSON with this schema:
{
  "fullText": "complete narrative of entire resume for keyword search",
  "experience": [{ "title": "", "organization": "", "dates": "", "details": "" }],
  "education": [{ "degree": "", "school": "", "dates": "", "details": "" }],
  "skills": [""],
  "projects": [{ "name": "", "details": "" }],
  "certifications": [""],
  "other": [""]
}`;

const PHASE2_DIRECT_PDF_PROMPT = `${PHASE2_PROMPT_PREFIX}

Read the attached resume document directly. Scan every page and all layout regions before structuring.`;

function asStringList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => String(s || '').trim()).filter(Boolean);
}

function asObjectList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((item) => {
    if (!item || typeof item !== 'object') return null;
    const out = {};
    Object.keys(item).forEach((k) => {
      out[k] = String(item[k] || '').trim();
    });
    return Object.values(out).some(Boolean) ? out : null;
  }).filter(Boolean);
}

/**
 * Flatten structured resume JSON into keyword-rich plain text for rules engine.
 */
export function flattenStructuredResume(structured) {
  if (!structured || typeof structured !== 'object') return '';
  const chunks = [];

  const fullText = String(structured.fullText || '').trim();
  if (fullText) chunks.push(fullText);

  asObjectList(structured.experience).forEach((exp) => {
    chunks.push([exp.title, exp.organization, exp.dates, exp.details].filter(Boolean).join(' — '));
  });
  asObjectList(structured.education).forEach((edu) => {
    chunks.push([edu.degree, edu.school, edu.dates, edu.details].filter(Boolean).join(' — '));
  });
  chunks.push(...asStringList(structured.skills));
  asObjectList(structured.projects).forEach((p) => {
    chunks.push([p.name, p.details].filter(Boolean).join(' — '));
  });
  chunks.push(...asStringList(structured.certifications));
  chunks.push(...asStringList(structured.other));

  return chunks.filter(Boolean).join('\n').trim();
}

function resumeTextFromStructured(structured) {
  const fullText = String(structured?.fullText || '').trim();
  if (fullText.length >= MIN_RESUME_CHARS) return fullText.slice(0, MAX_RAW_EXTRACT_CHARS);
  return flattenStructuredResume(structured).slice(0, MAX_RAW_EXTRACT_CHARS);
}

async function structureFromText(env, rawText) {
  const prompt = `${PHASE2_PROMPT_PREFIX}

<resume_content>
${String(rawText || '').slice(0, MAX_RAW_EXTRACT_CHARS)}
</resume_content>`;

  return callGeminiJson(env, {
    prompt,
    temperature: 0.2,
    maxTokens: 2048,
    label: 'resume-structure-text',
    softFail: true,
  });
}

async function structureFromPdf(env, { base64, mimeType }) {
  const result = await callGeminiMultimodal(env, {
    textPrompt: PHASE2_DIRECT_PDF_PROMPT,
    base64,
    mimeType,
    temperature: 0.15,
    maxTokens: 4096,
    jsonMode: true,
    label: 'resume-structure-pdf',
    softFail: true,
  });
  if (!result.ok) return null;
  try {
    const parsed = JSON.parse(result.text);
    return parsed;
  } catch {
    try {
      const start = result.text.indexOf('{');
      const end = result.text.lastIndexOf('}');
      if (start >= 0 && end > start) return JSON.parse(result.text.slice(start, end + 1));
    } catch {
      // fall through
    }
    return null;
  }
}

/**
 * Format-agnostic resume extraction: full-document scan → structure → flattened text.
 */
export async function extractResumeDocument(env, { base64, mimeType, fileName }) {
  const cleanBase64 = String(base64 || '').trim();
  if (!cleanBase64) {
    return { ok: false, error: 'No resume file data provided.', method: 'none' };
  }

  const { apiKey } = geminiConfigFromEnv(env);
  if (!apiKey) {
    return { ok: false, error: 'GEMINI_API_KEY is not configured.', method: 'none' };
  }

  const mime = mimeType || 'application/pdf';
  let rawText = '';
  let method = 'phase1+phase2';
  let lastError = '';
  let retryable = false;

  // Phase 1: full-document raw text extraction
  const phase1 = await callGeminiMultimodal(env, {
    textPrompt: PHASE1_PROMPT,
    base64: cleanBase64,
    mimeType: mime,
    temperature: 0.1,
    maxTokens: 4096,
    jsonMode: false,
    label: 'resume-extract-phase1',
    softFail: true,
  });

  if (phase1.ok) {
    rawText = phase1.text.slice(0, MAX_RAW_EXTRACT_CHARS);
    if (rawText.length >= MIN_RESUME_CHARS) {
      method = 'phase1';
    }
  } else {
    lastError = phase1.error || 'Phase 1 extraction failed.';
    retryable = !!phase1.retryable;
    console.warn('resume extract phase1 failed', lastError);
  }

  let structured = null;

  // Phase 2: structure only when Phase 1 OCR was insufficient; otherwise use raw text directly.
  if (rawText.length < MIN_RESUME_CHARS) {
    method = 'phase2-direct-pdf';
    structured = await structureFromPdf(env, { base64: cleanBase64, mimeType: mime });
    if (!structured) {
      lastError = lastError || 'Could not structure resume from PDF.';
    }
  }

  const resumeText = structured ? resumeTextFromStructured(structured) : rawText;

  if (resumeText.length < MIN_RESUME_CHARS) {
    const pasteHint = retryable
      ? 'AI is busy — paste your resume text instead.'
      : (lastError || 'PDF text extraction returned too little content. Try pasting your resume or a different file.');
    return {
      ok: false,
      resumeText: resumeText || '',
      structured: structured || null,
      extractedText: rawText,
      method,
      error: pasteHint,
      retryable,
      fileName: fileName || '',
    };
  }

  return {
    ok: true,
    resumeText,
    structured,
    extractedText: rawText || resumeText,
    method,
    error: null,
    fileName: fileName || '',
  };
}

export { MIN_RESUME_CHARS, MAX_RAW_EXTRACT_CHARS };
