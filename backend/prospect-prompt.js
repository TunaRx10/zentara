// prospect-prompt.js — Moteur d'analyse Zentara v2 (DETERMINISTE).
//
// Changements majeurs vs v1 :
//   • L'IA NE DÉCIDE PLUS les scores. Tous les chiffres (need_score,
//     opportunity_score, confidence, urgency, contact_risk) sont calculés
//     EN AMONT par scoring-engine.js à partir d'un NormalizedInput hashé.
//   • La seule chose que produit l'IA, c'est la NARRATION :
//       - résumé (2-3 phrases)
//       - insights (signaux forts tirés des forces/faiblesses calculées)
//       - recommendations (actions concrètes)
//       - risks (risques identifiés)
//       - email HTML premium (objet, html, body, cta_url)
//       - product_estimate (depuis le catalogue Zentara — prix factuel)
//       - profile (paragraphe fluide des 34 champs historiques)
//   • Le prompt reçoit les critères de scoring en entrée → cohérent avec
//     la vérité mathématique, pas d'invention ni d'aléatoire.
//
// Cette fonction retourne un prompt avec `messages` (system + user).
// La conversation AI est déterministe dans sa structure ; seule la prose varie.
'use strict';

const { CATEGORIES } = require('./scoring-criteria');

const ZENTARA_CATALOG = [
  { id: 'core', name: 'Zentara Intelligence Core', price_eur: 490, tier: 'veille' },
  { id: 'pro',  name: 'Zentara Intelligence Pro',  price_eur: 990, tier: 'pro' },
  { id: 'enterprise', name: 'Zentara Enterprise',   price_eur: 2900, tier: 'dedicated' },
];

// --------------------------------------------------------------------------
// Framework (system prompt) — INTERPRÉTATION SEULE.
// --------------------------------------------------------------------------

const FRAMEWORK = `Tu es l'analyste senior de Zentara — un cabinet d'intelligence commerciale spécialisé dans l'analyse d'entreprises B2B.

MISSION
Produis une analyse PROFESSIONNELLE, DÉTAILLÉE et STRUCTURÉE, du niveau d'un
cabinet de conseil. Chaque affirmation doit être tracée, sourcée et qualifiée.
Pas de banalité, pas de remplissage : uniquement des constats exploitables,
hiérarchisés par impact.

RÈGLE FONDAMENTALE — LES CHIFFRES
Tous les CHIFFRES de cette analyse ont déjà été calculés déterministe­ment
en amont par le moteur de scoring. Tu ne dois JAMAIS inventer, recalculer ou
modifier un score. Tu commentes, interprètes et hiérarchises, c'est tout.
Les seuls chiffres que tu produis toi-même sont :
  • les estimations financières PRUDENTES (toujours présentées comme telles) ;
  • les pourcentages d'impact et le ROI, marqués « estimation » ;
  • les prix produits, qui doivent être EXACTEMENT ceux du catalogue.

Tu reçois en entrée :
  1. Un objet "scoring" qui contient :
       • aggregate : need_score, opportunity_score, confidence,
                     urgency, contact_risk, category_scores (par catégorie)
       • strengths : 5 critères les plus forts (avec evidence)
       • weaknesses : 5 critères les plus faibles (avec evidence)
       • missing_data : champs critiques sans observation
  2. Un objet "profile" qui contient les 34 champs observables du framework
     (site web scrapé, identité, présence digitale, réputation, etc.).
  3. Un catalogue de produits Zentara (prix FIXES — tu n'inventes AUCUN prix).

RIGUEUR INTELLECTUELLE (non négociable)
• Qualifie CHAQUE affirmation :
    [FAIT]       = observé dans les données fournies (cite la source exacte).
    [DÉDUCTION]  = conséquence logique des faits (explique le raisonnement).
    [HYPOTHÈSE]  = supposition plausible mais non vérifiée (à confirmer).
• Derrière chaque [FAIT], cite l'élément de preuve (critère / champ du profil).
• Donnée absente → écris « Non disponible » et abaisse ton niveau d'affirmation.
• Ne JAMAIS inventer un chiffre, un client, un revenu, une perte ou un concurrent.
• Ne JAMAIS garantir un résultat financier. « -30 % de churn » est INTERDIT ;
  « une réduction de churn valorisée ≈ X €/mois si le levier est traité » est correct.
• Pas de superlatifs marketing ("leader", "n°1", "révolutionnaire", "garanti").
• Hiérarchise : le lecteur pressé doit comprendre l'essentiel en lisant
  uniquement les 2-3 premières lignes de chaque section.

ANATOMIE DU RAPPORT (obligatoire, dans cet ordre, titres « ## »)

## SYNTHÈSE EXÉCUTIVE
3-5 phrases. Réponds : qui est l'entreprise, quel est SON problème n°1
(le plus coûteux), ce que Zentara recommande, et le verdict.

## PROFIL DE L'ENTREPRISE
Paragraphe fluide regroupant :
  contexte (nom, secteur, sous-secteur, localisation, taille, création),
  présence digitale (site, état, mobile, vitesse, CTA, formulaire, réservation,
  paiement, chatbot, CRM),
  réputation (Google Business, note, avis, tendances, problèmes, réponses),
  réseaux sociaux (plateformes, activité, engagement),
  marketing (SEO local, mots-clés, publicité, contenu).
N'écris QUE ce qui figure dans « profile ». Chaque donnée citée est un [FAIT].
N'invente JAMAIS un champ absent.

## ANALYSE (diagnostic structuré)
Pour CHAQUE catégorie du scoring fournie, une sous-partie :
  - score de la catégorie (rappel chiffré — ne pas modifier),
  - points forts (avec preuve),
  - points faibles (avec preuve),
  - impact business probable (qualifié [DÉDUCTION] / [HYPOTHÈSE]),
  - priorité (P0 urgent / P1 important / P2 à surveiller).

## IMPACT FINANCIER
Quantifie PRUDEMMENT le coût du problème principal, au format EXACT :
  - Revenu potentiellement non capturé estimé : <montant> €/an (estimation prudente)
Explique le raisonnement (facteurs × valeur × probabilité) en 2-3 lignes.
Si les données sont insuffisantes : « Estimation impossible avec les données
disponibles » + explique quelles données manquent.

## ESTIMATION PRODUIT & IMPACT
Reprends le produit recommandé (catalogue), son prix, l'impact estimé et le ROI
12 mois. Justifie le choix produit ↔ problème détecté en 2-3 phrases.

## ÉVALUATION COMMERCIALE
Rappelle les scores déterministes au format EXACT (un par ligne) :
  - Score du besoin : {need_score}/100
  - Score d'opportunité commerciale : {opportunity_score}/100
  - Urgence du problème : {urgence}
  - Risque de contact : {contact_risk}
  - Niveau de confiance : {confidence}/100
Puis VERDICT final : GO / NO-GO / GO SOUS CONDITIONS + 1 phrase de justification.

## RECOMMANDATIONS PRIORISÉES
3 à 5 actions concrètes classées par impact, au format :
  [P0|P1|P2] Action — pourquoi maintenant — résultat attendu (prudent).

## RISQUES & LIMITES
Les risques de la recommandation ET les limites de l'analyse (données manquantes,
confiance faible, hypothèses non vérifiées). Ne pas minimiser.

## EMAIL
Reprends l'email personnalisé en texte lisible : une ligne « Objet : … » puis le
corps. (L'HTML complet va uniquement dans le champ JSON email_html.)

## PROCHAINE ACTION
LA toute prochaine étape concrète (une seule) : interlocuteur visé + canal + timing.

PRODUIT ZENTARA RECOMMANDÉ
• Choisis UN seul produit parmi exactement : Zentara Intelligence Core (490 €/mois),
  Zentara Intelligence Pro (990 €/mois), Zentara Enterprise (2 900 €/mois).
• Le prix DOIT être exactement celui du catalogue. Jamais un autre chiffre.
• Justifie en 2-3 phrases en reliant produit ↔ problème détecté.
• Impact estimé : estimation PRUDENTE en pourcentage 0-100. Ne jamais garantir.
• ROI 12 mois : estimation (valeur mensuelle du problème - prix) × 12,
  UNIQUEMENT si les données le permettent ; sinon produit présent mais impact_pct: 0.

EMAIL PERSONNALISÉ (HTML)
• Format HTML complet avec CSS inline uniquement (aucune feuille externe).
• Structure obligatoire :
   - Salutation ("Bonjour [Prénom] / Bonjour") — utilise le nom du prospect ou de
     l'entreprise si disponible, sinon reste générique mais PAS "Madame, Monsieur"
     rigide.
   - Présentation : 1 observation SPÉCIFIQUE (issue d'un strength réel, PAS d'une
     hypothèse présentée comme un fait).
   - Problématique : 1 problème principal identifié (strengths faibles),
     formulé prudemment.
   - Conséquences : 2-3 conséquences crédibles et prudentes.
   - Solution Zentara : 1-2 phrases, produit + impact.
   - CTA : bouton <a> violet #7C3AED, padding 12px 24px, radius 8px, texte
     "Planifier un échange" ou contextuel, lien vers https://calendly.com/zentara-demo
     (ou "réponse à cet email").
   - Signature humaine.
• Le but : OBTENIR UNE RÉPONSE. Pas une brochure.
• PAS DE JSON dans le corps de l'email. Email lisible et humain.

FORMAT DE SORTIE (obligatoire)
1. Rédige les 10 sections ci-dessus en texte Markdown léger (titres « ## »).
2. Termine par un bloc JSON dans une fence \`\`\`json ... \`\`\` avec exactement :
   {
     "summary": "résumé 2-3 phrases (prose, sans markdown)",
     "insights": ["...", "...", "..."],
     "recommendations": ["...", "...", "..."],
     "risks": ["...", "..."],
     "email_subject": "objet court, non-spammy",
     "email_html": "<div>html complet avec css inline</div>",
     "email_body": "version texte simple de l'email",
     "email_cta_url": "https://calendly.com/zentara-demo",
     "profile": { "1": "Nom de l'entreprise : X", ... }   // 34 champs
     "product_estimate": {
       "product": "Zentara Intelligence Pro",      // exactement catalogue
       "price_monthly_eur": 990,                  // exactement catalogue
       "impact_pct": 65,                          // 0-100 prudent
       "roi_12m_eur": 42000,                      // optionnel, 0 si impossible
       "justification": "...",
       "note": "Estimation prudente"
     }
   }
3. NE retourne AUCUN champ "scores" / "need_score" / "opportunity_score" /
   "urgency" / "contact_risk" / "confidence" — ces valeurs sont déjà calculées
   par le moteur déterministe et seront fusionnées côté serveur.
4. Si certaines données manquent et que tu ne peux pas faire d'estimation,
   tu mets quand même product_estimate avec impact_pct: 0 et justification :
   "Estimation produit impossible avec les données disponibles".`;

// Mapping legacy des 34 champs du framework
const FIELD_34_LABELS = {
  company_name: "1. Nom de l'entreprise",
  sector: "2. Secteur",
  subsector: "3. Sous-secteur",
  location: "4. Localisation",
  area_served: "5. Zone desservie",
  company_size: "6. Taille estimée",
  founded_year: "7. Année de création",
  website: "8. Site web",
  site_status: "9. État du site",
  mobile_quality: "10. Qualité mobile",
  site_speed: "11. Vitesse du site",
  main_cta: "12. CTA principal",
  contact_form: "13. Formulaire de contact",
  booking_quote: "14. Système de réservation ou de devis",
  payment_system: "15. Système de paiement",
  chatbot: "16. Chatbot",
  crm_detected: "17. CRM détecté",
  automations: "18. Automatisations détectées",
  google_business_profile: "19. Google Business Profile",
  google_rating: "20. Note Google",
  review_count: "21. Nombre d'avis",
  review_trends: "22. Tendances des avis",
  review_issues: "23. Problèmes récurrents dans les avis",
  review_response: "24. Réponse aux avis",
  facebook: "25. Facebook",
  instagram: "26. Instagram",
  linkedin: "27. LinkedIn",
  tiktok: "28. TikTok",
  social_activity: "29. Activité sociale",
  engagement: "30. Engagement estimé",
  local_seo: "31. SEO local",
  main_keywords: "32. Mots-clés principaux",
  ads_detected: "33. Publicité détectée",
  content_quality: "34. Qualité du contenu",
};

// --------------------------------------------------------------------------
// Construction du prompt utilisateur
// --------------------------------------------------------------------------

/**
 * Construit le prompt complet pour le LLM.
 * @param {object} data
 *   - entity : { id, name, sector, subsector, location, ... }
 *   - siteProfile : profil site 34 champs (legacy) + mobile + cta + ...
 *   - scoring : { aggregate, breakdown, strengths, weaknesses, missing_data }
 *   - productCatalog : liste constante ZENTARA_CATALOG
 */
function buildProspectPrompt(data) {
  const profile = buildLegacy34Profile(data.entity || {}, data.siteProfile || {});
  const scoring = data.scoring || {};
  const aggregate = scoring.aggregate || {};
  const strengths = (scoring.breakdown?.filter
    ? scoring.breakdown.filter((x) => x.direction === 'positive' && x.value > 0)
        .sort((a, b) => (b.value * b.weight) - (a.value * a.weight)).slice(0, 5)
    : scoring.strengths || []);
  const weaknesses = (scoring.breakdown?.filter
    ? scoring.breakdown.filter((x) => x.direction !== 'informational')
        .sort((a, b) => (a.value * a.weight) - (b.value * b.weight)).slice(0, 5)
    : scoring.weaknesses || []);

  const scoringBlock = renderScoringBlock(aggregate, strengths, weaknesses, scoring.missing_data || []);

  const profileBlock = renderProfileBlock34(profile);

  const catalogBlock = `
CATALOGUE PRODUITS ZENTARA (prix mensuels HT — JAMAIS d'autre prix) :
${(data.productCatalog || ZENTARA_CATALOG).map((p) =>
  `- ${p.name} : ${p.price_eur} €/mois (${p.tier})`).join('\n')}
`;

  return `${FRAMEWORK}
${catalogBlock}

PROFIL OBSERVÉ (34 champs du framework — issus des sources réelles) :
${profileBlock}

SCORING DÉTERMINISTE DÉJÀ CALCULÉ (interprète, ne recalcule pas) :
${scoringBlock}

TRACE DES DONNÉES UTILISÉES :
- input_hash : ${aggregate.input_hash || 'inconnu'}
- prompt_version : zentara-v2-deterministic
- confiance de l'analyse : ${aggregate.confidence ?? 0}/100
- urgence déduite des données : ${aggregate.urgency || 'indéterminée'}
- risque de contact estimé : ${aggregate.contact_risk || 'indéterminé'}

CONSIGNE
1. Rédige l'analyse complète en respectant EXACTEMENT l'« ANATOMIE DU RAPPORT »
   (10 sections, titres « ## », dans l'ordre).
2. Le PROFIL DE L'ENTREPRISE est un PARAGRAPHE FLUIDE — n'écris QUE ce qui figure
   dans « profile » ci-dessus ; ne mentionne JAMAIS un champ absent.
3. Les sections ÉVALUATION COMMERCIALE et IMPACT FINANCIER commentent les CHIFFRES
   fournis par le bloc scoring déterministe — tu ne peux pas proposer un score différent.
4. Termine par un bloc JSON conforme au format ci-dessus.`;
}

function renderScoringBlock(agg, strengths, weaknesses, missing) {
  const catLines = Object.entries(agg.category_scores || {})
    .map(([cat, score]) => `- ${cat} : ${score}/100`)
    .join('\n') || '- (aucune catégorie)';
  const sLines = strengths.map((s) =>
    `- [${s.id}] ${s.label} : value=${Number(s.value).toFixed(2)} weight=${Number(s.weight).toFixed(2)} — ${JSON.stringify(s.evidence)}`
  ).join('\n') || '- (aucune force notable)';
  const wLines = weaknesses.map((w) =>
    `- [${w.id}] ${w.label} : value=${Number(w.value).toFixed(2)} weight=${Number(w.weight).toFixed(2)} — ${JSON.stringify(w.evidence)}`
  ).join('\n') || '- (aucune faiblesse majeure)';
  const mLines = (missing || []).map((m) => `- ${m}`).join('\n') || '- (aucun)';

  return `
- need_score       : ${agg.need_score ?? 0}/100   (plus haut = besoin plus fort)
- opportunity_score: ${agg.opportunity_score ?? 0}/100   (plus haut = meilleure opportunité commerciale)
- confidence       : ${agg.confidence ?? 0}/100   (qualité des données utilisées)
- urgency          : ${agg.urgency || 'indéterminée'}
- contact_risk     : ${agg.contact_risk || 'indéterminé'}

Scores par catégorie (0-100) :
${catLines}

Top forces (à METTRE EN AVANT dans la narration) :
${sLines}

Top faiblesses (problèmes à EXPLIQUER) :
${wLines}

Données manquantes critiques (à déclarer comme "Non disponible") :
${mLines}

`;
}

function renderProfileBlock34(profile) {
  const lines = [];
  for (const key of Object.keys(FIELD_34_LABELS)) {
    const v = profile[key];
    if (v != null && String(v).trim() !== '') {
      lines.push(`- ${FIELD_34_LABELS[key]} : ${v}`);
    }
  }
  return lines.length ? lines.join('\n') : '- Aucune observation disponible.';
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Construit un profil 34-champs à partir de entity + siteProfile.
 *  Cible : produire un bloc lisible, compatible avec le framework legacy,
 *  sans inventer de données absentes. */
function buildLegacy34Profile(entity, site) {
  const p = { ...entityDefaults(entity) };
  if (!site || typeof site !== 'object') return p;

  // map site profile legacy → 34 champs
  if (site.url) p.website = site.url;
  p.site_status = site.reachable === true ? 'En ligne'
                : site.reachable === false ? 'Inaccessible' : 'Inconnu';
  p.mobile_quality = 'mobile_quality' in site ? `${Math.round((site.mobile_quality || 0) * 100)}/100` : (site.mobile?.responsive ? 'Responsive (viewport présent)' : null);
  p.site_speed = site.speed_ms != null ? `${site.speed_ms} ms (cible < 2000 ms)` : null;
  p.main_cta = site.main_cta || null;
  p.contact_form = site.contact_form ? 'Présent' : null;
  p.booking_quote = site.booking_quote || site.booking_url ? 'Présent' : null;
  p.payment_system = site.payment_system || null;
  p.chatbot = site.chatbot || null;
  p.crm_detected = site.crm_detected || null;
  p.automations = Array.isArray(site.automations) && site.automations.length
    ? site.automations.join(', ') : null;

  if (site.gbusiness) {
    p.google_business_profile = site.gbusiness.name || site.gbusiness.url || 'Présent';
    p.google_rating = (site.gbusiness.rating != null) ? `${site.gbusiness.rating}/5` : null;
    p.review_count = site.gbusiness.review_count || null;
    p.review_trends = site.gbusiness.trend === 'up' ? 'Hausse'
                    : site.gbusiness.trend === 'down' ? 'Baisse'
                    : site.gbusiness.trend === 'flat' ? 'Stable'
                    : null;
    p.review_response = (site.gbusiness.response_rate != null)
      ? `${Math.round(site.gbusiness.response_rate * 100)}%` : null;
    p.review_issues = Array.isArray(site.gbusiness.top_issues) && site.gbusiness.top_issues.length
      ? site.gbusiness.top_issues.join(', ') : null;
  }

  const handles = site.social?.handles || {};
  p.facebook = handles.facebook || null;
  p.instagram = handles.instagram || null;
  p.linkedin = handles.linkedin || null;
  p.tiktok = handles.tiktok || null;
  if (site.social) {
    p.social_activity = site.social.posts_per_week != null
      ? `${site.social.posts_per_week} posts/semaine` : null;
    p.engagement = site.social.engagement_rate != null
      ? `${(site.social.engagement_rate * 100).toFixed(1)}%` : null;
  }

  if (site.marketing) {
    p.local_seo = site.marketing.local_seo_score != null
      ? `${Math.round(site.marketing.local_seo_score * 100)}/100` : null;
    p.main_keywords = Array.isArray(site.marketing.main_keywords)
      ? site.marketing.main_keywords.slice(0, 10).join(', ') : null;
    p.ads_detected = Array.isArray(site.marketing.ads_platforms) && site.marketing.ads_platforms.length
      ? site.marketing.ads_platforms.join(', ') : null;
    p.content_quality = site.marketing.content_quality_score != null
      ? `${Math.round(site.marketing.content_quality_score * 100)}/100` : null;
  }

  return p;
}

function entityDefaults(e) {
  const out = {};
  if (e.name) out.company_name = e.name;
  if (e.sector) out.sector = e.sector;
  if (e.subsector || e.industry) out.subsector = e.subsector || e.industry;
  if (e.location) {
    out.location = typeof e.location === 'string'
      ? e.location
      : [e.location.city, e.location.country].filter(Boolean).join(', ') || null;
  }
  if (e.area_served) out.area_served = e.area_served;
  if (e.company_size || e.size) out.company_size = e.company_size || e.size;
  if (e.founded_year) out.founded_year = e.founded_year;
  // Champs purement dérivés — null si pas fournis.
  return out;
}

// --------------------------------------------------------------------------
// Parsing de la réponse IA
// --------------------------------------------------------------------------

/**
 * Extrait les champs narratifs de la réponse complète (sections + JSON final).
 * Note : la fonction NE TOUCHE PAS aux scores — ils viennent du moteur.
 */
function parseAnalysisResponse(content) {
  const { extractJson } = require('./ai');
  const p = extractJson(content) || {};

  return {
    summary: String(p.summary || '').trim() || (content || '').split(/\n\s*\n/)[0]?.slice(0, 500) || '',
    insights: Array.isArray(p.insights) ? p.insights.map(String).slice(0, 8) : [],
    recommendations: Array.isArray(p.recommendations) ? p.recommendations.map(String).slice(0, 8) : [],
    risks: Array.isArray(p.risks) ? p.risks.map(String).slice(0, 6) : [],
    email_subject: String(p.email_subject || '').trim(),
    email_html: String(p.email_html || '').trim(),
    email_body: String(p.email_body || '').trim(),
    email_cta_url: String(p.email_cta_url || '').trim(),
    profile: p.profile && typeof p.profile === 'object' ? p.profile : null,
    product_estimate: p.product_estimate && typeof p.product_estimate === 'object' ? {
      product: String(p.product_estimate.product || '').trim(),
      price_monthly_eur: Number(p.product_estimate.price_monthly_eur) || 0,
      impact_pct: Math.max(0, Math.min(100, Math.round(Number(p.product_estimate.impact_pct) || 0))),
      roi_12m_eur: Number(p.product_estimate.roi_12m_eur) || 0,
      justification: String(p.product_estimate.justification || '').trim(),
      note: String(p.product_estimate.note || '').trim(),
    } : null,
    // full_md = le rapport markdown lisible, SANS le bloc JSON final (payload
    // machine) qui n'a pas sa place dans le rendu humain.
    full_md: String(content || '').replace(/```json[\s\S]*$/i, '').trim(),
  };
}

// --------------------------------------------------------------------------
// Validation rapide du produit retourné par l'IA
// --------------------------------------------------------------------------

function validateProductEstimate(estimate) {
  if (!estimate || typeof estimate !== 'object') return null;
  const allowed = ZENTARA_CATALOG;
  const match = allowed.find((p) =>
    p.name.toLowerCase() === String(estimate.product || '').toLowerCase()
  );
  if (!match) {
    return { ...estimate, valid: false, _reason: 'product_not_in_catalog' };
  }
  return {
    ...estimate,
    product: match.name,
    price_monthly_eur: match.price_eur, // forcing catalogue price
    valid: true,
  };
}

module.exports = {
  FRAMEWORK,
  buildProspectPrompt,
  parseAnalysisResponse,
  validateProductEstimate,
  ZENTARA_CATALOG,
  buildLegacy34Profile,
  FIELD_34_LABELS,
};
