#!/usr/bin/env python3
"""Draws the Vice Pack item icons (16x16 pixel art) and the pack icons. Pure Python, no PIL needed.

Run: python3 tools/vice_textures.py   (rewrites the PNGs in "Vice Pack RP/textures/items" and both pack_icon.png)
"""
import math, os, struct, zlib

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(root, "Vice Pack RP")
BP = os.path.join(root, "Vice Pack BP")


def hexc(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


CLEAR = (0, 0, 0, 0)


def write_png(path, px):
    h, w = len(px), len(px[0])
    raw = b"".join(b"\x00" + b"".join(bytes(c) for c in row) for row in px)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) \
        + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def from_map(rows, pal):
    assert len(rows) == 16, len(rows)
    out = []
    for r in rows:
        assert len(r) == 16, (r, len(r))
        out.append([pal.get(ch, CLEAR) if ch != "." else CLEAR for ch in r])
    return out


def outline(px, color=hexc("#1e1410"), skip=()):
    """Dark 1px outline around the opaque shape (pixels in `skip` colours, like smoke, get none)."""
    h, w = len(px), len(px[0])
    out = [row[:] for row in px]
    for y in range(h):
        for x in range(w):
            if px[y][x][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and px[ny][nx][3] and px[ny][nx] not in skip:
                    out[y][x] = color
                    break
    return out


def stick(a, b, width, color_at):
    """A diagonal stick from a to b; color_at(t, side) gives the colour (t 0..1 along it, side -1..1 across it)."""
    px = [[CLEAR] * 16 for _ in range(16)]
    ax, ay = a; bx, by = b
    dx, dy = bx - ax, by - ay
    ln = math.hypot(dx, dy)
    for y in range(16):
        for x in range(16):
            cx, cy = x + 0.5 - ax, y + 0.5 - ay
            t = (cx * dx + cy * dy) / (ln * ln)
            if t < 0 or t > 1:
                continue
            side = (cx * dy - cy * dx) / ln
            if abs(side) <= width / 2:
                px[y][x] = color_at(t, side / (width / 2))
    return px


def put(px, pts, c):
    for x, y in pts:
        px[y][x] = c


# ---------------------------------------------------------------- icons
def beer():
    rows = [
        "................",
        ".......cc.......",
        ".......CC.......",
        ".......bb.......",
        ".......Bb.......",
        "......bhBb......",
        ".....bhBBBb.....",
        ".....bhBBBb.....",
        ".....bwwwwb.....",
        ".....bwrrwb.....",
        ".....bwwwwb.....",
        ".....bhBBBb.....",
        ".....bhBBBb.....",
        ".....bhBBBb.....",
        "......bbbb......",
        "................",
    ]
    return from_map(rows, {
        "c": hexc("#f2c94c"), "C": hexc("#b8901f"), "b": hexc("#3b1f0b"), "B": hexc("#8a4b14"),
        "h": hexc("#c97f2e"), "w": hexc("#f1e3c2"), "r": hexc("#c0392b"),
    })


def liquor():
    rows = [
        "................",
        ".......kk.......",
        ".......KK.......",
        "......gLLg......",
        "......gLLg......",
        ".....gLLLLg.....",
        "....gLAAAALg....",
        "....gAhAAAAg....",
        "....gAhAAAAg....",
        "....gwwwwwwg....",
        "....gwXXXXwg....",
        "....gwwwwwwg....",
        "....gAhAAAAg....",
        "....gAAAAAAg....",
        "....gggggggg....",
        "................",
    ]
    return from_map(rows, {
        "k": hexc("#c8a26a"), "K": hexc("#8f6a3a"), "g": hexc("#40585c"), "L": hexc("#d6eef2", 200),
        "A": hexc("#b5651d"), "h": hexc("#e3a050"), "w": hexc("#202020"), "X": hexc("#e8d48a"),
    })


def cigarette():
    def col(t, s):
        if t < 0.25:                       # filter
            return hexc("#d9822b") if s < 0.2 else hexc("#a85d16")
        if t < 0.86:                       # paper
            return hexc("#f4f4f0") if s < 0.2 else hexc("#c9c9c2")
        if t < 0.94:                       # ash
            return hexc("#8a8a8a")
        return hexc("#ffb000") if s < 0 else hexc("#ff4a12")   # ember
    px = stick((2.5, 13.5), (13, 3), 2.2, col)
    smoke = [hexc("#b0b0b0", 170), hexc("#d0d0d0", 120)]
    px = outline(px)
    put(px, [(14, 1), (13, 0)], smoke[0])
    put(px, [(15, 0)], smoke[1])
    return px


def cigar():
    band_a, band_b = 0.22, 0.32
    def col(t, s):
        if t < 0.04:
            return hexc("#4a2812")
        if band_a <= t < band_b:            # paper band
            return hexc("#d4af37") if abs(s) < 0.35 else hexc("#b0262b")
        if t < 0.88:                         # wrapper leaf
            if s < -0.3:
                return hexc("#9a5c30")
            return hexc("#6b3a1e") if s < 0.45 else hexc("#4a2812")
        if t < 0.95:
            return hexc("#9a9a9a")
        return hexc("#ff6a1a")
    px = stick((2, 14), (13, 3), 3.4, col)
    px = outline(px)
    put(px, [(14, 1), (15, 0)], hexc("#b8b8b8", 150))
    return px


def cocaine():
    rows = [
        "................",
        "................",
        "....pppppppp....",
        "....prrrrrrp....",
        "....pLLLLLLp....",
        "....pLLLLLLp....",
        "....pLLLWLLp....",
        "....pLWWWWLp....",
        "....pWWWWWWp....",
        "....pWWwWWWp....",
        "....pWWWWWWp....",
        "....pWwWWWwp....",
        "....pWWWWWWp....",
        ".....pppppp.....",
        "................",
        "................",
    ]
    return from_map(rows, {
        "p": hexc("#7f8c95"), "r": hexc("#d03a3a"), "L": hexc("#e6f0f4", 140),
        "W": hexc("#ffffff"), "w": hexc("#d8dde0"),
    })


def ketamine():
    rows = [
        "................",
        "......PPPP......",
        "......PQQP......",
        "......gLLg......",
        "......gLLg......",
        ".....gLLLLg.....",
        ".....gLLLLg.....",
        ".....gwwwwg.....",
        ".....gwKKwg.....",
        ".....gwwwwg.....",
        ".....gCCCCg.....",
        ".....gChCCg.....",
        ".....gCCCCg.....",
        ".....gCCCCg.....",
        "......gggg......",
        "................",
    ]
    return from_map(rows, {
        "P": hexc("#8e4fd0"), "Q": hexc("#5c2d91"), "g": hexc("#4b5563"), "L": hexc("#e8f6fb", 150),
        "w": hexc("#f5f5f5"), "K": hexc("#7b3fb5"), "C": hexc("#cfe9ff"), "h": hexc("#ffffff"),
    })


def opium():
    rows = [
        "................",
        ".....c.c.c......",
        ".....cccccc.....",
        "....oGGGGGGo....",
        "...oGGhGGGGGo...",
        "...oGhGGGGGGo...",
        "...oGGGGGrGGo...",
        "...oGGGGGrGGo...",
        "...oGGGGGrRGo...",
        "....oGGGGRGo....",
        ".....oGGGGo.....",
        "......oddo......",
        ".......ss.......",
        ".......ss.......",
        "......ss........",
        "................",
    ]
    return from_map(rows, {
        "c": hexc("#4a5a2a"), "o": hexc("#2f3a1c"), "G": hexc("#8fa36a"), "h": hexc("#c4d39f"),
        "r": hexc("#4a2410"), "R": hexc("#2a1306"), "d": hexc("#556b2f"), "s": hexc("#5f8a3a"),
    })


ICONS = {
    "vice_beer": beer, "vice_liquor": liquor, "vice_cigarette": cigarette, "vice_cigar": cigar,
    "vice_cocaine": cocaine, "vice_ketamine": ketamine, "vice_opium": opium,
}


def pack_icon(icons):
    """64x64: dark tile with four of the icons, each drawn 2x."""
    px = [[hexc("#241a2e")] * 64 for _ in range(64)]
    for y in range(64):
        for x in range(64):
            if x in (0, 63) or y in (0, 63):
                px[y][x] = hexc("#c9a227")
    for (ox, oy), icon in zip(((0, 0), (32, 0), (0, 32), (32, 32)), icons):
        for y in range(16):
            for x in range(16):
                c = icon[y][x]
                if c[3] < 100:
                    continue
                for sy in range(2):
                    for sx in range(2):
                        px[oy + y * 2 + sy][ox + x * 2 + sx] = c[:3] + (255,)
    return px


if __name__ == "__main__":
    drawn = {}
    for name, fn in ICONS.items():
        drawn[name] = fn()
        write_png(os.path.join(RP, "textures", "items", name + ".png"), drawn[name])
    icon = pack_icon([drawn["vice_beer"], drawn["vice_cigarette"], drawn["vice_cocaine"], drawn["vice_opium"]])
    write_png(os.path.join(RP, "pack_icon.png"), icon)
    write_png(os.path.join(BP, "pack_icon.png"), icon)
    print("wrote", len(drawn), "icons + pack icons")
