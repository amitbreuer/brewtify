import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/app/',
  optimizeDeps: {
    include: ['@brewtify/shared'],
  },
  server: {
    port: 5174,
    host: '127.0.0.1',
  },
})
