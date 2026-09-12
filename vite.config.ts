import { defineConfig, loadEnv } from 'vite'
import { getEnv } from './src/env'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig(({ mode }) => ({
  resolve: { tsconfigPaths: true },
  plugins: [
    {
      name: 'validate-instance-config',
      configureServer() {
        const values = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
        const instanceConfig = getEnv(values)
        Object.assign(process.env, values, {
          BETTER_AUTH_URL: instanceConfig.BETTER_AUTH_URL,
        })
      },
    },
    devtools(),
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
}))

export default config
