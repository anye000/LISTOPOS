"""Genera los iconos PNG de ListoPOS (PWA/manifest) con el logo de recibo + check.

Uso: python scripts/generate-icons.py
Requiere: Pillow.
"""
import os

from PIL import Image, ImageDraw

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "..", "public", "icons")
os.makedirs(OUT_DIR, exist_ok=True)

S = 2048  # render en súper-muestreo para bordes suaves

NAVY = (11, 28, 48, 255)  # #0B1C30 Pizarra Oscura
BAND = (220, 225, 255, 255)  # #DCE1FF azul claro
GREEN = (5, 150, 105, 255)  # #059669 Esmeralda POS
WHITE = (255, 255, 255, 255)
SURFACE = (248, 249, 255, 255)  # #F8F9FF


def receipt_layer() -> Image.Image:
    """Recibo azul marino con borde inferior dentado y banda clara arriba."""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    x0, x1 = int(S * 0.27), int(S * 0.73)
    y0, y1 = int(S * 0.14), int(S * 0.64)
    teeth = 5
    depth = int(S * 0.05)
    tw = (x1 - x0) / teeth

    points = [(x0, y0), (x1, y0), (x1, y1)]
    for i in range(teeth):
        xr = x1 - i * tw
        points.append((xr - tw / 2, y1 - depth))
        points.append((xr - tw, y1))
    points.append((x0, y1))
    d.polygon(points, fill=NAVY)

    # Banda clara superior (el "rollo" del recibo)
    band_h = int((y1 - y0) * 0.22)
    d.polygon(
        [(x0, y0), (x1, y0), (x1, y0 + band_h), (x0, y0 + band_h)],
        fill=BAND,
    )
    # Líneas internas sutiles
    line_color = (3, 20, 39, 120)
    d.rounded_rectangle(
        [int(x0 + (x1 - x0) * 0.15), int(y0 + (y1 - y0) * 0.36),
         int(x0 + (x1 - x0) * 0.85), int(y0 + (y1 - y0) * 0.40)],
        radius=int(S * 0.008), fill=line_color,
    )
    d.rounded_rectangle(
        [int(x0 + (x1 - x0) * 0.15), int(y0 + (y1 - y0) * 0.46),
         int(x0 + (x1 - x0) * 0.62), int(y0 + (y1 - y0) * 0.50)],
        radius=int(S * 0.008), fill=line_color,
    )
    return layer.rotate(-10, resample=Image.BICUBIC)


def check(img: Image.Image) -> None:
    """Check esmeralda con halo blanco sobre el recibo."""
    d = ImageDraw.Draw(img)
    p1 = (int(S * 0.42), int(S * 0.58))
    p2 = (int(S * 0.52), int(S * 0.68))
    p3 = (int(S * 0.75), int(S * 0.36))
    d.line([p1, p2, p3], fill=WHITE, width=int(S * 0.095), joint="curve")
    d.line([p1, p2, p3], fill=GREEN, width=int(S * 0.06), joint="curve")
    r = int(S * 0.03)
    for px, py in (p1, p3):
        d.ellipse([px - r, py - r, px + r, py + r], fill=GREEN)


def make_icon(maskable: bool = False) -> Image.Image:
    if maskable:
        img = Image.new("RGBA", (S, S), SURFACE)
    else:
        img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255
        )
        img.paste(Image.new("RGBA", (S, S), WHITE), (0, 0), mask)
        # Borde sutil para favorecer el contraste en pestañas del navegador
        d = ImageDraw.Draw(img)
        d.rounded_rectangle(
            [2, 2, S - 3, S - 3], radius=int(S * 0.22),
            outline=(224, 225, 244, 255), width=int(S * 0.006),
        )
    img.alpha_composite(receipt_layer())
    check(img)
    return img


targets = [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("icon-180.png", 180, False),
    ("maskable-512.png", 512, True),
]

for name, size, maskable in targets:
    make_icon(maskable=maskable).resize((size, size), Image.LANCZOS).save(
        os.path.join(OUT_DIR, name)
    )
    print(f"generado public/icons/{name}")
