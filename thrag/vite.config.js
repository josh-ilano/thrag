import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const vllmOrigin = env.VITE_VLLM_ORIGIN || 'http://localhost:8000'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/chat': {
          target: vllmOrigin,
          changeOrigin: true,
          rewrite: () => '/v1/chat/completions',
        },
      },
    },
  }
})
