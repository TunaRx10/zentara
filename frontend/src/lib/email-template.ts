/**
 * email-template.ts — builder d'email HTML/CSS inline.
 *
 * Les clients mail (Gmail via Apps Script `MailApp.sendEmail({ htmlBody })`)
 * suppriment les balises `<style>` et le CSS externe : on génère donc un
 * HTML 100 % inline (styles sur chaque élément), layout table-based
 * (le plus compatible) et responsive simple.
 */

const BRAND = {
  primary: '#2563eb', // bleu Zentara
  accent: '#7c3aed', // violet Zentara
  ink: '#0f172a',
  muted: '#64748b',
  bg: '#f8fafc',
  card: '#ffffff',
  border: '#e2e8f0',
};

/** Échappe le HTML pour éviter toute injection depuis le texte saisi. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convertit un texte brut en blocs HTML :
 *  - une ligne vide = nouveau paragraphe `<p>`
 *  - un saut de ligne simple = `<br/>`
 */
function paragraphs(text: string): string {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (blocks.length === 0) return `<p>${esc(text)}</p>`;

  return blocks
    .map((b) => {
      const inner = esc(b).replace(/\n/g, '<br/>');
      return `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:${BRAND.ink};">${inner}</p>`;
    })
    .join('');
}

export interface EmailTemplateOptions {
  /** Nom de l'entité (entreprise / lead) affiché en haut. */
  companyName: string;
  /** Catégorie / secteur (optionnel). */
  category?: string | null;
  /** Corps du message en texte brut (retours à la ligne conservés). */
  body: string;
  /** Nom du destinataire pour la ligne d'appel (optionnel). */
  recipientName?: string | null;
  /** Bouton d'appel à l'action (optionnel — omis si absent). */
  cta?: { label: string; url: string } | null;
  /** Signature (nom + entreprise de l'expéditeur). */
  signature?: string;
  /** Couleur d'accent (défaut : bleu Zentara). */
  accent?: string;
}

/**
 * Construit l'email HTML complet (inline styles, table-based).
 * Retourne aussi une version texte-plain (alt) pour les clients sans HTML.
 */
export function buildEmailHtml(opts: EmailTemplateOptions): { html: string; text: string } {
  const accent = opts.accent ?? BRAND.primary;
  const company = opts.companyName || 'votre entreprise';
  const category = opts.category || null;
  const greeting = opts.recipientName ? `Bonjour ${esc(opts.recipientName)},` : 'Bonjour,';

  const chip = category
    ? `<div style="margin-bottom:18px;"><span style="display:inline-block;background:${accent}1a;color:${accent};border:1px solid ${accent}33;border-radius:999px;padding:4px 12px;font-size:11px;font-weight:700;letter-spacing:.04em;">${esc(category)}</span></div>`
    : '';

  const ctaBlock = opts.cta?.url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 10px 0;"><tr><td>
         <a href="${esc(opts.cta.url)}" target="_blank" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 26px;border-radius:10px;">${esc(opts.cta.label || 'En savoir plus')}</a>
       </td></tr></table>`
    : '';

  const signatureBlock = opts.signature
    ? `<div style="margin-top:8px;border-top:1px solid ${BRAND.border};padding-top:14px;font-size:13px;line-height:1.5;color:${BRAND.muted};">${esc(opts.signature)}</div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${esc(company)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${BRAND.card};border-radius:16px;overflow:hidden;border:1px solid ${BRAND.border};">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${accent},${BRAND.primary});padding:22px 30px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:12px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:40px;height:40px;background:rgba(255,255,255,.16);border-radius:11px;">
                      <tr><td align="center" style="font-size:20px;font-weight:900;color:#ffffff;">Z</td></tr>
                    </table>
                  </td>
                  <td style="vertical-align:middle;">
                    <div style="color:#ffffff;font-size:17px;font-weight:800;letter-spacing:.02em;">Zentara</div>
                    <div style="color:rgba(255,255,255,.75);font-size:11px;letter-spacing:.08em;text-transform:uppercase;">Enterprise Intelligence</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:30px 30px 26px 30px;">
              <div style="font-size:20px;font-weight:800;color:${BRAND.ink};margin-bottom:14px;">${esc(company)}</div>
              ${chip}
              <div style="font-size:15px;line-height:1.65;color:${BRAND.ink};">
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:${BRAND.ink};">${greeting}</p>
                ${paragraphs(opts.body)}
              </div>
              ${ctaBlock}
              ${signatureBlock}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:${BRAND.bg};border-top:1px solid ${BRAND.border};padding:16px 30px;">
              <div style="font-size:11px;line-height:1.5;color:${BRAND.muted};">
                Envoyé via <strong>Zentara</strong> — intelligence stratégique &amp; prospection automatisée.
                <br/>Si vous ne souhaitez plus recevoir ce type de message, répondez simplement « STOP ».
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Version texte-plain (alt) pour les clients sans HTML.
  const text = [
    `${company}`,
    '',
    greeting,
    opts.body.trim(),
    opts.cta?.url ? `${opts.cta.label}: ${opts.cta.url}` : null,
    '',
    opts.signature ?? '',
    '',
    '— Envoyé via Zentara (intelligence stratégique & prospection).',
    'Répondez « STOP » pour ne plus recevoir ce type de message.',
  ]
    .filter((l): l is string => l !== null)
    .join('\n');

  return { html, text };
}

/** Templates pré-remplis pour le composer email. */
export interface EmailTemplatePreset {
  key: 'cold' | 'follow_up' | 'breakup';
  label: string;
  subject: (company: string, category: string) => string;
  body: (company: string, category: string, recipientName?: string | null) => string;
}

export const EMAIL_TEMPLATES: EmailTemplatePreset[] = [
  {
    key: 'cold',
    label: 'Cold',
    subject: (c, cat) => `${c} — un mot à propos de ${cat}`,
    body: (c, cat, name) =>
      `${name ? `Bonjour ${name},\n\n` : 'Bonjour,\n\n'}` +
      `Nous avons repéré ${c} (${cat}) et nous pensons que Zentara pourrait vous faire gagner un temps précieux sur votre prospection et votre veille stratégique.\n\n` +
      `Seriez-vous disponible 10 minutes cette semaine pour un échange rapide ?\n\n` +
      `Bien cordialement,`,
  },
  {
    key: 'follow_up',
    label: 'Follow-up',
    subject: (c) => `Re: ${c} — suite à mon précédent message`,
    body: (c, cat, name) =>
      `${name ? `Bonjour ${name},\n\n` : 'Bonjour,\n\n'}` +
      `Je me permets de revenir vers vous au sujet de ${c} (${cat}) : mon précédent message est peut-être passé inaperçu dans une boîte bien remplie.\n\n` +
      `L'enjeu reste simple : automatiser la veille concurrentielle et la prospection pour gagner plusieurs heures par semaine.\n\n` +
      `Une réponse, même brève, me permettra de savoir si ce sujet vous intéresse.\n\n` +
      `Bien cordialement,`,
  },
  {
    key: 'breakup',
    label: 'Breakup',
    subject: (c) => `Dernier message au sujet de ${c}`,
    body: (c, cat, name) =>
      `${name ? `Bonjour ${name},\n\n` : 'Bonjour,\n\n'}` +
      `Je vous écris une dernière fois au sujet de ${c} (${cat}). Si vous n'êtes pas le bon interlocuteur ou si le sujet n'est pas d'actualité, dites-le-moi simplement : je cesserai de vous solliciter.\n\n` +
      `Si la situation change (nouvelle campagne, besoin de veille, équipe commerciale en croissance), pensez à nous.\n\n` +
      `Bien cordialement,`,
  },
];
