# Storyboard — vidéo de démo TikTok (audit Content Posting API)

**Durée cible :** ~2 min · **Format :** mp4, < 50 Mo · **Audio :** voix off OU sous-titres en **anglais**.
**Environnement :** app branchée sur la config **Sandbox** TikTok, compte de test ajouté en *Target user*.
**Outil de capture :** Win+Alt+R (Xbox Game Bar) ou OBS. Capture **plein écran de l'app**.

> Règle d'or audit : on doit VOIR que l'utilisateur **contrôle et confirme** chaque post. Montre les clics, les champs, le choix de confidentialité, et le résultat sur TikTok.

---

## Plan par plans (shots)

| # | Durée | À l'écran | Voix off / sous-titre (EN) |
|---|------|-----------|----------------------------|
| 1 | 0:00–0:10 | App ouverte, en-tête « TikTokClip » + le compte connecté (@pseudo + avatar). | "TikTokClip is a desktop app that turns a creator's own long videos into vertical TikTok clips." |
| 2 | 0:10–0:30 | Réglages → clic **« Ouvrir l'autorisation »** → page OAuth TikTok (scopes affichés) → autoriser → retour app, **pseudo + avatar** affichés. | "The creator connects their TikTok account with Login Kit. We use user.info.basic to show the account." |
| 3 | 0:30–0:45 | Onglet Sources : coller une URL **de ton propre contenu**, choisir « Clips : 1 », **Lancer le pipeline**. Montrer le journal qui avance. | "The app downloads the source the creator owns, and generates a vertical clip with captions." |
| 4 | 0:45–1:00 | Onglet Clips : le clip généré (9:16, sous-titres). Régler **Mode = Direct** dans Réglages (le montrer). | "The creator reviews the generated clip before anything is posted." |
| 5 | 1:00–1:30 | Clic **« Publier »** → la **modale de confirmation** s'ouvre : aperçu vidéo, **légende éditable** (modifier un mot à l'écran), **sélecteur Confidentialité** (dérouler les options venant de creator_info), cases **Commentaires / Duos / Stitch**, case **contenu commercial**. | "Here the creator sees a preview, edits the caption, picks the privacy level returned by creator_info, sets comment/duet/stitch and commercial-content options. Nothing is posted automatically." |
| 6 | 1:30–1:45 | Clic explicite **« Publier sur TikTok »** → journal : « Clip publié … publish_id … ». | "Only on explicit confirmation, the app calls the Content Posting API to publish the clip." |
| 7 | 1:45–2:05 | Basculer sur **TikTok** (app/web du compte de test) → montrer la vidéo publiée avec **la bonne confidentialité** et la **légende** identique. | "The post appears on the creator's account with the exact caption and privacy they chose." |
| 8 | 2:05–2:15 | Retour app. | "The creator controls and confirms every post; rights to the content are the creator's responsibility." |

---

## Checklist à montrer obligatoirement (sinon refus)
- [ ] Écran **OAuth** réel (consentement aux scopes).
- [ ] **Pseudo/avatar** du compte connecté affichés.
- [ ] **Modale de confirmation** avant publication (aperçu + légende + confidentialité + interactions).
- [ ] Le **sélecteur de confidentialité** est rempli par `creator_info` (le dérouler à l'écran).
- [ ] **Clic explicite** « Publier » (pas d'auto-post).
- [ ] **Résultat visible sur TikTok** (vidéo + légende + confidentialité correctes).
- [ ] Si tu demandes `video.upload` aussi : montre **une** publication en mode **Brouillon** (boîte de réception TikTok) en plus.

## À éviter
- ❌ Montrer une publication **automatique** sans confirmation.
- ❌ Confidentialité **codée en dur** (doit venir de creator_info).
- ❌ Demander des scopes **non montrés** dans la vidéo (retire-les du formulaire).
- ❌ Voix/sous-titres dans une autre langue que l'anglais.
