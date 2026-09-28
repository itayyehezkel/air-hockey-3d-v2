import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works inside Capacitor's WebView.
  base: './',
  assetsInclude: ['**/*.glb'],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
  server: { host: true },
});
