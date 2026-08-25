// linkedin.js — Wrapper Node pour la recherche LinkedIn réelle (StaffSpy + MCP vendored).
// Appelle backend/linkedin-bridge.py (Python) via child_process et normalise en forme Lead Zentara.
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const { McpStdioClient } = require('./mcp-client');
const AI = require('./ai');

const BRIDGE = path.join(__dirname, 'linkedin-bridge.py');
const MCP_DIR = path.join(__dirname, 'linkedin', 'vendor', 'linkedin-mcp-server');
const PYTHON = process.env.PYTHON || 'python3';

let cachedStatus = null;
let cachedAt = 0;
let linkedinCreds = { username: '', password: '', session_file: '' };

/** Configure les identifiants LinkedIn (priorité réglages > .env). */
function configure(creds = {}) {
  linkedinCreds = {
    username: String(creds.username || process.env.LINKEDIN_USERNAME || ''),
    password: String(creds.password || process.env.LINKEDIN_PASSWORD || ''),
    session_file: String(creds.session_file || process.env.LINKEDIN_SESSION_FILE || ''),
  };
}

/** Exécute le bridge avec un payload JSON sur stdin, timeout maîtrisé. */
function runBridge(payload, timeoutMs = 60000) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    const child = spawn(PYTHON, [BRIDGE], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        LINKEDIN_USERNAME: linkedinCreds.username || process.env.LINKEDIN_USERNAME || '',
        LINKEDIN_PASSWORD: linkedinCreds.password || process.env.LINKEDIN_PASSWORD || '',
        LINKEDIN_SESSION_FILE: linkedinCreds.session_file || process.env.LINKEDIN_SESSION_FILE || '',
      },
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, available: false, error: `timeout après ${timeoutMs}ms (scraping LinkedIn lent)` });
    }, timeoutMs);

    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, available: false, error: `python3 introuvable ou bridge manquant : ${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ ok: false, available: false, error: `bridge exit ${code} : ${(err || '').trim().slice(0, 300)}` });
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve({ ok: false, available: false, error: 'réponse bridge non-JSON : ' + String(out).slice(0, 200) });
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

/** Statut (avec cache 30s pour éviter de spammer python). */
async function status(force = false) {
  if (!force && cachedStatus && Date.now() - cachedAt < 30000) return cachedStatus;
  const r = await runBridge({ action: 'status' }, 15000);
  cachedStatus = r;
  cachedAt = Date.now();
  return r;
}

/** Normalise une personne → forme Lead (compatible keelead / multi-source toHit). */
function toLead(p, source = 'Zentara People (StaffSpy)') {
  if (!p) return null;
  const name = (p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ')).trim();
  if (!name) return null;
  return {
    firstName: p.first_name || name,
    lastName: p.last_name || '',
    company: p.company || null,
    title: p.title || null,
    email: p.email || null,
    phone: p.phone || null,
    location: p.location || null,
    linkedin: p.linkedin_url || null,
    confidence: Number(p.confidence) || 0.5,
    tags: ['linkedin', ...(p.open_to_work ? ['open-to-work'] : []), ...(p.is_hiring ? ['hiring'] : [])],
    metadata: {
      source,
      linkedinUrl: p.linkedin_url || null,
      skills: p.skills || [],
      followers: p.meta?.followers || null,
      connections: p.meta?.connections || null,
      premium: !!p.meta?.premium,
    },
  };
}

const PEOPLE_EXTRACT_PROMPT = `Tu es un extracteur de données LinkedIn pour Zentara.
À partir du TEXTE BRUT d'une recherche de personnes LinkedIn, extrais chaque personne réelle en JSON.
Réponds UNIQUEMENT avec un objet JSON de la forme :
{"people":[{"full_name":"Prénom Nom","title":"poste / headline","company":"entreprise actuelle","location":"ville","linkedin_url":"https://www.linkedin.com/in/username","skills":["skill1","skill2"]}]}

Règles strictes :
- N'invente AUCUNE donnée : si un champ est absent ou illisible, mets null.
- Ignore les lignes de navigation, les intitulés de section et tout texte qui n'est pas une personne.
- linkedin_url : reconstruis https://www.linkedin.com/in/<username> uniquement si un username est visible.
- title : le poste actuel (headline) sans le nom de l'entreprise.
- company : l'entreprise actuelle (null si introuvable).
- Ne renvoie que le JSON, aucun texte autour.`;

/**
 * Parse le rawText brut de search_people via l'IA → leads Zentara structurés.
 * Renvoie [] proprement si l'IA est indisponible ou si le parsing échoue.
 */
async function parsePeopleRawText(rawText, opts = {}) {
  if (!rawText || !String(rawText).trim()) return [];
  try {
    const r = await AI.chatCompletion([
      { role: 'system', content: PEOPLE_EXTRACT_PROMPT },
      { role: 'user', content: String(rawText).slice(0, 12000) },
    ], { json: true, maxTokens: 4000 });
    const parsed = AI.extractJson(r.content);
    const people = Array.isArray(parsed) ? parsed : (parsed?.people || []);
    return people
      .map((p) => toLead({
        full_name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' '),
        first_name: p.first_name,
        last_name: p.last_name,
        title: p.title || p.headline || null,
        company: p.company || null,
        location: p.location || null,
        linkedin_url: p.linkedin_url || p.linkedin || null,
        skills: Array.isArray(p.skills) ? p.skills : [],
        confidence: 0.65,
      }, 'Zentara People (MCP)'))
      .filter(Boolean);
  } catch {
    return []; // parsing IA indisponible → on ne casse pas la recherche
  }
}

/** Recherche de décideurs dans une entreprise (roster). */
async function searchStaff(company, opts = {}) {
  const r = await runBridge({
    action: 'staff',
    company,
    roles: opts.roles || opts.needs || '',
    location: opts.location || '',
    limit: opts.limit || 25,
  }, opts.timeoutMs || 15000);
  const leads = (r.records || []).map(toLead).filter(Boolean);
  return { ...r, leads };
}

/** Recherche globale par niche + besoins (search_term sans company). */
async function searchPeople(niche, opts = {}) {
  const keywords = [niche, opts.roles || opts.needs || ''].filter(Boolean).join(' ');
  const r = await runBridge({
    action: 'people',
    keywords,
    location: opts.location || '',
    limit: opts.limit || 25,
  }, opts.timeoutMs || 15000);
  const leads = (r.records || []).map(toLead).filter(Boolean);
  return { ...r, leads, keywords };
}

/**
 * Ouvre UNE session MCP (spawn + handshake + tools/list) et expose call(tool, args).
 * Permet plusieurs appels d'outil sur la même session (ex: search_jobs puis get_company_profile).
 */
async function withMcpSession(cb, opts = {}) {
  const client = new McpStdioClient({
    command: PYTHON,
    args: ['-m', 'linkedin_mcp_server'],
    cwd: MCP_DIR,
    env: { PYTHONUNBUFFERED: '1', PYTHONPATH: MCP_DIR },
  });
  try {
    await client.start(40000);
    const tools = await client.listTools(30000);
    const toolNames = tools.map((t) => t.name);
    const call = async (toolName, args, timeoutMs = 12000) => {
      const result = await client.callTool(toolName, args, timeoutMs);
      let rawText = '';
      const content = result && result.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b && b.type === 'text' && b.text) rawText += b.text;
        }
      }
      return { rawText, isError: !!(result && result.isError) };
    };
    return await cb({ call, toolNames });
  } finally {
    client.close();
  }
}

const AUTH_RE = /session|login|auth|sign in/i;

/** Recherche de personnes via linkedin-mcp-server (search_people). */
async function searchPeopleMCP(keywords, opts = {}) {
  const kw = String(keywords || '').trim();
  if (!kw) return { ok: false, available: true, engine: 'zentara-mcp', error: 'mots-clés requis', leads: [] };
  try {
    return await withMcpSession(async ({ call, toolNames }) => {
      if (!toolNames.includes('search_people')) {
        return { ok: false, available: true, engine: 'zentara-mcp', error: 'outil search_people introuvable', tools: toolNames, leads: [] };
      }
      const { rawText, isError } = await call('search_people', { keywords: kw, location: opts.location || undefined }, opts.timeoutMs || 120000);
      if (isError) {
        return { ok: false, available: true, engine: 'zentara-mcp', error: rawText || 'erreur search_people', authRequired: AUTH_RE.test(rawText), tools: toolNames, leads: [] };
      }
      const leads = await parsePeopleRawText(rawText, opts);
      return { ok: true, available: true, engine: 'zentara-mcp', rawText, tools: toolNames, leads, parsedCount: leads.length };
    }, opts);
  } catch (e) {
    const msg = String(e.message || e);
    return { ok: false, available: true, engine: 'zentara-mcp', error: msg, authRequired: AUTH_RE.test(msg), leads: [] };
  }
}

const JOBS_EXTRACT_PROMPT = `Tu es un extracteur de données LinkedIn pour Zentara.
À partir du TEXTE BRUT d'une recherche d'offres d'emploi LinkedIn, extrais chaque offre en JSON.
Réponds UNIQUEMENT avec un objet JSON de la forme :
{"jobs":[{"title":"Intitulé du poste","company":"Nom de l'entreprise","location":"Ville / remote","job_id":"identifiant numérique LinkedIn si visible","apply_url":"https://www.linkedin.com/jobs/view/<job_id> si visible","posted_date":"il y a X jours / aujourd'hui","salary":"fourchette si visible","description_snippet":"2-3 phrases du descriptif si visibles"}]}

Règles strictes :
- N'invente AUCUNE donnée : champ absent → null.
- Ignore les textes de navigation/UI.
- company : le nom exact de l'entreprise qui publie l'offre.
- job_id : l'identifiant numérique LinkedIn uniquement s'il est visible (sinon null).
- Ne renvoie que le JSON, aucun texte autour.`;

const COMPANY_EXTRACT_PROMPT = `Tu es un extracteur de données LinkedIn pour Zentara.
À partir du TEXTE BRUT du profil d'une entreprise LinkedIn, extrais un objet JSON :
{"name":"Nom","industry":"secteur","size":"taille (ex 11-50 employés)","location":"siège","website":"site web si visible","description":"2-3 phrases de présentation"}

Règles strictes : n'invente AUCUNE donnée, champ absent → null. Ne renvoie que le JSON, aucun texte autour.`;

/** Parse le rawText brut de search_jobs via l'IA → jobs structurés. */
async function parseJobsRawText(rawText, opts = {}) {
  if (!rawText || !String(rawText).trim()) return [];
  try {
    const r = await AI.chatCompletion([
      { role: 'system', content: JOBS_EXTRACT_PROMPT },
      { role: 'user', content: String(rawText).slice(0, 14000) },
    ], { json: true, maxTokens: 5000 });
    const parsed = AI.extractJson(r.content);
    const jobs = Array.isArray(parsed) ? parsed : (parsed?.jobs || []);
    return jobs
      .map((j) => ({
        title: j.title || j.name || null,
        company: j.company || null,
        location: j.location || null,
        job_id: j.job_id || j.jobId || null,
        apply_url: j.apply_url || j.applyUrl || null,
        posted_date: j.posted_date || j.postedDate || null,
        salary: j.salary || null,
        description_snippet: j.description_snippet || j.snippet || null,
        confidence: 0.7,
        tags: ['job', 'linkedin'],
        metadata: { source: 'Zentara Jobs (MCP)' },
      }))
      .filter((j) => j.title);
  } catch {
    return [];
  }
}

/** Parse le rawText brut d'un profil entreprise via l'IA → objet infos. */
async function parseCompanyRawText(rawText) {
  if (!rawText || !String(rawText).trim()) return null;
  try {
    const r = await AI.chatCompletion([
      { role: 'system', content: COMPANY_EXTRACT_PROMPT },
      { role: 'user', content: String(rawText).slice(0, 8000) },
    ], { json: true, maxTokens: 2000 });
    return AI.extractJson(r.content);
  } catch {
    return null;
  }
}

const NEEDS_EXTRACT_PROMPT = `Tu es un analyste commercial de Zentara.
À partir de la description d'une offre d'emploi, identifie les besoins explicites de l'entreprise qui recrute.
Réponds UNIQUEMENT avec un objet JSON :
{"needs":["besoin explicite 1","besoin explicite 2"],"hiring_context":"1-2 phrases résumant pourquoi l'entreprise recrute (croissance, remplacement, nouveau marché, structuration d'équipe…)"}

Règles strictes :
- needs : uniquement des besoins réellement exprimés dans la description (jamais inventés).
- Si aucun besoin explicite n'est détectable, renvoie {"needs":[],"hiring_context":null}.
- hiring_context : contexte de recrutement déduit de la description (null si non identifiable).
- Ne renvoie que le JSON, aucun texte autour.`;

/**
 * Parse la description d'une offre via l'IA → besoins explicites de l'entreprise qui recrute.
 * Renvoie { needs: string[], hiringContext: string|null }.
 */
async function parseJobNeeds(job, descriptionText) {
  const text = String(descriptionText || job?.description_snippet || job?.snippet || '').trim();
  if (!text) return { needs: [], hiringContext: null };
  try {
    const r = await AI.chatCompletion([
      { role: 'system', content: NEEDS_EXTRACT_PROMPT },
      { role: 'user', content: text.slice(0, 8000) },
    ], { json: true, maxTokens: 1500 });
    const parsed = AI.extractJson(r.content) || {};
    return {
      needs: Array.isArray(parsed.needs) ? parsed.needs.filter(Boolean).slice(0, 6) : [],
      hiringContext: parsed.hiring_context || parsed.hiringContext || null,
    };
  } catch {
    return { needs: [], hiringContext: null };
  }
}

const JOB_EMAIL_PROMPT = `Tu es un expert en prospection B2B outbound pour Zentara (plateforme d'intelligence commerciale : recherche de leads, enrichissement d'emails, scoring, emails outbound automatisés).
À partir d'une offre d'emploi et des besoins explicites détectés chez l'entreprise qui recrute, rédige UN email d'approche personnalisé.

Objectif : montrer à l'entreprise que tu as compris POURQUOI elle recrute, et proposer Zentara comme levier pour résoudre ce besoin (remplir le pipeline, structurer l'outbound, générer des leads qualifiés, gagner du temps de prospection).

RÈGLES :
- Réponds UNIQUEMENT en JSON valide, sans texte autour.
- body : HTML/CSS inline valide (couleurs sobres, responsive, 1 bouton CTA vers https://calendly.com/zentara-demo, signature).
- subject : court et personnalisé (max 60 caractères).
- Ne révèle pas toute l'analyse, reste humain, direct, crédible.
- Ne garantis aucun chiffre, n'invente aucune donnée sur l'entreprise.

Format JSON attendu :
{"subject":"...","body":"<html>...</html>","rationale":"1 phrase expliquant l'angle choisi"}`;

/** Contexte commun (entreprise + poste + besoins) pour la génération d'emails. */
function jobEmailContext(job) {
  const title = job?.title || job?.name || 'le poste à pourvoir';
  const company = job?.company || job?.category || 'votre entreprise';
  const location = job?.location || '';
  const needs = Array.isArray(job?.needs) ? job.needs.filter(Boolean) : [];
  const hiringContext = job?.hiringContext || '';
  const snippet = job?.description_snippet || job?.snippet || '';
  const ci = job?.companyInfo || {};
  const ciText = [ci.industry || ci.sector, ci.size, ci.headquarters || ci.location].filter(Boolean).join(' · ');
  return [
    `ENTREPRISE : ${company}`,
    `POSTE RECRUTÉ : ${title}`,
    location ? `LOCALISATION : ${location}` : null,
    ciText ? `INFOS ENTREPRISE : ${ciText}` : null,
    needs.length ? `BESOINS EXPLICITES DÉTECTÉS :\n${needs.map((n) => '- ' + n).join('\n')}` : null,
    hiringContext ? `CONTEXTE DE RECRUTEMENT : ${hiringContext}` : null,
    snippet ? `EXTRAIT DE L'OFFRE : ${snippet}` : null,
  ].filter(Boolean).join('\n');
}

/** Rédige un email d'approche IA ciblé sur les besoins extraits d'une offre. */
async function generateJobEmail(job, opts = {}) {
  try {
    const r = await AI.chatCompletion([
      { role: 'system', content: JOB_EMAIL_PROMPT },
      { role: 'user', content: jobEmailContext(job).slice(0, 6000) },
    ], { json: true, maxTokens: 3000, provider: opts.provider, model: opts.model });
    const parsed = AI.extractJson(r.content) || {};
    return {
      ok: true,
      subject: parsed.subject || '',
      body: parsed.body || '',
      rationale: parsed.rationale || '',
      provider: r.provider,
      model: r.model,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e), subject: '', body: '', rationale: '' };
  }
}

const JOB_EMAIL_SEQUENCE_PROMPT = `Tu es un expert en prospection B2B outbound pour Zentara (plateforme d'intelligence commerciale : recherche de leads, enrichissement d'emails, scoring, emails outbound automatisés).
À partir d'une offre d'emploi et des besoins explicites détectés chez l'entreprise qui recrute, rédige UNE SÉQUENCE de 3 emails d'approche :
1. "cold"      : premier email — accroche personnalisée sur un besoin détecté.
2. "follow_up" : relance courte (3-5 jours plus tard) — nouvelle valeur ajoutée, sans répéter l'email 1.
3. "breakup"   : dernier email de rupture élégant — laisse la porte ouverte, dernier point de contact.

Objectif : montrer que tu as compris POURQUOI l'entreprise recrute, et proposer Zentara comme levier pour résoudre ce besoin (remplir le pipeline, structurer l'outbound, générer des leads qualifiés, gagner du temps de prospection).

RÈGLES :
- Réponds UNIQUEMENT en JSON valide, sans texte autour.
- Chaque body : HTML/CSS inline valide (couleurs sobres, responsive, 1 bouton CTA vers https://calendly.com/zentara-demo, signature).
- Chaque subject : court et personnalisé (max 60 caractères).
- Ne révèle pas toute l'analyse, reste humain, direct, crédible.
- Ne garantis aucun chiffre, n'invente aucune donnée sur l'entreprise.

Format JSON attendu :
{"sequence":[
  {"step":"cold","subject":"...","body":"<html>...</html>","rationale":"..."},
  {"step":"follow_up","subject":"...","body":"<html>...</html>","rationale":"..."},
  {"step":"breakup","subject":"...","body":"<html>...</html>","rationale":"..."}
]}`;

/** Génère la séquence complète (cold → follow-up → breakup) ciblée sur les besoins. */
async function generateJobEmailSequence(job, opts = {}) {
  try {
    const r = await AI.chatCompletion([
      { role: 'system', content: JOB_EMAIL_SEQUENCE_PROMPT },
      { role: 'user', content: jobEmailContext(job).slice(0, 6000) },
    ], { json: true, maxTokens: 5000, provider: opts.provider, model: opts.model });
    const parsed = AI.extractJson(r.content) || {};
    const seq = (Array.isArray(parsed.sequence) ? parsed.sequence : []).map((s) => ({
      step: s.step || '',
      subject: s.subject || '',
      body: s.body || '',
      rationale: s.rationale || '',
    }));
    const by = (step) => seq.find((s) => s.step === step) || null;
    return {
      ok: seq.length > 0,
      sequence: seq,
      cold: by('cold'),
      follow_up: by('follow_up'),
      breakup: by('breakup'),
      provider: r.provider,
      model: r.model,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e), sequence: [], cold: null, follow_up: null, breakup: null };
  }
}

/**
 * Recherche d'offres d'emploi LinkedIn + enrichissement des entreprises qui recrutent.
 * 1) search_jobs → jobs (titre, entreprise, localisation, job_id, URL…)
 * 2) pour les ~5 premières entreprises uniques → get_company_profile (secteur, taille, siège…)
 * 3) pour les ~3 premières offres avec job_id → get_job_details + IA → besoins explicites
 */
async function searchJobsMCP(keywords, opts = {}) {
  const kw = String(keywords || '').trim();
  if (!kw) return { ok: false, available: true, engine: 'zentara-mcp', error: 'mots-clés requis', leads: [] };
  try {
    return await withMcpSession(async ({ call, toolNames }) => {
      if (!toolNames.includes('search_jobs')) {
        return { ok: false, available: true, engine: 'zentara-mcp', error: 'outil search_jobs introuvable', tools: toolNames, leads: [] };
      }
      const { rawText, isError } = await call('search_jobs', {
        keywords: kw,
        location: opts.location || undefined,
        date_posted: opts.date_posted || undefined,
        work_type: opts.work_type || undefined,
        easy_apply: opts.easy_apply === true,
      }, opts.timeoutMs || 120000);
      if (isError) {
        return { ok: false, available: true, engine: 'zentara-mcp', error: rawText || 'erreur search_jobs', authRequired: AUTH_RE.test(rawText), tools: toolNames, leads: [] };
      }
      const jobs = await parseJobsRawText(rawText, opts);
      // Enrichissement entreprise (top N uniques) via get_company_profile
      if (opts.enrichCompanies !== false) {
        const companies = [...new Set(jobs.map((j) => j.company).filter(Boolean))].slice(0, opts.enrichLimit || 5);
        for (const c of companies) {
          try {
            const cr = await call('get_company_profile', { company_name: c }, 60000);
            if (!cr.isError) {
              const info = await parseCompanyRawText(cr.rawText);
              if (info) {
                for (const j of jobs) {
                  if (j.company === c) j.companyInfo = info;
                }
              }
            }
          } catch { /* enrichissement best-effort */ }
        }
      }
      // Enrichissement besoins (top N offres avec job_id) via get_job_details + IA
      if (opts.enrichNeeds !== false) {
        const needLimit = opts.needsLimit || 3;
        const targets = jobs.filter((j) => j.job_id).slice(0, needLimit);
        for (const j of targets) {
          try {
            let desc = j.description_snippet || '';
            const jd = await call('get_job_details', { job_id: j.job_id }, 60000);
            if (!jd.isError && jd.rawText) {
              desc = [j.description_snippet, jd.rawText].filter(Boolean).join('\n\n');
            }
            const n = await parseJobNeeds(j, desc);
            j.needs = n.needs;
            j.hiringContext = n.hiringContext;
          } catch { /* besoins best-effort */ }
        }
      }
      // Génération automatique de l'email d'approche (top N offres enrichies)
      if (opts.autoEmail !== false) {
        const emailLimit = opts.emailLimit || opts.needsLimit || 3;
        const emailTargets = jobs
          .filter((j) => (j.needs && j.needs.length) || j.hiringContext || j.description_snippet)
          .slice(0, emailLimit);
        for (const j of emailTargets) {
          try {
            j.outreachSequence = await generateJobEmailSequence(j);
          } catch { /* email best-effort */ }
        }
      }
      return { ok: true, available: true, engine: 'zentara-mcp', rawText, tools: toolNames, leads: jobs, parsedCount: jobs.length };
    }, opts);
  } catch (e) {
    const msg = String(e.message || e);
    return { ok: false, available: true, engine: 'zentara-mcp', error: msg, authRequired: AUTH_RE.test(msg), leads: [] };
  }
}

/** Recherche d'entreprises LinkedIn (search_companies). */
async function searchCompaniesMCP(keywords, opts = {}) {
  const kw = String(keywords || '').trim();
  if (!kw) return { ok: false, available: true, engine: 'zentara-mcp', error: 'mots-clés requis', leads: [] };
  try {
    return await withMcpSession(async ({ call, toolNames }) => {
      if (!toolNames.includes('search_companies')) {
        return { ok: false, available: true, engine: 'zentara-mcp', error: 'outil search_companies introuvable', tools: toolNames, leads: [] };
      }
      const { rawText, isError } = await call('search_companies', { keywords: kw }, opts.timeoutMs || 120000);
      if (isError) {
        return { ok: false, available: true, engine: 'zentara-mcp', error: rawText || 'erreur search_companies', authRequired: AUTH_RE.test(rawText), tools: toolNames, leads: [] };
      }
      const leads = await parseCompaniesRawText(rawText, opts);
      return { ok: true, available: true, engine: 'zentara-mcp', rawText, tools: toolNames, leads, parsedCount: leads.length };
    }, opts);
  } catch (e) {
    const msg = String(e.message || e);
    return { ok: false, available: true, engine: 'zentara-mcp', error: msg, authRequired: AUTH_RE.test(msg), leads: [] };
  }
}

const COMPANIES_EXTRACT_PROMPT = `Tu es un extracteur de données LinkedIn pour Zentara.
À partir du TEXTE BRUT d'une recherche d'entreprises LinkedIn, extrais chaque entreprise en JSON.
Réponds UNIQUEMENT avec un objet JSON de la forme :
{"companies":[{"name":"Nom","industry":"secteur","size":"taille","location":"siège","linkedin_url":"https://www.linkedin.com/company/username si visible","description":"1-2 phrases"}]}

Règles strictes : n'invente AUCUNE donnée, champ absent → null. Ignore les textes de navigation/UI. Ne renvoie que le JSON, aucun texte autour.`;

async function parseCompaniesRawText(rawText, opts = {}) {
  if (!rawText || !String(rawText).trim()) return [];
  try {
    const r = await AI.chatCompletion([
      { role: 'system', content: COMPANIES_EXTRACT_PROMPT },
      { role: 'user', content: String(rawText).slice(0, 12000) },
    ], { json: true, maxTokens: 4000 });
    const parsed = AI.extractJson(r.content);
    const companies = Array.isArray(parsed) ? parsed : (parsed?.companies || []);
    return companies
      .map((c) => ({
        name: c.name || null,
        industry: c.industry || null,
        size: c.size || null,
        location: c.location || null,
        website: c.website || null,
        linkedin: c.linkedin_url || c.linkedin || null,
        description: c.description || null,
        confidence: 0.7,
        tags: ['company', 'linkedin'],
        metadata: { source: 'Zentara Companies (MCP)' },
      }))
      .filter((c) => c.name);
  } catch {
    return [];
  }
}

/**
 * Recherche d'offres via l'API PUBLIQUE jobs-guest (aucune session requise).
 * Le bridge Python parse le HTML → jobs structurés (id, titre, entreprise,
 * localisation, date, URL, description pour les premières).
 */
async function searchJobsPublic(keywords, opts = {}) {
  if (!keywords) return { ok: false, available: true, engine: 'zentara-jobs-public', error: 'mots-clés requis', leads: [] };
  const res = await runBridge(
    {
      action: 'jobs',
      keywords: String(keywords),
      location: String(opts.location || ''),
      limit: Number(opts.limit || 25),
      details: Number(opts.enrichLimit || opts.details || 5),
    },
    opts.timeoutMs || 90000,
  );
  if (!res.ok || !Array.isArray(res.jobs)) {
    return { ok: false, available: true, engine: 'zentara-jobs-public', error: res.error || 'échec jobs public', leads: [] };
  }
  const leads = res.jobs.map((j) => ({
    title: j.title,
    company: j.company,
    location: j.location,
    job_id: j.job_id,
    apply_url: j.apply_url || j.linkedin || null,
    linkedin: j.linkedin || j.apply_url || null,
    posted_date: j.posted_date,
    salary: j.salary,
    description_snippet: j.description_snippet,
    needs: [],
    hiringContext: null,
    companyInfo: {},
  }));
  return { ok: true, available: true, engine: 'zentara-jobs-public', leads, count: leads.length, keywords: res.keywords, location: res.location };
}

module.exports = {
  status,
  searchStaff,
  searchPeople,
  searchPeopleMCP,
  searchJobsPublic,
  searchJobsMCP,
  searchCompaniesMCP,
  parsePeopleRawText,
  parseJobsRawText,
  parseCompanyRawText,
  parseJobNeeds,
  generateJobEmail,
  generateJobEmailSequence,
  toLead,
  configure,
  BRIDGE,
};
