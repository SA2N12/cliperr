# Image serveur TikTokClip (API + pipeline). Le front (dist-web) et le provider
# PO token (bgutil) sont gérés à côté. ffmpeg vient de ffmpeg-static ; yt-dlp est
# téléchargé au 1er lancement dans le volume /data.
FROM node:20-bookworm-slim

# Outils de build pour better-sqlite3 (au cas où pas de prebuilt)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# On installe toutes les deps mais SANS télécharger le binaire Electron (inutile ici)
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build du dashboard web (→ dist-web), servi en statique par le serveur
RUN npm run build:web

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "server"]
