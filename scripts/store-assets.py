# Builds store screenshots (1280x800) and the GitHub social preview (1280x640) from popup screenshots.
# Run scripts/screenshots.mjs first. python scripts/store-assets.py  (needs Pillow and Segoe UI from Windows)
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
OUT = DOCS / "store"
FONTS = Path("C:/Windows/Fonts")
BG = (27, 26, 24)
TEXT = (239, 236, 230)
MUTED = (161, 157, 148)
ACCENT = (240, 122, 65)

TEXTS = {
    "ru": ("Тихие диалоги\nгромче,\nвзрывы тише",
           "Усиление до 600% и автоматическое\nвыравнивание громкости видео\nна любом сайте.\n\nChrome, Edge, Яндекс Браузер,\nOpera, Brave, Firefox."),
    "en": ("Quiet dialog\nlouder,\nexplosions quieter",
           "Volume boost up to 600% and\nautomatic loudness leveling\nfor video on any site.\n\nChrome, Edge, Yandex Browser,\nOpera, Brave, Firefox."),
}


def font(bold, size):
    return ImageFont.truetype(str(FONTS / ("segoeuib.ttf" if bold else "segoeui.ttf")), size)


def shot(name, height):
    im = Image.open(DOCS / name).convert("RGB")
    w = round(im.width * height / im.height)
    im = im.resize((w, height), Image.LANCZOS)
    # rounded corners and a thin border so the light popup sits on the dark background
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, height - 1], radius=18, fill=255)
    framed = Image.new("RGB", (w + 4, height + 4), (70, 66, 60))
    fmask = Image.new("L", framed.size, 0)
    ImageDraw.Draw(fmask).rounded_rectangle([0, 0, w + 3, height + 3], radius=20, fill=255)
    framed.paste(im, (2, 2), mask)
    return framed, fmask


def store(lang):
    suffix = "" if lang == "ru" else "-en"
    title, sub = TEXTS[lang]
    img = Image.new("RGB", (1280, 800), BG)
    d = ImageDraw.Draw(img)
    icon = Image.open(ROOT / "src/icons/icon-128.png").resize((72, 72), Image.LANCZOS)
    img.paste(icon, (64, 64), icon)
    d.text((64, 170), title, font=font(True, 50), fill=TEXT, spacing=8)
    d.text((64, 380), sub, font=font(False, 22), fill=MUTED, spacing=8)
    main, m1 = shot(f"popup{suffix}.png", 540)
    adv, m2 = shot(f"popup-advanced{suffix}.png", 700)
    img.paste(adv, (1280 - adv.width - 48, 50), m2)
    img.paste(main, (1280 - adv.width - main.width - 80, 210), m1)
    assert 1280 - adv.width - main.width - 80 > 560, "screenshots overlap the text column"
    img.save(OUT / f"store-{lang}.png")


def social():
    img = Image.new("RGB", (1280, 640), BG)
    d = ImageDraw.Draw(img)
    icon = Image.open(ROOT / "src/icons/icon-128.png").resize((96, 96), Image.LANCZOS)
    img.paste(icon, (72, 96), icon)
    d.text((72, 220), "Steady Volume", font=font(True, 72), fill=TEXT)
    d.text((72, 315), "Ровный звук", font=font(True, 44), fill=ACCENT)
    d.text((72, 400), "Volume booster and loudness leveler\nfor Chrome, Edge, Yandex Browser, Opera, Firefox",
           font=font(False, 26), fill=MUTED, spacing=10)
    main, m = shot("popup-en.png", 540)
    img.paste(main, (1280 - main.width - 80, 50), m)
    img.save(OUT / "social-preview.png")


OUT.mkdir(exist_ok=True)
store("ru")
store("en")
social()
print("written to", OUT)
