# Model kits (not committed)

The building, ship and decoration models in `client/public/models/` are
kit-bashed by the asset build (`assets/build/`, README "Asset build") from
two CC0 packs by [Kay Lousberg](https://kaylousberg.com) (KayKit), in their
**SOURCE** editions. The kit files are **inputs only**: they are never
committed (see `.gitignore`), and the build verifies every file it uses
against the sha256 in [`MANIFEST.json`](MANIFEST.json). The committed GLBs,
`manifest.json` and the build-card thumbnails (`thumbs/`) are what the
client loads — the client build, the tests and CI never need the kits or
Blender.

| Kit | Download | Directory under the kit root | Licence |
|---|---|---|---|
| KayKit Medieval Hexagon Pack 1.0 (SOURCE) | <https://kaylousberg.itch.io/kaykit-medieval-hexagon-pack> | `KayKit_Medieval_Hexagon_Pack_1.0_SOURCE/` | CC0 1.0 (`License.txt` in the kit) |
| KayKit Forest Nature Pack 1.0 (SOURCE) | <https://kaylousberg.itch.io/kaykit-forest-nature-pack> | `KayKit_Forest_Nature_Pack_1.0_SOURCE/` | CC0 1.0 (`License.txt` in the kit) |

The SOURCE editions are the paid tiers of the same itch.io pages; they
contain everything of the FREE editions (`KayKit_*_1.0_FREE/`), which the
build no longer reads — FREE folders can be deleted. The Quaternius kits of
the earlier art plan (Medieval Village MegaKit, Pirate Kit, Stylized
Nature MegaKit) are not used any more either.

The build reads `Assets/gltf/` of each pack (`.gltf` + `.bin` per piece):
the Hexagon pack's `buildings/`, `decoration/props/` and `units/` folders
(the `blue` files; colour variants differ only in the `team` swatch, which
recipes re-colour) and the Forest pack's `Color1/` folder. KayKit pieces are
coloured by a gradient atlas: the build classifies every face by the atlas
**cell** of its UV centroid (8 × 4 grid; no triangle spans cells) and by the
band of the cell's light → dark gradient, and maps the cell to a palette
role (`KIT_ATLAS_CELLS` in `assets/build/nsassets/config.py`; recipes
re-colour `Atlas/<swatch>` or one band `Atlas/<swatch>@<0-2>`, e.g. the
`team` swatch = the roofs and the sloop's sail stripes). The atlas image
itself is not read, so it is not pinned. KayKit buildings have no hex base
(the hex tiles are separate files); their front faces −y.

`MANIFEST.json` lists exactly the files the recipes use (plus every kit's
licence file) with their sha256, the kit version and the download date.

## Where the build looks

The kit root is `$NEW_SHORES_KITS_DIR` if set, else this directory
(`assets/kits/`). Either

- unpack the kits anywhere and point the variable at the directory that
  contains the two `KayKit_*_1.0_SOURCE/` directories:

  ```sh
  export NEW_SHORES_KITS_DIR=~/Downloads/kaykit
  ```

- or unpack (or symlink) the kit directories here, next to this file:

  ```sh
  ln -s ~/Downloads/kaykit/KayKit_Medieval_Hexagon_Pack_1.0_SOURCE assets/kits/
  ln -s ~/Downloads/kaykit/KayKit_Forest_Nature_Pack_1.0_SOURCE assets/kits/
  ```

  Everything in `assets/kits/` except `MANIFEST.json` and this README is
  ignored by git.

## Verify

```sh
make assets-check   # verifies the kit files, rebuilds into a temp dir and compares with the committed models and thumbnails
```

A missing kit directory, a missing file or a file whose sha256 differs aborts
the build with a non-zero exit, listing every problem. A newer kit release
with changed files needs a deliberate update: re-pin with
`python3 assets/build/build.py pin`, rebuild with `make assets`, review the
contact sheets in `assets/build/out/` and commit the recipes, `MANIFEST.json`
and the models together.
