# Infinity Broadcast Scheduler

Cron quotidien qui génère les **broadcasts radio pré-enregistrés** pour [Infinity](https://github.com/infinityfreeworld/infinity), tourne en GitHub Actions, publie sur **IPFS (Pinata)** + **NOSTR (kind:30093)**.

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
│   └── scripts/
│       ├── generate-broadcast.ts ← 1 station (testable localement)
│       └── generate-all.ts       ← toutes les stations (CI)
└── .github/workflows/
    └── daily-broadcast.yml       ← cron 22h UTC daily
```

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
texte → sons). Sur Ubuntu CI, c'est dans le workflow ; pour le dev local Mac :

```bash
brew install espeak-ng
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
   Téléchargement voix fr_FR-tom-medium…

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

## Limites connues V1

- **Pas de musique** dans les broadcasts (juste dialogue continu). Insertion de musique = R.7+ (intégration des CIDs IPFS de tracks).
- **WAV brut** (~1 MB / 10s audio). Migration Opus = R.7 (économise 10× le stockage IPFS).
- **9 stations FR uniquement**. Ajouter EN/ES/etc. nécessite voix kokoro côté Node (= reécrire piper.ts pour kokoro).

## Roadmap

- R.7 : encodage Opus
- R.7 : insertion musiques entre dialogues (porter `runMusicPhase` browser → Node)
- R.8 : multi-langues (en/es/it/pt/hi/ja/zh)
- R.9 : vraies voix premium ElevenLabs ou cloud TTS (qualité broadcast)
- R.10 : archive des broadcasts (J-7 disponibles pour replay)

## License

AGPL-3.0 — code libre. Voir [LICENSE](./LICENSE) (à ajouter).
