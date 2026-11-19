import { defineConfig } from 'vite'
import path from 'node:path'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import router from '@tanstack/router-plugin/vite'
import autoImports from 'unplugin-auto-import/vite'
import tailwindcss from '@tailwindcss/vite'
import { lingui } from '@lingui/vite-plugin'

const host = process.env.TAURI_DEV_HOST
const wails = process.env.WAILS_DEV === 'true'

export default defineConfig(() => ({
  envDir: '.config',
  plugins: [
    lingui({ macroTransform: true }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    autoImports({
      include: [/\.tsx?$/],
      imports: [
        'react',
        {
          clsx: [['default', 'c']],
          '@tanstack/react-router': [
            'Link',
            'Outlet',
            'Navigate',
            'useParams',
            'useLoaderDeps',
            'useLoaderData',
            'useRouter',
            'useNavigate',
            'useBlocker',
            'useSearch',
            'useMatches',
            'redirect',
            'notFound',
          ],
        },
      ],
      dts: 'src/gen/auto-imports.d.ts',
    }),
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
    port: wails ? 34115 : 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
}))
