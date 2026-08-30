#!/usr/bin/env python3
"""generate-splash.py — Splash screen Android pour Zentara.

Rendu : fond noir premium + monogramme Z argenté centré, dans les bons
ratios (portrait 9:16 et paysage 16:9) pour chaque densité Android.

Sortie :
  frontend/android/app/src/main/res/drawable-{port,land}-{m,h,xh,xxh,xxxh}dpi/splash.png
"""
import os
from PIL import Image, ImageDraw
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "frontend", "android", "app", "src", "main", "res")

# Même palette que favicon.svg / generate-icons.py
SILVER_TOP = (0xFF, 0xFF, 0xFF)
SILVER_MID = (0xD6, 0xDA, 0xE2)
SILVER_DEEP = (0x7E, 0x86, 0x93)
SILVER_ACCENT = (0xE8, 0xEC, 0xF2)
BG_CENTER = (0x14, 0x14, 0x1B)
BG_EDGE = (0x03, 0x03, 0x05)

# Splash = canvas plein écran, ratio téléphone 9:16 (port) / 16:9 (land)
# Tailles pour chaque densité dpi (basé sur xxxhdpi 1080×1920).
# Plus simple : on rend chaque density à une taille "safe" large qui passe
# sur tous les écrans (Android redimensionne). Résolutions recommandées :
#   mdpi:   480×800 (port) / 800×480 (land)
#   hdpi:   720×1280
#   xhdpi:  960×1600
#   xxhdpi: 1280×1920 (port) / 1920×1080 (land)
#   xxxhdpi:1440×2560 (port) / 2560×1440 (land)
PORT = {
    "mdpi":   (480, 800),
    "hdpi":   (720, 1280),
    "xhdpi":  (960, 1600),
    "xxhdpi": (1280, 1920),
    "xxxhdpi":(1440, 2560),
}
LAND = {
    "mdpi":   (800, 480),
    "hdpi":   (1280, 720),
    "xhdpi":  (1600, 960),
    "xxhdpi": (1920, 1280),
    "xxxhdpi":(2560, 1440),
}


def _radial_bg(w, h):
    """Radial dark premium background adapted to portrait/landscape.

    Construit directement un tablau (h, w, 3) RGB.  On évite le bug
    `np.array(Image.new("RGBA", ...))` → shape (h,w,4) qui corrompt le
    canal G via la convolution de l'offset alpha=255.
    """
    arr = np.zeros((h, w, 3), dtype=np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w * 0.5, h * 0.5
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    dmax = np.sqrt(cx * cx + cy * cy)
    t = np.clip(d / dmax, 0, 1) ** 1.4
    for i in range(3):
        arr[:, :, i] = BG_CENTER[i] + (BG_EDGE[i] - BG_CENTER[i]) * t
    return Image.fromarray(arr.astype(np.uint8), "RGB").convert("RGBA")


def _silver_grad(w, h, vertical=True):
    if vertical:
        t = np.linspace(0, 1, h, dtype=np.float32)[:, None]
        stops = np.array([0.0, 0.5, 1.0], dtype=np.float32)
    else:
        t = np.linspace(0, 1, w, dtype=np.float32)[None, :]
        stops = np.array([0.0, 0.5, 1.0], dtype=np.float32)
    arr = np.zeros((h, w, 3), np.float32)
    for i in range(3):
        ys = np.array([SILVER_TOP[i], SILVER_MID[i], SILVER_DEEP[i]], dtype=np.float32)
        arr[:, :, i] = np.interp(t, stops, ys)
    return Image.fromarray(arr.astype(np.uint8), "RGB").convert("RGBA")


def _draw_monogram(canvas, w, h):
    """Dessine le Z argenté + accent carré, proportionnel au canvas.
    Le Z occupe ~38% de la dimension la plus petite (équivalent favicon 1:1).
    """
    # cible = 38% du plus petit côté
    target = int(min(w, h) * 0.38)
    # pad centre
    cx, cy = w // 2, h // 2
    # Notre SVG favicon = 512, donc facteur = target / 512
    S = target / 512.0
    # rendu Silver grad pour la zone du Z
    z_w = 512 * S
    z_h = 512 * S
    # Position top-left du rendu du Z dans le canvas
    px = int(cx - z_w / 2 + (160 * S))  # ajuste pour le décalage Z (commence à 160 dans viewBox)
    py = int(cy - z_h / 2 + (168 * S))

    # Crée une image temporaire pour le silver grad et on dessine le path dessus
    z_canvas_w = int(z_w + (500 * S))  # marge
    z_canvas_h = int(z_h + (500 * S))
    z_img = Image.new("RGBA", (z_canvas_w, z_canvas_h), (0, 0, 0, 0))
    silver = _silver_grad(z_canvas_w, z_canvas_h)

    # Masc pour le Z (mêmes coords que favicon.svg)
    m = Image.new("L", (z_canvas_w, z_canvas_h), 0)
    d = ImageDraw.Draw(m)
    stroke = max(1, int(48 * S))
    segs = [(160, 168, 360, 168), (360, 168, 160, 344), (160, 344, 360, 344)]
    for (x1, y1, x2, y2) in segs:
        d.line([(x1 * S, y1 * S), (x2 * S, y2 * S)], fill=255, width=stroke)
    r = stroke / 2
    for (x, y) in [(160, 168), (360, 344)]:
        d.ellipse([x * S - r, y * S - r, x * S + r, y * S + r], fill=255)
    z_img = Image.composite(silver, z_img, m)
    # Accent rect bas-droite
    d2 = ImageDraw.Draw(z_img)
    ax = int(378 * S)
    ay = int(378 * S)
    aw = int(34 * S)
    r_accent = max(1, int(6 * S))
    d2.rounded_rectangle([ax, ay, ax + aw, ay + aw], radius=r_accent, fill=SILVER_ACCENT + (235,))

    # Paste centré
    canvas.paste(z_img, (px, py), z_img)


def render_splash(w, h):
    img = _radial_bg(w, h)
    # micro-bordure premium (subtile)
    d = ImageDraw.Draw(img)
    border = max(1, int(2 * (min(w, h) / 1080)))
    d.rectangle([0, 0, w - 1, h - 1], outline=(255, 255, 255, 12), width=border)
    # Monogramme centré
    _draw_monogram(img, w, h)
    return img


def main():
    for dpi, (pw, ph) in PORT.items():
        folder = os.path.join(RES, f"drawable-port-{dpi}")
        os.makedirs(folder, exist_ok=True)
        render_splash(pw, ph).save(os.path.join(folder, "splash.png"))
        print(f"port-{dpi}: {pw}x{ph}")
    for dpi, (lw, lh) in LAND.items():
        folder = os.path.join(RES, f"drawable-land-{dpi}")
        os.makedirs(folder, exist_ok=True)
        render_splash(lw, lh).save(os.path.join(folder, "splash.png"))
        print(f"land-{dpi}: {lw}x{lh}")
    print("Splash screens regenerated (dark premium + argent Z)")


if __name__ == "__main__":
    main()
