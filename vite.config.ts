import { defineConfig } from 'vite'
import path from 'node:path'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import router from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import { lingui } from '@lingui/vite-plugin'

const wailsApp = process.env.WAILS_APP === 'true'
const serverDevelopment = process.env.MODKEEPER_SERVER_DEV === '1'
const serverBackend =
  process.env.MODKEEPER_SERVER_URL || 'http://127.0.0.1:8080'

export default defineConfig(() => ({
  envDir: '.config',
  define: {
    'import.meta.env.WAILS': JSON.stringify(String(wailsApp)),
  },
  plugins: [
    lingui({ macroTransform: true }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    router({
      generatedRouteTree: 'src/gen/routes.ts',
      disableLogging: true,
    }),
  ],
  clearScreen: false,
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@gen': path.resolve(import.meta.dirname, 'src/gen'),
      '@utils': path.resolve(import.meta.dirname, 'src/utils'),
      '@mod': path.resolve(import.meta.dirname, 'src/modules'),
    },
  },
  server: {
    port: Number(process.env.WAILS_VITE_PORT || 34115),
    strictPort: true,
    ...(serverDevelopment
      ? {
          proxy: {
            '/wails': {
              target: serverBackend,
              ws: true,
            },
          },
        }
      : {}),
  },
}))
