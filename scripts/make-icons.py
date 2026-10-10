# Draws the extension icon: uneven bars on the left, levelled bars on the right.
# python scripts/make-icons.py  (needs Pillow)
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "src" / "icons"
BG = (217, 98, 43, 255)
FG = (255, 255, 255, 255)
S = 1024


def draw_master():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=230, fill=BG)
    # bar heights as a fraction of the drawable height: jumpy on the left, steady on the right
    heights = [0.25, 0.85, 0.4, 0.55, 0.55, 0.55]
    n = len(heights)
    margin, gap = 170, 44
    bw = (S - 2 * margin - gap * (n - 1)) / n
    top, bottom = 200, S - 200
    mid = (top + bottom) / 2
    for i, h in enumerate(heights):
        x0 = margin + i * (bw + gap)
        half = (bottom - top) * h / 2
        d.rounded_rectangle([x0, mid - half, x0 + bw, mid + half], radius=bw / 2, fill=FG)
    return img


def draw_small(size):
    # at 16 px six bars turn to mush, so three bars: two uneven, one level pair
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=200, fill=BG)
    heights = [0.3, 0.9, 0.55, 0.55]
    n = len(heights)
    margin, gap = 150, 90
    bw = (S - 2 * margin - gap * (n - 1)) / n
    top, bottom = 150, S - 150
    mid = (top + bottom) / 2
    for i, h in enumerate(heights):
        x0 = margin + i * (bw + gap)
        half = (bottom - top) * h / 2
        d.rounded_rectangle([x0, mid - half, x0 + bw, mid + half], radius=bw / 3, fill=FG)
    return img


OUT.mkdir(parents=True, exist_ok=True)
master, small = draw_master(), draw_small(16)
for size in (16, 32, 48, 128):
    src = small if size <= 32 else master
    src.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png")
master.resize((512, 512), Image.LANCZOS).save(OUT.parent.parent / "docs" / "icon-512.png") if (OUT.parent.parent / "docs").exists() else None
print("icons written to", OUT)
