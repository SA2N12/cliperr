# Image serveur TikTokClip (API + pipeline). Le front (dist-web) et le provider
# PO token (bgutil) sont gérés à côté. ffmpeg vient de ffmpeg-static ; yt-dlp est
# téléchargé au 1er lancement dans le volume /data.
FROM node:20-bookworm-slim

# Outils de build pour better-sqlite3 + polices pour les sous-titres (libass).
# fonts-liberation fournit "Liberation Sans" (équivalent Arial) + fontconfig
# permet à libass de trouver/substituer la police du fichier .ass.
# ffmpeg (Debian) EN PLUS du ffmpeg-static : le binaire statique 7.0.2 segfaute
# en lisant les flux HLS de Twitch (CloudFront) — code -11. Le ffmpeg système
# (5.1.x) les gère sans problème. yt-dlp l'utilise pour extraire une portion de
# VOD ; ffmpeg-static reste pour le montage local (recadrage, sous-titres).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates fontconfig fonts-liberation fonts-inter \
    fonts-comfortaa fonts-quicksand fonts-comic-neue curl ffmpeg \
  # Polices des sous-titres. Archivo Black (grotesque très grasse) est celle des
  # gros comptes TikTok et sert par défaut ; les paquets Debian arrondis n'existent
  # qu'en Light/Regular, donc trop fins. Les autres sont gardées comme variantes
  # (Anton = condensée, Luckiest Guy / Fredoka = cartoon). Téléchargement non
  # bloquant : un incident réseau ne doit pas casser un déploiement.
  && mkdir -p /usr/share/fonts/truetype/cartoon \
  && for f in \
       'ArchivoBlack.ttf|https://github.com/google/fonts/raw/main/ofl/archivoblack/ArchivoBlack-Regular.ttf' \
       'Anton.ttf|https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf' \
       'LuckiestGuy.ttf|https://github.com/google/fonts/raw/main/apache/luckiestguy/LuckiestGuy-Regular.ttf' \
       'Fredoka.ttf|https://github.com/google/fonts/raw/main/ofl/fredoka/Fredoka%5Bwdth,wght%5D.ttf' ; do \
       n="${f%%|*}"; u="${f##*|}"; \
       curl -fsSL --retry 3 -o "/usr/share/fonts/truetype/cartoon/$n" "$u" || echo "ATTENTION : $n non téléchargée" ; \
     done \
  && fc-cache -f \
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
