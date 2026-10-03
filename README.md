# Air Smash

Mobile 3D air hockey game built with TypeScript, Babylon.js and Capacitor.

## Run in the browser

```bash
npm install
npm run dev
```

Open the printed URL (use the Network URL to try it on your phone over Wi‑Fi).

## Build for iOS / Android

```bash
npx cap add ios        # once (requires Xcode + CocoaPods)
npx cap add android    # once (requires Android Studio)
npm run cap:ios        # build web, sync, open Xcode
npm run cap:android    # build web, sync, open Android Studio
```

Lock the app to portrait in Xcode (Deployment Info) / `AndroidManifest.xml`
(`android:screenOrientation="portrait"`).

## Project layout

| Path | Purpose |
| --- | --- |
| `src/main.ts` | Engine bootstrap, screen switching |
| `src/scenes/HomeScene.ts` | Home background: orbiting camera over an AI-vs-AI rally |
| `src/scenes/GameScene.ts` | Match flow (countdown → play → goal → result), touch input, camera |
| `src/game/Physics.ts` | Sub-stepped puck/mallet/rail/goal-post physics |
| `src/game/AI.ts` | CPU opponent (attack, loop-around, intercept prediction, defend) |
| `src/game/Rig.ts` | Syncs physics to meshes; puck trail, goal drop, goal flash |
| `src/game/Meshes.ts` | Table, mallets, puck, lights, shadows, glow |
| `src/game/Effects.ts` | Hit sparks, shockwave rings, goal explosion |
| `src/audio/Sound.ts` | Procedural WebAudio SFX + Capacitor haptics |
| `src/babylon.ts` | Deep Babylon imports (keeps the bundle ~1.4 MB instead of ~6.7 MB) |
| `tools/table-pipeline/` | Builds themed tables from a Scenario concept sheet (see its README) |
| `CLAUDE.md` | Rules, workflows and current content for AI agents working on this project |
