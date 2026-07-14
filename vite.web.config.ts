import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build du dashboard web (séparé de l'app Electron). Sort dans dist-web/, servi
// par le serveur Express. En dev, proxy /api et /media vers le serveur local (8080)
// — ou vers la PROD en lecture via DEV_API (voir plus bas), pour voir le design
// avec les vraies données sans rien déployer. ⚠️ En mode DEV_API=prod, chaque
// action cliquée (publier, supprimer…) touche la prod pour de vrai.
const apiTarget = process.env.DEV_API || 'http://localhost:8080'
export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true
  },
  server: {
    port: 3000,
    // ⚠️ Clés en REGEX (`^/api/`), pas en préfixe simple : un préfixe '/api'
    // intercepterait aussi le module source `/api.ts` et renverrait du HTML à la
    // place du JS → « Failed to load module script » et page blanche en dev.
    proxy: {
      '^/api/': { target: apiTarget, changeOrigin: true },
      '^/media/': { target: apiTarget, changeOrigin: true }
    }
  }
})
