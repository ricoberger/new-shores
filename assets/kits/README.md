# Model kits (not committed)

The building and ship models in `client/public/models/` are kit-bashed by
the asset build (`assets/build/`, README "Asset build") from CC0 kits by
[Quaternius](https://quaternius.com) and [Kay Lousberg](https://kaylousberg.com)
(KayKit). The kit files are **inputs only**: they
are never committed (see `.gitignore`), and the build verifies every file it
uses against the sha256 in [`MANIFEST.json`](MANIFEST.json). The committed
GLBs and `manifest.json` are what the client loads — the client build, the
tests and CI never need the kits or Blender.

| Kit | Download | Directory under the kit root | Licence |
|---|---|---|---|
| Medieval Village MegaKit (Source edition) | <https://quaternius.com/packs/medievalvillagemegakit.html> | `Medieval-Village-MegaKit-Source/` | CC0 1.0 (`License_Source.txt` in the kit) |
| Pirate Kit | <https://quaternius.com/packs/piratekit.html> | `Pirate-Kit/` | CC0 1.0 (<https://creativecommons.org/publicdomain/zero/1.0/>; the kit ships no licence file) |
| KayKit Medieval Hexagon Pack 1.0 (FREE) | <https://kaylousberg.itch.io/kaykit-medieval-hexagon-pack> | `KayKit_Medieval_Hexagon_Pack_1.0_FREE/` | CC0 1.0 (`License.txt` in the kit) |
| KayKit Forest Nature Pack 1.0 (FREE) | <https://kaylousberg.itch.io/kaykit-forest-nature-pack> | `KayKit_Forest_Nature_Pack_1.0_FREE/` | CC0 1.0 (`License.txt` in the kit) |

The build reads the `glTF/` folder of each Quaternius kit (Medieval:
`.gltf` + `.bin` per piece; Pirate: self-contained `.gltf` files with the
embedded atlas) and `Assets/gltf/` of each KayKit pack (`.gltf` + `.bin`
per piece). KayKit pieces are coloured by a gradient atlas: the build
classifies every face by the atlas **cell** of its UV centroid (8 × 4 grid;
no triangle spans cells) and by the band of the cell's light → dark
gradient, and maps the cell to a palette role (`KIT_ATLAS_CELLS` in
`assets/build/nsassets/config.py`; recipes re-colour `Atlas/<swatch>` or
one band `Atlas/<swatch>@<0-2>`, e.g. the `team` swatch = the roofs). The
atlas image itself is not read, so it is not pinned. KayKit buildings have
no hex base (the hex tiles are separate files); their front faces −y.

`MANIFEST.json` lists exactly the files the recipes use (plus every kit's
licence file) with their sha256, the kit version and the download date.
The KayKit packs replace the Stylized Nature MegaKit of the earlier art
plan for nature (trees, bushes, rocks, grass).

## Where the build looks

The kit root is `$NEW_SHORES_KITS_DIR` if set, else this directory
(`assets/kits/`). Either

- unpack the kits anywhere and point the variable at the directory that
  contains `Medieval-Village-MegaKit-Source/`, `Pirate-Kit/` and the two
  `KayKit_*_1.0_FREE/` directories:

  ```sh
  export NEW_SHORES_KITS_DIR=~/Downloads/quaternius
  ```

- or unpack (or symlink) the kit directories here, next to this file:

  ```sh
  ln -s ~/Downloads/quaternius/Medieval-Village-MegaKit-Source assets/kits/
  ln -s ~/Downloads/quaternius/Pirate-Kit assets/kits/
  ln -s ~/Downloads/kaykit/KayKit_Medieval_Hexagon_Pack_1.0_FREE assets/kits/
  ln -s ~/Downloads/kaykit/KayKit_Forest_Nature_Pack_1.0_FREE assets/kits/
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
