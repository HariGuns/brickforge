# Third-party data and attribution

BrickForge's code is MIT-licensed (see [LICENSE](LICENSE)). Some of the data it ships, and some it can download, comes from other projects under their own licences.

## LDraw parts library

Part geometry, connection points and dimensions come from the [LDraw parts library](https://library.ldraw.org/), © LDraw.org and its contributors, licensed under [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) and [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (see the library's CAreadme.txt). The library itself isn't included; `npm run build-catalog` reads it from `ldraw-lib/`.

## LDCad shadow library

Connection (snap) data comes from the [LDCad shadow library](https://github.com/RolandMelkert/LDCadShadowLibrary) by Roland Melkert and contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). It isn't included; `npm run build-catalog` reads it from `ldraw-lib/shadow/`.

## Derived part data in this repository

`src/lib/parts/catalog.json` and the meshes in `public/parts/` are generated from the two libraries above by `scripts/build-catalog.ts`. They are shared under **CC BY-SA 4.0**, with attribution to LDraw.org and its contributors and to Roland Melkert and the LDCad shadow library contributors. Changes: parts were filtered, framed on a stud grid, given connection and collision data, and converted to compact meshes.

## Rebrickable

The BrickLink wanted-list export can use part and colour numbers from [Rebrickable](https://rebrickable.com/)'s API. That data is **not** included in this repository. Each user fetches it with their own Rebrickable API key (`npm run fetch-bricklink`), under Rebrickable's terms.

## Trademarks

LEGO® is a trademark of the LEGO Group, which does not sponsor, authorise or endorse this project. BrickLink is a trademark of its owner. Brick, part and colour names in the part data are LDraw's.
