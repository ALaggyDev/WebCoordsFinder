import { defineConfig } from 'vitest/config'
import mdx from '@mdx-js/rollup'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Keep the PWA shell fully local, including the bundled texture atlas and
// scanner WASM used after the application has been installed.
export default defineConfig({
  plugins: [
    // Compile the bundled information pages from MDX before React transforms
    // their generated JSX. The content is never fetched or parsed at runtime.
    { enforce: 'pre', ...mdx() },
    react({ include: /\.(?:js|jsx|ts|tsx|mdx)$/ }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'WebCoordsFinder',
        short_name: 'CoordsFinder',
        description: 'Turn Minecraft block texture evidence into CoordsFinder configs.',
        theme_color: '#0b1014',
        background_color: '#0b1014',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,wasm,wcf}'],
        // The bundled demo is intentionally larger than Workbox's default
        // limit and must remain available to an offline installation.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
