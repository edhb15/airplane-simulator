import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

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
      // CrazyGames: everything (fonts included) ends up in one index.html
      assetsInlineLimit: crazy ? 100000000 : 4096,
      rollupOptions: crazy ? { output: { format: 'iife', inlineDynamicImports: true } } : {},
    },
    publicDir: crazy ? false : 'public',
    worker: { format: 'iife' },
    plugins: [
      {
        // CrazyGames build as a single self-contained index.html: the script
        // (with the CSS, fonts and terrain worker built in) and the icon are
        // inlined, so there is exactly one file to upload
        name: 'single-file',
        apply: 'build',
        enforce: 'post',
        generateBundle(_, bundle) {
          if (!crazy) return;
          const html = Object.values(bundle).find((f) => f.type === 'asset' && f.fileName === 'index.html');
          if (!html) return;
          let src = String(html.source);
          for (const [name, f] of Object.entries(bundle)) {
            if (f.type === 'chunk' && f.isEntry) {
              const tag = new RegExp(`<script[^>]*src="\\./${f.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*></script>\\s*`);
              src = src.replace(tag, '');
              // Runs at the end of <body>, where the canvas and UI root exist
              const code = f.code.replace(/<\/script/gi, '<\\/script');
              src = src.replace('</body>', () => `<script>${code}</script>\n</body>`);
              delete bundle[name];
            } else if (f.type === 'asset' && f.fileName.endsWith('.css')) {
              const tag = new RegExp(`<link[^>]*href="\\./${f.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>\\s*`);
              src = src.replace(tag, '');
              src = src.replace('</head>', () => `<style>${String(f.source)}</style>\n</head>`);
              delete bundle[name];
            }
          }
          const icon = Buffer.from(readFileSync('public/favicon.svg')).toString('base64');
          src = src.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="data:image/svg+xml;base64,${icon}" type="image/svg+xml" />`);
          html.source = src;
        },
      },
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
