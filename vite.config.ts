import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
// defineConfig from vitest/config is Vite's, widened with the `test` block, so the alias below
// stays the single source of truth for both the app and the test run.
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // Cloudflare Pages serves this site from the root of `<project>.pages.dev` (or a custom
  // domain), so asset URLs must stay absolute. A relative base ('./') would break once the
  // `public/_redirects` SPA fallback serves index.html for an unknown deep link, because
  // './assets/...' would resolve against the fake path segment instead of the site root.
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    // Mirrors "paths" in tsconfig.app.json so `tsc -b` and Vite agree on '@/...'.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
  test: {
    // The rules engine is pure, so no DOM environment (and no jsdom dependency) is needed.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
