import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The API refuses unauthenticated /api calls when SMG_API_TOKEN is set. In
// production nginx injects the X-Smuggler-Token header (docker/nginx.conf.template);
// the dev/preview proxy must do the same or every request 401s on a machine
// that has run setup.sh. The token comes from the repo-root .env and never
// reaches the client bundle — the header is added server-side by the proxy.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, 'SMG_')
  const token = env.SMG_API_TOKEN ?? process.env.SMG_API_TOKEN ?? ''
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:55555',
          headers: token ? { 'X-Smuggler-Token': token } : {},
        },
      },
    },
  }
})
