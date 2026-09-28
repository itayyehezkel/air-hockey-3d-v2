import type { Scene } from '../babylon';

export interface Screen {
  readonly scene: Scene;
  /** Resolves once the screen's models and textures are loaded (a transition waits for it). */
  readonly ready?: Promise<void>;
  /** While true the loop stops updating and rendering (the last frame stays on screen). */
  readonly paused?: boolean;
  /** Toggle/force pause; screens without a pause state ignore it. */
  setPaused?(paused: boolean): void;
  update(dt: number): void;
  resize(): void;
  dispose(): void;
}
