"""Palette roles (assets/palette.json) for the re-palette of kit pieces and primitives."""

import hashlib
import json

from . import config


def load(path=config.PALETTE_PATH):
    """Returns (roles, sha256): role name → (r, g, b) in 0..1 (sRGB, as the renderer uses them)."""
    with open(path, "rb") as f:
        raw = f.read()
    data = json.loads(raw.decode("utf-8"))
    roles = {}
    for group in config.ROLE_GROUPS:
        colors = data["groups"][group]["colors"]
        for name in sorted(colors):
            if name in roles:
                raise ValueError(f"palette: role {name!r} is defined in more than one material group")
            roles[name] = hex_rgb(colors[name])
    return roles, hashlib.sha256(raw).hexdigest()


def load_shadows(path=config.PALETTE_PATH):
    """Shadow tone per role (palette group "shadows"): role name → (r, g, b); every material role must have one."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    roles, _ = load(path)
    colors = data["groups"].get(config.SHADOW_GROUP, {}).get("colors", {})
    missing = sorted(set(roles) - set(colors))
    if missing:
        raise ValueError(f"palette: group {config.SHADOW_GROUP!r} lacks a shadow tone for {', '.join(missing)}")
    return {name: hex_rgb(colors[name]) for name in sorted(roles)}


def hex_rgb(h):
    """'#RRGGBB' → (r, g, b) floats in 0..1."""
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))


def shaded(rgb, shade):
    """A palette colour × shade, clamped to 1."""
    return tuple(min(1.0, c * shade) for c in rgb)


def to_byte(c):
    """A 0..1 channel as the exported UNSIGNED_BYTE (round half up, deterministic)."""
    return max(0, min(255, int(c * 255.0 + 0.5)))
