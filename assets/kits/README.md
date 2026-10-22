# Model kits (not committed)

The building and ship models in `client/public/models/` are kit-bashed by
the asset build (`assets/build/`, README "Asset build") from two CC0 kits by
[Quaternius](https://quaternius.com). The kit files are **inputs only**: they
are never committed (see `.gitignore`), and the build verifies every file it
uses against the sha256 in [`MANIFEST.json`](MANIFEST.json). The committed
GLBs and `manifest.json` are what the client loads — the client build, the
tests and CI never need the kits or Blender.

| Kit | Download | Directory under the kit root | Licence |
|---|---|---|---|
| Medieval Village MegaKit (Source edition) | <https://quaternius.com/packs/medievalvillagemegakit.html> | `Medieval-Village-MegaKit-Source/` | CC0 1.0 (`License_Source.txt` in the kit) |
| Pirate Kit | <https://quaternius.com/packs/piratekit.html> | `Pirate-Kit/` | CC0 1.0 (<https://creativecommons.org/publicdomain/zero/1.0/>; the kit ships no licence file) |

The build reads the `glTF/` folder of each kit (Medieval: `.gltf` + `.bin`
per piece; Pirate: self-contained `.gltf` files with the embedded atlas).
`MANIFEST.json` lists exactly the files the recipes use (plus the Medieval
licence file) with their sha256, the kit version and the download date. The
Stylized Nature MegaKit (the third kit of the art plan) is not used yet; it
joins the manifest with the nature pass (ART_DIRECTION §9, task 4).

## Where the build looks

The kit root is `$NEW_SHORES_KITS_DIR` if set, else this directory
(`assets/kits/`). Either

- unpack the kits anywhere and point the variable at the directory that
  contains `Medieval-Village-MegaKit-Source/` and `Pirate-Kit/`:

  ```sh
  export NEW_SHORES_KITS_DIR=~/Downloads/quaternius
  ```

- or unpack (or symlink) the two kit directories here, next to this file:

  ```sh
  ln -s ~/Downloads/quaternius/Medieval-Village-MegaKit-Source assets/kits/
  ln -s ~/Downloads/quaternius/Pirate-Kit assets/kits/
  ```

  Everything in `assets/kits/` except `MANIFEST.json` and this README is
  ignored by git.

## Verify

```sh
make assets-check   # verifies the kit files, rebuilds into a temp dir and compares with the committed models
```

A missing kit directory, a missing file or a file whose sha256 differs aborts
the build with a non-zero exit, listing every problem. A newer kit release
with changed files needs a deliberate update: re-pin with
`python3 assets/build/build.py pin`, rebuild with `make assets`, review the
contact sheets in `assets/build/out/` and commit the recipes, `MANIFEST.json`
and the models together.
