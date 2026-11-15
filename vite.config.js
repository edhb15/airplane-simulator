import { defineConfig } from 'vite';

// CrazyGames SDK v3. Only the CrazyGames build (vite build --mode crazygames)
// loads it; src/platform/platform.js falls back to plain web behaviour.
const CRAZYGAMES_SDK = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

export default defineConfig(({ mode }) => {
  const crazy = mode === 'crazygames';
  return {
    // Relative asset URLs so the build works from any sub-path (e.g. GitHub Pages
    // project sites at https://<user>.github.io/<repo>/, or a portal's CDN folder)
    // as well as from the root
    base: './',
    server: { host: true, port: 5173 },
    preview: { port: 4173 },
    define: {
      'import.meta.env.VITE_PLATFORM': JSON.stringify(crazy ? 'crazygames' : process.env.VITE_PLATFORM || 'web'),
    },
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 3000,
      outDir: crazy ? 'dist-crazygames' : 'dist',
      // Portals may serve the files from a CDN origin or a sandboxed frame:
      // a classic script (no module, no CORS) loads in every case
      modulePreload: !crazy,
      rollupOptions: crazy ? { output: { format: 'iife', inlineDynamicImports: true } } : {},
    },
    worker: { format: 'iife' },
    plugins: [
      {
        name: 'classic-script',
        apply: 'build',
        enforce: 'post',
        transformIndexHtml: {
          order: 'post',
          handler(html) {
            if (!crazy) return html;
            return html.replace(/<script type="module" crossorigin src=/g, '<script defer src=').replace(/(<link rel="stylesheet") crossorigin/g, '$1');
          },
        },
      },
      {
        name: 'portal-sdk',
        transformIndexHtml(html) {
          if (!crazy) return html;
          return {
            html,
            // async: a slow or blocked SDK must not hold up the page (the
            // boot screen); platform.js waits for it with a timeout
            tags: [{ tag: 'script', attrs: { src: CRAZYGAMES_SDK, async: true, onerror: 'window.__cgSdkFailed=true' }, injectTo: 'head' }],
          };
        },
      },
    ],
  };
});
