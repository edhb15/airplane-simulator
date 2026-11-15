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
    },
    worker: { format: 'es' },
    plugins: [
      {
        name: 'portal-sdk',
        transformIndexHtml(html) {
          if (!crazy) return html;
          return {
            html,
            tags: [{ tag: 'script', attrs: { src: CRAZYGAMES_SDK }, injectTo: 'head-prepend' }],
          };
        },
      },
    ],
  };
});
