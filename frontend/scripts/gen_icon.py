#!/usr/bin/env python3
"""
Zentara app icon generator.
Renders a professional icon (violet gradient + bold white "Z" + fuchsia signal dot)
and writes every web + Android asset.

Usage: python3 gen_icon.py   (run from frontend/)
"""
import os
import numpy as np
from PIL import Image, ImageDraw

# ---------------------------------------------------------------------------
# Palette / geometry (in a 512-unit canvas)
# ---------------------------------------------------------------------------
C0 = np.array([139, 92, 246], dtype=np.float32)    # #8B5CF6 violet-500
C1 = np.array([124, 58, 237], dtype=np.float32)    # #7C3AED violet-600
C2 = np.array([79, 70, 229], dtype=np.float32)     # #4F46E5 indigo-600
WHITE = (255, 255, 255, 255)
FUCHSIA = (240, 171, 252, 255)                     # #F0ABFC

# Z polyline (round caps/joins) + accent dot, in 512-space.
Z_POINTS = [(148, 156), (352, 156), (148, 356), (352, 356)]
Z_WIDTH = 52
DOT = (400, 122, 17)  # cx, cy, r

# Content bounding box (for foreground safe-zone scaling).
CONTENT_MIN_X = 122
CONTENT_MAX_X = 417
CONTENT_MIN_Y = 105
CONTENT_MAX_Y = 382
CONTENT_W = CONTENT_MAX_X - CONTENT_MIN_X   # 295
CONTENT_H = CONTENT_MAX_Y - CONTENT_MIN_Y   # 277
CONTENT_CX = (CONTENT_MIN_X + CONTENT_MAX_X) / 2
CONTENT_CY = (CONTENT_MIN_Y + CONTENT_MAX_Y) / 2

SS = 4  # supersampling factor for anti-aliasing


def gradient_array(S):
    """Diagonal 3-stop gradient (0..1) as float RGB array (S x S x 3)."""
    y, x = np.mgrid[0:S, 0:S]
    t = (x + y) / (2.0 * (S - 1))
    t = np.clip(t, 0.0, 1.0)
    c = np.empty((S, S, 3), dtype=np.float32)
    m1 = t < 0.55
    m2 = ~m1
    tt1 = (t / 0.55)[m1]
    tt2 = ((t - 0.55) / 0.45)[m2]
    c[m1] = C0 + (C1 - C0) * tt1[:, None]
    c[m2] = C1 + (C2 - C1) * tt2[:, None]
    # Top gloss highlight (white fading over first 42%).
    gy = y / (S - 1)
    gloss = np.where(gy < 0.42, 0.18 * (1.0 - gy / 0.42), 0.0)
    c = c * (1.0 - gloss[..., None]) + 255.0 * gloss[..., None]
    return np.clip(c, 0, 255).astype(np.uint8)


def draw_mark(draw, scale, color=WHITE):
    """Draw the Z + dot onto a PIL draw at the given scale (512-space -> px)."""
    pts = [(int(x * scale), int(y * scale)) for x, y in Z_POINTS]
    w = max(1, int(Z_WIDTH * scale))
    draw.line(pts, fill=color, width=w, joint='curve')
    r = w / 2
    for (x, y) in pts:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)
    cx, cy, cr = DOT
    cx, cy, cr = cx * scale, cy * scale, cr * scale
    draw.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=FUCHSIA)


def render(size, mode='full'):
    """Render the icon at `size`. mode: 'full' | 'rounded' | 'foreground'."""
    S = size * SS
    base = Image.fromarray(gradient_array(S), 'RGB').convert('RGBA')

    if mode == 'rounded':
        mask = Image.new('L', (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.226), fill=255)
        base.putalpha(mask)
    elif mode == 'foreground':
        base = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    draw = ImageDraw.Draw(base)

    if mode == 'foreground':
        # Scale content into the 45% safe zone, centered.
        scale = (0.45 * S) / CONTENT_W
        ox = S / 2 - CONTENT_CX * scale
        oy = S / 2 - CONTENT_CY * scale
        # Draw via a temp layer then offset.
        layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        d2 = ImageDraw.Draw(layer)
        pts = [(int(x * scale), int(y * scale)) for x, y in Z_POINTS]
        w = max(1, int(Z_WIDTH * scale))
        d2.line(pts, fill=WHITE, width=w, joint='curve')
        r = w / 2
        for (x, y) in pts:
            d2.ellipse([x - r, y - r, x + r, y + r], fill=WHITE)
        cx, cy, cr = DOT
        cx, cy, cr = cx * scale, cy * scale, cr * scale
        d2.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=FUCHSIA)
        base = Image.alpha_composite(base, ImageChops_offset(layer, int(ox), int(oy)))
    else:
        draw_mark(draw, S / 512.0)

    return base.resize((size, size), Image.LANCZOS)


def ImageChops_offset(im, xoff, yoff):
    """Offset a transparent image by (xoff, yoff)."""
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(im, (xoff, yoff))
    return out


def main():
    root = os.path.dirname(os.path.abspath(__file__))
    pub = os.path.join(root, '..', 'public')
    res = os.path.join(root, '..', 'android', 'app', 'src', 'main', 'res')

    # ---- Web / PWA ----
    render(512, 'full').save(os.path.join(pub, 'icon-512.png'))
    render(192, 'full').save(os.path.join(pub, 'icon-192.png'))
    render(180, 'full').save(os.path.join(pub, 'apple-touch-icon.png'))
    ico = render(256, 'rounded')
    ico.save(os.path.join(pub, 'favicon.ico'), format='ICO', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

    # ---- Android launcher (legacy full icons) ----
    densities = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    for d, s in densities.items():
        dpath = os.path.join(res, f'mipmap-{d}')
        os.makedirs(dpath, exist_ok=True)
        render(s, 'full').save(os.path.join(dpath, 'ic_launcher.png'))
        render(s, 'full').save(os.path.join(dpath, 'ic_launcher_round.png'))

    # ---- Android adaptive foreground (transparent, safe zone) ----
    fg_densities = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
    for d, s in fg_densities.items():
        dpath = os.path.join(res, f'mipmap-{d}')
        os.makedirs(dpath, exist_ok=True)
        render(s, 'foreground').save(os.path.join(dpath, 'ic_launcher_foreground.png'))

    print('Icon assets generated.')


if __name__ == '__main__':
    main()
