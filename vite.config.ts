import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
) as { version?: string }

const gitSha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
})()

const appVersion = `${packageJson.version || '0.0.0'}+${gitSha}`

const anonymousPageAliasPlugin = () => ({
  name: 'anonymous-page-alias',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/anon\/[^/]+\.html(?:\?.*)?$/i.test(req.url)) {
        req.url = req.url.replace(/^\/anon\/[^/]+\.html/i, '/anon/index.html')
      }

      if (req.url && /^\/feedback\/[0-9a-f]{64}\/?(?:\?.*)?$/i.test(req.url)) {
        req.url = '/feedback/index.html'
      }

      next()
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react(), tailwindcss(), anonymousPageAliasPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        anon: path.resolve(__dirname, 'anon', 'index.html'),
        feedback: path.resolve(__dirname, 'feedback', 'index.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/auth': 'http://localhost:3001',
    },
  },
})
