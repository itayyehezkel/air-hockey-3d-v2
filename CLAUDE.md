# Air Smash: notes for agents

Hyper-casual 3D air hockey for mobile. It is TypeScript + Babylon.js 9 + Vite, packaged with
Capacitor, and made by the user's studio "Pixel Pop Studio". All art comes from Scenario.com.
**This is a hyper-casual game:** keep things simple, bright, readable and quick to play.

## The user's standing rules (always follow)

1. **No git.** Don't run git commands (init, commit, branch, and so on) unless the user explicitly
   asks.
2. **Credits first.** Before any Scenario job that costs credits (CU), tell the user the cost and
   wait for a yes. Local work is free (0 CU); say so.
3. **Brainstorm means don't act.** When the user says "brainstorm", "just answer" or "do not do
   anything", only discuss. Don't generate or edit.
4. **Table colour rule.** On every table theme, the player's goal is the exact Classic blue and
   the opponent's goal is the exact Classic red. All four corner caps are the Classic blue.
   - Front view: blue goal nearest.
   - Back view: red goal nearest.
   - Left view: blue goal on the left.
   - Right view: red goal on the left.
5. **All tables are the same table.** Every table has the Classic shape and size; only the paint
   changes. The reference is the Classic turnaround `asset_V6gu1cHU13jaNL2zXWRxU2YY`.
6. **Playing surfaces stay calm.** Plain surface with no pictures or leaves. Markings are solid
   colour with no outline, and their line thickness matches the Classic table.
7. **Rails must be clean.** No dots, lines or other bits of the playing surface may end up on the
   rails. Always check both side rails close up.
8. **Particles are always small** (hyper-casual style):
   - small but readable bits, about 15–25% of the puck's width (puck sprites about 0.13–0.23);
   - a short life of about 0.2–0.45 s;
   - a quick outward pop, then shrink and fade;
   - nothing lingers, and nothing covers the puck.
   - In Babylon, `addSizeGradient` sets the absolute size (it overrides `minSize`/`maxSize`),
     so pass the real sizes to it.
9. **Verify before saying done.** Check the change in the running game (see "Checking your work").
   Put the player's equipped item back the way it was afterwards.

10. **One text style for the whole game** (user, 2026-10-03): every live text uses **Lilita One** (`--font`) in white
    with the gentle navy shadow-outline + navy depth edge, `text-shadow: var(--label-shadow)` (defined on `:root` in
    `styles.css`). New text must use it too. No stroke-outlines, no drop-shadow filters, no gradient fills on text.

## Performance (smoothness pass, 2026-10-03)

Measured in the dev game at phone size: per-frame JS is ~1 ms (update 0.1, render 0.9), so the real enemies are
one-off freezes. What was found and fixed, and the rules that keep it fixed:
- **Big animated text = freeze.** The match banner ("3/2/1/GO!/GOAL!") as live text with `--label-shadow` (36 soft
  shadows) cost 50-130 ms per new word. Banner words are now drawn once into canvases (`drawLabel` / `bannerImage` in
  UI.ts, prepared at startup in idle time) and only the image animates. Any new big animated text: same treatment.
- **First draw of a particle system = freeze.** The themed puck bits froze ~80 ms on the first burst of a match. Every
  particle system is warmed up out of sight while the match loads (Effects, PuckFx after its sprites load, the streak).
  A new particle system needs the same warm-up.
- **Locker card pictures are shipped**, not rendered on the phone: `src/assets/thumbs/<mallet|puck|table>-<id>.webp`
  (rendering them stuttered the Locker for ~4.5 s with 66-100 ms frames). Missing pictures (new items) still render
  live. **After adding or changing an item, re-bake:** `python3 tools/ui/thumbsrv.py` (project root), open the dev game
  with `?bakethumbs`, open the Locker and wait ~30 s, then `mv tools/ui/thumbs-out/*.webp src/assets/thumbs/`.
- **Auto quality** (`adaptResolution` in main.ts): starts at device pixel ratio (max 2); drops 0.25 when >= 4 frames
  miss the refresh within 2 s; judged only from 2 s after a screen is ready (loading stalls never count).
- Touch input uses a cached canvas rect (`GameScene.canvasRect`, refreshed on resize).
- Earlier rules still apply: no backdrop blur over the canvas, no text drop-shadow filters, pre-drawn glows/rays, the 3D
  table stops rendering under the result popup. Measure frame times (`requestAnimationFrame` deltas) before saying done.

## Scenario (art generation)

- Team `team_QVZYCrdTSuXowciXy7qPMynt`, project `proj_jrTZ3pL8UFrQ6qLUyRYp7kst` ("Air Hockey").
  The plan is Pro.
- **Images:** `model_openai-gpt-image-2-5-sunburst`.
  - Cost: 13 CU at 1024×2048, 16 CU at 2048².
  - Edits: pass the image to edit as the first `referenceImages` entry, and say "change ONLY …".
- **3D:**
  - `model_tripo-v3-1-image-to-3d`: 45 CU.
  - `model_tripo-v3-1-multiview-to-3d`: 90 CU.
  - `model_tripo-v3-0-texturing`: 30 CU. It only works on an UNTEXTURED mesh; a textured
    upload comes back unchanged.
- **Tripo gotchas:**
  - Tripo models often face backwards: add `yaw: Math.PI` to the skin.
  - For exact concept colours, use `delight: false, pbr: false` and render unlit.
- **Style:** glossy casual cartoon (Supercell/King look), sky-blue ray background with confetti.
  The home screen reference is `asset_nNyE7qX3ThdmKQS6nvJZkv8z`.

## Code map

| Path | What |
|---|---|
| `src/main.ts` | Bootstrap, screen switching, PLAY flow with the booster offer |
| `src/scenes/HomeScene.ts`, `GameScene.ts`, `LockerScene.ts` | Screens. GameScene has the camera tilt, intro swing, slow-mo and hit punch |
| `src/game/Meshes.ts` | Tables (`TABLE_LOOKS`), goals (`buildGoals`, `GOAL_FIT`), mallets, pucks, materials |
| `src/game/Skins.ts` | Locker catalogue: `MALLET_SKINS`, `TABLE_SKINS`, `PUCK_SKINS`, and what is equipped (localStorage `airsmash.locker`) |
| `src/game/Physics.ts` | Puck/mallet physics, corner anti-stick (`cornerAir`, `separatePinned`) |
| `src/game/Rig.ts`, `AI.ts`, `Effects.ts`, `Boosters.ts` | Physics→meshes sync, opponent AI (kept easy on purpose), effects, Big Mallet booster |
| `src/ui/UI.ts`, `LockerUI.ts` | Sprite-based UI cut from Scenario mockups (`src/assets/ui/`) |
| `tools/table-pipeline/` | **Builds themed tables locally (0 CU). Read its README before making a table.** |
| `resources/reference/` | Classic table reference renders and 3D model |

## Making a new table (summary; full recipe in `tools/table-pipeline/README.md`)

1. **Generate the sheet** (16 CU, confirm first). Edit `asset_V6gu1cHU13jaNL2zXWRxU2YY` into a
   themed 2×2 turnaround, putting rules 4–7 in the prompt.
2. **Check the sheet** in all four views before building: goal positions and colours, and blue
   corners.
3. **Build it** (0 CU):
   1. `align.py`
   2. Bake in `viewer/bake.html`: all four views, plus front/back only for the goals.
   3. A `surface_THEME.py` for the sharp surface.
   4. `finish.py` with `RAILS=lengthwise` (stripes or grain) or `RAILS=oneview RAILS_MIRROR=1`
      (rings or patterns).
   5. `build_theme.py`, then gltf-transform weld + quantize into `src/assets/table-THEME.glb`.
4. **Add it to the game only after the .glb exists.** A missing import breaks the whole game.
   Add it to `TABLE_LOOKS` (Meshes.ts) and `TABLE_SKINS` (Skins.ts).
5. **Check it** on the home screen, in a match and in the Locker, including close-ups of the rails.

**What the user likes in tables:** one familiar object made into a table, with the "material" on
the rails and body and a plain surface. Examples: Ice Cream (waffle and chocolate drips), Picnic
(soft checks), Beach (surfboard stripes), Cloudy, Dim Sum (bamboo steamer).
**What the user dislikes:** busy "place" scenes such as jungles with leaves everywhere, dark or
muddy colours, pictures on the playing surface, and strokes around the lines.

## Checking your work

- **Dev server:** use `preview_start` with the name `dev-5174` (see `.claude/launch.json`).
  Resize to a phone size, about 400×840, and reset to desktop afterwards.
- **Equipped items:** switch them through localStorage `airsmash.locker`
  (`{mallet, puck, table}`), then restore the user's previous value.
- **Free booster offer is OFF for now** (user, 2026-10-03; `OFFERS_ON` in Boosters.ts); boosters come later.
- **Helpers:** `?booster` forces the booster offer (dev, even while it is off), and `?stats=LEVEL,STARS,NEEDED,COINS` sets the player level, which decides what the Locker unlocks (`UNLOCK_ALL` is off since 2026-10-02).
- **Checks:** `npx tsc --noEmit -p .` for types. The APK is rebuilt **only when the user asks** (`npm run build:apk`;
  never after every change). It builds with Temurin JDK 21 in `~/.jdks/jdk-21.0.12.1+1` (downloaded 2026-10-03 with
  the user's OK): Android Studio's bundled Java became 25, which Gradle 8.14.3 can't run.
- **Hot-reload errors:** a console error left over from a half-finished edit can remain after a
  hot reload. Check its timestamp and reload before blaming the code.

## Current content (2026-09-30)

- **Tables** (Locker order): Classic, Dim Sum, Frozen, Beach, Rainy, Cloudy, Ice Cream, Picnic,
  Garden.
  Removed at the user's request: Ice (Tripo model) and Jungle.
  - `goal.glb` is still sized in the old Ice model's units; `GOAL_FIT` in Meshes.ts keeps those
    numbers. Don't delete it.
- **Mallets:** Classic, Panda, Ice, Watermelon, Frog, Rainbow, Donut, Strawberry, Cat.
  - Strawberry replaced Gold (2026-10-02): image `asset_c4MTRPpWu2fDgLzvmjfXdynn` (no gingham) →
    Tripo detailed texture (75 CU) `asset_1hW4z4h2NjxnNxUM4Nxjxroi`; 1024 textures. The base was
    painted one even red with `tools/puck-retouch/solid_zone.py SRC OUT 0.08 0.52 0.02` (keeps the
    yellow seeds) and its bump map flattened with `flatten_zone.py` (same zone), after the user
    rejected spill, a grey floor sliver and seam lines inside the ring. The metal-shine code (`metal: true`) is kept for a
    future gold item. Its inner ring was cleaned of spilled seed colour with
    `tools/puck-retouch/recolor_zone.py` (repaints anything off the zone's main colour).
  - **Shrink textures with `tools/puck-retouch/shrink_tex.py SRC OUT SIZE`, not
    `gltf-transform resize`**: on the detailed Strawberry model, resize changed vertex data and
    opened ~3,500 cracks. Retouch at 2048 and shrink last.
  - **Theme sets** (Locker order in every tab). **One item unlocks per level** (user, 2026-10-03), set by set in
    Locker order: the set's **mallet, then its table, then its puck** (user, 2026-10-03; it was mallet, puck, table).
    Unlock levels (mallet / table / puck):

    | # | Mallet | Table | Puck | Levels (M / T / P) |
    |---|---|---|---|---|
    | 1 | Classic | Classic | Star | 1 (start) |
    | 2 | Panda | Dim Sum | Bao Bun | 2 / 3 / 4 |
    | 3 | Ice | Frozen | Snowflake | 5 / 6 / 7 |
    | 4 | Watermelon | Beach | Beach Ball | 8 / 9 / 10 |
    | 5 | Frog | Rainy | Lily Pad | 11 / 12 / 13 |
    | 6 | Rainbow | Cloudy | Sun | 14 / 15 / 16 |
    | 7 | Donut | Ice Cream | Macaron | 17 / 18 / 19 |
    | 8 | Strawberry | Picnic | Cherry Pie | 20 / 21 / 22 |
    | 9 | Cat | Garden | Ladybug | 23 / 24 / 25 |

    A new theme gets a row here, and its items go at the same position in `MALLET_SKINS`,
    `TABLE_SKINS` and `PUCK_SKINS` (Skins.ts), continuing the levels (26 / 27 / 28, ...).
    `unlockAt(level)` in Skins.ts says which item a level unlocks.
- **Pucks:** Star, Bao Bun, Snowflake, Beach Ball, Lily Pad, Sun, Macaron, Cherry Pie, Ladybug.
  - Snowflake: image `asset_yDhfgexuhH1XCudHEst834cC` → Tripo `asset_zTFnYKj3q9Q8UrrxWxLWToFn`,
    with an icy-cyan trail and icy-blue tinted bits.
  - Sun (made for Cloudy): image `asset_m3BQTXPwVz1PLwBFXgnjPPdu` → Tripo
    `asset_zB9ezhDvCZo5hCzJCgy6gnnb`; bits are twinkle + sun dot.
  - Ladybug (made for Garden): image `asset_Y8JVBxM84diG8GXbgN7AEf7p` (no leaf) → Tripo
    `asset_CrXc3E5NcN74unAFwHFQpEeb`; bits are red and black dots (the gold dot recoloured
    locally, for free).
  - Beach Ball (made for Beach): image `asset_2TbAVFNt3sXJjAghywRGjtuw` → Tripo
    `asset_NJfQZKdxbicT57He3sSYZmUA`; bits are red, yellow and blue dots (recoloured for free).
  - Cherry Pie (made for Picnic): image `asset_1G5Asr58tX5bNC6xwZJYP3Xk` → Tripo
    `asset_C5Kgb3NknL7PTZVRwaDpv2y8`; bits are cherry-red dots and golden crust crumbs.
  - Lily Pad: image `asset_Pd25uE328Z5egtAF2mYNjCrn` → Tripo `asset_axRscQ6LzxjXhfU1Qe4McbSK`;
    bits are lime dot + raindrop.
  - Bao Bun (made for Dim Sum): image `asset_wbTjdLjhUrJgLn23ku2vxxDK` → Tripo
    `asset_xRbrXZvwJ3bGZsA7JdwBTY4N` (domed: squashY 0.89, rim-matched); bits are red dot + steam puff.
    It has a golden bamboo rim on purpose: an all-white puck would vanish on the cream table.
  - **Recipe for a new puck:**
    1. Edit the Star image `asset_m3sHsg1A1EDRRJQ7DgXR94Jq`, keeping its exact coin shape and
       changing only the paint and centre symbol (12 CU at 1024²).
    2. Run `model_tripo-v3-1-image-to-3d` with `faceLimit 10000` (45 CU).
    3. Shrink the textures: `gltf-transform resize --width 512 --height 512`.
    4. Add a `PUCK_LOOKS` entry, with `squashY` set so its height matches the Star
       (0.28 × 0.9), and a `PUCK_SKINS` entry. Match the RIM height (about 0.24 in game
       units), not the total height: a puck with a raised dome (the Bao Bun) would otherwise get a
       thin rim.
  - **Keep pucks easy to see** on light tables: give them a strong rim colour. Light-coloured
    pucks need their own trail colours (the `trail` field in `PUCK_LOOKS`), or the speed trail
    becomes a murky smear.
  - **Themed puck particles:** `src/game/PuckFx.ts` makes the themed bits that drift behind a
    fast puck and pop out like confetti on hard hits (at most one burst per 200 ms).
    - Each puck lists its sprites in the `bits` field of `PUCK_LOOKS`: Star has star + twinkle,
      Macaron has heart + sprinkles, Snowflake has snowflake + frost, Sun has sun + gold sparkle, Ladybug has mini ladybug + red dot, Beach Ball has mini beach ball + yellow dot, Cherry Pie has cherries + crust crumb, Bao Bun has mini bao + steam swirl, Lily Pad has leaf + raindrop.
    - Second sprite sheet (same style): `asset_bsVSY5qeA4r3gy21H31zc6dV` (sun, ladybug, beach ball,
      cherry, bao, steam, leaf, raindrop, gold sparkle). Cut with
      `tools/vfx/cut.py OUT_DIR SHEET.png "a,b,c;d,e,f;g,h,i"`. The plain dots (reddot, yellowdot,
      crustdot) are the gold dot recoloured locally.
    - The sprites are in `src/assets/vfx/`, cut from Scenario sheet
      `asset_1DXboeHCk4XrxbDxqgiATUPz`: a 3×3 grid on flat magenta, keyed out locally.
    - A new puck needs 2 sprites. Generate them the same way: a 3×3 icon grid on #FF00FF,
      about 12 CU, then cut it with `tools/vfx/cut.py`.
  - **Removing a painted detail from a Tripo model for free:** use `tools/puck-retouch/`.
    - `texmap.py` maps each texture pixel to its 3D spot.
    - `clean.py` fills chosen spots on the top from the surrounding colours and flattens the
      bump texture there.

    This is how the sparkle stars were removed from the old Snowflake puck.
  - **Grey patches from Tripo:** Tripo sometimes leaves a flat grey patch on a side of the puck
    it couldn't see in the image. `tools/puck-retouch/fill_grey.py SRC.glb OUT.glb` repaints
    those texels from good ones at the same height and radius (run it on the 2048 source, then
    resize to 512). Don't use it on pucks with white or grey parts (Beach Ball, Snowflake).
  - **Holes in a Tripo puck's side** (you see through the wall; a repaint does nothing): run
    `tools/puck-retouch/mirror_patch.py SRC.glb OUT.glb BAD_ANGLE 45 0.42`. It lays a mirrored
    copy of the clean opposite wall a hair outside the broken part, keeping every original face,
    so no cracks open. Cherry Pie needed both tools (angle 180). To find the bad angle, look
    for open edges in the mesh. Check every new puck from 8 angles: Tripo builds the side it
    can't see in the image.
- **Table sheets generated but not built** (building is free):
  - Forest `asset_E8ypcs5J367PYhX9wJ4i3u1b`
  - Bamboo Forest `asset_FTPcQUybGPovtM6zPSPcqkGS`
  - Bamboo `asset_Q8jndYEL5aq43w8B7V9oUmnF`
  - Tropical `asset_YvfN86s8yC6cpuqwvhdCFzSU`
  - Candy Land `asset_BQM9yRaDbDdnyS2o8yvfeusr`
  - Beach Shoreline `asset_xdbvvDdmwpDe8k3Q33FQVCJv`
  - Paradise Jungle `asset_J87e1LSGsR5FrMxbwZFtRB67`
  - Mint Ice Cream `asset_kdJNZi8zpWdNsobx6WyZ5hc6`
  - Jungle with fixed colours `asset_mS4Mov8AudvTBqrkWGijmczi`
- **Ideas the user liked but didn't generate yet:** Donut table, Gold Trophy table, Frog Prince.
- **Pipeline servers:** the bake servers must run from `tools/table-pipeline`:
  - `(cd viewer && python3 -m http.server 8765)`
  - `python3 savesrv.py`

  Rainy was the first table built entirely from the project copy.
- **Known small flaw with `RAILS=lengthwise`:** a few tiny specks can remain on the last bit of
  each side rail, where it meets the corner cap (outside the stretch that step repaints). Check
  there.

## Progression and saved progress (built 2026-10-03)

The spec is the agent memory file `progression-spec.md`. Built: stars/levels (`starsNeeded` in Rewards.ts), one unlock
per level (Skins.ts), the LEVEL UP popup, and **saved progress** in `src/game/Stats.ts`:
- **The star counters show `totalStars`** (every star ever earned; it never drops on a level-up), on Home and on the
  result popup (user, 2026-10-03: showing stars inside the level looked like a bug, "0" after each level-up). Planned:
  tapping the star counter shows a tooltip with the stars needed for the next level. Old saves get
  `totalStars` from the level reached.
- One record `airsmash.progress` `{v, level, stars, totalStars, coins, fresh, pendingLevelUp, matches, wins, perfects}`, saved with
  **Capacitor Preferences** (`@capacitor/preferences` 8.0.1; native storage on Android) and mirrored to localStorage.
  Loaded once at startup in `main.ts` (behind the splash) BEFORE the Home scene is built (its mallet depends on the
  level). Every change saves at once. A damaged save is repaired field by field (or starts fresh); never crashes.
- Unlocked items are NOT stored: they follow from the level (`unlockLevel`).
- **A match is banked when it ends** (`bankMatch` in `UI.runResultPopup`), so closing the app on the result popup loses
  nothing. KEEP PLAYING! undoes it (the match then counts at its real end). x3 coins: `addCoins`.
- **Quitting from the pause menu gives nothing** (user, 2026-10-03; not a loss).
- **NEW!**: a newly unlocked item is "fresh" until the player EQUIPS it (user): NEW! badge on its Locker card
  (`badge_new.webp`), a red dot on its Locker tab and on the Home Locker button (`.has-new`). Equipping anywhere
  (`equipItem` in Skins.ts) clears it.
- **Unseen level-up**: saved as `pendingLevelUp`; if the app closed before its popup, the LEVEL UP popup shows over Home on
  the next launch (EQUIP / CONTINUE, both stay on Home). It counts as seen once a button is tapped.
- Dev: `?stats=L,S,N,C` plays with those numbers and never saves; `?resetprogress` starts a fresh save; `?result=` banks
  into the dev save like a real match.
- The phone gets the Preferences plugin with the next `npm run build:apk` (it runs `cap sync` first).

## Home top bar (built 2026-10-02)

- Kit image `asset_xcvj45DeAuokfvxSQF9giQdF` (blank coin pill, blank star pill, taller PLAY button on
  flat magenta), cut with `tools/ui/cut_kit.py KIT.png OUT_DIR name1,name2,name3` into
  `src/assets/ui/home/` (`coin_pill`, `star_pill`, `play`).
- The numbers are live text: `UI.setHomeStats({level, stars, starsNeeded, coins})` in `src/ui/UI.ts`
  fills the coin pill, the star pill (total stars ever earned) and the "LEVEL N" line
  under the baked "PLAY". Long numbers shrink to fit. `main.ts` calls it through `showHome()`.
- The values come from the saved progress in `src/game/Stats.ts` (`homeStats()`; see "Progression and saved progress"). In dev, `?stats=LEVEL,STARS,NEEDED,COINS` (for example `?stats=5,3,4,1250`) overrides them.
- **The counters are dynamic 3-slice sprites** (kit `asset_1UNs3cfwPaSaehetfQzkMrFb`, long coin pill + star pill):
  `border-image` keeps the icon cap and the end cap fixed and stretches the bar. The pill grows with its number
  between `--bar-min` and `--bar-max` (pill heights); past the max, `UI.fitStat` shrinks the text to 50%. The
  cap sizes (`--cap-l`, `--cap-r`) are in sprite pixels, set per pill in `styles.css`. Pills sit in a right-aligned
  `.stat-bar` flex row, so the coin pill moves left as the star pill grows. A new pill sprite needs its caps measured.
- UI kits on magenta: generate the blank parts, cut them, put live text on top (like the Locker).

## Result popup (WIN and LOSE built 2026-10-02/03; the old winpanel/losepanel sprites are no longer shown)

- Built in code by `src/ui/ResultPopup.ts` from parts in `src/assets/ui/result/`; styles are `.rp-*` in `styles.css`.
  Final concept: `asset_ARPwGLpjAhwec8kZtX4cmSmA`. Kits: A `asset_bbdfrwr788MowY1AyHVA1HZd` (panel, gold/purple
  ribbons, 2D trophy; on GREEN because of the purple ribbon), B `asset_Wxw2jzZ6GckpPN6B2ucocZKb` (7 title words),
  C `asset_hSuwFgHGpVwgkuxZYikN2Ch7` (stars, 3 blank buttons, icons, sweat drop). `coin.webp` is cut from the Home
  coin pill so it is the exact same coin. The rays are drawn in CSS (the generated ray sprite keyed badly).
- `tools/ui/cut_kit.py` options: `KEY=green`, `MERGE_ROWS=1` (text sheets), `-` to skip a piece, `DEBUG=1`.
- Everything is live text: title word sprite, score numbers and names, coin amount, button labels. Buttons are
  3-slice (`border-image`) with separate icons; all buttons in a popup share the widest width.
- Rewards and title rules live in `src/game/Rewards.ts` (stars/coins per result, x3 ad, titles by score).
- Dev: `?result=win,5,2` (or `lose,3,5`) opens the popup over Home without playing.
- **Performance rules for UI over the game (user: "it should be smooth"):** no `backdrop-filter` blur over the 3D
  canvas; no stacked `drop-shadow` filters on text (use `-webkit-text-stroke` + `paint-order: stroke fill` + one
  `text-shadow`); spin pre-drawn images, not CSS gradients/masks; pre-decode sprites and warm up canvases before the
  popup opens; `will-change: transform` on animated parts. GameScene stops re-rendering the 3D table 1.2 s after the
  match ends (`paused` getter), so the popup gets the phone's full attention. Measure frame times in the browser pane
  (all frames ~16.7 ms) before saying it is smooth.
- Button icons are pre-tinted per button colour (`icon_<name>_<gold|green|blue>.webp`), made from the navy-outline
  originals in `tools/ui/icon-src/` with `tools/ui/tint_icon.py SRC OUT EDGE DEEP` (same colours as `--txt-edge` /
  `--txt-deep` in styles.css). A new icon or button colour needs this run once.
- **Coins fly A to B:** after the stars, the earned coins fly in arcs from the popup's coin line into a coin counter
  at the top right (Home's `.stat-bar`/`.coin-pill`, class `rp-wallet`), each landing ticks the counter, bumps it,
  dings (`Sound.coin`) and buzzes lightly. x3 sends a bigger stream. A button tap lands everything at once
  (`finishCoins`), so nobody waits or loses coins. The start balance is `homeStats().coins` (placeholder: coins are not
  saved yet). Dev: `?result=win,5,2&stats=4,1,4,120` to see a non-zero balance.
- **LOSE popup:** purple ribbon, title by your goals (3-4 SO CLOSE!, 1-2 NICE TRY!, 0 NEXT TIME!), 1 star, no coins,
  cool-blue rays, a heavier jelly drop and a crooked ribbon that swings straight. Buttons: KEEP PLAYING! (gold ad,
  shine; once per match), PLAY AGAIN, HOME. KEEP PLAYING! calls `GameScene.keepPlaying()`: the opponent's winning goal
  is cancelled and the match resumes after a countdown. The emblem is the worried puck `worried.webp` (image
  `asset_2XVWeLzsLNNUvYzYLpCjfzvT`, cut from the LOSE concept's puck), bobbing, with the sweat-drop sprite wiggling.
- Dev: `window.__screen` is the current screen (set in `setScreen`), handy for forcing results from the console, e.g.
  `__screen.score.cpu = 5; __screen.endMatch()`. Don't redefine it as a getter (that broke every screen change).
- **Trophy (win):** lands with a squash-and-stretch, a sparkle burst and a rays flare; then a gentle float with a "ta-da"
  punch/wiggle every 4.5 s (`rpTrophyIdle`), a bright shine streak masked to the trophy's shape (`.rp-trophy-shine`) and
  a rays flare (`rpRaysTada`) on the same beat, plus small canvas sparkles now and then.
- **Stars fly A to B too:** the result screen shows Home's coin + star counters (top right; a loss shows only the star
  counter). After the slots fill, each earned star flies from its slot into the star counter (tick, bump, sparkle,
  `Sound.starLand`, medium buzz), then the coins stream into the coin counter. One shared `fly()` in ResultPopup draws
  both arcs; a button tap lands everything at once.
- **Button layout (user, 2026-10-03):** the ad button on top (x3 COINS / KEEP PLAYING!), then a row: a small round
  icon-only HOME button + the green main button (win: **CONTINUE**, loss: PLAY AGAIN). `iconOnly: true` on a button
  puts it in a row with the next one (`.rp-btn-row`, `.rp-btn-round`: the 3-slice pill with no middle = a circle).
- **Alive details:** CONTINUE breathes (`breathe: true` on a button, `rpBreathe`); after landing, the earned stars hop in a
  wave with a twinkle each every ~3 s (`starsIdle` in ResultPopup; empty slots stay still).
- **Reward line:** bigger coin + amount, a punch-in (overshoot, squash, settle) with a sparkle burst, a breathing golden
  glow behind it (pre-drawn `coinGlowImage`, fading only: a scaling CSS gradient dropped frames to 51 ms), and the coin
  rocking every few seconds.
- **Small polish:** the score counts up 0 -> N (75 ms a step, each digit punches, `Sound.tick`); the ribbon title does a
  tiny squash-bounce every 4 s (`rpTitleBounce`).
- **PERFECT! (5-0) flair:** card gets `.rp-perfect`; a gold shimmer streak masked to the title word sweeps every
  2.4 s (`.rp-title-shine`, sized by height to match the contained title image); the third star lands with an extra
  confetti burst + sparkles. The coin amount stays white (user, 2026-10-03: no gold fill).
- **Ad button shows the payoff:** "+75 (coin)" (coins x 3, so +150 on a PERFECT) with a tilted "x3" badge that pops
  every couple of seconds (`badge` and `coin` options on a button; `.rp-btn-badge`, `.rp-btn-coin`). The badge is the
  painted starburst `badge_burst.webp` (kit `asset_SEvPhHQSBm6dZw3r7qYgqnps`, also has a round `badge_round.webp`)
  with live text.
- **Vibration beats** (native app only; `Sound.haptic` throttles to one per 60 ms): popup lands = light, trophy thumps =
  heavy (worried puck = medium), each star filling = medium, each star landing in the counter = medium, each coin =
  light, any button tap = light, x3 / KEEP PLAYING! granted = success notification. Dev: `window.__haptics` logs them.
- **Entry flash:** a full-screen white flash (`.rp-flash`, opacity only) as the popup pops in: 0.85 peak on a win,
  0.35 on a loss, gone after ~0.3 s.
- **Font (whole game, user 2026-10-03):** **Lilita One** (`--font` in styles.css, `@fontsource/lilita-one` imported in
  main.ts), chunky like the Scenario-painted words. It has one weight, so `body { font-synthesis: none }` stops the
  browser faking a bold for the many `font-weight: 700` rules. Fredoka is no longer loaded.
- **Chunky button kit (Pause/Settings style, 2026-10-03, now used by the Win/Lose popups):** `src/assets/ui/buttons/chunky_{green,blue,
  orange,gold}.webp` (~672x196, blank, cut from `asset_fTLmsW3SSeTxybhYvrpC1RwB`, made from the Pause popup reference
  `asset_NeJtMpukaCCWXFc4my8Sm1hF`). Use as 3-slice like `.rp-btn` (round ends ~100 px of the 196 px height); labels
  live in Lilita One with one thick navy outline.
- **Popup buttons now:** chunky kit (gold = ad, green = CONTINUE / PLAY AGAIN, blue = round HOME), height 16cqw, label
  8.2cqw Lilita One with one thick navy shadow-outline + navy depth (same for every colour); icons re-tinted navy
  (`tint_icon.py ... "#0d2f7a" "#0a2362"`). `fitButtons()` shrinks a label that would overflow its button.
- **Win popup trim (user, 2026-10-03):** no score line on a win (`score` is optional; the loss still shows it), a much
  bigger coin line (coin 15cqw, amount 14cqw), the ad button reads "x3 COINS" with no badge or coin, and confetti rains
  for as long as the popup is open (`rain(Infinity, 24)`, capped at 450 pieces).
- **Pause-like proportions (2026-10-03):** buttons 19.5cqw tall in a 74cqw-wide column (side margins like the Pause
  popup); label + icon may reach 16% of the height into each rounded end; `fitButtons()` shrinks ALL labels of a popup by
  the same factor when one does not fit (one text size per popup). Flying coins are capped at 44 px.
- **Lose popup trim (user, 2026-10-03):** no score line; a loss now gives **+5 coins** (`REWARDS.coins.loss = 5`) shown in
  the same big coin line, flying into the coin counter; the worried puck is smaller (44cqw). CONTINUE / PLAY AGAIN are
  label-only (no icon) so the labels can be bigger.
- **LEVEL UP popup (built 2026-10-03):** concept `asset_b3MLTS7gcNoV8YVdx8ganTt8`; kit `asset_nWZYpgRUMiVmrE9i5Z4AiZ1V`
  cut into `src/assets/ui/levelup/` (`title_levelup`, blank `star_level`, `badge_new`, `pedestal`). `ResultPopup.showLevelUp()`
  reuses the panel, gold ribbon, rays, confetti, coin line and buttons. It opens when the result popup closes
  (CONTINUE / PLAY AGAIN / HOME) if the match filled the star bar (`UI.runLevelUp`).
  - The item is its real 3D model, **spinning** (user, 2026-10-03): `ItemSpinner` in `src/game/ItemShot.ts` is a small
    canvas with its own Babylon engine (Locker card framing, one turn per 4.5 s). It loads 3.5 s into the result popup
    (so the entry never stutters), runs only while the LEVEL UP popup is open, and is disposed with it (or dropped if
    there is no level-up, e.g. after KEEP PLAYING!). Measured: all frames ~16.7 ms while loading and while spinning.
  - **The model stands on the pedestal in the pedestal's own perspective** (user, 2026-10-03): the camera looks from
    13.6 degrees above (the pedestal sprite's top oval is 0.235 as tall as wide) at the item's base, which is the centre of
    the square view; CSS puts that centre on the middle of the oval. The pedestal is 62cqw wide and its stage sits at
    -12cqw (bigger and lower, user 2026-10-03); the view is 64cqw. On-screen footprint per kind (`FRAMING`): mallet
    36cqw, puck 41cqw, table 54cqw. Behind the level star breathes the win popup's coin glow (`.rp-level-glow`). The item does not float (it would leave the stand).
  - The level number sits at the centre of the biggest circle inside the star (50.5%, 48.7%) and `fitLevelNum()` shrinks
    two-digit levels to fit. The star sits ~4cqw under the ribbon band.
  - Order: the pedestal pops up, the item drops on it (squash, sparkles, rays flare, heavy buzz), the level star flips from
    the old level to the new one, then the name ("PANDA MALLET"). **No coins** on this popup and no level-up coin bonus
    (user, 2026-10-03).
  - Buttons (user, 2026-10-03): **EQUIP** (green, breathing; equips via `equipItem`; "EQUIP & CONTINUE" was tried and dropped: too long, it shrank all labels) and **CONTINUE** (blue).
    No HOME button: both go where the result popup's button pointed (next match, or Home after HOME); on launch they
    stay on Home. No "SET COMPLETE!".
  - Rewards are banked when the result popup closes (`addMatchRewards` in Stats.ts), so KEEP PLAYING! never counts a
    match twice. Star needs per level: `starsNeeded()` in Rewards.ts (the spec's table).
  - Dev: `?result=win,5,2&stats=5,3,4,120` → level 6 (Snowflake); `?result=win,5,2` → level 2 (Panda);
    `?stats=3,1,2,300` → level 4 (Dim Sum table).
- **Label style everywhere:** `--label-shadow` (`:root` in styles.css) is the shared gentle navy shadow-outline + depth
  edge, used by the Locker tabs, card names, level tags and "COMING SOON"; the popup button labels, coin amount and
  LEVEL-under-PLAY use the same recipe inline.
