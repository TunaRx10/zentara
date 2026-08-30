#!/usr/bin/env python3
"""create-session.py — Crée (ou rafraîchit) la session LinkedIn de StaffSpy.

Méthode : login `requests` (émulation API mobile LinkedIn) → AUCUN navigateur,
aucun Chrome, aucun écran requis. Idéal pour un serveur headless.

Usage :
  LINKEDIN_USERNAME=you@mail.com LINKEDIN_PASSWORD=xxx \
      python3 create-session.py --out /chemin/session.pkl

  # En cas de captcha (CHALLENGE) :
  LINKEDIN_USERNAME=... LINKEDIN_PASSWORD=... 2CAPTCHA_API_KEY=xxx \
      python3 create-session.py --out /chemin/session.pkl

Une fois la session créée, ajoute dans .env :
  LINKEDIN_SESSION_FILE=/chemin/session.pkl
(plus besoin du mot de passe pour les lancements suivants)
"""
import sys
import os
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(HERE, "vendor", "StaffSpy")
if VENDOR not in sys.path:
    sys.path.insert(0, VENDOR)

DEFAULT_OUT = os.path.join(HERE, "session.pkl")


def main():
    ap = argparse.ArgumentParser(description="Crée la session LinkedIn StaffSpy")
    ap.add_argument("--out", default=DEFAULT_OUT, help=f"chemin du session.pkl (défaut {DEFAULT_OUT})")
    ap.add_argument("--username", default=os.environ.get("LINKEDIN_USERNAME", ""), help="email LinkedIn")
    ap.add_argument("--password", default=os.environ.get("LINKEDIN_PASSWORD", ""), help="mot de passe")
    ap.add_argument("--solver-key", default=os.environ.get("2CAPTCHA_API_KEY", ""), help="clé 2captcha (optionnel, anti-captcha)")
    args = ap.parse_args()

    if not args.username or not args.password:
        print("ERREUR: LINKEDIN_USERNAME et LINKEDIN_PASSWORD requis (env ou --username/--password).", file=sys.stderr)
        sys.exit(2)

    try:
        from staffspy import LinkedInAccount, SolverType
    except Exception as e:
        print(
            "ERREUR: staffspy non importable. Dépendances requises :\n"
            "  pip install pandas selenium requests pydantic tldextract beautifulsoup4 tenacity pytz 2captcha-python\n"
            f"  ({e})",
            file=sys.stderr,
        )
        sys.exit(3)

    print(f"[session] connexion LinkedIn pour {args.username} …")
    try:
        LinkedInAccount(
            username=args.username,
            password=args.password,
            session_file=args.out,
            log_level=1,
            solver_api_key=args.solver_key or None,
            solver_service=SolverType.TWO_CAPTCHA,
        )
    except Exception as e:
        msg = str(e)
        print(f"ERREUR: {msg}", file=sys.stderr)
        up = msg.upper()
        if "CHALLENGE" in up or "CAPTCHA" in up:
            print("→ LinkedIn demande un captcha. Fournis 2CAPTCHA_API_KEY pour le résoudre automatiquement.", file=sys.stderr)
        elif "BAD_USERNAME_OR_PASSWORD" in up or "INCORRECT USERNAME" in up or "PASSWORD" in up:
            print("→ Identifiants incorrects (vérifie email + mot de passe).", file=sys.stderr)
        elif "CHECKPOINT" in up or "VERIFICATION" in up or "2FA" in up:
            print("→ Vérification de sécurité demandée par LinkedIn (souvent 2FA). La connexion requests ne gère pas le code 2FA.", file=sys.stderr)
        sys.exit(1)

    if os.path.isfile(args.out):
        print(f"OK: session enregistrée → {args.out}")
        print("Ajoute dans .env :  LINKEDIN_SESSION_FILE=" + args.out)
    else:
        print("ATTENTION: session non trouvée sur disque (login peut avoir échoué silencieusement).", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
