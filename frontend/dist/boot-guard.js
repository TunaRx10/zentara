/**
 * boot-guard.js — diagnostic de boot externe (CSP-friendly).
 *
 * Pourquoi ce fichier existe : le middleware helmet impose
 * `script-src 'self'`, ce qui BLOQUE les `<script>` inline dans
 * index.html. Auparavant, le setup de diagnostic (MutationObserver,
 * window.onerror, setTimeout de hide) était inline et ne s'exécutait
 * jamais. Résultat : le boot-fallback HTML restait visible
 * indéfiniment, masquant toute erreur React (écran noir trompeur).
 *
 * Référencé depuis index.html via `<script src="/boot-guard.js" defer>` :
 *  - Vite copie `public/` → `dist/` à chaque build, donc servi à `/boot-guard.js`.
 *  - `defer` : le script s'exécute après le parsing HTML, sans bloquer.
 *  - CSP `'self'` accepte un script dont le src est sur la même origine.
 *  - Le script peut manipuler librement le DOM (les inline event handlers
 *    posés dynamiquement ne sont PAS couverts par script-src — ils relèvent
 *    de script-src-attr, et on n'en utilise pas ici, on attache via addEventListener).
 */
(function setupBootGuards() {
  if (window.__zentaraBootGuardInstalled) return;
  window.__zentaraBootGuardInstalled = true;

  var fb = document.getElementById('boot-fallback');
  var errCard = document.getElementById('boot-error');
  var errDetail = document.getElementById('boot-error-detail');
  var reactMounted = false;

  // Round 107 — disable complete via ?nofallback=1 (debug mode).
  try {
    var url = new URL(window.location.href);
    if (url.searchParams.get('nofallback') === '1') {
      if (fb && fb.parentNode) fb.parentNode.removeChild(fb);
    }
  } catch (_e) {
    /* URL parse fail (very old browser) */
  }

  function showError(msg) {
    if (!errCard || !errDetail) return;
    errDetail.textContent = msg;
    errCard.classList.add('show');
    if (fb) fb.classList.add('hide');
  }

  function hideFallback(reason) {
    if (!fb || reactMounted) return;
    reactMounted = true;
    fb.classList.add('hide');
    if (window.console && console.log) {
      console.log('[boot-guard] hidden after', reason || 'mount');
    }
    setTimeout(function () {
      if (fb && fb.parentNode) fb.parentNode.removeChild(fb);
    }, 350);
  }

  // Capture globale des erreurs window.onerror + unhandledrejection.
  window.addEventListener('error', function (e) {
    var msg;
    if (e.error && e.error.stack) msg = e.error.stack;
    else msg = (e.message || 'Erreur inconnue') + ' @ ' + (e.filename || '?') + ':' + (e.lineno || 0);
    showError(msg);
  });

  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    var msg = r && r.stack
      ? r.stack
      : (typeof r === 'string' ? r : JSON.stringify(r));
    showError('Unhandled promise rejection:\n' + msg);
  });

  // MutationObserver sur #root : si React monte un enfant, on cache
  // le fallback. Round 107 — on rend le hide immédiat (transition
  // 250ms) car le fallback est maintenant minimal (mark + dot) et n'a
  // plus besoin du délai long de 800ms.
  var rootEl = document.getElementById('root');
  if (rootEl) {
    var obs = new MutationObserver(function () {
      if (rootEl.childNodes && rootEl.childNodes.length > 0) {
        hideFallback('mutation');
      }
    });
    obs.observe(rootEl, { childList: true, subtree: true });
  }

  // Round 107 — les timeouts de 2s/10s et le boot-pending-flag
  // (toast violet/bleu après 10s) sont supprimés. Si React ne mount
  // vraiment pas, l'error overlay capté par window.onerror ci-dessus
  // s'affichera de toute façon.
})();
