#!/usr/bin/env python3
"""generate-icons.py — Régénère toutes les icônes Zentara (premium black + silver Z).

Source de vérité visuelle : frontend/public/favicon.svg (même design).
Ce script reproduit le même rendu en PIL (pas de cairo/rsvg dispo) et génère :
  - Web/PWA : favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png
  - Android launcher : ic_launcher.png / _round.png / _foreground.png (5 densités)
  - Android adaptive : drawable/ic_launcher_background.xml + values/ic_launcher_background.xml
"""
import os
from PIL import Image, ImageDraw
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "frontend", "public")
RES = os.path.join(ROOT, "frontend", "android", "app", "src", "main", "res")

# Palette "argent premium" (style Linear / Vercel / Stripe) — coordonnée avec favicon.svg
SILVER_TOP = (0xFF, 0xFF, 0xFF)   # #FFFFFF
SILVER_MID = (0xD6, 0xDA, 0xE2)   # #D6DAE2
SILVER_DEEP = (0x7E, 0x86, 0x93)  # #7E8693
SILVER_ACCENT = (0xE8, 0xEC, 0xF2)  # #E8ECF2 (petit carré bottom-right)
BG_CENTER = (0x14, 0x14, 0x1B)    # #14141B
BG_EDGE = (0x03, 0x03, 0x05)      # #030305

DENSITIES = [
    ("mdpi", 48, 108),
    ("hdpi", 72, 162),
    ("xhdpi", 96, 216),
    ("xxhdpi", 144, 324),
    ("xxxhdpi", 192, 432),
]


def _radial_bg(size):
    """Fond radial sombre premium (#14141B → #030305).
    Construit directement un tablau (size, size, 3) RGB pour éviter le bug
    `np.array(Image.new("RGBA", ...))` qui corrompt le canal G par le biais
    de l'alpha=255.
    """
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    cx, cy = size * 0.5, size * 0.36
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    dmax = np.sqrt((size * 0.5) ** 2 + (size * 0.36) ** 2)
    t = np.clip(d / dmax, 0, 1) ** 1.2
    arr = np.zeros((size, size, 3), np.float32)
    for i in range(3):
        arr[:, :, i] = BG_CENTER[i] + (BG_EDGE[i] - BG_CENTER[i]) * t
    return Image.fromarray(arr.astype(np.uint8), "RGB").convert("RGBA")


def _silver_grad(size):
    h = size
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    stops = np.array([0.0, 0.5, 1.0], dtype=np.float32)
    arr = np.zeros((h, size, 3), np.float32)
    for i in range(3):
        ys = np.array([SILVER_TOP[i], SILVER_MID[i], SILVER_DEEP[i]], dtype=np.float32)
        arr[:, :, i] = np.interp(t, stops, ys)
    return Image.fromarray(arr.astype(np.uint8), "RGB").convert("RGBA")


def _rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def _z_mask(size, S):
    """Z stroked unique — coords correspondant EXACTEMENT au favicon.svg.
       Path : M 160 168 H 360 L 160 344 H 360 (stroke-width 48, linecap round, linejoin miter).
    """
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    stroke = max(1, int(48 * S))
    r = stroke / 2
    segs = [
        (160, 168, 360, 168),  # top bar
        (360, 168, 160, 344),  # diagonal
        (160, 344, 360, 344),  # bottom bar
    ]
    for (x1, y1, x2, y2) in segs:
        d.line([(x1 * S, y1 * S), (x2 * S, y2 * S)], fill=255, width=stroke)
    # rounded caps aux deux extrémités (le reste = joins miter)
    for (x, y) in [(160, 168), (360, 344)]:
        d.ellipse([x * S - r, y * S - r, x * S + r, y * S + r], fill=255)
    return m


def _draw_accent_rect(d, S):
    """Petit carré arrondi argent en bas-droite (signature Linear-style)."""
    ax = int(378 * S)
    ay = int(378 * S)
    aw = int(34 * S)
    radius = max(1, int(6 * S))
    d.rounded_rectangle([ax, ay, ax + aw, ay + aw], radius=radius, fill=(*SILVER_ACCENT, 235))


def render_full(size):
    """Icône complète : fond noir radial + micro-bordure + Z argent + accent."""
    S = size / 512.0
    img = _radial_bg(size)
    img.putalpha(_rounded_mask(size, int(116 * S)))
    d = ImageDraw.Draw(img)
    # micro-bordure premium
    ring_w = max(1, int(1.5 * S))
    inset = int(1.5 * S)
    d.rounded_rectangle(
        [inset, inset, size - 1 - inset, size - 1 - inset],
        radius=int(114.5 * S),
        outline=(255, 255, 255, 18),
        width=ring_w,
    )
    img = Image.composite(_silver_grad(size), img, _z_mask(size, S))
    d = ImageDraw.Draw(img)
    _draw_accent_rect(d, S)
    return img


def render_mark(size):
    """Z + accent sur fond transparent (positions natives 512)."""
    S = size / 512.0
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img = Image.composite(_silver_grad(size), img, _z_mask(size, S))
    d = ImageDraw.Draw(img)
    _draw_accent_rect(d, S)
    return img


def render_foreground(size):
    """Z + accent sur fond transparent, recadré et centré (zone sûre ~66%)."""
    mark = render_mark(512)
    bbox = mark.getbbox()
    cropped = mark.crop(bbox)
    target = int(size * 0.66)
    w, h = cropped.size
    sc = min(target / w, target / h)
    new = (int(w * sc), int(h * sc))
    resized = cropped.resize(new, Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ox, oy = (size - new[0]) // 2, (size - new[1]) // 2
    canvas.paste(resized, (ox, oy), resized)
    return canvas


def _write_adaptive_xml():
    """Écrit le fond adaptive icon en dark premium (sinon AAPT garde le violet par défaut)."""
    drawable_dir = os.path.join(RES, "drawable")
    values_dir = os.path.join(RES, "values")
    os.makedirs(drawable_dir, exist_ok=True)
    os.makedirs(values_dir, exist_ok=True)
    drawable_xml = """<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item>
        <shape android:shape="rectangle">
            <gradient
                android:type="linear"
                android:angle="135"
                android:startColor="#14141B"
                android:centerColor="#08080C"
                android:endColor="#030305" />
        </shape>
    </item>
</layer-list>
"""
    with open(os.path.join(drawable_dir, "ic_launcher_background.xml"), "w") as f:
        f.write(drawable_xml)
    values_xml = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#06060a</color>
</resources>
"""
    with open(os.path.join(values_dir, "ic_launcher_background.xml"), "w") as f:
        f.write(values_xml)
    print("Adaptive icon background: dark premium (#14141B -> #030305)")


def main():
    os.makedirs(PUBLIC, exist_ok=True)
    # Web / PWA
    render_full(512).save(os.path.join(PUBLIC, "icon-512.png"))
    render_full(192).save(os.path.join(PUBLIC, "icon-192.png"))
    render_full(180).save(os.path.join(PUBLIC, "apple-touch-icon.png"))
    ico = render_full(256)
    ico.save(
        os.path.join(PUBLIC, "favicon.ico"),
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("Web: icon-512.png, icon-192.png, apple-touch-icon.png, favicon.ico")

    # Android launcher
    for (dpi, leg, fg) in DENSITIES:
        folder = os.path.join(RES, f"mipmap-{dpi}")
        os.makedirs(folder, exist_ok=True)
        render_full(leg).save(os.path.join(folder, "ic_launcher.png"))
        render_full(leg).save(os.path.join(folder, "ic_launcher_round.png"))
        render_foreground(fg).save(os.path.join(folder, "ic_launcher_foreground.png"))
    print("Android: ic_launcher / _round / _foreground (5 densités)")
    _write_adaptive_xml()


if __name__ == "__main__":
    main()
