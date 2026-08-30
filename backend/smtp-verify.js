// smtp-verify.js — Vérification d'email par handshake SMTP (zéro dépendance, natif Node).
// Vérifie la syntaxe, résout les MX, puis dialogue SMTP (EHLO → MAIL FROM → RCPT TO)
// SANS envoyer d'email. Le code de réponse de RCPT TO indique si la boîte existe.
'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const DISPOSABLE = new Set([
  'mailinator.com', '10minutemail.com', 'guerrillamail.com', 'tempmail.com',
  'throwawaymail.com', 'yopmail.com', 'sharklasers.com', 'grr.la', 'temp-mail.org',
]);

/** Parse une réponse SMTP multi-lignes : "250-..." puis "250 ..." (dernière ligne sans '-'). */
function parseReply(buf) {
  const lines = String(buf).split('\r\n').filter(Boolean);
  if (!lines.length) return null;
  const last = lines[lines.length - 1];
  const m = /^(\d{3})(?:[ -])(.*)$/.exec(last);
  if (!m) return null;
  return { code: Number(m[1]), text: m[2] };
}

/** Un seul échange SMTP : envoie `cmd`, attend la réponse. */
function smtpCommand(sock, cmd, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    let buf = '';
    const onData = (d) => {
      buf += d;
      const r = parseReply(buf);
      if (r) {
        clearTimeout(timer);
        sock.removeListener('data', onData);
        resolve(r);
      }
    };
    sock.on('data', onData);
    sock.write(cmd + '\r\n');
  });
}

/**
 * Vérifie un email par SMTP.
 * @returns {{email:string, syntax:boolean, disposable:boolean, mx:string|null,
 *            deliverable:boolean|null, code:number|null, reason:string, confidence:number}}
 */
async function verifyEmail(email, { timeoutMs = 9000 } = {}) {
  const addr = String(email || '').trim().toLowerCase();
  const base = { email: addr, syntax: false, disposable: false, mx: null, deliverable: null, code: null, reason: '', confidence: 0 };

  if (!EMAIL_RE.test(addr)) {
    return { ...base, syntax: false, reason: 'syntaxe invalide', confidence: 0 };
  }
  base.syntax = true;

  const domain = addr.split('@')[1];
  base.disposable = DISPOSABLE.has(domain);

  let mxRecords;
  try {
    mxRecords = await dns.resolveMx(domain);
  } catch {
    return { ...base, reason: 'aucun enregistrement MX', confidence: 0.1 };
  }
  if (!mxRecords || !mxRecords.length) {
    return { ...base, reason: 'aucun enregistrement MX', confidence: 0.1 };
  }
  mxRecords.sort((a, b) => a.priority - b.priority);
  const host = mxRecords[0].exchange;
  base.mx = host;

  const result = await new Promise((resolve) => {
    const sock = net.createConnection({ host, port: 25 });
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; sock.destroy(); resolve(r); } };
    const timer = setTimeout(() => finish({ deliverable: null, code: null, reason: 'timeout SMTP' }), timeoutMs);

    sock.setEncoding('utf8');
    sock.on('connect', () => {
      // attend le banner 220
    });
    let bannerBuf = '';
    const onBanner = (d) => {
      bannerBuf += d;
      const r = parseReply(bannerBuf);
      if (!r) return;
      sock.removeListener('data', onBanner);
      (async () => {
        const ehlo = await smtpCommand(sock, `EHLO zentara.local`, timeoutMs);
        if (!ehlo) return finish({ deliverable: null, code: null, reason: 'pas de réponse EHLO' });
        const mail = await smtpCommand(sock, `MAIL FROM:<verify@zentara.local>`, timeoutMs);
        if (!mail) return finish({ deliverable: null, code: null, reason: 'pas de réponse MAIL FROM' });
        if (mail.code >= 500) return finish({ deliverable: null, code: mail.code, reason: 'MAIL FROM refusé: ' + mail.text });
        const rcpt = await smtpCommand(sock, `RCPT TO:<${addr}>`, timeoutMs);
        sock.write('QUIT\r\n');
        if (!rcpt) return finish({ deliverable: null, code: null, reason: 'pas de réponse RCPT TO' });
        if (rcpt.code === 250 || rcpt.code === 251) {
          finish({ deliverable: true, code: rcpt.code, reason: 'boîte acceptée (250/251)' });
        } else if (rcpt.code === 550 || rcpt.code === 551 || rcpt.code === 553) {
          finish({ deliverable: false, code: rcpt.code, reason: 'boîte refusée: ' + rcpt.text });
        } else {
          finish({ deliverable: null, code: rcpt.code, reason: 'vérification impossible (catch-all / greylisting): ' + rcpt.text });
        }
      })();
    };
    sock.on('data', onBanner);
    sock.on('error', (e) => {
      clearTimeout(timer);
      finish({ deliverable: null, code: null, reason: e.code === 'ECONNREFUSED' ? 'port 25 bloqué/refusé' : (e.code || 'erreur réseau') });
    });
    sock.on('close', () => {
      clearTimeout(timer);
      finish({ deliverable: null, code: null, reason: 'connexion fermée' });
    });
  });

  let confidence = 0;
  if (result.deliverable === true) confidence = base.disposable ? 0.35 : 0.85;
  else if (result.deliverable === false) confidence = 0.05;
  else confidence = 0.25;

  return { ...base, ...result, confidence };
}

module.exports = { verifyEmail };
