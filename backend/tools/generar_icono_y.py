"""
Genera el icono de marca de Mayrit: la 'Y' naranja sobre fondo transparente,
usando la tipografía corporativa Aller Display. Produce:
  - mayrit-Y.ico            (raíz del repo, para el acceso directo)
  - frontend/public/favicon.ico  (pestaña del navegador)
  - backend/tools/_preview_icono.png (vista previa para revisar)

Uso:  python backend/tools/generar_icono_y.py
Requiere: Pillow  (pip install pillow)
"""
import os

from PIL import Image, ImageDraw, ImageFont

NARANJA = (218, 88, 51, 255)  # #da5833

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONT = os.path.join(ROOT, "frontend", "src", "assets", "fonts", "AllerDisplay.ttf")
PUBLIC = os.path.join(ROOT, "frontend", "public")
ICO_ROOT = os.path.join(ROOT, "mayrit-Y.ico")
FAVICON = os.path.join(PUBLIC, "favicon.ico")
PREVIEW = os.path.join(ROOT, "backend", "tools", "_preview_icono.png")
PNG_192 = os.path.join(PUBLIC, "icon-192.png")
PNG_512 = os.path.join(PUBLIC, "icon-512.png")

SIZES = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def render(canvas: int = 256) -> Image.Image:
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Tamaño de fuente grande; se ajusta para que la Y ocupe ~78% del lienzo.
    font = ImageFont.truetype(FONT, int(canvas * 0.95))
    bbox = draw.textbbox((0, 0), "Y", font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (canvas - w) / 2 - bbox[0]
    y = (canvas - h) / 2 - bbox[1]
    draw.text((x, y), "Y", font=font, fill=NARANJA)
    return img


def main():
    base = render(512)
    os.makedirs(PUBLIC, exist_ok=True)
    base.save(ICO_ROOT, format="ICO", sizes=SIZES)
    base.save(FAVICON, format="ICO", sizes=SIZES)
    base.resize((512, 512)).save(PNG_512, format="PNG")
    base.resize((192, 192)).save(PNG_192, format="PNG")
    base.resize((256, 256)).save(PREVIEW, format="PNG")
    print("Generado:")
    for p in (ICO_ROOT, FAVICON, PNG_192, PNG_512, PREVIEW):
        print("  -", p)


if __name__ == "__main__":
    main()
