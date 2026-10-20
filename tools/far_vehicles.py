#!/usr/bin/env python3
"""Far sight for vehicles: renders each vehicle's own model (boxes coloured from the vehicle palette) from 8 sides into
one particle atlas, textures/particle/war_farv.png, and prints the per-vehicle sizes main.js needs (FARV).

Each cell is 128x64. Column k is the vehicle seen from k*45 degrees round from its front (the same signed angle
main.js measures from the vehicle's heading to the viewer), row r is vehicle r in VEH order.
    python3 tools/far_vehicles.py
"""
import json, math, os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, "War Engine RP")
VEH = ["boat", "plane", "tank", "truck", "gunboat", "heli"]
CW, CH, SS, PITCH = 128, 64, 4, math.radians(8)

geo = {g["description"]["identifier"]: g for g in json.load(open(os.path.join(RP, "models/entity/war.geo.json")))["minecraft:geometry"]}
pal = Image.open(os.path.join(RP, "textures/entity/war_vehicle/palette.png")).convert("RGBA")
FACES = {"north": (0, 0, -1), "south": (0, 0, 1), "east": (1, 0, 0), "west": (-1, 0, 0), "up": (0, 1, 0), "down": (0, -1, 0)}

def boxes(name):
    out = []
    for b in geo[f"geometry.war_{name}"]["bones"]:
        for c in b.get("cubes", []):
            o, s = np.array(c["origin"], float), np.array(c["size"], float)
            col = {}
            for f in FACES:
                uv = c["uv"][f]["uv"] if isinstance(c["uv"], dict) else c["uv"]
                col[f] = np.array(pal.getpixel((int(uv[0]), int(uv[1])))[:3], float)
            out.append((o, o + s, col))
    return out

def camera(rel):
    rel += 1e-3                                               # (never exactly along an axis: the slab test divides by it)
    d = np.array([math.sin(rel) * math.cos(PITCH), math.sin(PITCH), -math.cos(rel) * math.cos(PITCH)])   # toward the viewer
    look = -d
    right = np.cross(look, [0, 1, 0]); right /= np.linalg.norm(right)
    up = np.cross(right, look)
    return look, right, up

LIGHT = np.array([0.4, 1.0, -0.6]); LIGHT /= np.linalg.norm(LIGHT)

def shade(n):
    return 0.55 + 0.45 * max(0.0, float(np.dot(n, LIGHT)))

def extents(bx):
    xs, ys = [], []
    for k in range(8):
        _, right, up = camera(k * math.pi / 4)
        for lo, hi, _ in bx:
            for cx in (lo[0], hi[0]):
                for cy in (lo[1], hi[1]):
                    for cz in (lo[2], hi[2]):
                        p = np.array([cx, cy, cz]); xs.append(abs(p @ right)); ys.append(p @ up)
    return max(xs), min(ys), max(ys)

def render(bx, rel, s, ytop):
    look, right, up = camera(rel)
    W, H = CW * SS, CH * SS
    px = (np.arange(W) + 0.5) / SS - CW / 2
    py = (np.arange(H) + 0.5) / SS
    gx, gy = np.meshgrid(px, py)
    sx, sy = gx / s, ytop - gy / s                            # screen coords in model units
    origin = sx[..., None] * right + sy[..., None] * up - look * 1000.0
    best = np.full((H, W), np.inf); rgb = np.zeros((H, W, 3))
    inv = np.where(np.abs(look) > 1e-9, 1.0 / np.where(np.abs(look) > 1e-9, look, 1), np.inf)
    for lo, hi, col in bx:
        t1 = (lo - origin) * inv; t2 = (hi - origin) * inv
        t1 = np.where(np.isfinite(inv), t1, np.where((origin >= lo) & (origin <= hi), -np.inf, np.inf))
        t2 = np.where(np.isfinite(inv), t2, np.where((origin >= lo) & (origin <= hi), np.inf, -np.inf))
        tn = np.minimum(t1, t2); tf = np.maximum(t1, t2)
        tnear = tn.max(-1); tfar = tf.min(-1); axis = tn.argmax(-1)
        hit = (tnear <= tfar) & (tnear < best)
        if not hit.any(): continue
        best = np.where(hit, tnear, best)
        for a, (neg, pos) in enumerate((("west", "east"), ("down", "up"), ("north", "south"))):
            for f, sign in ((neg, -1), (pos, 1)):
                if -look[a] * sign <= 0: continue            # faces away from the camera
                m = hit & (axis == a)
                rgb[m] = col[f] * shade(np.array(FACES[f], float))
    cov = np.isfinite(best).astype(float)
    rgb_s = rgb.reshape(CH, SS, CW, SS, 3).sum((1, 3)); cov_s = cov.reshape(CH, SS, CW, SS).sum((1, 3))
    out = np.zeros((CH, CW, 4), np.uint8)
    on = cov_s >= SS * SS * 0.4
    out[..., :3] = np.where(on[..., None], rgb_s / np.maximum(cov_s, 1)[..., None], 0).clip(0, 255)
    out[..., 3] = np.where(on, 255, 0)
    return out

atlas = np.zeros((CH * len(VEH), CW * 8, 4), np.uint8)
spec = {}
for r, v in enumerate(VEH):
    bx = boxes(v)
    rx, ylo, yhi = extents(bx)
    s = min(CW / 2 / rx, CH / (yhi - ylo)) * 0.98
    ytop = yhi + (CH / s - (yhi - ylo)) / 2
    for k in range(8):
        atlas[r * CH:(r + 1) * CH, k * CW:(k + 1) * CW] = render(bx, k * math.pi / 4, s, ytop)
    # billboard half sizes and the height of its centre above the entity, in blocks
    spec[v] = [round(CW / 2 / s / 16, 3), round(CH / 2 / s / 16, 3), round((ytop - CH / 2 / s) / 16, 3)]
Image.fromarray(atlas).save(os.path.join(RP, "textures/particle/war_farv.png"))
print("const FARV = " + json.dumps({f"war:{v}": [r] + spec[v] for r, v in enumerate(VEH)}).replace(" ", "") + ";")
