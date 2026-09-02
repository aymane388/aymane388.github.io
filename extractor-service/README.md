# Service d’extraction Miqdar

Ce service reçoit uniquement un lien TikTok public depuis le Worker Miqdar. Il
tente d’abord le média déclaré dans le HTML public TikTok, puis Chromium avec
Playwright et enfin `yt-dlp` comme dernier secours. Si `ffmpeg` ne peut pas lire l’URL
signée, Chromium télécharge le fichier avec les cookies, le référent et le
`User-Agent` de la page avant de le préparer localement. Ce téléchargement se
fait par blocs, s'arrête dès que la limite de 96 Mo est dépassée et revérifie
chaque redirection avant de la suivre. Le processus Chromium reste chaud entre
deux demandes, mais chaque vidéo utilise un contexte isolé et des cookies
éphémères. Lorsqu’une piste audio
est déjà dans un format accepté et sous 24 Mo, elle est conservée telle quelle. Une piste AAC
ou WebM incluse dans une vidéo peut être extraite sans réencodage. Le WAV PCM
16 bits, mono, à 24 kHz reste le repli sûr. Tous les chemins sont limités à deux
minutes et 24 Mo. Le même conteneur
peut préparer un fichier importé pesant jusqu’à 80 Mo avant son envoi au
transcripteur. Le son d’origine peut déjà être compressé, mais Miqdar ne lui
ajoute plus une seconde compression destructive : il retire seulement l’image,
réduit le nombre de canaux et normalise la fréquence d’échantillonnage.

Le média est placé dans un répertoire temporaire unique et supprimé à la fin de
la réponse. Le service n’utilise ni compte TikTok, ni cookies utilisateur, ni
résolution de captcha. Une publication privée, protégée ou indisponible est
refusée et doit être importée manuellement dans Miqdar.

La version du service est `1.5.0` (diagnostic `5`).

## Contrat HTTP

- `GET /health` : disponibilité, version du moteur et capacités de diagnostic.
- `POST /v1/extract` : JSON `{ "url": "https://…" }` avec
  `Authorization: Bearer <MIQDAR_EXTRACTOR_TOKEN>`.
- `POST /v1/prepare-upload` : formulaire multipart avec un champ `file`, limité
  à 80 Mo et deux minutes, protégé par le même jeton.
- Succès : fichier `audio/wav` temporaire (`PCM s16le`, mono, 24 kHz).
- Échec d’un lien : JSON avec le code public, un identifiant de dossier et les
  méthodes essayées (`yt-dlp`, puis éventuellement `chromium`). Les logs Docker
  indiquent séparément le démarrage, la réussite ou la raison d’échec de chaque
  méthode, sans enregistrer le lien complet ni le contenu de la vidéo.
- Succès : en-têtes de durée pour la source, la préparation et l’extraction
  totale, ainsi que le mode `source-audio`, `lossless-remux` ou `lossless-wav`.

Le conteneur doit être placé derrière HTTPS, sans accès entrant public autre
que celui nécessaire à Miqdar. Une règle d’egress bloquant les réseaux privés
est recommandée en complément des validations applicatives.

## Développement

```sh
python3 -m unittest discover -s tests -v
docker compose up --build
```

## Test sur Windows avec Docker Desktop

Le script `demarrer-windows.ps1` génère un secret local, construit le conteneur,
vérifie les trois outils puis ouvre un tunnel HTTPS Cloudflare temporaire. Aucun
compte Cloudflare n'est nécessaire pour ce test. Le tunnel force HTTP/2 afin
d'éviter les boucles de reconnexion QUIC observées sur certains réseaux.

1. Ouvrir Docker Desktop et attendre l'état « Engine running ».
2. Ouvrir PowerShell dans ce dossier.
3. Exécuter `powershell -ExecutionPolicy Bypass -File .\demarrer-windows.ps1`.
4. Transmettre uniquement l'adresse `https://….trycloudflare.com` affichée.

Le fichier `.env` contient le secret d'accès : il ne doit pas être envoyé dans
une messagerie ni ajouté à Git. Le tunnel rapide est public mais chaque
extraction reste protégée par ce secret. Il convient seulement aux essais : son
adresse change à chaque recréation et le service s'arrête avec l'ordinateur.

Pour arrêter proprement les deux conteneurs :

```powershell
powershell -ExecutionPolicy Bypass -File .\arreter-windows.ps1
```
