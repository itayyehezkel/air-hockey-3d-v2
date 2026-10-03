# Table theme pipeline

Turns a Scenario **turnaround concept sheet** into a themed table for the game. The result has the
exact Classic table shape (same size, height, rails and goals), with only the paint changed.
Everything here runs locally and costs 0 CU; only the concept sheet costs credits (about 16 CU).

Run every command from this folder (`tools/table-pipeline`).

## Rules for every table (the concept prompt must ask for them, and check them before building)

- **Reference:** edit the Classic turnaround `asset_V6gu1cHU13jaNL2zXWRxU2YY`, 2048×2048. The views
  are front (top-left), left (top-right), back (bottom-left) and right (bottom-right). Change only
  paint, textures and colors: no new shapes and nothing sticking out.
- **Goals:** the player's goal is the exact Classic light blue and the opponent's goal is the exact
  Classic red.
  - Front view: blue goal nearest.
  - Back view: red goal nearest.
  - Left view: blue goal on the left.
  - Right view: red goal on the left.
- **Corner caps:** all four are the plain Classic light blue, with nothing painted on them.
- **Playing surface:** plain and calm, with no pictures. The markings are solid lines with no
  outline. The surface is redrawn here anyway (step 4), so its line widths always match the Classic
  table.
- **Rails:**
  - Stripes or grain along the rail's length come out cleanest.
  - Rings or bands around the rail also work.
  - Unique marks along the rail do not work well.
- **Hyper-casual:** one clear, familiar idea (a waffle cone, a picnic blanket, a surfboard) beats a
  busy scene.

## One-time setup

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/mkmaster.py        # writes viewer/master-uv.glb from scripts/master.npz
```

`scripts/master.npz` is the Classic table geometry as exported from the game, merged into one
mesh with a texture layout. It was made by `scripts/unwrap.py` from `refs/classic_geom.*`, and you
only need to redo that if the Classic table's shape changes.

## Building a theme (example: `forest`)

1. **Download the sheet** from Scenario as PNG, for example to `refs/forest-sheet.png`.
2. **Line up the four views** with the Classic reference renders:
   ```bash
   .venv/bin/python scripts/align.py forest refs/forest-sheet.png
   ```
3. **Project the views onto the table** in the browser. Start the two local servers:
   ```bash
   (cd viewer && python3 -m http.server 8765) &
   python3 savesrv.py &                        # receives the bakes into refs/
   ```
   Open http://127.0.0.1:8765/bake.html and run in its console:
   ```js
   await bake('forest', 12);                               // all four views -> refs/bake_forest.png
   await bake('forest', 12, 0.06, [1,0,1,0], 'forest_fb'); // front/back only, for the goals
   ```
4. **Draw the sharp playing surface.** Copy the closest `scripts/surface_*.py`, set the theme's
   colors (sampled from the sheet), and run it to write `scripts/surface_forest.png`. It reuses the
   Classic layout (`src/assets/table-classic-surface.webp`), so dots, lines and circles match every
   table.
5. **Finish the texture.** This takes about 10 minutes. Pick how the side rails are painted:
   - `RAILS=lengthwise`: stripes or grain along the rail. Takes the typical color at each angle
     around the pipe, so it is perfectly clean.
   - `RAILS=oneview RAILS_MIRROR=1`: rings, bands or a pattern (bamboo, waffle, tiger stripes).
     Painted from the side views, and the inner side copies the outer side so no surface gets
     onto the rails.
   ```bash
   RAILS=lengthwise .venv/bin/python scripts/finish.py forest
   ```
6. **Build the model** and shrink it:
   ```bash
   .venv/bin/python scripts/build_theme.py forest scripts/surface_forest.png scripts/table-forest.glb
   npx -y @gltf-transform/cli@4 weld scripts/table-forest.glb scripts/tf-w.glb
   npx -y @gltf-transform/cli@4 quantize scripts/tf-w.glb ../../src/assets/table-forest.glb
   ```
7. **Add it to the game.** Do this only after the `.glb` exists, or the game will not load:
   - `src/game/Meshes.ts`: import the model and add a `TABLE_LOOKS` entry like the others
     (`kind: 'textured'`, `innerX: [-HALF_W, HALF_W]`, `innerZ: HALF_L`, `surfaceY: 0`,
     `unlit: true`).
   - `src/game/Skins.ts`: add it to `TABLE_SKINS` with a name and an unlock level.
8. **Check it** on the home screen, in a match and in the Locker. Look closely at both side rails.

## Tables built with this pipeline

| Table | Concept sheet | Surface script | Rails |
|---|---|---|---|
| Garden | asset_fVLLAFSX5FZ2AKxtAnwGRQtv | surface_garden.py | oneview |
| Cloudy | asset_U25M8r6HiVUq4LebQ6g3vgw7 | surface_cloudy.py | lengthwise |
| Picnic | asset_txdQLNJPr5TwbGY3YD9N9YZW | surface_picnic.py | lengthwise |
| Beach | asset_FUmbQ9dgmCX5XwDmxt1kLjKy | surface_beach.py | lengthwise |
| Ice Cream | asset_7ZGH2ApjJWE93s7svcR3WB85 | surface_icecream.py | oneview + mirror |
| Frozen | asset_4THRMSEvGfH97HHDH23hEoXf | surface_frozen.py | lengthwise |
| Dim Sum | asset_DZGCwTfwbeQ216tPczHpo3dW | surface_dimsum.py | oneview + mirror |
| Rainy | asset_bxXfXczSvy5voeskPTRLgc3j | surface_rainy.py | lengthwise |

## Files

- `scripts/align.py`: cuts the sheet into views and matches them to `refs/classic-turnaround/`.
- `viewer/bake.html`: projects the views onto the table. It uses a depth test, weights each view
  by how directly it sees a spot, and skips the cut-out background.
- `scripts/finish.py`:
  - paints the goals from front/back only;
  - paints the rails (`rails.py`, `lengthwise.py`) and the surface (`surface.py`);
  - fills hidden spots with their part's main color;
  - writes `scripts/tex_THEME.png`.
- `scripts/build_theme.py`: the final model. The surface has its own sharp image, and the rest
  uses the 2048 texture. Both are unlit, so the colors are exactly the painted ones.
- `scripts/glb.py`: a small GLB writer.
- `savesrv.py`: saves the bakes sent from `bake.html` into `refs/`.
