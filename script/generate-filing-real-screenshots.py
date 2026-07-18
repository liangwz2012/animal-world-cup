from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "备案截图" / "动物足球赛"
REF_DIR = ROOT / "wechat-minigame-cocos-production" / "reference-screenshots" / "user-phone-rotated-ccw90"
GAME_NAME = "动物足球赛"
SIZE = (1280, 720)
HEADER_HEIGHT = 64
CONTENT_SIZE = (SIZE[0], SIZE[1] - HEADER_HEIGHT)


SOURCES = {
    "loading": REF_DIR / "01-1ac7b8db31fe3bcb79861c0ef3f6136d.jpg",
    "wide_field": REF_DIR / "02-22c755ca3f872149ce2cb24ed63f23ab.jpg",
    "setup": REF_DIR / "03-d59a6a9d5ac3667836dc9c3bfe400b90.jpg",
    "kickoff": REF_DIR / "04-8bcf73d49e978b2a80ef8819b6fe6d8f.jpg",
    "stats_1": REF_DIR / "05-12bfc09443cc518c2c1fe3ee1d975919.jpg",
    "stats_2": REF_DIR / "06-d90df310dbdd53fd50f637475ea2968a.jpg",
    "goal_net": REF_DIR / "07-7e686f8a44ebc0bc3961c77c99f650c2.jpg",
    "crowd_goal": REF_DIR / "08-cef23a29c0caab51faac905cc4961817.jpg",
}


OUTPUTS = [
    ("01_微信小游戏_加载页.png", "loading", "loading"),
    ("02_微信小游戏_阵型选择.png", "setup", "setup"),
    ("03_微信小游戏_比赛全景.png", "wide_field", "game"),
    ("04_微信小游戏_开球操作.png", "kickoff", "game"),
    ("05_微信小游戏_数据面板.png", "stats_1", "game"),
    ("06_微信小游戏_带球射门.png", "stats_2", "game"),
    ("07_微信小游戏_禁区攻门.png", "goal_net", "game"),
    ("08_微信小游戏_观众进球.png", "crowd_goal", "game"),
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in (
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
    ):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


NAV_TITLE_FONT = font(30)
NAV_SUBTITLE_FONT = font(18)
TITLE_FONT = font(42)
SUBTITLE_FONT = font(24)


def game_crop(source: Image.Image, mode: str) -> Image.Image:
    if source.size != (2440, 1080):
        return ImageOps.fit(source, CONTENT_SIZE, method=Image.Resampling.LANCZOS)

    if mode == "setup":
        pure_game_box = (160, 0, 2072, 1080)
    elif mode == "loading":
        pure_game_box = (270, 0, 2440, 1080)
    else:
        pure_game_box = (270, 0, 2440, 1080)
    pure_game = source.crop(pure_game_box)
    return ImageOps.fit(pure_game, CONTENT_SIZE, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))


def text_bbox(draw: ImageDraw.ImageDraw, xy, text: str, fnt: ImageFont.FreeTypeFont):
    try:
        return draw.textbbox(xy, text, font=fnt)
    except AttributeError:
        w, h = draw.textsize(text, font=fnt)
        x, y = xy
        return (x, y, x + w, y + h)


def draw_centered_text(draw: ImageDraw.ImageDraw, y: int, text: str, fnt: ImageFont.FreeTypeFont, fill, stroke_fill=None, stroke_width=0):
    bbox = text_bbox(draw, (0, 0), text, fnt)
    x = (SIZE[0] - (bbox[2] - bbox[0])) // 2
    draw.text((x, y), text, font=fnt, fill=fill, stroke_width=stroke_width, stroke_fill=stroke_fill)


def cover_old_setup_title(image: Image.Image) -> None:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.rounded_rectangle((472, 40, 808, 108), radius=30, fill=(246, 255, 235, 238))
    overlay_draw.rounded_rectangle((472, 40, 808, 108), radius=30, outline=(82, 145, 54, 200), width=2)
    image.alpha_composite(overlay)
    draw = ImageDraw.Draw(image)
    draw_centered_text(draw, 50, GAME_NAME, TITLE_FONT, "#ffffff", "#224018", 4)


def add_loading_title(image: Image.Image) -> None:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rounded_rectangle((472, 92, 808, 160), radius=30, fill=(255, 255, 255, 224))
    image.alpha_composite(overlay)
    draw = ImageDraw.Draw(image)
    draw_centered_text(draw, 102, GAME_NAME, TITLE_FONT, "#315222")
    draw_centered_text(draw, 162, "master-ai.cn/football", SUBTITLE_FONT, "#426b2e")


def add_wechat_title_bar(image: Image.Image) -> Image.Image:
    framed = Image.new("RGBA", SIZE, (255, 255, 255, 255))
    framed.alpha_composite(image, (0, HEADER_HEIGHT))
    draw = ImageDraw.Draw(framed)
    draw.rectangle((0, 0, SIZE[0], HEADER_HEIGHT), fill=(255, 255, 255, 255))
    draw.text((52, 14), GAME_NAME, font=NAV_TITLE_FONT, fill=(28, 33, 38, 255))
    draw.text((212, 22), "微信小游戏", font=NAV_SUBTITLE_FONT, fill=(112, 122, 132, 255))
    draw.rounded_rectangle((1132, 16, 1238, 48), radius=16, fill=(50, 62, 55, 255))
    for x in (1160, 1180, 1200):
        draw.ellipse((x - 4, 28 - 4, x + 4, 28 + 4), fill=(255, 255, 255, 255))
    draw.ellipse((1214, 21, 1228, 35), outline=(255, 255, 255, 255), width=3)
    return framed


def render(output_name: str, source_key: str, mode: str) -> Path:
    source = Image.open(SOURCES[source_key]).convert("RGBA")
    image = game_crop(source, mode)
    if mode == "setup":
        cover_old_setup_title(image)
    elif mode == "loading":
        add_loading_title(image)
    image = add_wechat_title_bar(image)
    target = OUT_DIR / output_name
    image.convert("RGB").save(target, "PNG", optimize=True)
    return target


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old_file in OUT_DIR.glob("*"):
        if old_file.suffix.lower() in {".png", ".jpg", ".jpeg"}:
            old_file.unlink()
    rows = []
    for output_name, source_key, mode in OUTPUTS:
        target = render(output_name, source_key, mode)
        rows.append(f"{target.name}\t{target.stat().st_size // 1024}KB")
    print(OUT_DIR)
    print("\n".join(rows))


if __name__ == "__main__":
    main()
