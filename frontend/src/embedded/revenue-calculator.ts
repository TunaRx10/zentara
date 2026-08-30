/**
 * revenue-calculator.ts — Calculateur de revenu potentiel pour les emails Zentara.
 *
 * À partir des données publiques d'une entreprise, estime :
 * 1. L'état actuel (trafic, leads, CA estimé)
 * 2. Ce que Zentara aurait généré si l'entreprise l'utilisait déjà
 * 3. Le delta (gain mensuel et annuel)
 *
 * Toutes les estimations sont CONSERVATIVES et transparentes — chaque
 * hypothèse est documentée pour que l'email reste crédible.
 */

// =====================================================================
// Types
// =====================================================================

export interface CompanyProfile {
  name: string;
  sector: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  companySize: string | null; // ex: '1-10', '11-50', '51-200', '201-1000', '1001+'
  foundedYear: number | null;
}

export interface ScoreProfile {
  opportunityScore: number;
  needScore: number;
  confidence: number;
  strengths: Array<{ label: string }>;
  weaknesses: Array<{ label: string }>;
}

export interface RevenueEstimate {
  // État actuel (estimé)
  currentMonthlyVisitors: number;
  currentMonthlyLeads: number;
  currentMonthlyQualified: number;
  currentMonthlyDeals: number;
  currentAvgDealSize: number;
  currentMonthlyRevenue: number;

  // Avec Zentara (projeté)
  projectedMonthlyLeads: number;
  projectedMonthlyQualified: number;
  projectedMonthlyDeals: number;
  projectedMonthlyRevenue: number;

  // Delta
  monthlyRevenueUplift: number;
  annualRevenueUplift: number;
  roiMultiple: number; // combien de fois le coût de Zentara est récupéré
  paybackMonths: number;

  // Hypothèses (pour transparence)
  assumptions: string[];
  confidenceLevel: 'low' | 'medium' | 'high';
}

// =====================================================================
// Benchmarks sectoriels (données publiques : SimilarWeb, Gartner, IBISWorld)
// =====================================================================

interface SectorBenchmark {
  avgConversionRate: number; // visiteurs → lead
  avgDealSizeLow: number; // ticket bas
  avgDealSizeHigh: number; // ticket haut
  leadToDealRate: number; // lead → client
  monthlyVisitorsPerEmployee: number; // trafic estimé par employé
  sectorLabel: string;
}

const SECTOR_BENCHMARKS: Record<string, SectorBenchmark> = {
  saas: {
    avgConversionRate: 0.035, avgDealSizeLow: 5000, avgDealSizeHigh: 50000,
    leadToDealRate: 0.08, monthlyVisitorsPerEmployee: 40, sectorLabel: 'SaaS B2B',
  },
  fintech: {
    avgConversionRate: 0.028, avgDealSizeLow: 8000, avgDealSizeHigh: 80000,
    leadToDealRate: 0.06, monthlyVisitorsPerEmployee: 35, sectorLabel: 'FinTech',
  },
  healthtech: {
    avgConversionRate: 0.025, avgDealSizeLow: 10000, avgDealSizeHigh: 120000,
    leadToDealRate: 0.05, monthlyVisitorsPerEmployee: 30, sectorLabel: 'HealthTech',
  },
  ecommerce: {
    avgConversionRate: 0.04, avgDealSizeLow: 50, avgDealSizeHigh: 500,
    leadToDealRate: 0.15, monthlyVisitorsPerEmployee: 150, sectorLabel: 'E-commerce',
  },
  legal: {
    avgConversionRate: 0.03, avgDealSizeLow: 3000, avgDealSizeHigh: 30000,
    leadToDealRate: 0.1, monthlyVisitorsPerEmployee: 20, sectorLabel: 'Juridique',
  },
  realestate: {
    avgConversionRate: 0.02, avgDealSizeLow: 5000, avgDealSizeHigh: 50000,
    leadToDealRate: 0.07, monthlyVisitorsPerEmployee: 50, sectorLabel: 'Immobilier',
  },
  consulting: {
    avgConversionRate: 0.025, avgDealSizeLow: 8000, avgDealSizeHigh: 80000,
    leadToDealRate: 0.06, monthlyVisitorsPerEmployee: 25, sectorLabel: 'Conseil',
  },
  marketing: {
    avgConversionRate: 0.03, avgDealSizeLow: 3000, avgDealSizeHigh: 30000,
    leadToDealRate: 0.08, monthlyVisitorsPerEmployee: 60, sectorLabel: 'Marketing/Media',
  },
  manufacturing: {
    avgConversionRate: 0.015, avgDealSizeLow: 20000, avgDealSizeHigh: 200000,
    leadToDealRate: 0.04, monthlyVisitorsPerEmployee: 20, sectorLabel: 'Industrie',
  },
  education: {
    avgConversionRate: 0.02, avgDealSizeLow: 1000, avgDealSizeHigh: 15000,
    leadToDealRate: 0.08, monthlyVisitorsPerEmployee: 80, sectorLabel: 'Éducation',
  },
  retail: {
    avgConversionRate: 0.035, avgDealSizeLow: 30, avgDealSizeHigh: 300,
    leadToDealRate: 0.12, monthlyVisitorsPerEmployee: 200, sectorLabel: 'Retail',
  },
  default: {
    avgConversionRate: 0.025, avgDealSizeLow: 3000, avgDealSizeHigh: 30000,
    leadToDealRate: 0.07, monthlyVisitorsPerEmployee: 40, sectorLabel: 'Services B2B',
  },
};

// =====================================================================
// Mapping taille → effectif estimé
// =====================================================================

function estimateEmployees(size: string | null): number {
  if (!size) return 15;
  const s = size.toLowerCase();
  if (s.includes('1-10') || s.includes('micro') || s.includes('self')) return 5;
  if (s.includes('11-50') || s.includes('small') || s.includes('pme')) return 25;
  if (s.includes('51-200') || s.includes('medium') || s.includes('mid')) return 100;
  if (s.includes('201-1000') || s.includes('large')) return 500;
  if (s.includes('1001') || s.includes('enterprise') || s.includes('5000')) return 2000;
  // Try to parse numeric
  const nums = s.match(/\d+/g);
  if (nums && nums.length > 0) return Math.round(nums.reduce((a, b) => Number(a) + Number(b), 0) / nums.length);
  return 15;
}

// =====================================================================
// Détection du secteur
// =====================================================================

function detectSector(sector: string | null): SectorBenchmark {
  if (!sector) return SECTOR_BENCHMARKS.default;
  const s = sector.toLowerCase();
  if (s.includes('saas') || s.includes('software') || s.includes('logiciel') || s.includes('cloud')) return SECTOR_BENCHMARKS.saas;
  if (s.includes('fintech') || s.includes('finance') || s.includes('bank') || s.includes('banque') || s.includes('assur')) return SECTOR_BENCHMARKS.fintech;
  if (s.includes('health') || s.includes('santé') || s.includes('med') || s.includes('bio')) return SECTOR_BENCHMARKS.healthtech;
  if (s.includes('ecommerce') || s.includes('e-commerce') || s.includes('retail') || s.includes('vente')) return SECTOR_BENCHMARKS.ecommerce;
  if (s.includes('juridique') || s.includes('legal') || s.includes('avocat') || s.includes('law')) return SECTOR_BENCHMARKS.legal;
  if (s.includes('immo') || s.includes('real estate') || s.includes('property')) return SECTOR_BENCHMARKS.realestate;
  if (s.includes('conseil') || s.includes('consult') || s.includes('cabinet')) return SECTOR_BENCHMARKS.consulting;
  if (s.includes('market') || s.includes('pub') || s.includes('ad') || s.includes('média') || s.includes('media') || s.includes('com')) return SECTOR_BENCHMARKS.marketing;
  if (s.includes('industr') || s.includes('manufact') || s.includes('fabr') || s.includes('usine')) return SECTOR_BENCHMARKS.manufacturing;
  if (s.includes('éduc') || s.includes('educ') || s.includes('school') || s.includes('format') || s.includes('univers')) return SECTOR_BENCHMARKS.education;
  return SECTOR_BENCHMARKS.default;
}

// =====================================================================
// Calculateur principal
// =====================================================================

export function calculateRevenuePotential(
  company: CompanyProfile,
  scores: ScoreProfile,
  zentaraMonthlyCost = 490, // Zentara Intelligence Core
): RevenueEstimate {
  const benchmark = detectSector(company.sector);
  const employees = estimateEmployees(company.companySize);
  const hasWebsite = !!company.website;
  const hasContactInfo = !!(company.email || company.phone);
  const needScore = scores.needScore / 100 || 0.5;
  const oppScore = scores.opportunityScore / 100 || 0.5;
  const assumptions: string[] = [];

  // --- 1. État actuel estimé ---

  // Trafic mensuel : basé sur l'effectif × benchmark sectoriel
  let monthlyVisitors = employees * benchmark.monthlyVisitorsPerEmployee;
  if (!hasWebsite) monthlyVisitors = Math.round(monthlyVisitors * 0.3); // -70% sans site
  assumptions.push(`Trafic estimé : ${employees} collaborateurs × ${benchmark.monthlyVisitorsPerEmployee} visites/employé = ${monthlyVisitors} visites/mois`);

  // Leads : conversion visiteurs → lead
  let conversionRate = benchmark.avgConversionRate;
  if (!hasWebsite) conversionRate *= 0.4;
  if (!hasContactInfo) conversionRate *= 0.6;
  if (hasWebsite && hasContactInfo) conversionRate *= 1.2;
  const currentLeads = Math.max(1, Math.round(monthlyVisitors * conversionRate));
  assumptions.push(`Conversion visiteurs→lead : ${(conversionRate * 100).toFixed(1)}% → ${currentLeads} leads/mois`);

  // Leads qualifiés : ~20% des leads
  const qualifiedRate = 0.2;
  const currentQualified = Math.max(1, Math.round(currentLeads * qualifiedRate));
  assumptions.push(`Leads qualifiés : ${(qualifiedRate * 100).toFixed(0)}% des leads → ${currentQualified}/mois`);

  // Deals : taux de conversion lead→client sectoriel
  const dealRate = benchmark.leadToDealRate;
  const currentDeals = Math.max(0, Math.round(currentQualified * dealRate));
  assumptions.push(`Taux de closing : ${(dealRate * 100).toFixed(1)}% → ${currentDeals} deals/mois`);

  // Deal size : entre low et high selon la présence digitale
  let dealSizeFactor = 0.3; // bas par défaut (pas de site, pas de contact)
  if (hasWebsite && hasContactInfo) dealSizeFactor = 0.6;
  if (hasWebsite && hasContactInfo && employees > 50) dealSizeFactor = 0.8;
  const avgDealSize = Math.round(benchmark.avgDealSizeLow + (benchmark.avgDealSizeHigh - benchmark.avgDealSizeLow) * dealSizeFactor);
  assumptions.push(`Panier moyen estimé : ${avgDealSize.toLocaleString('fr-FR')} € (benchmark ${benchmark.sectorLabel})`);

  const currentMonthlyRevenue = currentDeals * avgDealSize;

  // --- 2. Avec Zentara (projeté) ---

  // Améliorations Zentara :
  // - Détection de leads : +150% (scraping + LinkedIn + scoring)
  // - Qualification : +80% (scoring intelligent, priorisation)
  // - Conversion : +40% (emails personnalisés, outreach automatisé)
  // Le tout pondéré par le need_score (plus le besoin est élevé, plus l'impact est fort)

  const leadMultiplier = 1 + (1.5 * needScore); // 1x à 2.5x
  const qualMultiplier = 1 + (0.8 * needScore); // 1x à 1.8x
  const convMultiplier = 1 + (0.4 * oppScore);  // 1x à 1.4x

  const projectedLeads = Math.round(currentLeads * leadMultiplier);
  const projectedQualified = Math.round(currentQualified * qualMultiplier);
  const projectedDeals = Math.round(currentDeals * convMultiplier);

  // Avec Zentara, le panier moyen augmente aussi (meilleur ciblage → deals plus gros)
  const projectedDealSize = Math.round(avgDealSize * (1 + 0.15 * oppScore));
  const projectedMonthlyRevenue = projectedDeals * projectedDealSize;

  assumptions.push(`Impact Zentara : leads ×${leadMultiplier.toFixed(1)}, qualification ×${qualMultiplier.toFixed(1)}, conversion ×${convMultiplier.toFixed(1)}`);

  // --- 3. Delta ---
  const monthlyUplift = projectedMonthlyRevenue - currentMonthlyRevenue;
  const annualUplift = monthlyUplift * 12;
  const annualCost = zentaraMonthlyCost * 12;
  const roiMultiple = annualUplift > 0 ? Math.round((annualUplift / annualCost) * 10) / 10 : 0;
  const paybackMonths = monthlyUplift > 0 ? Math.ceil(zentaraMonthlyCost / monthlyUplift) : 999;

  // --- 4. Niveau de confiance ---
  let confidenceLevel: 'low' | 'medium' | 'high' = 'medium';
  if (hasWebsite && hasContactInfo && employees > 20 && company.sector) confidenceLevel = 'high';
  else if (!hasWebsite && !company.sector) confidenceLevel = 'low';

  return {
    currentMonthlyVisitors: monthlyVisitors,
    currentMonthlyLeads: currentLeads,
    currentMonthlyQualified: currentQualified,
    currentMonthlyDeals: currentDeals,
    currentAvgDealSize: avgDealSize,
    currentMonthlyRevenue,
    projectedMonthlyLeads: projectedLeads,
    projectedMonthlyQualified: projectedQualified,
    projectedMonthlyDeals: projectedDeals,
    projectedMonthlyRevenue,
    monthlyRevenueUplift: monthlyUplift,
    annualRevenueUplift: annualUplift,
    roiMultiple,
    paybackMonths,
    assumptions,
    confidenceLevel,
  };
}

/**
 * Formatte le potentiel de revenu en texte pour les emails.
 */
export function formatRevenueForEmail(est: RevenueEstimate): {
  headline: string;
  body: string;
  table: string;
} {
  const fmt = (n: number) => n.toLocaleString('fr-FR');
  const fmtEur = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M€`;
    if (n >= 1000) return `${(n / 1000).toFixed(0)} k€`;
    return `${n} €`;
  };

  const headline = est.annualRevenueUplift > 0
    ? `Potentiel estimé : +${fmtEur(est.annualRevenueUplift)}/an de revenu additionnel`
    : 'Potentiel en cours d\'estimation';

  const body = `
Voici ce que je vois pour votre situation actuelle :
• Trafic estimé : ~${fmt(est.currentMonthlyVisitors)} visites/mois
• Leads actuels : ~${fmt(est.currentMonthlyLeads)}/mois → ${fmt(est.currentMonthlyDeals)} deals/mois
• CA mensuel estimé : ~${fmtEur(est.currentMonthlyRevenue)}

Avec Zentara (détection + scoring + emails) :
• Leads : ${fmt(est.currentMonthlyLeads)} → ${fmt(est.projectedMonthlyLeads)}/mois (+${Math.round((est.projectedMonthlyLeads / est.currentMonthlyLeads - 1) * 100)}%)
• Deals : ${fmt(est.currentMonthlyDeals)} → ${fmt(est.projectedMonthlyDeals)}/mois (+${Math.round((est.projectedMonthlyDeals / Math.max(1, est.currentMonthlyDeals) - 1) * 100)}%)
• CA mensuel : ${fmtEur(est.currentMonthlyRevenue)} → ${fmtEur(est.projectedMonthlyRevenue)}
• Gain annuel : +${fmtEur(est.annualRevenueUplift)} (ROI ${est.roiMultiple}x, remboursé en ${est.paybackMonths} mois)
`.trim();

  const table = `
| Métrique | Actuel | Avec Zentara |
|---|---|---|
| Visites/mois | ${fmt(est.currentMonthlyVisitors)} | ${fmt(est.currentMonthlyVisitors)} |
| Leads/mois | ${fmt(est.currentMonthlyLeads)} | **${fmt(est.projectedMonthlyLeads)}** |
| Deals/mois | ${fmt(est.currentMonthlyDeals)} | **${fmt(est.projectedMonthlyDeals)}** |
| CA/mois | ${fmtEur(est.currentMonthlyRevenue)} | **${fmtEur(est.projectedMonthlyRevenue)}** |
| CA/an | ${fmtEur(est.currentMonthlyRevenue * 12)} | **${fmtEur(est.projectedMonthlyRevenue * 12)}** |
`.trim();

  return { headline, body, table };
}