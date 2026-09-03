import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/expo-push': {
        target: 'https://exp.host',
        changeOrigin: true,
        rewrite: () => '/--/api/v2/push/send',
      },
    },
  },
})
