#!/usr/bin/env python3
"""
linkedin-bridge.py — Pont Python unifié pour la recherche LinkedIn de Zentara.

Repos vendored (backend/linkedin/vendor/):
  - StaffSpy   (cullenwatson/StaffSpy)  → roster d'entreprise + recherche par niche
  - linkedin-mcp-server (stickerdaniel) → vendored, non branché ici (runtime MCP dédié)
  - lead-generation-scraper (ayalbson)  → VIDE (README marketing, aucun code source)

Lecture : un objet JSON sur stdin  →  écrit un objet JSON sur stdout.

Actions :
  status  → disponibilité des moteurs + session
  staff   → employés/décideurs d'une entreprise (company_name + search_term/roles)
  people  → recherche globale par niche/mots-clés (search_term = niche + besoins)

Config (variables d'environnement) :
  LINKEDIN_SESSION_FILE  → chemin du fichier de session StaffSpy (session.pkl)
  LINKEDIN_USERNAME      → email du compte LinkedIn (fallback si pas de session)
  LINKEDIN_PASSWORD      → mot de passe (fallback si pas de session)
  LINKEDIN_LIMIT         → nombre max de résultats (défaut 25)

Important : StaffSpy exige une session LinkedIn authentifiée. Sans session ni
identifiants, tout renvoie { available: false, ... } sans planter.
"""
import sys
import os
import json
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "linkedin", "vendor")
STAFFSPY_DIR = os.path.join(VENDOR, "StaffSpy")
MCP_DIR = os.path.join(VENDOR, "linkedin-mcp-server")
DEFAULT_SESSION = os.path.join(os.path.dirname(os.path.abspath(__file__)), "linkedin", "session.pkl")

for _p in (STAFFSPY_DIR, MCP_DIR):
    if os.path.isdir(_p) and _p not in sys.path:
        sys.path.insert(0, _p)


def env(name, default=""):
    v = os.environ.get(name, "")
    return v.strip() if v else default


def output(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, default=str))
    sys.stdout.write("\n")
    sys.stdout.flush()


def check_staffspy():
    """Renvoie (ok, message) selon que staffspy est importable."""
    try:
        import pandas  # noqa: F401
        import selenium  # noqa: F401
        import staffspy  # noqa: F401
        return True, ""
    except Exception as e:
        return False, f"deps manquantes (pip install pandas selenium requests pydantic): {e.__class__.__name__}: {e}"


def check_mcp():
    """Détection réelle du runtime linkedin-mcp-server (vendored).
    Exige Python >= 3.12 + Patchright + session navigateur."""
    if sys.version_info < (3, 12):
        return False, f"Python >= 3.12 requis (actuel {sys.version.split()[0]}) — exécute `uvx mcp-server-linkedin`"
    try:
        import patchright  # noqa: F401
        return True, ""
    except ImportError as e:
        return False, f"deps MCP manquantes (pip install patchright && patchright install chromium): {e}"
    except Exception as e:
        return False, f"MCP indisponible: {e.__class__.__name__}: {e}"


def resolve_session_file():
    """Chemin de session : env LINKEDIN_SESSION_FILE, sinon le session.pkl par défaut s'il existe."""
    explicit = env("LINKEDIN_SESSION_FILE")
    if explicit:
        return explicit
    return DEFAULT_SESSION if os.path.isfile(DEFAULT_SESSION) else None


def session_info():
    session_file = resolve_session_file()
    username = env("LINKEDIN_USERNAME")
    password = env("LINKEDIN_PASSWORD")
    return {
        "file": session_file,
        "exists": bool(session_file and os.path.isfile(session_file)),
        "username_set": bool(username),
        "password_set": bool(password),
        "ready": bool((session_file and os.path.isfile(session_file)) or (username and password)),
    }


def action_status():
    ss_ok, ss_msg = check_staffspy()
    mcp_ok, mcp_msg = check_mcp()
    return {
        "ok": True,
        "available": ss_ok,
        "python": sys.version.split()[0],
        "engines": {
            "staffspy": {"available": ss_ok, "error": None if ss_ok else ss_msg},
            "mcp_server": {"available": mcp_ok, "error": mcp_msg},
            "lead_generation_scraper": {"available": False, "error": "repo vide (README marketing, aucun code source)"},
        },
        "session": session_info(),
    }


def _person(rec):
    """Normalise un dict StaffSpy → forme personne canonique Zentara."""
    name = (rec.get("name") or "").strip()
    first = rec.get("first_name") or (name.split(" ")[0] if name else "")
    last = rec.get("last_name") or (name.split(" ", 1)[1] if name and " " in name else "")
    if not first and not last:
        first, last = (name or "LinkedIn Member"), ""

    ci = rec.get("contact_info") or {}
    email = rec.get("potential_emails") and rec["potential_emails"][0] if isinstance(rec.get("potential_emails"), list) and rec.get("potential_emails") else None
    if not email and isinstance(ci, dict):
        email = ci.get("email_address")
    phone = None
    if isinstance(ci, dict):
        phones = ci.get("phone_numbers")
        if isinstance(phones, list) and phones:
            phone = phones[0]

    skills = rec.get("skills") or []
    skill_names = [s.get("name") for s in skills if isinstance(s, dict) and s.get("name")]

    # Confiance heuristique : email + phone + headline + skills
    conf = 0.45
    if email:
        conf += 0.25
    if phone:
        conf += 0.10
    if rec.get("headline"):
        conf += 0.10
    if skill_names:
        conf += 0.05
    conf = round(min(max(conf, 0.2), 0.95), 2)

    return {
        "first_name": first,
        "last_name": last,
        "full_name": name,
        "title": rec.get("headline") or rec.get("current_position"),
        "company": rec.get("current_company") or rec.get("company"),
        "location": rec.get("location"),
        "email": email,
        "phone": phone,
        "linkedin_url": rec.get("profile_link"),
        "skills": skill_names[:8],
        "open_to_work": bool(rec.get("open_to_work")),
        "is_hiring": bool(rec.get("is_hiring")),
        "confidence": conf,
        "source": "zentara-people",
        "meta": {
            "followers": rec.get("followers"),
            "connections": rec.get("connections"),
            "premium": bool(rec.get("premium")),
        },
    }


def _patch_proxy():
    """Monkey-patch StaffSpy : route la session via un proxy résidentiel
    (LINKEDIN_PROXY) si défini. Requis depuis une IP datacenter."""
    try:
        from staffspy.utils.utils import Login
    except Exception:
        return
    proxy = env("LINKEDIN_PROXY")
    if not proxy:
        return
    try:
        _orig = Login.load_session
        def _patched(self):
            session = _orig(self)
            try:
                session.proxies = {"http": proxy, "https": proxy}
            except Exception:
                pass
            return session
        Login.load_session = _patched
    except Exception:
        pass


def _run_staff(params):
    ss_ok, ss_msg = check_staffspy()
    if not ss_ok:
        return {"ok": False, "available": False, "error": ss_msg, "records": []}
    if not session_info()["ready"]:
        return {
            "ok": False,
            "available": False,
            "error": "Session LinkedIn absente. Définis LINKEDIN_SESSION_FILE (ou LINKEDIN_USERNAME + LINKEDIN_PASSWORD).",
            "records": [],
        }
    try:
        _patch_proxy()
        from staffspy import LinkedInAccount

        company_name = (params.get("company") or "").strip() or None
        search_term = (params.get("roles") or params.get("needs") or params.get("keywords") or "").strip() or None
        location = (params.get("location") or "").strip() or None
        limit = int(params.get("limit") or int(env("LINKEDIN_LIMIT", "25")))
        limit = max(1, min(limit, 200))

        account = LinkedInAccount(
            session_file=resolve_session_file() or None,
            username=env("LINKEDIN_USERNAME") or None,
            password=env("LINKEDIN_PASSWORD") or None,
            log_level=0,
        )
        df = account.scrape_staff(
            company_name=company_name,
            search_term=search_term,
            location=location,
            extra_profile_data=True,
            max_results=limit,
        )
        if df is None or getattr(df, "empty", True):
            return {"ok": True, "available": True, "engine": "zentara-people", "records": [], "count": 0,
                    "note": "Aucun résultat (ou tous les profils masqués 'LinkedIn Member')."}

        records = [_person(r) for r in df.to_dict("records")]
        records = [r for r in records if r.get("full_name") and r["full_name"] != "LinkedIn Member"]
        return {"ok": True, "available": True, "engine": "zentara-people", "records": records[:limit],
                "count": len(records[:limit]), "company": company_name, "search_term": search_term}
    except Exception as e:
        return {"ok": False, "available": True, "error": f"staffspy: {e.__class__.__name__}: {e}", "records": []}


def _run_mcp(params):
    """Recherche people via linkedin-mcp-server (Patchright).
    Défensif : renvoie un statut propre si le runtime n'est pas prêt.
    """
    ok, msg = check_mcp()
    if not ok:
        return {"ok": False, "available": False, "engine": "zentara-mcp", "error": msg, "records": []}
    try:
        # Le serveur MCP est conçu comme process FastMCP autonome ; on l'appelle en
        # sous-process JSON-RPC via `python -m linkedin_mcp_server` quand il est prêt.
        return {
            "ok": False,
            "available": True,
            "engine": "zentara-mcp",
            "error": "runtime MCP détecté mais non piloté ici — lance `uvx mcp-server-linkedin` et branche le client MCP.",
            "records": [],
        }
    except Exception as e:
        return {"ok": False, "available": True, "engine": "zentara-mcp", "error": f"mcp: {e.__class__.__name__}: {e}", "records": []}


def _run_jobs_public(params):
    """Recherche d'offres d'emploi LinkedIn via l'API publique jobs-guest.
    Aucune session requise (endpoint public), HTML parsé avec BeautifulSoup.
    """
    keywords = (params.get("keywords") or params.get("q") or params.get("needs") or "").strip()
    location = (params.get("location") or "").strip()
    limit = int(params.get("limit") or 25)
    limit = max(1, min(limit, 50))
    details_limit = int(params.get("details") or 5)
    if not keywords:
        return {"ok": False, "available": True, "engine": "zentara-jobs-public", "jobs": [], "error": "keywords requis"}
    try:
        import requests
        from bs4 import BeautifulSoup
    except Exception as e:
        return {"ok": False, "available": True, "engine": "zentara-jobs-public", "jobs": [], "error": f"deps: {e}"}

    UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    s = requests.Session()
    s.headers["User-Agent"] = UA

    jobs = []
    seen = set()
    start = 0
    try:
        while len(jobs) < limit:
            url = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
            pq = {"keywords": keywords, "location": location, "start": start, "count": min(25, limit - len(jobs))}
            r = s.get(url, params=pq, timeout=30)
            if r.status_code != 200:
                break
            soup = BeautifulSoup(r.text, "html.parser")
            cards = soup.select("div.base-search-card")
            if not cards:
                break
            new = 0
            for c in cards:
                urn = c.get("data-entity-urn") or ""
                job_id = urn.split(":")[-1] if urn else None
                if not job_id or job_id in seen:
                    continue
                seen.add(job_id)
                t = c.select_one(".base-search-card__title")
                sub = c.select_one(".base-search-card__subtitle")
                loc = c.select_one(".job-search-card__location")
                tm = c.select_one("time")
                link = c.select_one("a.base-card__full-link")
                href = link.get("href") if link else None
                apply_url = (href or "").split("?")[0] or f"https://www.linkedin.com/jobs/view/{job_id}"
                jobs.append({
                    "job_id": job_id,
                    "title": t.get_text(strip=True) if t else None,
                    "company": sub.get_text(strip=True) if sub else None,
                    "location": loc.get_text(strip=True) if loc else None,
                    "posted_date": tm.get_text(strip=True) if tm else None,
                    "apply_url": apply_url,
                    "linkedin": apply_url,
                    "salary": None,
                    "description_snippet": None,
                })
                new += 1
                if len(jobs) >= limit:
                    break
            if new == 0:
                break
            start += len(cards)
    except Exception as e:
        return {"ok": True, "available": True, "engine": "zentara-jobs-public", "jobs": jobs, "count": len(jobs), "error": f"partiel: {e.__class__.__name__}: {e}"}

    # Détails (description + salaire) pour les premières offres
    for j in jobs[:details_limit]:
        try:
            det = s.get(f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{j['job_id']}", timeout=20)
            if det.status_code == 200:
                ds = BeautifulSoup(det.text, "html.parser")
                desc = ds.select_one(".show-more-less-html__markup")
                if desc:
                    j["description_snippet"] = desc.get_text(" ", strip=True)[:900]
                sal = ds.select_one(".compensation__salary, .job-details-jobs-unified-top-card__salary-info")
                if sal:
                    j["salary"] = sal.get_text(" ", strip=True)[:200]
        except Exception:
            pass

    return {"ok": True, "available": True, "engine": "zentara-jobs-public", "jobs": jobs, "count": len(jobs), "keywords": keywords, "location": location}


def main():
    raw = ""
    for line in sys.stdin:
        raw += line
    try:
        req = json.loads(raw) if raw.strip() else {}
    except Exception as e:
        output({"ok": False, "error": f"JSON invalide: {e}"})
        return
    action = (req.get("action") or "status").lower()
    params = req if isinstance(req, dict) else {}

    if action == "status":
        output(action_status())
    elif action == "staff":
        output(_run_staff(params))
    elif action == "people":
        # StaffSpy : search_term seul (sans company) = recherche globale par mots-clés
        output(_run_staff(params))
    elif action == "jobs":
        # API publique jobs-guest — aucune session requise
        output(_run_jobs_public(params))
    elif action == "mcp":
        output(_run_mcp(params))
    else:
        output({"ok": False, "error": f"action inconnue: {action}"})


if __name__ == "__main__":
    main()
