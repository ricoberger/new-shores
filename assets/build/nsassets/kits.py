"""Kit pinning: assets/kits/MANIFEST.json lists every kit file the recipes use with its sha256."""

import hashlib
import json
import os

from . import config


class KitError(Exception):
    """A kit directory or file is missing or differs from MANIFEST.json."""


def load_manifest(path=config.KITS_MANIFEST_PATH):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def kit_files(manifest):
    """(kit id, relative file) → sha256 of every pinned file."""
    out = {}
    for kit in manifest["kits"]:
        for rel, sha in kit["files"].items():
            out[(kit["id"], rel)] = sha
    return out


def kit_dir(manifest, kit_id, root=None):
    root = root or config.kits_root()
    for kit in manifest["kits"]:
        if kit["id"] == kit_id:
            return os.path.join(root, kit["dir"])
    raise KitError(f"unknown kit {kit_id!r}")


def file_path(manifest, kit_id, rel, root=None):
    return os.path.join(kit_dir(manifest, kit_id, root), rel)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify(manifest, root=None, needed=None):
    """
    Verifies the pinned kit files (all of them, or the (kit, file) pairs in
    `needed` plus the licence files). Raises KitError naming every missing
    or changed file.
    """
    root = root or config.kits_root()
    problems = []
    for kit in manifest["kits"]:
        base = os.path.join(root, kit["dir"])
        if not os.path.isdir(base):
            problems.append(f"missing kit directory {kit['dir']}/ (kit {kit['id']})")
            for rel in sorted(kit["files"]):
                problems.append(f"missing {kit['dir']}/{rel}")
            continue
        for rel in sorted(kit["files"]):
            if needed is not None and (kit["id"], rel) not in needed and rel != kit.get("licence_file"):
                continue
            path = os.path.join(base, rel)
            if not os.path.isfile(path):
                problems.append(f"missing {kit['dir']}/{rel}")
            elif sha256_file(path) != kit["files"][rel]:
                problems.append(f"changed {kit['dir']}/{rel} (sha256 differs from MANIFEST.json)")
    if problems:
        raise KitError(
            f"kit verification failed under {root} ({len(problems)} problem(s)):\n  "
            + "\n  ".join(problems)
            + f"\nDownload the kits as described in {config.KITS_README} (or set {config.KITS_ENV})."
        )
