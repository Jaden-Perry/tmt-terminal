import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // TMT_API_PORT lets a second copy run side by side (e.g. for testing)
    proxy: { '/api': `http://127.0.0.1:${process.env.TMT_API_PORT ?? '8000'}` },
  },
})
