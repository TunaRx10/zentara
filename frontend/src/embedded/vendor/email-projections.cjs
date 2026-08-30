/**
 * email-projections.cjs — Extension des templates email avec projections revenus/risques.
 * 
 * Ajoute aux templates existants :
 * - Section projection_revenue : bloc visuel CA actuel → CA projeté
 * - Section risk_analysis : risques identifiés + impact + mitigation
 * - Section roi_summary : ROI, payback, gain annuel
 * - Nouveaux templates : value_proposal, roi_report
 * 
 * Compatible avec le système de templates existant (renderEmailTemplate).
 */
'use strict';

// ============================================================================
// Nouveaux templates avec projections
// ============================================================================

const PROJECTION_TEMPLATES = [
  {
    id: 'value_proposal',
    label: 'Proposition de valeur chiffrée',
    description: 'Email avec projection revenus détaillée et ROI calculé automatiquement.',
    subject_default: '{{ company_name }} — Projection +{{ revenue_uplift_yearly | "XX" }}k€/an',
    variables: [
      { key: 'recipient_first_name', label: 'Prénom', default: '' },
      { key: 'recipient_last_name', label: 'Nom', default: '' },
      { key: 'company_name', label: 'Entreprise', default: '' },
      { key: 'company_sector', label: 'Secteur', default: '' },
      // Current state
      { key: 'current_monthly_leads', label: 'Leads actuels/mois', default: '0' },
      { key: 'current_monthly_deals', label: 'Deals actuels/mois', default: '0' },
      { key: 'current_monthly_revenue', label: 'CA actuel/mois (€)', default: '0' },
      // Projected state
      { key: 'projected_monthly_leads', label: 'Leads projetés/mois', default: '0' },
      { key: 'projected_monthly_deals', label: 'Deals projetés/mois', default: '0' },
      { key: 'projected_monthly_revenue', label: 'CA projeté/mois (€)', default: '0' },
      // ROI
      { key: 'revenue_uplift_monthly', label: 'Gain mensuel (€)', default: '0' },
      { key: 'revenue_uplift_yearly', label: 'Gain annuel (€)', default: '0' },
      { key: 'roi_multiple', label: 'ROI x', default: '0' },
      { key: 'payback_months', label: 'Payback (mois)', default: '0' },
      { key: 'confidence_level', label: 'Niveau de confiance', default: 'medium' },
      // Risks
      { key: 'risk_1', label: 'Risque 1', default: '' },
      { key: 'risk_1_impact', label: 'Impact risque 1', default: 'medium' },
      { key: 'risk_1_mitigation', label: 'Mitigation risque 1', default: '' },
      { key: 'risk_2', label: 'Risque 2', default: '' },
      { key: 'risk_2_impact', label: 'Impact risque 2', default: 'medium' },
      { key: 'risk_2_mitigation', label: 'Mitigation risque 2', default: '' },
      // CTA
      { key: 'cta_text', label: 'Texte CTA', default: 'Voir la projection complète' },
      { key: 'cta_url', label: 'URL CTA', default: 'https://zentara.app/r/' },
      { key: 'sender_name', label: 'Signataire', default: "L'équipe Zentara" },
      { key: 'sender_role', label: 'Rôle', default: 'Enterprise Intelligence' },
    ],
    sections: ['greeting', 'value_hook', 'projection_revenue', 'risk_analysis', 'roi_summary', 'cta', 'signature'],
    has_projections: true,
  },
  {
    id: 'roi_report',
    label: 'Rapport ROI détaillé',
    description: 'Rapport post-analyse avec projections, risques et plan d\'action.',
    subject_default: 'Rapport ROI — {{ company_name }} | Zentara',
    variables: [
      { key: 'recipient_first_name', label: 'Prénom', default: '' },
      { key: 'recipient_last_name', label: 'Nom', default: '' },
      { key: 'company_name', label: 'Entreprise', default: '' },
      { key: 'company_sector', label: 'Secteur', default: '' },
      { key: 'analysis_date', label: 'Date analyse', default: '' },
      // Current state
      { key: 'current_monthly_visitors', label: 'Visiteurs actuels/mois', default: '0' },
      { key: 'current_monthly_leads', label: 'Leads actuels/mois', default: '0' },
      { key: 'current_monthly_deals', label: 'Deals actuels/mois', default: '0' },
      { key: 'current_monthly_revenue', label: 'CA actuel/mois (€)', default: '0' },
      // Projected state
      { key: 'projected_monthly_visitors', label: 'Visiteurs projetés/mois', default: '0' },
      { key: 'projected_monthly_leads', label: 'Leads projetés/mois', default: '0' },
      { key: 'projected_monthly_deals', label: 'Deals projetés/mois', default: '0' },
      { key: 'projected_monthly_revenue', label: 'CA projeté/mois (€)', default: '0' },
      // ROI
      { key: 'revenue_uplift_monthly', label: 'Gain mensuel (€)', default: '0' },
      { key: 'revenue_uplift_yearly', label: 'Gain annuel (€)', default: '0' },
      { key: 'roi_multiple', label: 'ROI x', default: '0' },
      { key: 'payback_months', label: 'Payback (mois)', default: '0' },
      { key: 'confidence_level', label: 'Niveau de confiance', default: 'medium' },
      // Risks (up to 3)
      { key: 'risk_1', label: 'Risque 1', default: '' },
      { key: 'risk_1_impact', label: 'Impact risque 1', default: 'medium' },
      { key: 'risk_1_mitigation', label: 'Mitigation risque 1', default: '' },
      { key: 'risk_2', label: 'Risque 2', default: '' },
      { key: 'risk_2_impact', label: 'Impact risque 2', default: 'medium' },
      { key: 'risk_2_mitigation', label: 'Mitigation risque 2', default: '' },
      { key: 'risk_3', label: 'Risque 3', default: '' },
      { key: 'risk_3_impact', label: 'Impact risque 3', default: 'medium' },
      { key: 'risk_3_mitigation', label: 'Mitigation risque 3', default: '' },
      // Action plan
      { key: 'action_1', label: 'Action 1', default: '' },
      { key: 'action_1_owner', label: 'Responsable action 1', default: '' },
      { key: 'action_1_deadline', label: 'Deadline action 1', default: '' },
      { key: 'action_2', label: 'Action 2', default: '' },
      { key: 'action_2_owner', label: 'Responsable action 2', default: '' },
      { key: 'action_2_deadline', label: 'Deadline action 2', default: '' },
      { key: 'action_3', label: 'Action 3', default: '' },
      { key: 'action_3_owner', label: 'Responsable action 3', default: '' },
      { key: 'action_3_deadline', label: 'Deadline action 3', default: '' },
      // CTA
      { key: 'cta_text', label: 'Texte CTA', default: 'Planifier la prochaine étape' },
      { key: 'cta_url', label: 'URL CTA', default: 'https://calendly.com/zentara-demo' },
      { key: 'sender_name', label: 'Signataire', default: "L'équipe Zentara" },
      { key: 'sender_role', label: 'Rôle', default: 'Enterprise Intelligence' },
    ],
    sections: ['greeting', 'report_header', 'projection_revenue', 'risk_analysis', 'action_plan', 'roi_summary', 'cta', 'signature'],
    has_projections: true,
  },
];

// ============================================================================
// Rendu des sections de projection
// ============================================================================

function formatEur(value) {
  const num = parseInt(value, 10) || 0;
  if (num >= 1000000) return (num / 1000000).toFixed(1) + ' M€';
  if (num >= 1000) return (num / 1000).toFixed(0) + ' k€';
  return num.toLocaleString('fr-FR') + ' €';
}

function formatNum(value) {
  const num = parseInt(value, 10) || 0;
  return num.toLocaleString('fr-FR');
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getConfidenceBadge(level) {
  const config = {
    high: { label: 'Confiance élevée', color: '#10b981', bg: '#ecfdf5' },
    medium: { label: 'Confiance modérée', color: '#f59e0b', bg: '#fffbeb' },
    low: { label: 'Confiance faible', color: '#ef4444', bg: '#fef2f2' },
  };
  const c = config[level] || config.medium;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;color:${c.color};background:${c.bg};border:1px solid ${c.color}33;">${c.label}</span>`;
}

function getImpactBadge(impact) {
  const config = {
    high: { label: 'Impact élevé', color: '#ef4444', bg: '#fef2f2' },
    medium: { label: 'Impact modéré', color: '#f59e0b', bg: '#fffbeb' },
    low: { label: 'Impact faible', color: '#10b981', bg: '#ecfdf5' },
  };
  const c = config[impact] || config.medium;
  return `<span style="display:inline-block;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;color:${c.color};background:${c.bg};">${c.label}</span>`;
}

// ------------------------------------------------------------------
// Section : value_hook — Accroche valeur
// ------------------------------------------------------------------
function renderValueHook(vars) {
  const firstName = escapeHtml(vars.recipient_first_name || 'là');
  const company = escapeHtml(vars.company_name || 'votre entreprise');
  const yearly = formatEur(vars.revenue_uplift_yearly);

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr>
    <td style="padding:20px;background:linear-gradient(135deg,#f0fdf4 0%,#ecfdf5 100%);border-radius:12px;border:1px solid #bbf7d0;">
      <p style="margin:0 0 8px;font-size:13px;color:#166534;font-weight:600;">Bonjour ${firstName},</p>
      <p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.6;">
        Notre analyse de <strong>${company}</strong> révèle un potentiel de croissance significatif.
      </p>
      <div style="display:inline-block;padding:8px 16px;background:#10b981;border-radius:8px;color:#ffffff;font-size:16px;font-weight:800;">
        +${yearly}/an
      </div>
      <p style="margin:8px 0 0;font-size:11px;color:#6b7280;">Gain estimé avec Zentara · ${getConfidenceBadge(vars.confidence_level)}</p>
    </td>
  </tr>
</table>`;
}

// ------------------------------------------------------------------
// Section : projection_revenue — Bloc projection revenus
// ------------------------------------------------------------------
function renderProjectionRevenue(vars) {
  const currentLeads = formatNum(vars.current_monthly_leads);
  const projectedLeads = formatNum(vars.projected_monthly_leads);
  const currentDeals = formatNum(vars.current_monthly_deals);
  const projectedDeals = formatNum(vars.projected_monthly_deals);
  const currentRevenue = formatEur(vars.current_monthly_revenue);
  const projectedRevenue = formatEur(vars.projected_monthly_revenue || vars.projected_monthly_revenue);
  const monthlyUplift = formatEur(vars.revenue_uplift_monthly);
  const yearlyUplift = formatEur(vars.revenue_uplift_yearly);

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
  <tr>
    <td style="padding:20px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
      <p style="margin:0 0 16px;font-size:14px;font-weight:700;color:#111827;">📊 Projection financière</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr style="background:#f9fafb;">
          <td width="34%" style="padding:10px 12px;font-size:11px;font-weight:600;color:#6b7280;border-radius:6px 0 0 6px;">Métrique</td>
          <td width="33%" style="padding:10px 12px;font-size:11px;font-weight:600;color:#6b7280;text-align:center;">Actuel</td>
          <td width="33%" style="padding:10px 12px;font-size:11px;font-weight:600;color:#10b981;text-align:center;border-radius:0 6px 6px 0;">Avec Zentara</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;font-size:12px;color:#374151;border-top:1px solid #f3f4f6;">Leads/mois</td>
          <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#6b7280;text-align:center;border-top:1px solid #f3f4f6;text-decoration:line-through;">${currentLeads}</td>
          <td style="padding:10px 12px;font-size:13px;font-weight:800;color:#10b981;text-align:center;border-top:1px solid #f3f4f6;">${projectedLeads}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;font-size:12px;color:#374151;border-top:1px solid #f3f4f6;">Deals/mois</td>
          <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#6b7280;text-align:center;border-top:1px solid #f3f4f6;text-decoration:line-through;">${currentDeals}</td>
          <td style="padding:10px 12px;font-size:13px;font-weight:800;color:#10b981;text-align:center;border-top:1px solid #f3f4f6;">${projectedDeals}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;font-size:12px;color:#374151;border-top:1px solid #f3f4f6;">CA/mois</td>
          <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#6b7280;text-align:center;border-top:1px solid #f3f4f6;text-decoration:line-through;">${currentRevenue}</td>
          <td style="padding:10px 12px;font-size:13px;font-weight:800;color:#10b981;text-align:center;border-top:1px solid #f3f4f6;">${projectedRevenue}</td>
        </tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
        <tr>
          <td style="padding:12px;background:#f0fdf4;border-radius:8px;text-align:center;">
            <p style="margin:0;font-size:11px;color:#6b7280;">Gain estimé</p>
            <p style="margin:4px 0 0;font-size:18px;font-weight:800;color:#10b981;">+${monthlyUplift}/mois · +${yearlyUplift}/an</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

// ------------------------------------------------------------------
// Section : risk_analysis — Analyse des risques
// ------------------------------------------------------------------
function renderRiskAnalysis(vars) {
  const risks = [];
  if (vars.risk_1) risks.push({ risk: vars.risk_1, impact: vars.risk_1_impact, mitigation: vars.risk_1_mitigation });
  if (vars.risk_2) risks.push({ risk: vars.risk_2, impact: vars.risk_2_impact, mitigation: vars.risk_2_mitigation });
  if (vars.risk_3) risks.push({ risk: vars.risk_3, impact: vars.risk_3_impact, mitigation: vars.risk_3_mitigation });

  if (risks.length === 0) return '';

  const rows = risks.map((r) => `
<tr>
  <td style="padding:10px 12px;font-size:12px;color:#374151;border-top:1px solid #f3f4f6;">${escapeHtml(r.risk)}</td>
  <td style="padding:10px 12px;text-align:center;border-top:1px solid #f3f4f6;">${getImpactBadge(r.impact)}</td>
  <td style="padding:10px 12px;font-size:11px;color:#6b7280;border-top:1px solid #f3f4f6;">${escapeHtml(r.mitigation)}</td>
</tr>`).join('');

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
  <tr>
    <td style="padding:20px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
      <p style="margin:0 0 16px;font-size:14px;font-weight:700;color:#111827;">⚠️ Analyse des risques</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr style="background:#f9fafb;">
          <td width="34%" style="padding:10px 12px;font-size:11px;font-weight:600;color:#6b7280;border-radius:6px 0 0 6px;">Risque</td>
          <td width="20%" style="padding:10px 12px;font-size:11px;font-weight:600;color:#6b7280;text-align:center;">Impact</td>
          <td width="46%" style="padding:10px 12px;font-size:11px;font-weight:600;color:#6b7280;border-radius:0 6px 6px 0;">Mitigation</td>
        </tr>
        ${rows}
      </table>
    </td>
  </tr>
</table>`;
}

// ------------------------------------------------------------------
// Section : roi_summary — Résumé ROI
// ------------------------------------------------------------------
function renderRoiSummary(vars) {
  const roi = vars.roi_multiple || '0';
  const payback = vars.payback_months || '0';
  const yearly = formatEur(vars.revenue_uplift_yearly);

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
  <tr>
    <td style="padding:20px;background:linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%);border-radius:12px;border:1px solid #bfdbfe;">
      <p style="margin:0 0 16px;font-size:14px;font-weight:700;color:#1e40af;">💰 Retour sur investissement</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="33%" style="text-align:center;padding:8px;">
            <p style="margin:0;font-size:24px;font-weight:800;color:#1e40af;">${roi}x</p>
            <p style="margin:4px 0 0;font-size:10px;color:#6b7280;">ROI sur 12 mois</p>
          </td>
          <td width="33%" style="text-align:center;padding:8px;border-left:1px solid #bfdbfe;">
            <p style="margin:0;font-size:24px;font-weight:800;color:#1e40af;">${payback} mois</p>
            <p style="margin:4px 0 0;font-size:10px;color:#6b7280;">Payback</p>
          </td>
          <td width="33%" style="text-align:center;padding:8px;border-left:1px solid #bfdbfe;">
            <p style="margin:0;font-size:24px;font-weight:800;color:#1e40af;">${yearly}</p>
            <p style="margin:4px 0 0;font-size:10px;color:#6b7280;">Gain annuel</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

// ------------------------------------------------------------------
// Section : action_plan — Plan d'action
// ------------------------------------------------------------------
function renderActionPlan(vars) {
  const actions = [];
  if (vars.action_1) actions.push({ action: vars.action_1, owner: vars.action_1_owner, deadline: vars.action_1_deadline });
  if (vars.action_2) actions.push({ action: vars.action_2, owner: vars.action_2_owner, deadline: vars.action_2_deadline });
  if (vars.action_3) actions.push({ action: vars.action_3, owner: vars.action_3_owner, deadline: vars.action_3_deadline });

  if (actions.length === 0) return '';

  const rows = actions.map((a, i) => `
<tr>
  <td style="padding:10px 12px;font-size:12px;color:#374151;border-top:1px solid #f3f4f6;">
    <strong>${i + 1}.</strong> ${escapeHtml(a.action)}
  </td>
  <td style="padding:10px 12px;font-size:11px;color:#6b7280;text-align:center;border-top:1px solid #f3f4f6;">${escapeHtml(a.owner)}</td>
  <td style="padding:10px 12px;font-size:11px;color:#f59e0b;text-align:center;border-top:1px solid #f3f4f6;font-weight:600;">${escapeHtml(a.deadline)}</td>
</tr>`).join('');

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
  <tr>
    <td style="padding:20px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
      <p style="margin:0 0 16px;font-size:14px;font-weight:700;color:#111827;">🎯 Plan d'action</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr style="background:#f9fafb;">
          <td width="50%" style="padding:10px 12px;font-size:11px;font-weight:600;color:#6b7280;border-radius:6px 0 0 6px;">Action</td>
          <td width="25%" style="padding:10px 12px;font-size:11px;font-weight:600;color:#6b7280;text-align:center;">Responsable</td>
          <td width="25%" style="padding:10px 12px;font-size:11px;font-weight:600;color:#6b7280;text-align:center;border-radius:0 6px 6px 0;">Deadline</td>
        </tr>
        ${rows}
      </table>
    </td>
  </tr>
</table>`;
}

// ------------------------------------------------------------------
// Section : report_header — En-tête rapport
// ------------------------------------------------------------------
function renderReportHeader(vars) {
  const company = escapeHtml(vars.company_name || 'Entreprise');
  const date = escapeHtml(vars.analysis_date || new Date().toLocaleDateString('fr-FR'));
  const sector = escapeHtml(vars.company_sector || '');

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr>
    <td style="padding:16px 20px;background:#111827;border-radius:12px 12px 0 0;">
      <p style="margin:0;font-size:16px;font-weight:800;color:#ffffff;">Rapport d'analyse</p>
      <p style="margin:4px 0 0;font-size:12px;color:#9ca3af;">${company}${sector · ' · ' + sector} · ${date}</p>
    </td>
  </tr>
</table>`;
}

// ============================================================================
// Export
// ============================================================================

module.exports = {
  PROJECTION_TEMPLATES,
  renderValueHook,
  renderProjectionRevenue,
  renderRiskAnalysis,
  renderRoiSummary,
  renderActionPlan,
  renderReportHeader,
  formatEur,
  formatNum,
};
