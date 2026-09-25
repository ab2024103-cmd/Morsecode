import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed port and never bundles a Node runtime at runtime —
// everything below is dev-server only.
export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: '0.0.0.0',
    port: 1420,
    strictPort: true,
    // Allows the sandbox/live-preview proxy host as well as localhost.
    allowedHosts: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // Tauri v2 targets modern webviews only.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 900,
  },
}));
