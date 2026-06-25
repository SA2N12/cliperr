import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build du dashboard web (séparé de l'app Electron). Sort dans dist-web/, servi
// par le serveur Express. En dev, proxy /api et /media vers le serveur (8080).
export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true
  },
  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/media': { target: 'http://localhost:8080', changeOrigin: true }
    }
  }
})
