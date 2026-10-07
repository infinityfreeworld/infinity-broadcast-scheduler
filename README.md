# Infinity Broadcast Scheduler

Cron quotidien qui génère les **broadcasts radio pré-enregistrés** pour [Infinity](https://github.com/infinityfreeworld/infinity), tourne en GitHub Actions, publie sur **IPFS (data-space)** + **NOSTR (kind:30093)**.

Stratégie : J-1 pour J. Chaque soir à 22h UTC, le scheduler génère les broadcasts du lendemain pour les 9 stations seed avec l'actu fraîche du jour. Tous les utilisateurs Infinity entendent le même contenu sur la même fréquence — **vraie radio FM décentralisée**.

## Coût

- **Anthropic Haiku 4.5** : ~$0.04/broadcast × 9 stations = ~$0.36/jour ≈ **$11/mois**
- **Pinata** : free tier 1 GB suffisant (J-2 retention = ~5 GB MAX en WAV brut)
- **GitHub Actions** : free tier 2000 min/mois (job dure ~45 min/jour = ~22h/mois)
- **NOSTR** : 100% gratuit (relais publics)

→ **Total ~$11/mois pour faire tourner les 9 stations seed pour des milliers d'auditeurs.**

## Architecture

```
infinity-broadcast-scheduler/
├── src/
│   ├── data/
│   │   ├── seed-stations.ts     ← 9 stations FR (porté de infinity)
│   │   └── seed-host-kbs.ts     ← KBs animateurs (porté de infinity)
│   ├── lib/
│   │   ├── types.ts             ← types partagés (sync avec Infinity)
│   │   ├── personas.ts          ← system prompt builder + KB retriever
│   │   ├── anthropic.ts         ← SDK officiel @anthropic-ai/sdk
│   │   ├── piper.ts             ← binaire Piper natif (download + run)
│   │   ├── audio.ts             ← read/concat/encode WAV (pur Node)
│   │   ├── news.ts              ← fetch RSS via fast-xml-parser
│   │   ├── pinata.ts            ← upload IPFS via API HTTP
│   │   └── nostr.ts             ← publish kind:30093 via nostr-tools
│   │   ├── tv-conductor.ts      ← TV : actu → conducteur (rubriques) via LLM
│   │   ├── tv-voice.ts          ← TV : narration → voix-off Piper + minutage
│   │   ├── tv-assemble.ts       ← TV : conducteur → plans, EPG, programme (pur)
│   │   ├── waf.ts               ← TV : forge (images, dépôt, montage → CID)
│   │   └── tv-nostr.ts          ← TV : publish kind:30184
│   └── scripts/
│       ├── generate-broadcast.ts ← 1 station (testable localement)
│       ├── generate-all.ts       ← toutes les stations (CI)
│       ├── generate-tv-program.ts← 1 chaîne TV (--plan = hors ligne)
│       ├── generate-tv-all.ts    ← toutes les chaînes TV (CI)
│       ├── tv-voice-preview.ts   ← écouter une voix avant de diffuser
│       └── tv-voice-test.ts      ← test hors ligne : voix ↔ image ne dérivent pas
└── .github/workflows/
    ├── daily-broadcast.yml       ← radio : cron 22h UTC daily
    └── daily-tv.yml              ← TV : cron 20h UTC daily
```

## TV (Infinity TV)

Même principe que la radio, en vidéo : chaque jour, par chaîne, l'actu devient un
**conducteur** (le LLM écrit les rubriques, la voix-off et les prompts d'images),
la forge [We are forger](https://weareforger.data-space.world) génère les visuels
puis **monte** le tout en un `.mp4` épinglé sur IPFS, et le programme est publié
sur NOSTR (kind `30184`). Le module TV d'Infinity le diffuse en horloge virtuelle,
comme une vraie chaîne.

```bash
npm run test:tv                    # hors ligne : voix ↔ image + contrat de publication
npx tsx src/scripts/generate-tv-program.ts --plan     # hors ligne, montre tout
npm run preview:voice              # écouter la voix (écrit un .wav)
npm run generate:tv -- tv-jt-fr --fixture   # un JT COMPLET, sans clé ni publication
npm run generate:tv:all -- --fixture        # toutes les chaînes, sans publication
npm run generate:tv -- tv-jt-fr    # une chaîne, pour de vrai
npm run generate:tv:all            # toutes les chaînes (ce que fait le cron)
```

**Regarder un JT avant de diffuser** — `--fixture` produit la vidéo entière (voix,
images, montage) à partir d'un conducteur d'exemple, **sans clé de langage, sans relais,
sans rien publier**. Il faut la forge en face ; en local :

```bash
# dans ~/forge3d, sur une branche qui contient /api/v1/upload
WAF_API_KEYS=wafk_essai_local SESSION_SECRET=essai PORT=5400 npm run dev
# puis ici
WAF_API_URL=http://127.0.0.1:5400 WAF_API_KEY=wafk_essai_local npm run generate:tv:all -- --fixture
```

Mesuré le 09/09/2026 : **2 chaînes produites en 62 s**, JT de 19,33 s en H.264 720p 30 i/s
avec piste AAC.

**La voix commande l'image.** Le LLM propose une durée de plan sans savoir combien
de temps sa phrase prend à dire. Après synthèse, on **mesure** chaque phrase et on
réécrit les durées : sans cela le montage cale la vidéo sur la durée de l'audio et
tous les plans suivants glissent (mesuré : un plan annoncé à 8 s ne dure que 4,9 s
de parole — près de 3 s de décalage dès le deuxième sujet, cumulatif).

La synthèse est faite par **Piper, sur le processeur** de l'exécuteur : un JT
quotidien ne réveille aucune station GPU et n'entre pas en concurrence avec la
radio pour la même machine. `--muet` reste un repli si la synthèse échoue.

| Variable | Rôle |
|---|---|
| `WAF_API_URL` | Base de la forge (défaut `https://weareforger.data-space.world`) |
| `WAF_API_KEY` | Clé API v1 de la forge (`wafk_…`) — images, dépôt, montage |
| `ANTHROPIC_API_KEY` | Écriture du conducteur |
| `NOSTR_PRIVATE_KEY` | Identité qui signe les programmes |

## Setup (15 min)

### 1. Crée le repo GitHub

```bash
cd "/Users/med/Claude code Fichier Vs code/infinity-broadcast-scheduler"
git init
git add .
git commit -m "feat: initial scheduler scaffold"
gh repo create infinityfreeworld/infinity-broadcast-scheduler --public --source=. --push
```

### 2. Crée les comptes / récupère les clés

| Service | Action | URL |
|---|---|---|
| Anthropic | Crée une clé API (compte avec contact@perform.tf) | https://console.anthropic.com/settings/keys |
| Pinata | Crée un JWT (free tier 1 GB) | https://app.pinata.cloud/developers/api-keys |
| NOSTR | Génère une clé privée hex | `openssl rand -hex 32` |

### 3. Configure les GitHub secrets

Repo → Settings → Secrets and variables → Actions → New repository secret :

| Nom | Valeur |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` |
| `PINATA_JWT`        | `eyJhbGc...` |
| `NOSTR_PRIVATE_KEY` | clé hex 64 chars (du `openssl rand`) |

(Optionnel) Variables (non-secret) :
- `ANTHROPIC_MODEL` : `claude-haiku-4-5-20251001` (défaut)
- `NUM_TURNS` : `25` (défaut)
- `NOSTR_RELAYS` : liste comma-separated (défaut : 6 relays curatés)

### 4. Test local d'une station

**Pré-requis macOS** : Piper a besoin de la lib système `espeak-ng` (phonétisation
texte → sons) ET `opus-tools` (encodage final WAV → Opus pour upload Pinata, ~16× plus petit que WAV brut).
texte → sons). Sur Ubuntu CI, c'est dans le workflow ; pour le dev local Mac :

```bash
brew install espeak-ng opus-tools
```

Puis :

```bash
cp .env.example .env
# remplis .env avec tes clés

npm install
npm run typecheck
npm run generate:one wtf-radio
# → génère + upload + publie le broadcast WTF Radio pour J+1
```

Output attendu :
```
🎙  Génération broadcast : WTF Radio pour 2026-05-06
    Model : claude-haiku-4-5 · 25 tours · 3 animateur(s)

📦 Setup Piper…
   Téléchargement binaire piper_linux_x86_64.tar.gz…
   Téléchargement voix fr_FR-siwis-medium…

📰 Fetch actu…
   0 item(s) récupérés

🤖 Dialogue + TTS…
   [1/25] Cyril… Bonsoir et bienvenue sur WTF Radio…
   [2/25] Marina… Cyril a raison, mais on va plus loin…
   ...
   ✓ 25 tours, 9.4 min audio (240s wall)
   Tokens : 22431 in / 4892 out
   Coût estimé Haiku 4.5 : $0.0375

📡 Upload Pinata IPFS…
   ✓ CID bafybeicid... (8.7 MB)

📨 Publish NOSTR kind:30093…
   ✓ Event abc123… publié sur 5/6 relays

✅ Broadcast wtf-radio pour 2026-05-06 publié.
```

### 5. Vérification dans Infinity

Ouvre l'app Infinity, va sur la fréquence WTF Radio (91.3 MHz). Tu dois voir le badge `📼 REPLAY` apparaître au lock — c'est la lecture du broadcast que tu viens de générer.

### 6. Active le cron GitHub Actions

Repo → Actions → enable workflows. Le cron tourne automatiquement chaque jour à 22h UTC.

Pour trigger manuellement (test) :
- Repo → Actions → "Daily Broadcast Generation" → "Run workflow"
- Optionnellement spécifie une date ou une station unique

## TTS Chatterbox

Le pipeline supporte un **mode hybride** : Chatterbox (Resemble AI, voice
cloning) si configuré, repli Piper sinon. C'est ce qui donne aux animateurs
et invités leur VOIX PROPRE — Piper dirait le même texte avec une voix qui
n'est pas celle du personnage.

### 🔴 L'hébergement a changé — et le keepalive a été SUPPRIMÉ

Jusqu'au 02/09/2026, Chatterbox vivait sur un HF Space, maintenu éveillé par
un workflow `keepalive-chatterbox.yml` qui le sondait **toutes les 4 heures**.
Ce Space a fini **en pause** (`503 : The space is paused`), état dont il ne
sort pas tout seul : toutes les émissions d'août sont sorties avec les voix
Piper de repli, sans que rien ne le signale.

data-space héberge désormais Chatterbox sur un **GPU allumé à la demande**,
éteint dès la file vide. Le keepalive a donc été **supprimé, pas désactivé** :
le remettre rallumerait leur machine six fois par jour pour rien, et ils nous
offrent ce service. ⚠️ **Ne pas le recréer.**

Deux conséquences dans le code :

- `CHATTERBOX_WAKE_TIMEOUT_S` (défaut **600 s**) — démarrer une machine et
  charger le modèle prend bien plus que réveiller un Space endormi. L'ancien
  compte-à-rebours de 66 s aurait fait échouer la première station de chaque
  nuit, en silence.
- `CHATTERBOX_REQUEST_TIMEOUT_S` (défaut **300 s**) — data-space mesure
  Chatterbox à un facteur temps réel d'environ 1,0 ; le tour le plus long
  réellement diffusé fait 82,6 s d'audio, donc ~83 s de calcul. L'ancien
  abandon à 120 s ne laissait que 1,45× de marge.

**Activation** :

1. Obtenir l'URL du service auprès de data-space
2. Leur transmettre les échantillons de voix (ils les épinglent et rendent
   les CID) — ⚠️ sur IPFS, publier n'est pas conserver : nos 14 anciens CID
   ne répondaient plus faute d'épinglage
3. Ajoute les secrets GHA :
   - `CHATTERBOX_TTS_URL` (secret) — URL du service
   - `CHATTERBOX_API_KEY` (secret) — jeton Bearer
4. Ajoute les vars GHA :
   - `CHATTERBOX_VOICE_MAP` (var) — JSON `{"<hostId>":"<voiceName>"}` (optionnel)
   - `CHATTERBOX_DEFAULT_VOICE` (var) — voix utilisée si pas de mapping
   - `CHATTERBOX_LANGUAGE` (var) — défaut `fr`
   - `CHATTERBOX_FALLBACK_PIPER` (var) — défaut `true`

**Comportement** :
- Au démarrage : ping le HF Space (cold start ~30-60s)
- Pour chaque turn : si `host.id` est dans `CHATTERBOX_VOICE_MAP` → Chatterbox
- Si Chatterbox fail (timeout / 5xx) ET fallback activé → Piper FR
- Si pas de map ni de default → Piper FR direct (cas actuel)

**Coût additionnel** : ~10 USD/mois (HF Space GPU T4 avec sleep auto).

## Voix fiables : reprises de nuit, règle de publication, oreille de contrôle (07/10/2026)

**Le constat** (journaux du 21/09 au 06/10/2026) : environ deux stations sur trois sortaient
avec des tours en voix de repli Piper. Sur 2 171 tours perdus, **1 919 (88 %)** l'ont été sur
« échéance de la NUIT dépassée » : la nuit n'accordait que 150 minutes de voix clonée à toutes
les stations, alors que le GPU de data-space met ~32 minutes par station (il calcule à peu près
en temps réel ; « file pleine » n'est que le relevé régulier d'un travail en cours). Les 3 à 5
premières stations consommaient tout, les suivantes partaient entières en Piper. Le reste :
coupures réseau du Mac (141 tours) et jeton data-space indérivable pendant ces coupures (401,
81 tours).

**Ce qui a changé** :

- **La fenêtre** dure jusqu'à `RADIO_FIN_FENETRE` (heure locale, défaut `07:00`), au plus
  `RADIO_FENETRE_MAX_H` heures après le départ (défaut `11`). Les voix clonées sont permises
  jusqu'à la fin de la fenêtre moins `RADIO_MARGE_MONTAGE_MIN` (défaut `15`).
  `CHATTERBOX_NUIT_MINUTES`, s'il est posé, remet l'ancien budget (dépannage seulement).
  L'application joue la plus récente émission tant que celle du jour n'est pas publiée.
- **Reprise** : une station dont un tour a perdu sa voix de personnage n'est plus dite en
  Piper ; elle est **reportée** (code de sortie 75) et reprise à un passage suivant
  (`RADIO_MAX_PASSES`, défaut `4`), après une pause (`RADIO_PAUSE_REPRISE_MIN`, défaut `10`).
  Le **chantier** (`RADIO_CHANTIERS_DIR`, défaut `~/Library/Application Support/infinity-radio/chantiers`)
  garde le texte écrit et chaque tour déjà dit par sa voix : une reprise n'appelle pas le modèle
  de langue et ne redemande **que les tours manquants**. Chantier effacé à la publication, et
  au bout de 3 jours. Un service injoignable au réveil reporte la station AVANT l'écriture.
- **Dernière chance** : dernier passage, ou moins de `RADIO_MARGE_DERNIERE_CHANCE_MIN`
  (défaut `45`) avant la fin de la fenêtre. Là seulement, le repli Piper reprend son rôle et la
  règle de publication décide.

**Règle de publication** (décision du Bâtisseur : « si elle sonne robotique ou
incompréhensible, elle est refabriquée au lieu d'être diffusée ») :

| Situation | Ce qui se passe |
|---|---|
| toutes les voix de personnage sont là | publiée |
| des tours en repli, il reste du temps | **reportée**, reprise plus tard (seuls les tours manquants) |
| fin de fenêtre, `RADIO_REPLI_FINAL=garder-veille` (**défaut**) | **non publiée** : l'émission précédente reste à l'antenne (code 76) |
| …mais aucune émission de la station sur les `RADIO_VEILLE_MAX_JOURS` (défaut `2`) derniers jours, ou relais illisibles | publiée en repli, **avec alerte** (mieux qu'un silence) |
| fin de fenêtre, `RADIO_REPLI_FINAL=publier-alerte` | publiée en repli, avec alerte (comportement d'avant) |

`RADIO_REPLI_TOLERE` (défaut `0`) : nombre de tours en repli acceptés sans rien reporter.
Un lancement à la main de `generate-broadcast` est une dernière chance (pas de nuit derrière) ;
`--repetition` ne reporte jamais et n'applique pas la règle.

**Oreille de contrôle** (`src/lib/oreille.ts`) : chaque tour dit par une voix de personnage est
réécouté par **whisper.cpp** et comparé au texte prévu — taux d'erreur de mots (WER), part de
mots perdus (la mesure de l'usine du Journal), fin entendue. Les nombres, noms propres, sigles
et hésitations ne comptent pas ; en chinois on compte par caractère. Un tour refusé est
régénéré tout de suite (`OREILLE_ESSAIS`, défaut `1`), puis reporté comme un tour manquant ; à
la dernière chance, il est dit en voix locale plutôt qu'incompréhensible.

- `OREILLE_SEUIL_WER` (défaut `0.5`), `OREILLE_SEUIL_PERDUS` (défaut `0.25`),
  `OREILLE_FIN=0` (ne pas exiger la fin), `OREILLE_MOTS_MIN` (défaut `4` : en deçà on ne juge
  pas), `OREILLE_DELAI_S` (défaut `120`), `OREILLE=0` (coupe l'oreille).
- **Installation** sur la machine de nuit (sinon l'oreille se déclare indisponible et la nuit
  continue sur le contrôle du signal seul) :
  `brew install whisper-cpp`, puis le modèle
  `curl -L -o "$HOME/Library/Application Support/infinity-radio/whisper/ggml-base.bin" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin`
  (~150 Mo ; `OREILLE_MODELE` et `OREILLE_BINAIRE` pour d'autres chemins). Les seuils n'ont
  pas encore été calibrés sur de vraies émissions.

## Maintenance

**Coûts à surveiller** :
- Anthropic : `https://console.anthropic.com/settings/usage` — alarme à $20/mois
- Pinata : `https://app.pinata.cloud/pinmanager` — purge auto J-2 côté Infinity (Dashboard) quand R.7+ activé

**Si une station échoue** :
- Le job CI continue avec les autres (résilience)
- Vois les logs dans Actions → run → step "Generate broadcasts"
- Re-run manuel possible pour la station seule

**Ajouter une station seed** :
1. Modifier `src/data/seed-stations.ts` (ajouter au tableau `SEED_STATIONS`)
2. Modifier `src/data/seed-host-kbs.ts` (ajouter les KBs pour les nouveaux animateurs)
3. Modifier `src/scripts/generate-broadcast.ts` (mapping `PIPER_VOICE_BY_HOST`)
4. Push → prochain cron picke automatiquement

**Ajouter une voix Piper** :
1. Trouver le modèle sur https://huggingface.co/rhasspy/piper-voices
2. Ajouter dans `VOICE_REGISTRY` de `src/lib/piper.ts` (path HF + sample rate)

## Sécurité

- **Repo PUBLIC** : aucune donnée sensible dans le code (les KBs sont du contenu éditorial)
- **Secrets GitHub** : encrypted at rest, jamais loggés
- **Clé NOSTR privée** : appartient à l'admin scheduler, signe les broadcasts. Compromission = quelqu'un peut publier de faux broadcasts au nom de l'admin (mais pas accéder aux clés Anthropic/Pinata).

## Courrier et appels des auditeurs (07/10/2026, `src/lib/courrier/`)

Les Bâtisseurs écrivent à une station depuis l'app (✉️ dans l'en-tête Radio) : message, dédicace
ou message vocal (≤ 60 s), CHIFFRÉ (NIP-59) vers la clé « courrier radio ». Le soir, pour chaque
station, le générateur relève ces enveloppes, les juge (liste d'insultes, puis modèle de langue ;
vocaux transcrits par whisper.cpp) : insulte → écartée et comptée ; douteux → envoyé chiffré aux
admins radio (IHL › Pirate › Radio › Courrier) ; propre → lu à l'antenne le lendemain à la place du
courrier inventé. Les appels réglés dans la fiche de la station (30091 `appels`) passent les VRAIS
vocaux d'abord, puis des auditeurs JOUÉS (personnages inventés, voix inventées). Protocole complet :
`docs/radio-courrier-auditeurs.md` dans l'app.
- `RADIO_COURRIER_NSEC` (secret, nsec ou 64 hex) : SANS lui, aucun vrai message n'est lu ; les
  appels joués suivent seulement le réglage de la station ;
- `COURRIER_AUDITEURS=0` coupe tout (courrier et appels) ;
- `COURRIER_TRANSCRIPTION=0` coupe la transcription (les vocaux vont alors à l'IHL) ;
  `OREILLE_BINAIRE` / `OREILLE_MODELE` : les mêmes que l'oreille de contrôle.

## Musique dans les émissions (22/09/2026)

Chaque émission contient des **pauses musicales cuites dans le fichier** (`src/lib/musique.ts`),
entre des blocs de dialogue : par défaut **2 pauses de 3 min maximum** pour 22 tours (après le
7ᵉ et le 15ᵉ tour), tirées de façon déterministe par (station, date) parmi `station.tracks`.
Les jingles (`station.jingles`) ouvrent et ferment l'émission. Le niveau de la musique est calé
sur la voix (marge −4 dB), avec fondus. Le manifeste kind 30093 porte les `segments`
(`music` / `jingle`, CID, titre, tStart/tEnd) pour l'affichage « 🎵 titre » dans l'application.

- Sources : `station.tracks` de la seed, **remplacées** par ce que l'IHL publie (📻 Stations →
  🎵 Musiques / 📯 Jingles, kind 30091, auteur admin — `src/lib/station-reglages.ts`,
  `src/lib/admins-radio.ts`). Champs IHL reconnus : `tracks`, `jingles`, `skipMusic`,
  `pauses` (0-6), `pauseDureeS` (30-600).
- Réglages d'une nuit : `MUSIQUE_PAUSES`, `MUSIQUE_PAUSE_S`, `MUSIQUE_MARGE_DB`,
  `MUSIQUE_DESACTIVEE=true` (kill switch).
- **La musique ne bloque jamais l'émission** : une pause en échec est sautée et annoncée.
- Épingler les pistes chez data-space (sinon elles ne sont que mises en cache) :
  `npx tsx src/scripts/epingler-pistes.ts --executer` ou le workflow « Épingler les musiques ».
- Débit Opus : 64 kbps quand il y a de la musique (32 sinon).

## Habillage « réel, humain » (22/09/2026, `src/lib/humain.ts`)

Tout est déterministe par (station, date) et se coupe par variable (`off`) :
- `HABILLAGE_ECRITURE` : ~1 tour sur 5 est une réaction courte (3-10 mots), un tour lit le
  courrier des auditeurs, l'animateur qui précède une pause LANCE le morceau, celui qui suit
  en REVIENT ; la date du jour est connue (jamais l'heure) ; consigne de style oral ;
- `HABILLAGE_DISFLUENCES` (07/10/2026, `src/lib/disfluences.ts`) : les animateurs HÉSITENT
  (« euh… », « bah », « enfin », « tu vois », faux départs, « c'est, c'est vrai »), avec les
  hésitations naturelles de chaque langue (en : uh, um, I mean ; es : eh, pues, o sea ; ru : ну,
  э-э, как бы ; zh : 嗯, 那个, 就是). La consigne vise un tour sur deux ou trois, deux au plus par
  tour ; si le modèle en écrit trop peu, un rattrapage déterministe en ajoute (début de réponse,
  après une virgule, petite répétition), jamais dans l'ouverture, la conclusion, le lancement d'un
  morceau, le retour de pause, le courrier lu ni les réactions courtes. Valeur = part des tours
  concernés : `0.4` par défaut, `0.5` ou `50` pour un sur deux, `0` (ou `off`) = ni consigne ni
  rattrapage. Coupé aussi par `HABILLAGE_ECRITURE=off` ;
- `HABILLAGE_NIVEAUX` : chaque voix rejoint le niveau médian (±6 dB, sans écrêter) ;
- `HABILLAGE_SILENCES` : silence variable entre les tours (0,10-0,70 s, plus long après une
  question, plus court après une réaction brève) ;
- `HABILLAGE_FOND` : fond de salle à −58 dBFS dans les silences ;
- `HABILLAGE_TALKOVER` : la musique démarre sous les 1,2 dernières secondes de l'animateur ;
- `HABILLAGE_LIT` : un morceau à −16 dB sous l'ouverture (ident + 20 s) et la fermeture (8 s + ident) ;
- `IDENTS=false` coupe les idents (« Vous écoutez Radio Pirate. Le code est libre, l'humain aussi. »).

## Limites connues

- Les pistes par défaut (mai 2026) sont d'origine inconnue : à remplacer par des musiques
  dont les droits sont établis (CC0, productions maison, génération souveraine).
- Kokoro (chinois) : poids depuis GitHub, vérifiés par empreinte ; pas encore miroités.

## Roadmap

- R.8 : multi-langues (en/es/it/pt/hi/ja/zh)
- R.9 : vraies voix premium ElevenLabs ou cloud TTS (qualité broadcast)
- R.10 : archive des broadcasts (J-7 disponibles pour replay)

## License

AGPL-3.0 — code libre. Voir [LICENSE](./LICENSE) (à ajouter).
