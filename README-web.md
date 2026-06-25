# TikTokClip — version web (dashboard)

Migration de l'app Electron vers un **dashboard web** (serveur Node + front React), mono-utilisateur, hébergé sur un VPS.

## Architecture
- **Backend** : `server/` (Express). Réutilise `src/main/pipeline/*` et `src/main/db/*`.
  - Auth mono-utilisateur (cookie de session signé, mot de passe `ADMIN_PASSWORD`).
  - Secrets chiffrés AES-256-GCM (clé `SECRET_KEY`).
  - API REST + **SSE** (`/api/events`) pour la progression/journaux.
  - Upload de fichier (`POST /api/sources/upload`) = voie d'ingestion principale.
  - Clips servis en statique sous `/media/clips` (protégé).
- **Front** : `src/renderer` (React) → build Vite vers `dist-web/`, servi par le serveur. *(Phase B en cours)*
- **Provider PO token** : conteneur `bgutil-provider` (utile seulement pour le download par URL).

## Variables d'environnement
Voir `.env.example`. Obligatoires : `ADMIN_PASSWORD`, `SECRET_KEY`.

## Lancer en local (Docker)
```bash
cp .env.example .env   # remplis ADMIN_PASSWORD + SECRET_KEY
docker compose up --build
# → http://localhost:8080
```

## Déployer sur un VPS (HTTPS automatique via Caddy)

**Prérequis** : un VPS Linux (Ubuntu 22.04+, ≥2 Go RAM, ≥30 Go disque) + un nom de domaine dont le **DNS (A record) pointe vers l'IP du VPS**.

```bash
# 1. Installer Docker (sur le VPS)
curl -fsSL https://get.docker.com | sh

# 2. Récupérer le projet
git clone <ton-repo> tiktokclip && cd tiktokclip
#   (ou : scp/rsync le dossier vers le VPS)

# 3. Créer le .env
cp .env.example .env
nano .env        # remplis ADMIN_PASSWORD, SECRET_KEY (openssl rand -hex 32), DOMAIN

# 4. Lancer (app + provider bgutil + Caddy HTTPS)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

→ Caddy obtient automatiquement un certificat Let's Encrypt → **https://ton-domaine** est en ligne. Connecte-toi avec `ADMIN_PASSWORD`.

**Ouvre les ports 80 et 443** sur le pare-feu du VPS (`ufw allow 80,443/tcp`). Le port de l'app (8090) reste en localhost (privé).

### TikTok
Dans la console développeur TikTok, mets le **Redirect URI** sur
`https://ton-domaine/api/tiktok/callback`, et reporte ce même redirect dans
**Réglages → TikTok** du dashboard.

### Mise à jour
```bash
git pull && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## ⚠️ YouTube sur VPS
L'IP datacenter d'un VPS est bloquée par YouTube → le **download par URL échouera** la plupart du temps, même avec le PO token. **Utilise l'upload de fichier** : télécharge la vidéo ailleurs (navigateur, cobalt.tools…) puis importe-la dans le dashboard.

## État de la migration
- [x] Phase A — Backend (serveur, auth, API/SSE, upload, secrets, scheduler, TikTok)
- [x] Phase B — Front web (`src/web/` : login, sidebar violet, Dashboard, Sources+upload, Clips+modale, Réglages) → `dist-web/`
- [ ] Phase C — Déploiement (Caddy HTTPS, domaine, durcissement)

## Tester en local (Docker)
```bash
cp .env.example .env   # remplis ADMIN_PASSWORD + SECRET_KEY
docker compose up --build
# → http://localhost:8080  (login avec ADMIN_PASSWORD)
```
Note : impossible de lancer le serveur en direct sur Windows (better-sqlite3 est compilé pour Electron) — passe par Docker.
