import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

const build = `${pkg.version} (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`;

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(build) },
  server: { host: true },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Race the Route',
        short_name: 'Race the Route',
        description: 'BinSentry ProVision booth game',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#e8ede3',
        theme_color: '#1f2a44',
        start_url: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Code and art are precached. Config and scenarios are fetched fresh when the network (or local server)
        // answers, and fall back to the last copy offline, so scenario-only updates need no rebuild.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'rtr-data', networkTimeoutSeconds: 2 },
          },
        ],
      },
    }),
  ],
});
