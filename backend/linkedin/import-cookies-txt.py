#!/usr/bin/env python3
"""
import-cookies-txt.py — Convertit un export cookies.txt (Netscape) en session.pkl StaffSpy.

Usage :
    python3 import-cookies-txt.py /chemin/cookies.txt
    → écrit linkedin/session.pkl (format StaffSpy : {cookies, headers})

Le fichier cookies.txt vient de l'extension navigateur « Get cookies.txt LOCALLY »
(Chrome/Firefox) après connexion manuelle à linkedin.com.
"""
import sys
import os
import pickle
import requests

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "session.pkl")

def parse_netscape(path):
    cookies = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 7:
                continue
            domain, include_subdomains, path_, secure, expires, name, value = parts[:7]
            cookies.append({
                "domain": domain,
                "flag": include_subdomains,
                "path": path_,
                "secure": secure.upper() == "TRUE",
                "expires": int(expires) if expires.isdigit() else 0,
                "name": name,
                "value": value,
            })
    return cookies

def main():
    if len(sys.argv) < 2:
        print(json_err({"ok": False, "error": "Usage: import-cookies-txt.py <cookies.txt>"}))
        return 2
    src = sys.argv[1]
    if not os.path.isfile(src):
        print(json_err({"ok": False, "error": f"fichier introuvable: {src}"}))
        return 2

    cookies = parse_netscape(src)
    linkedin = [c for c in cookies if "linkedin" in c["domain"]]
    if not linkedin:
        print(json_err({"ok": False, "error": "aucun cookie linkedin.com trouvé dans le fichier"}))
        return 2

    session = requests.Session()
    for c in linkedin:
        session.cookies.set(c["name"], c["value"], domain=c["domain"], path=c["path"])
    # Headers exigés par l'API Voyager de LinkedIn
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "X-RestLi-Protocol-Version": "2.0.0",
        "X-Li-Track": '{"clientVersion":"1.13.1665"}',
    })
    # Csrf-Token = valeur du cookie JSESSIONID (sinon LinkedIn répond « CSRF check failed »)
    jsession = session.cookies.get("JSESSIONID", "")
    if jsession:
        session.headers.update({"Csrf-Token": str(jsession).replace('"', "")})

    data = {"cookies": session.cookies, "headers": session.headers}
    with open(OUT, "wb") as f:
        pickle.dump(data, f)

    names = [c["name"] for c in linkedin]
    print(json_err({"ok": True, "saved": OUT, "cookies": len(linkedin),
                    "has_li_at": "li_at" in names,
                    "has_jsessionid": "JSESSIONID" in names,
                    "names": names[:10]}))

def json_err(obj):
    import json
    return json.dumps(obj, ensure_ascii=False)

if __name__ == "__main__":
    sys.exit(main())
