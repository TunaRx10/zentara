#!/usr/bin/env python3
"""
make-session-patchright.py — tentative de login LinkedIn via Patchright (stealth).

Essaie de créer une session LinkedIn authentifiée sans intervention humaine :
  - lance chromium headless via patchright (anti-bot)
  - remplit email + mot de passe, soumet
  - détecte si le login aboutit OU si LinkedIn affiche un checkpoint/captcha/2FA
  - si succès → sauvegarde storage_state dans linkedin/session-state.json

Usage :
  LINKEDIN_USERNAME=... LINKEDIN_PASSWORD=... python3 make-session-patchright.py
"""
import os
import sys
import json
import time

OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "session-state.json")

USERNAME = os.environ.get("LINKEDIN_USERNAME", "")
PASSWORD = os.environ.get("LINKEDIN_PASSWORD", "")


def detect_state(page):
    """Renvoie ('ok'|'challenge'|'unknown', detail)."""
    url = page.url
    title = ""
    try:
        title = page.title()
    except Exception:
        pass
    body = ""
    try:
        body = page.inner_text("body")[:2000].lower()
    except Exception:
        pass

    if "checkpoint" in url or "challenge" in url or "uas/login" in url:
        return "challenge", f"checkpoint url: {url}"
    if "captcha" in body or "verify" in body or "security" in body and "code" in body:
        return "challenge", "captcha/verification detected"
    if "feed" in url or "linkedin.com/feed" in url or "/voyager" in url:
        return "ok", "landed on feed"
    # Login page → still not logged in
    if "/login" in url or "session_redirect" in url:
        return "challenge", f"still on login: {url}"
    if "add-phone" in url or "email" in url and "verify" in url:
        return "challenge", f"verification step: {url}"
    return "unknown", f"url={url} title={title[:120]}"


def main():
    if not USERNAME or not PASSWORD:
        print(json.dumps({"ok": False, "error": "LINKEDIN_USERNAME/PASSWORD manquants"}))
        sys.exit(1)

    try:
        from patchright.sync_api import sync_playwright
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"patchright import: {e}"}))
        sys.exit(1)

    result = {"ok": False, "state": None, "detail": "", "saved": None}

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
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
            locale="en-US",
        )
        page = ctx.new_page()
        try:
            page.goto("https://www.linkedin.com/login", timeout=30000, wait_until="domcontentloaded")
            time.sleep(3)
            # LinkedIn randomise les IDs des inputs — on cible par type/autocomplete
            # (et :visible car la page contient 2 formulaires, un caché).
            page.locator('input[type="email"]:visible').first.fill(USERNAME, timeout=15000)
            page.locator('input[type="password"]:visible').first.fill(PASSWORD, timeout=15000)
            # Soumet via Entrée sur le champ mot de passe (évite les boutons SSO)
            page.locator('input[type="password"]:visible').first.press("Enter", timeout=15000)
        except Exception as e:
            result["detail"] = f"fill/submit error: {e.__class__.__name__}: {e}"
            browser.close()
            print(json.dumps(result, ensure_ascii=False))
            sys.exit(0)

        # Poll up to ~25s for outcome
        state, detail = "unknown", ""
        for _ in range(25):
            time.sleep(1)
            state, detail = detect_state(page)
            if state in ("ok", "challenge"):
                break
            # fallback: check if page has a feed nav
            try:
                if page.locator("a[href*='/feed/']").count() > 0 or page.locator("a[href='/feed/']").count() > 0:
                    state, detail = "ok", "feed nav visible"
                    break
            except Exception:
                pass

        result["state"] = state
        result["detail"] = detail
        result["url"] = page.url

        if state == "ok":
            try:
                ctx.storage_state(path=OUT_PATH)
                result["saved"] = OUT_PATH
                result["ok"] = True
            except Exception as e:
                result["detail"] += f" | save error: {e}"
        else:
            # capture a screenshot for diagnosis
            try:
                page.screenshot(path="/tmp/li-login.png")
            except Exception:
                pass

        browser.close()

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 2)


if __name__ == "__main__":
    main()
