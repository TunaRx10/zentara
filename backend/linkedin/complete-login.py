#!/usr/bin/env python3
"""
complete-login.py — login LinkedIn + vérification email assistée.

Flux :
  1. lance chromium headless (patchright stealth)
  2. remplit email + mot de passe, soumet
  3. atteint le checkpoint « enter the verification code »
  4. POLLE le fichier /tmp/li-code.txt (6 chiffres) pendant ~14 min
  5. remplit le code, soumet, vérifie le login
  6. sauvegarde linkedin/session.pkl (cookies StaffSpy) + session-state.json

Usage :
  LINKEDIN_USERNAME=... LINKEDIN_PASSWORD=... python3 complete-login.py
Le code est déposé par l'opérateur dans /tmp/li-code.txt (puis supprimé).
"""
import os
import sys
import json
import time
import pickle

HERE = os.path.dirname(os.path.abspath(__file__))
CODE_FILE = "/tmp/li-code.txt"
PROGRESS = "/tmp/li-login-progress.log"
PKL_OUT = os.path.join(HERE, "session.pkl")
STATE_OUT = os.path.join(HERE, "session-state.json")

USERNAME = os.environ.get("LINKEDIN_USERNAME", "")
PASSWORD = os.environ.get("LINKEDIN_PASSWORD", "")


def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(PROGRESS, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def read_code():
    try:
        raw = open(CODE_FILE, encoding="utf-8").read().strip()
    except Exception:
        return None
    digits = "".join(ch for ch in raw if ch.isdigit())
    if 4 <= len(digits) <= 8:
        return digits
    return None


def detect_code_inputs(page):
    """Renvoie la liste des inputs candidats pour le code."""
    out = []
    n = page.locator("input").count()
    for i in range(n):
        try:
            el = page.locator("input").nth(i)
            attrs = el.evaluate(
                "e => ({id: e.id, name: e.name, type: e.type, inputmode: e.inputmode, "
                "autocomplete: e.autocomplete, placeholder: e.placeholder, "
                "aria: e.getAttribute('aria-label')})"
            )
            out.append((i, attrs))
        except Exception:
            continue
    return out


def main():
    open(PROGRESS, "w").close()
    try:
        os.remove(CODE_FILE)
    except FileNotFoundError:
        pass

    if not USERNAME or not PASSWORD:
        log("ERREUR: identifiants manquants")
        sys.exit(1)

    from patchright.sync_api import sync_playwright

    with sync_playwright() as p:
        chrome_bin = os.path.expanduser(
            "~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"
        )
        browser = p.chromium.launch(
            headless=True,
            executable_path=chrome_bin if os.path.exists(chrome_bin) else None,
        )
        ctx = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
            locale="en-US",
        )
        page = ctx.new_page()

        log("goto login")
        page.goto("https://www.linkedin.com/login", timeout=40000, wait_until="domcontentloaded")
        time.sleep(3)
        page.locator('input[type="email"]:visible').first.fill(USERNAME, timeout=20000)
        page.locator('input[type="password"]:visible').first.fill(PASSWORD, timeout=20000)
        page.locator('input[type="password"]:visible').first.press("Enter", timeout=20000)
        time.sleep(7)

        log(f"after login: {page.url}")
        body = ""
        try:
            body = page.inner_text("body")[:1500]
        except Exception:
            pass
        log(f"body head: {body[:300].replace(chr(10), ' | ')}")

        # Déjà connecté ?
        if "feed" in page.url or "voyager" in page.url:
            log("déjà connecté")
            try:
                ctx.storage_state(path=STATE_OUT)
                log(f"storage_state -> {STATE_OUT}")
            except Exception as e:
                log(f"storage_state err: {e}")
            browser.close()
            print(json.dumps({"ok": True, "saved": STATE_OUT}))
            sys.exit(0)

        # Sinon, checkpoint de vérification
        inputs = detect_code_inputs(page)
        log(f"inputs candidats: {json.dumps(inputs, ensure_ascii=False)}")

        # Choisir le champ code (id LinkedIn stable + fallbacks)
        code_locator = None
        for sel in [
            '#input__email_verification_pin',
            'input[autocomplete="one-time-code"]',
            'input[name="pin"]',
            'input[aria-label="Verification code"]',
        ]:
            try:
                if page.locator(sel).count() > 0:
                    code_locator = page.locator(sel).first
                    log(f"code input choisi via: {sel}")
                    break
            except Exception:
                continue
        if code_locator is None:
            for i in range(page.locator('input[type="number"], input[type="text"], input[type="tel"]').count()):
                el = page.locator('input[type="number"], input[type="text"], input[type="tel"]').nth(i)
                try:
                    if el.is_visible():
                        code_locator = el
                        log(f"code input fallback: input visible index {i}")
                        break
                except Exception:
                    continue

        # Poll du code
        deadline = time.time() + 14 * 60
        code = None
        while time.time() < deadline:
            code = read_code()
            if code:
                break
            time.sleep(2)

        if not code:
            log("TIMEOUT: aucun code reçu")
            browser.close()
            print(json.dumps({"ok": False, "error": "timeout waiting code"}))
            sys.exit(2)

        log(f"code reçu: {code}")
        try:
            os.remove(CODE_FILE)
        except Exception:
            pass

        try:
            code_locator.fill(code, timeout=15000)
            sub = page.locator('button:has-text("Submit")').first
            if sub.count() > 0:
                sub.click(timeout=15000)
            else:
                code_locator.press("Enter", timeout=15000)
        except Exception as e:
            log(f"fill code err: {e.__class__.__name__}: {e}")
        time.sleep(7)

        log(f"after code: {page.url}")
        try:
            body2 = page.inner_text("body")[:1500]
            log(f"body2 head: {body2[:300].replace(chr(10), ' | ')}")
        except Exception:
            body2 = ""

        # Vérif login
        logged = ("feed" in page.url or "voyager" in page.url or
                  ("checkpoint" not in page.url and "login" not in page.url))
        if logged:
            try:
                ctx.storage_state(path=STATE_OUT)
                log(f"OK -> {STATE_OUT}")
            except Exception as e:
                log(f"storage_state err: {e}")

            # Sauve aussi session.pkl (cookies pour StaffSpy)
            try:
                cookies = ctx.cookies()
                data = {
                    "cookies": {c["name"]: c["value"] for c in cookies},
                    "headers": {"User-Agent": "Mozilla/5.0"},
                }
                with open(PKL_OUT, "wb") as f:
                    pickle.dump(data, f)
                log(f"OK -> {PKL_OUT}")
            except Exception as e:
                log(f"pkl err: {e}")

            browser.close()
            print(json.dumps({"ok": True, "saved": STATE_OUT}))
            sys.exit(0)
        else:
            log(f"échec après code: {page.url}")
            browser.close()
            print(json.dumps({"ok": False, "error": f"still blocked: {page.url}", "body": body2[:300]}))
            sys.exit(2)


if __name__ == "__main__":
    main()
