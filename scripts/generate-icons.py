"""Generate the full app-icon set from web/icon/aidventure.png.

Scaling strategy:
  - Lanczos downsampling for all sizes (best for thin strokes + soft glow).
  - Unsharp mask on small favicons (<= 48px) to keep the gold linework visible.
  - Maskable PWA icons get a ~20% safe-zone padding on the brand dark background
    so Android launchers can crop to any shape without clipping the book.

Output sizes (browser + iOS + Android + PWA):
  - favicon-16.png, favicon-32.png, favicon-48.png
  - favicon.ico  (16/32/48 multi-res)
  - apple-touch-icon.png  (180x180, iOS home screen)
  - icon-192.png, icon-512.png  (PWA / Android Chrome)
  - icon-maskable-192.png, icon-maskable-512.png  (Android adaptive)
"""

from pathlib import Path
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "icon" / "aidventure.png"
OUT = ROOT / "web" / "icon"

# Brand background colour, matches index.html theme-color & near-black of the source.
BRAND_BG = (10, 10, 15)  # #0a0a0f

# Maskable safe zone: Android may crop to a shape inscribed in the inner 80%
# of the icon. We give the artwork ~78% of the canvas, leaving ~11% margin per side.
MASKABLE_INNER_RATIO = 0.78


def lanczos(src: Image.Image, size: int) -> Image.Image:
    return src.resize((size, size), Image.LANCZOS)


def sharpen_for_small(img: Image.Image) -> Image.Image:
    # Gentle unsharp: radius small relative to pixel size, modest amount.
    return img.filter(ImageFilter.UnsharpMask(radius=0.6, percent=110, threshold=2))


def make_maskable(src: Image.Image, size: int) -> Image.Image:
    inner = max(1, int(round(size * MASKABLE_INNER_RATIO)))
    art = src.resize((inner, inner), Image.LANCZOS)
    canvas = Image.new("RGB", (size, size), BRAND_BG)
    offset = ((size - inner) // 2, (size - inner) // 2)
    canvas.paste(art, offset)
    return canvas


def save_png(img: Image.Image, path: Path) -> None:
    img.save(path, format="PNG", optimize=True)
    print(f"  wrote {path.relative_to(ROOT)}  ({img.size[0]}x{img.size[1]})")


def main() -> None:
    print(f"Source: {SRC.relative_to(ROOT)}")
    src = Image.open(SRC).convert("RGB")
    print(f"  {src.size[0]}x{src.size[1]} {src.mode}")

    print("\nFavicons (Lanczos + mild unsharp)")
    favicon_imgs = {}
    for size in (16, 32, 48):
        img = sharpen_for_small(lanczos(src, size))
        favicon_imgs[size] = img
        save_png(img, OUT / f"favicon-{size}.png")

    ico_path = OUT / "favicon.ico"
    favicon_imgs[48].save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print(f"  wrote {ico_path.relative_to(ROOT)}  (multi-res 16/32/48)")

    print("\niOS home-screen icon (Lanczos)")
    save_png(lanczos(src, 180), OUT / "apple-touch-icon.png")

    print("\nPWA / Android standard icons (Lanczos)")
    save_png(lanczos(src, 192), OUT / "icon-192.png")
    save_png(lanczos(src, 512), OUT / "icon-512.png")

    print("\nAndroid maskable icons (Lanczos + safe-zone padding)")
    save_png(make_maskable(src, 192), OUT / "icon-maskable-192.png")
    save_png(make_maskable(src, 512), OUT / "icon-maskable-512.png")

    print("\nDone.")


if __name__ == "__main__":
    main()
