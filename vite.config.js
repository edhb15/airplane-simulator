import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the build works from any sub-path (e.g. GitHub Pages
  // project sites at https://<user>.github.io/<repo>/) as well as from the root
  base: './',
  server: { host: true, port: 5173 },
  preview: { port: 4173 },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 3000,
  },
  worker: { format: 'es' },
});
