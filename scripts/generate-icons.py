#!/usr/bin/env python3
"""Generate Zentara app icons (PNG) from the neon lime design."""
from PIL import Image, ImageDraw, ImageFilter
import math

SIZES = [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]

def draw_rounded_rect(draw, xy, r, fill):
    """Draw a rounded rectangle."""
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle([x1, y1, x2, y2], radius=r, fill=fill)

def create_icon(size):
    """Create a Zentara Z monogram icon at given size."""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    
    # Background gradient (simplified)
    radius = int(size * 0.226)  # ~116/512
    margin = 2
    draw_rounded_rect(draw, (margin, margin, size - margin, size - margin), radius, (11, 15, 23, 255))  # #0b0f17
    
    # Inner glow border
    border_color = (148, 255, 1, 20)  # #94ff01 at 8%
    draw_rounded_rect(draw, (margin + 2, margin + 2, size - margin - 2, size - margin - 2), radius - 2, None)
    
    # Z letter geometry (proportional to 512x512)
    scale = size / 512.0
    z_top_y = int(164 * scale)
    z_bot_y = int(348 * scale)
    z_left_x = int(148 * scale)
    z_right_x = int(364 * scale)
    z_width = int(44 * scale)
    z_width_half = z_width // 2
    
    # Neon lime color
    neon = (148, 255, 1, 230)  # #94ff01
    bright = (164, 255, 46, 255)  # #a3ff2e
    
    # Draw Z with glow (multiple passes for faux glow)
    glow_colors = [
        (148, 255, 1, 22),  # outer glow
        (148, 255, 1, 35),  # mid glow
        (148, 255, 1, 55),  # inner glow
    ]
    glow_offsets = [6, 3, 1]
    
    for gcol, goff in zip(glow_colors, glow_offsets):
        for dx in [-goff, 0, goff]:
            for dy in [-goff, 0, goff]:
                # Top bar
                draw.line([(z_left_x + dx, z_top_y + dy), (z_right_x + dx, z_top_y + dy)], 
                         fill=gcol, width=z_width + goff * 2)
                # Bottom bar
                draw.line([(z_left_x + dx, z_bot_y + dy), (z_right_x + dx, z_bot_y + dy)], 
                         fill=gcol, width=z_width + goff * 2)
                # Diagonal
                draw.line([(z_right_x + dx, z_top_y + dy), (z_left_x + dx, z_bot_y + dy)], 
                         fill=gcol, width=z_width + goff * 2)
    
    # Main Z in neon
    for (x1, y1, x2, y2) in [
        (z_left_x, z_top_y, z_right_x, z_top_y),   # top bar
        (z_left_x, z_bot_y, z_right_x, z_bot_y),   # bottom bar
        (z_right_x, z_top_y, z_left_x, z_bot_y),   # diagonal
    ]:
        draw.line([(x1, y1), (x2, y2)], fill=neon, width=z_width)
    
    # Bright highlight on Z (upper edge)
    hl_x1 = z_left_x + int(2 * scale)
    hl_x2 = z_right_x - int(2 * scale)
    hl_y = z_top_y - int(4 * scale)
    draw.line([(hl_x1, hl_y), (hl_x2, hl_y)], fill=bright, width=int(6 * scale))
    
    # Accent dot bottom-right
    dot_r = int(14 * scale)
    dot_x = int(378 * scale)
    dot_y = int(378 * scale)
    # Glow for dot
    for r in range(dot_r + 6, dot_r, -2):
        alpha = max(5, 40 - (r - dot_r) * 8)
        draw.ellipse([dot_x - r, dot_y - r, dot_x + r, dot_y + r], 
                    fill=(148, 255, 1, alpha))
    draw.ellipse([dot_x - dot_r, dot_y - dot_r, dot_x + dot_r, dot_y + dot_r], 
                fill=(148, 255, 1, 240))
    
    return im

if __name__ == '__main__':
    import os
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'public')
    for sz, fname in SIZES:
        img = create_icon(sz)
        path = os.path.join(out_dir, fname)
        img.save(path, 'PNG')
        print(f'{fname}: {sz}x{sz} ✓')

    # Also create favicon.ico (multires)
    favicon = create_icon(256)
    ico_path = os.path.join(out_dir, 'favicon.ico')
    favicon.save(ico_path, 'ICO', sizes=[(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)])
    print(f'favicon.ico: multi-res ✓')
    print('All icons generated!')