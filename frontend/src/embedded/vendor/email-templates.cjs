// email-templates.js — Système de templates email premium Zentara.
//
// But : passer d'un simple bloc HTML inline à de VRAIS templates éditables
//       (premium SaaS look) avec sections modulaires, theming, et
//       substitution de variables.
//
// Chaque template :
//   - id           :  clé stable
//   - label        :  libellé utilisateur
//   - subject_default : sujet par défaut
//   - description  :  contexte d'usage
//   - variables    :  liste des variables acceptées (avec type, défaut)
//   - sections     :  ordre des sections ('hero','insight','problem',
//                     'solution','proof','cta','signature'...)
//   - text_overrides :  objet optionnel pour customiser le wording
//                       d'une section (sinon le rendu utilise du générique)
//
// Le rendu se fait via renderEmailTemplate(templateId, vars) → string HTML/CSS
// (CSS inline uniquement, aucun fichier externe, compatibilité Gmail/Outlook/
// iOS Mail/Apple Mail vérifiée pour les patterns principaux).
'use strict';

// --------------------------------------------------------------------------
// Catalogue de templates
// --------------------------------------------------------------------------

const TEMPLATES = [
  {
    id: 'outreach_first_touch',
    label: 'Premier contact premium',
    description: "Première prise de contact sur la base d'une observation spécifique.",
    subject_default: '{{ company_name | "votre entreprise" }} — un point que nous avons relevé',
    variables: [
      { key: 'recipient_first_name', label: 'Prénom du destinataire', default: '' },
      { key: 'recipient_last_name',  label: 'Nom du destinataire',    default: '' },
      { key: 'recipient_role',       label: 'Poste du destinataire',  default: '' },
      { key: 'company_name',         label: 'Nom de l\'entreprise',   default: 'votre entreprise' },
      { key: 'company_sector',       label: 'Secteur',                default: '' },
      { key: 'observation',          label: 'Observation spécifique', default: '' },
      { key: 'problem',              label: 'Problème identifié',     default: '' },
      { key: 'consequence',          label: 'Conséquence potentielle', default: '' },
      { key: 'solution',             label: 'Solution Zentara proposée', default: '' },
      { key: 'cta_text',             label: 'Texte du bouton CTA',    default: 'Planifier un échange' },
      { key: 'cta_url',              label: 'URL du bouton',          default: 'https://calendly.com/zentara-demo' },
      { key: 'sender_name',          label: 'Nom du signataire',      default: 'L\'équipe Zentara' },
      { key: 'sender_role',          label: 'Rôle du signataire',     default: 'Enterprise Intelligence' },
    ],
    sections: ['greeting', 'observation', 'problem', 'consequence', 'solution', 'cta', 'signature'],
  },
  {
    id: 'outreach_followup',
    label: 'Relance douce',
    description: "Relance 3-5 jours après un premier message resté sans réponse.",
    subject_default: 'Suite de notre échange — {{ company_name }}',
    variables: [
      { key: 'recipient_first_name', label: 'Prénom', default: '' },
      { key: 'recipient_last_name',  label: 'Nom', default: '' },
      { key: 'company_name',         label: 'Entreprise', default: '' },
      { key: 'previous_subject',     label: 'Sujet précédent', default: '' },
      { key: 'new_observation',      label: 'Nouveau signal à mentionner', default: '' },
      { key: 'cta_text',             label: 'Texte CTA', default: 'Replanifier l\'échange' },
      { key: 'cta_url',              label: 'URL CTA', default: 'https://calendly.com/zentara-demo' },
      { key: 'sender_name',          label: 'Signataire', default: 'L\'équipe Zentara' },
    ],
    sections: ['greeting_short', 'previous_recall', 'new_observation', 'cta', 'signature'],
  },
  {
    id: 'outreach_reactivation',
    label: 'Réactivation prospect dormant',
    description: "Reprendre contact avec une entreprise qui était intéressante il y a plusieurs mois.",
    subject_default: '{{ company_name }} — un nouveau signal observé',
    variables: [
      { key: 'recipient_first_name', label: 'Prénom', default: '' },
      { key: 'company_name',         label: 'Entreprise', default: '' },
      { key: 'new_signal',           label: 'Nouveau signal déclencheur', default: '' },
      { key: 'why_now',              label: 'Pourquoi maintenant', default: '' },
      { key: 'cta_text',             label: 'Texte CTA', default: 'En discuter 15 min' },
      { key: 'cta_url',              label: 'URL CTA', default: 'https://calendly.com/zentara-demo' },
      { key: 'sender_name',          label: 'Signataire', default: 'L\'équipe Zentara' },
    ],
    sections: ['greeting_short', 'new_signal', 'why_now', 'cta', 'signature'],
  },
  {
    id: 'demo_invitation',
    label: 'Invitation démo',
    description: "Convaincu d'un problème précis, propose directement une démo ciblée.",
    subject_default: 'Démo Zentara personnalisée — {{ company_name }}',
    variables: [
      { key: 'recipient_first_name', label: 'Prénom', default: '' },
      { key: 'company_name',         label: 'Entreprise', default: '' },
      { key: 'demo_focus',           label: 'Focus démo', default: 'le scoring déterministe 50 critères' },
      { key: 'demo_duration',        label: 'Durée démo', default: '20 min' },
      { key: 'cta_text',             label: 'Texte CTA', default: 'Réserver ma démo' },
      { key: 'cta_url',              label: 'URL CTA', default: 'https://calendly.com/zentara-demo' },
      { key: 'sender_name',          label: 'Signataire', default: 'L\'équipe Zentara' },
      { key: 'sender_role',          label: 'Rôle signataire', default: 'Enterprise Intelligence' },
    ],
    sections: ['greeting', 'problem', 'demo_pitch', 'cta', 'signature'],
  },
  {
    id: 'meeting_proposal',
    label: 'Proposition de créneau précis',
    description: 'Propose 1 ou 2 créneaux concrets, sans ambiguïté.',
    subject_default: 'Proposition de créneau — Zentara × {{ company_name }}',
    variables: [
      { key: 'recipient_first_name', label: 'Prénom', default: '' },
      { key: 'company_name',         label: 'Entreprise', default: '' },
      { key: 'slot_1',               label: 'Créneau 1', default: 'Mardi 14h' },
      { key: 'slot_2',               label: 'Créneau 2', default: 'Jeudi 11h' },
      { key: 'duration',             label: 'Durée', default: '20 min' },
      { key: 'manager_email',        label: 'Email pour répondre', default: 'contact@zentara.app' },
    ],
    sections: ['greeting_short', 'slot_proposal', 'signature'],
  },
  {
    id: 'data_drop_summary',
    label: 'Livraison d\'un résumé d\'analyse',
    description: 'Partage un rapport d\'intelligence écrit à la main après une analyse longue.',
    subject_default: 'Votre analyse Zentara — {{ company_name }}',
    variables: [
      { key: 'recipient_first_name', label: 'Prénom', default: '' },
      { key: 'company_name',         label: 'Entreprise', default: '' },
      { key: 'analysis_url',         label: 'URL du rapport complet', default: 'https://zentara.app/r/' },
      { key: 'top_finding',          label: 'Finding principal', default: '' },
      { key: 'cta_text',             label: 'Texte CTA', default: 'Lire le rapport' },
      { key: 'cta_url',              label: 'URL CTA', default: 'https://zentara.app/r/' },
      { key: 'sender_name',          label: 'Signataire', default: 'L\'équipe Zentara' },
    ],
    sections: ['greeting_short', 'data_summary_header', 'top_finding', 'cta', 'signature'],
  },
];

const TEMPLATES_BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

// --------------------------------------------------------------------------
// Tokens utilitaires (échappement HTML, valeurs par défaut, template tags)
// --------------------------------------------------------------------------

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Substitute simple {{ key | default }} occurrences in a string. */
function applyVars(template, vars) {
  return String(template || '').replace(/\{\{\s*([\w_]+)(?:\s*\|\s*"([^"]+)")?\s*\}\}/g, (_, k, def) => {
    const v = vars?.[k];
    if (v != null && String(v).trim() !== '') return escapeHtml(v);
    return escapeHtml(def || '');
  });
}

// --------------------------------------------------------------------------
// Brand constants
// --------------------------------------------------------------------------

const BRAND = {
  name: 'Zentara',
  product: 'Enterprise Intelligence',
  primary: '#94ff01',     // neon lime signature
  primaryDark: '#5fa800',
  accent: '#94ff01',
  text: '#0F172A',
  textMuted: '#475569',
  bgPage: '#f4f4f7',
  bgCard: '#FFFFFF',
  border: '#E2E8F0',
  logoUrl: 'https://zentara.app/logo-email.png',
  siteUrl: 'https://zentara.app',
};

// --------------------------------------------------------------------------
// Sections modulaires
// --------------------------------------------------------------------------

function sectionGreeting(vars) {
  const fn = vars.recipient_first_name?.trim();
  const ln = vars.recipient_last_name?.trim();
  const full = [fn, ln].filter(Boolean).join(' ');
  const greet = full
    ? `Bonjour ${escapeHtml(full)}`
    : (vars.recipient_role ? `Bonjour` : 'Bonjour,');
  return `
    <tr><td style="padding:0 32px 16px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:16px; line-height:1.55; color:${BRAND.text};">
      <p style="margin:0;">${greet},</p>
    </td></tr>
  `;
}

function sectionGreetingShort(vars) {
  const fn = vars.recipient_first_name?.trim();
  return `
    <tr><td style="padding:0 32px 12px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; line-height:1.55; color:${BRAND.text};">
      <p style="margin:0;">Bonjour${fn ? ' ' + escapeHtml(fn) : ''},</p>
    </td></tr>
  `;
}

function sectionObservation(vars) {
  const obs = applyVars('{{ observation }}', vars);
  if (!obs.trim()) return '';
  return `
    <tr><td style="padding:0 32px 14px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bgPage}; border-radius:10px; border:1px solid ${BRAND.border};">
        <tr><td style="padding:14px 18px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:14.5px; line-height:1.6; color:${BRAND.text};">
          <strong style="color:${BRAND.primary}; display:block; margin-bottom:4px; font-size:12px; letter-spacing:0.6px; text-transform:uppercase;">Observation</strong>
          ${obs}
        </td></tr>
      </table>
    </td></tr>
  `;
}

function sectionProblem(vars) {
  const p = applyVars('{{ problem }}', vars);
  if (!p.trim()) return '';
  return `
    <tr><td style="padding:0 32px 14px;">
      <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; line-height:1.6; color:${BRAND.text};">
        <strong style="color:${BRAND.text};">Problème identifié :</strong> ${p}
      </p>
    </td></tr>
  `;
}

function sectionConsequence(vars) {
  const c = applyVars('{{ consequence }}', vars);
  if (!c.trim()) return '';
  return `
    <tr><td style="padding:0 32px 14px;">
      <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:14.5px; line-height:1.6; color:${BRAND.textMuted};">
        <strong style="color:${BRAND.textMuted};">Conséquence probable :</strong> ${c}
      </p>
    </td></tr>
  `;
}

function sectionSolution(vars) {
  const s = applyVars('{{ solution }}', vars);
  if (!s.trim()) return '';
  return `
    <tr><td style="padding:0 32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg, ${BRAND.primary}, ${BRAND.primaryDark}); border-radius:10px;">
        <tr><td style="padding:18px 20px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:14.5px; line-height:1.6; color:#FFFFFF;">
          <strong style="display:block; margin-bottom:4px; font-size:12px; letter-spacing:0.6px; text-transform:uppercase; opacity:0.85;">Solution Zentara</strong>
          ${s}
        </td></tr>
      </table>
    </td></tr>
  `;
}

function sectionCta(vars) {
  const text = applyVars('{{ cta_text | "En savoir plus" }}', vars);
  const url = applyVars('{{ cta_url | "https://calendly.com/zentara-demo" }}', vars);
  return `
    <tr><td align="center" style="padding:8px 32px 28px;">
      <a href="${escapeHtml(url)}"
         style="display:inline-block; background:${BRAND.primary}; color:#FFFFFF; padding:14px 28px; border-radius:10px; text-decoration:none; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; font-weight:600; letter-spacing:0.2px;">
        ${escapeHtml(text)}
      </a>
      <p style="margin:10px 0 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:12.5px; color:${BRAND.textMuted};">
        ou répondez simplement à cet email.
      </p>
    </td></tr>
  `;
}

function sectionSignature(vars) {
  const name = escapeHtml(vars.sender_name || BRAND.name);
  const role = escapeHtml(vars.sender_role || BRAND.product);
  return `
    <tr><td style="padding:8px 32px 28px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:14.5px; line-height:1.5; color:${BRAND.text};">
      <p style="margin:0 0 4px;">${name}</p>
      <p style="margin:0; color:${BRAND.textMuted}; font-size:13px;">${role}</p>
      <p style="margin:14px 0 0; font-size:12.5px; color:${BRAND.textMuted};">
        <a href="${BRAND.siteUrl}" style="color:${BRAND.primary}; text-decoration:none;">zentara.app</a>
        &nbsp;·&nbsp;
        <span style="opacity:0.7;">Intelligence commerciale déterministe pour B2B</span>
      </p>
    </td></tr>
  `;
}

function sectionPreviousRecall(vars) {
  const subj = vars.previous_subject?.trim();
  if (!subj) {
    return `
      <tr><td style="padding:0 32px 12px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; line-height:1.55; color:${BRAND.text};">
        <p style="margin:0;">Je me permets de revenir vers vous — j'espère que mon message précédent a retenu votre attention.</p>
      </td></tr>
    `;
  }
  return `
    <tr><td style="padding:0 32px 12px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; line-height:1.55; color:${BRAND.text};">
      <p style="margin:0;">Je me permets de revenir vers vous — suite à mon précédent message intitulé «&nbsp;<em>${escapeHtml(subj)}</em>&nbsp;», resté sans suite de votre côté.</p>
    </td></tr>
  `;
}

function sectionNewObservation(vars) {
  return sectionObservation({ ...vars, observation: vars.new_observation });
}

function sectionWhyNow(vars) {
  const w = applyVars('{{ why_now }}', vars);
  if (!w.trim()) return '';
  return `
    <tr><td style="padding:0 32px 14px;">
      <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; line-height:1.6; color:${BRAND.text};">
        <strong style="color:${BRAND.text};">Pourquoi maintenant :</strong> ${w}
      </p>
    </td></tr>
  `;
}

function sectionDemoPitch(vars) {
  const focus = applyVars('{{ demo_focus | "le scoring déterministe 50 critères" }}', vars);
  const dur = applyVars('{{ demo_duration | "20 min" }}', vars);
  return `
    <tr><td style="padding:0 32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bgCard}; border:1px solid ${BRAND.border}; border-radius:10px;">
        <tr><td style="padding:18px 22px;">
          <p style="margin:0 0 8px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:12px; letter-spacing:0.5px; text-transform:uppercase; color:${BRAND.primary}; font-weight:700;">DÉMO PERSONNALISÉE</p>
          <p style="margin:0 0 6px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:17px; color:${BRAND.text}; font-weight:600;">${focus}</p>
          <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:13.5px; color:${BRAND.textMuted};">Durée : ${dur} · En visio · 100% basé sur vos données</p>
        </td></tr>
      </table>
    </td></tr>
  `;
}

function sectionSlotProposal(vars) {
  const s1 = escapeHtml(vars.slot_1 || '');
  const s2 = escapeHtml(vars.slot_2 || '');
  if (!s1 && !s2) return '';
  return `
    <tr><td style="padding:0 32px 18px;">
      <p style="margin:0 0 10px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; color:${BRAND.text};">Deux créneaux possibles :</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
        ${s1 ? `<tr><td style="padding:6px 0;"><span style="display:inline-block; background:${BRAND.primary}; color:#FFFFFF; padding:6px 12px; border-radius:6px; font-family:-apple-system; font-size:13px; font-weight:600;">${s1}</span></td></tr>` : ''}
        ${s2 ? `<tr><td style="padding:6px 0;"><span style="display:inline-block; background:${BRAND.bgPage}; color:${BRAND.text}; padding:6px 12px; border-radius:6px; font-family:-apple-system; font-size:13px; font-weight:600; border:1px solid ${BRAND.border};">${s2}</span></td></tr>` : ''}
      </table>
      <p style="margin:12px 0 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:13.5px; color:${BRAND.textMuted};">
        Dites-moi lequel vous convient — ou proposez le vôtre.
      </p>
    </td></tr>
  `;
}

function sectionDataSummaryHeader(vars) {
  return `
    <tr><td style="padding:0 32px 14px;">
      <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; line-height:1.6; color:${BRAND.text};">
        Voici votre analyse Zentara pour <strong>${escapeHtml(vars.company_name || 'votre entreprise')}</strong>. Le document complet est disponible via le bouton ci-dessous.
      </p>
    </td></tr>
  `;
}

function sectionTopFinding(vars) {
  const tf = applyVars('{{ top_finding }}', vars);
  if (!tf.trim()) return '';
  return `
    <tr><td style="padding:0 32px 14px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFBEB; border-left:4px solid ${BRAND.accent}; border-radius:6px;">
        <tr><td style="padding:14px 18px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:14.5px; line-height:1.6; color:${BRAND.text};">
          <strong style="color:${BRAND.accent}; display:block; margin-bottom:4px; font-size:12px; letter-spacing:0.6px; text-transform:uppercase;">Finding principal</strong>
          ${tf}
        </td></tr>
      </table>
    </td></tr>
  `;
}

const SECTION_BUILDERS = {
  greeting: sectionGreeting,
  greeting_short: sectionGreetingShort,
  observation: sectionObservation,
  previous_recall: sectionPreviousRecall,
  new_observation: sectionNewObservation,
  problem: sectionProblem,
  consequence: sectionConsequence,
  why_now: sectionWhyNow,
  solution: sectionSolution,
  demo_pitch: sectionDemoPitch,
  slot_proposal: sectionSlotProposal,
  data_summary_header: sectionDataSummaryHeader,
  top_finding: sectionTopFinding,
  cta: sectionCta,
  signature: sectionSignature,
};

// --------------------------------------------------------------------------
// Layout global (page, header, footer)
// --------------------------------------------------------------------------

function renderEmailTemplate(templateId, vars = {}) {
  const tpl = TEMPLATES_BY_ID[templateId];
  if (!tpl) throw new Error(`Template inconnu : ${templateId}`);
  const filledVars = { ...defaultForTemplate(tpl), ...vars };

  const subject = applyVars(tpl.subject_default, filledVars);
  const sectionsHtml = tpl.sections
    .map((s) => SECTION_BUILDERS[s]?.(filledVars) || '')
    .join('\n');

  const html = `<!-- Zentara email — template ${escapeHtml(tpl.id)} -->
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0; padding:0; background:${BRAND.bgPage}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bgPage}; padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:${BRAND.bgCard}; border-radius:14px; overflow:hidden; box-shadow:0 4px 24px rgba(15,23,42,0.06);">
        <!-- Brand bar -->
        <tr>
          <td style="background:linear-gradient(135deg, ${BRAND.primary} 0%, ${BRAND.primaryDark} 60%, ${BRAND.accent} 130%); padding:18px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:16px; color:#FFFFFF; font-weight:700; letter-spacing:0.4px;">
                  Zentara
                </td>
                <td align="right" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:12px; color:#E0E7FF; opacity:0.9;">
                  Enterprise Intelligence
                </td>
              </tr>
            </table>
          </td>
        </tr>
        ${sectionsHtml}
        <!-- Divider -->
        <tr><td style="padding:0 32px;"><div style="height:1px; background:${BRAND.border};"></div></td></tr>
        <!-- Footer -->
        <tr><td style="padding:18px 32px 24px;">
          <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:11px; line-height:1.6; color:${BRAND.textMuted}; text-align:center;">
            Envoyé via Zentara · <a href="mailto:contact@zentara.app" style="color:${BRAND.primary}; text-decoration:none;">contact@zentara.app</a><br>
            Vous recevez cet email car nous avons identifié un signal pertinent pour votre activité.
            <a href="#" style="color:${BRAND.textMuted}; text-decoration:underline;">Se désinscrire</a>
          </p>
        </td></tr>
      </table>
      <p style="margin:18px 0 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:10.5px; color:${BRAND.textMuted}; text-align:center;">
        © ${new Date().getFullYear()} Zentara — Intelligence commerciale déterministe
      </p>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, html, template: tpl, variables_used: filledVars };
}

function defaultForTemplate(tpl) {
  const out = {};
  for (const v of (tpl.variables || [])) out[v.key] = v.default ?? '';
  return out;
}

// --------------------------------------------------------------------------
// Listing — exposed pour le frontend
// --------------------------------------------------------------------------

function listTemplates() {
  return TEMPLATES.map((t) => ({
    id: t.id, label: t.label, description: t.description,
    variables: t.variables, sections: t.sections,
  }));
}

function getTemplate(id) {
  const t = TEMPLATES_BY_ID[id];
  if (!t) return null;
  return JSON.parse(JSON.stringify(t)); // deep clone
}

module.exports = {
  TEMPLATES,
  TEMPLATES_BY_ID,
  BRAND,
  renderEmailTemplate,
  listTemplates,
  getTemplate,
  applyVars,
  escapeHtml,
};
