# Dossier d'audit — TikTok Content Posting API (Direct Post)

But : faire **auditer/approuver** l'app TikTok pour débloquer la publication **publique** (`PUBLIC_TO_EVERYONE`) via l'API. Tant que l'app est en sandbox/non auditée, seul `SELF_ONLY` (privé) est possible.

Portail : https://developers.tiktok.com → Manage apps → ton app.

URLs déjà en ligne (Netlify) :
- Privacy Policy : `https://preeminent-platypus-19eb4f.netlify.app/privacy.html`
- Terms of Service : `https://preeminent-platypus-19eb4f.netlify.app/terms.html`
- Redirect URI : `http://127.0.0.1:43217/callback`

---

## 1. Checklist avant soumission

- [ ] **App infos** : nom, icône (1024×1024 conseillé), description, catégorie remplis.
- [ ] **Plateforme** : Web / Desktop déclarée.
- [ ] **Privacy Policy URL** + **Terms of Service URL** renseignées (voir ci-dessus).
- [ ] **URL ownership** vérifiée (les fichiers `.txt` de vérification déjà déployés).
- [ ] **Scopes** demandés : `user.info.basic`, `video.upload`, `video.publish`.
- [ ] **Produit Content Posting API** ajouté + **Direct Post** activé.
- [ ] **Écran de confirmation/consentement** présent dans l'app (⚠️ voir §3 — requis pour passer).
- [ ] **Vidéo de démo** enregistrée (voir §4).
- [ ] **Use case** rempli (texte §2).
- [ ] **Submit for review**.

---

## 2. Textes prêts à coller (portail — en anglais, recommandé pour la review)

### App description
```
TikTokClip is a desktop application that helps a creator turn their long-form
video content into short vertical (9:16) clips with auto-generated subtitles and
captions, and publish them to their own TikTok account. The creator connects
their TikTok account via Login Kit (OAuth), reviews each generated clip and its
caption inside the app, then explicitly confirms publication. The app uses the
Content Posting API to upload the selected clip to the creator's account.
```

### Use case / Why you need Direct Post
```
The app's core workflow is: import a source video the creator owns or has rights
to, generate vertical clips with burned-in captions, let the creator review and
approve each clip and edit its caption/hashtags, and publish the approved clip to
their TikTok account. Direct Post is required so the creator can publish an
approved clip (with its caption, hashtags and chosen privacy level) directly from
the desktop app, instead of manually re-uploading files. The user always sees a
confirmation screen showing the video preview, caption, creator nickname and the
selected privacy level before any post is sent.
```

### Scopes justification
```
- user.info.basic: display the connected creator's nickname and avatar, and call
  creator_info to fetch allowed privacy levels, max duration and interaction
  settings before posting.
- video.upload: send a clip to the creator's TikTok inbox as a draft for the
  creator to finalize in the TikTok app.
- video.publish: let the creator directly publish an approved clip with the
  caption and privacy level they confirmed in the app's review screen.
```

---

## 3. Conformité UX exigée par TikTok (⚠️ point bloquant)

TikTok rejette les intégrations Direct Post qui publient **automatiquement** sans contrôle utilisateur. Pour passer, l'app DOIT, avant chaque publication, afficher un **écran de confirmation** qui :

1. montre un **aperçu de la vidéo** à poster ;
2. affiche la **légende** (titre/description + hashtags) éditable ;
3. affiche le **pseudo du créateur** connecté ;
4. laisse l'utilisateur **choisir le niveau de confidentialité** parmi ceux renvoyés par `creator_info` (`privacy_level_options`) — ne pas coder en dur ;
5. respecte les réglages renvoyés par `creator_info` : durée max, et options **Commentaires / Duet / Stitch** (désactiver celles que le créateur a coupées) ;
6. inclut la **déclaration de contenu commercial** (toggle « Contenu de marque / Promotion » → `disclose_video_content`) si applicable ;
7. ne lance la publication **que** sur clic explicite de l'utilisateur ;
8. affiche la mention « Publié via TikTokClip » / l'usage de la musique conforme.

> **État actuel de l'app** : ✅ **écran de confirmation implémenté** (modale « Vérifier & publier » sur le bouton Publier, en mode Direct). Elle montre l'aperçu vidéo, le pseudo, la légende éditable, le sélecteur de confidentialité alimenté par `creator_info`, les options Commentaires/Duos/Stitch (désactivées si le créateur les a coupées), la divulgation de contenu commercial, et ne publie qu'au clic « Publier sur TikTok ». → L'app est **démo-ready**.

---

## 4. Script de la vidéo de démo (2–3 min, écran enregistré)

Enregistre tout l'écran, voix off ou sous-titres en anglais :

1. **Intro (10 s)** : « This is TikTokClip, a desktop app to clip and publish a creator's videos to their own TikTok account. »
2. **Connexion (20 s)** : clic « Ouvrir l'autorisation » → page OAuth TikTok → consentement aux scopes → retour à l'app, **pseudo + avatar** affichés.
3. **Génération (20 s)** : ajouter une vidéo, lancer le pipeline, montrer les clips générés avec sous-titres.
4. **Revue (30 s)** : ouvrir un clip → montrer **l'écran de confirmation** : aperçu vidéo + légende éditable + **sélecteur de confidentialité** (issu de `creator_info`) + toggles Commentaires/Duet/Stitch.
5. **Publication (20 s)** : clic « Publier » **explicite** → confirmation de succès.
6. **Vérification (20 s)** : ouvrir TikTok, montrer le post publié avec la **bonne confidentialité** et la légende.
7. **Outro (10 s)** : rappeler que l'utilisateur valide chaque post et que les droits du contenu sont sous sa responsabilité.

---

## 5. Conseils & risques

- **Délai** : la review prend souvent plusieurs **semaines**, et peut être refusée → corriger et resoumettre.
- **Droits d'auteur / UGC** : une app qui republie le contenu **d'autres créateurs** est scrutée. Pour maximiser l'approbation, présente le use case comme « le créateur publie **son propre** contenu (ou du contenu qu'il a le droit d'utiliser) », et garde un champ **crédit/source** visible. N'affirme rien de faux dans le dossier.
- **Cohérence** : la démo doit **correspondre exactement** à l'app réelle (mêmes écrans). D'où l'importance d'ajouter l'écran de confirmation **avant** de filmer.
- **Compte de test** : en sandbox, ajoute ton compte comme **Target User** pour tester le flux complet avant soumission.

---

## 6. Après approbation (activer le public dans l'app)

Aucune ligne de code à changer — l'app est déjà prête :

1. Réglages → **Mode = « Direct »**.
2. Réglages → **Confidentialité = « Public »** (l'option devient réellement acceptée par l'API).
3. Clic « Vérifier le compte » → `confidentialité dispo` doit maintenant inclure `PUBLIC_TO_EVERYONE`.
4. Publie → le clip part **public** automatiquement, avec légende + hashtags.
