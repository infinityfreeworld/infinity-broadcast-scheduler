/**
 * @module InfinityScheduler/Chatterbox
 * @description Sprint DE — Wrapper Node.js pour le serveur Chatterbox TTS
 *   (Resemble AI, image Docker `ghcr.io/devnen/chatterbox-tts-server`).
 *
 *   Adapté du wrapper Neo CPI (~280 LoC). Différences :
 *     - Pure Node (pas de Buffer browser)
 *     - Pas d'admin upload depuis ici (upload géré côté IHL browser)
 *     - Health check `pingUntilReady()` qui attend le réveil du HF Space
 *
 *   Variables d'environnement requises :
 *     - CHATTERBOX_TTS_URL : https://username-chatterbox-xxx.hf.space
 *     - CHATTERBOX_API_KEY : bearer token (hf_xxx)
 *     - CHATTERBOX_VOICE_MAP : JSON optionnel `{ "<hostId>": "<voiceName>" }`
 *     - CHATTERBOX_DEFAULT_VOICE : voix utilisée si hostId pas dans la map
 *     - CHATTERBOX_LANGUAGE : défaut 'fr'
 *     - CHATTERBOX_FALLBACK_PIPER : 'true' (défaut) pour fallback si Chatterbox fail
 *
 *   Usage typique (depuis generate-broadcast.ts) :
 *     const cbVoice = getChatterboxVoiceForHost(station.id, host.id)
 *     if (cbVoice) {
 *       try {
 *         const buf = await synthesizeWithChatterbox(text, cbVoice)
 *         writeFileSync(tmpPath, buf)
 *         // suite pipeline normale (readWav, concat, etc.)
 *       } catch (err) {
 *         // fallback Piper
 *       }
 *     }
 */

import { getNostrVoiceForHost } from './host-voice-mappings'

export interface ChatterboxSpeakOptions {
  voice:               string
  text:                string
  language?:           string
  format?:             'mp3' | 'wav' | 'opus' | 'flac'
  emotionExaggeration?: number
  cfgWeight?:          number
  temperature?:        number
  speed?:              number
}

export class ChatterboxError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'ChatterboxError'
  }
}

function getEndpoint(): { url: string; apiKey: string } {
  const url = process.env.CHATTERBOX_TTS_URL
  if (!url) throw new ChatterboxError('CHATTERBOX_TTS_URL non défini')
  return {
    url:    url.replace(/\/+$/, ''),
    apiKey: process.env.CHATTERBOX_API_KEY ?? '',
  }
}

/**
 * Chemin de la route de synthèse chez data-space.
 *
 * 🔴 Nous appelions `/v1/audio/speech` — la convention OpenAI, héritée du
 * serveur Hugging Face que nous utilisions avant. data-space expose
 * `POST /api/v1/gpu/voix`, et AUCUNE valeur de `CHATTERBOX_TTS_URL` ne
 * pouvait rattraper l'écart : une base qui rend la bonne route de synthèse
 * casse toutes les autres.
 *
 * L'erreur aurait été un 404 la nuit de la diffusion — indiscernable, dans
 * nos journaux, d'un `voice_not_found`, qui est un 404 lui aussi. Nous
 * aurions cherché du côté des noms de voix, qui sont justes.
 *
 * Vérifié en ligne le 02/09/2026 : sur cette route, une voix INCONNUE rend
 * bien `404 voice_not_found` avec la liste des voix.
 */
function cheminSynthese(): string {
  return process.env.CHATTERBOX_SYNTH_PATH ?? '/api/v1/gpu/voix'
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

/**
 * Health check du HF Space. Sprint DJ — utilise `/api/model-info` (le seul
 * endpoint GET léger sans paramètre exposé par `devnen/chatterbox-tts-server`).
 * `/health` n'existe pas sur cette image (renvoie 404 FastAPI).
 */
export async function pingChatterbox(): Promise<{ ok: boolean; status: number; ms: number }> {
  const { url, apiKey } = getEndpoint()
  const t0 = Date.now()
  try {
    const res = await fetch(`${url}/api/model-info`, {
      headers: authHeaders(apiKey),
      signal:  AbortSignal.timeout(90_000),
    })
    return { ok: res.ok, status: res.status, ms: Date.now() - t0 }
  } catch {
    return { ok: false, status: 0, ms: Date.now() - t0 }
  }
}

/**
 * Attend que le service réponde, en le sondant.
 *
 * ── POURQUOI C'EST BEAUCOUP PLUS LONG QU'AVANT ──
 * Ce compte-à-rebours valait 6 tentatives, soit **66 secondes en tout** —
 * calibré sur un HF Space endormi, qui se réveille en 30 à 60 s.
 *
 * data-space nous héberge désormais Chatterbox sur un **GPU allumé à la
 * demande** (réponse du 02/09/2026) : il faut démarrer une machine ET
 * charger le modèle. 66 secondes n'y suffisent pas. La première station
 * de la nuit échouerait donc et retomberait sur Piper — **sans erreur**,
 * puisque le repli est un comportement normal. Une antenne qui perd ses
 * personnages sans que rien ne le signale.
 *
 * Le défaut par défaut est donc la PATIENCE : mieux vaut attendre dix
 * minutes une machine qui démarre que produire une émission entière avec
 * les mauvaises voix.
 *
 * Réglable par `CHATTERBOX_WAKE_TIMEOUT_S` (défaut 720 s : 5 min de
 * refroidissement + ~12 min de démarrage annoncés par data-space).
 */
/**
 * Ce qu'un réveil peut apprendre.
 *
 * `voix-absente` est une faute de NOTRE côté (mauvais nom de fichier),
 * corrigible en une minute. `injoignable` est une panne du service. Les
 * confondre ferait accuser data-space d'une coquille chez nous — et
 * inversement, ferait chercher une coquille pendant une panne.
 */
export type EtatReveil = 'pret' | 'voix-absente' | 'injoignable'

/**
 * Réveille le service et PROUVE qu'il peut parler, en lui demandant une
 * vraie phrase courte avec une vraie voix.
 *
 * ── POURQUOI PAS UN SIMPLE PING ──
 * Un `GET /api/model-info` ne réveille pas forcément une machine allumée
 * à la demande : rien ne garantit que la porte d'entrée compte une
 * lecture comme du travail à faire. Nous sonderions alors une machine
 * endormie jusqu'à épuisement du budget, avant de retomber sur Piper —
 * le scénario d'échec le plus probable de la première nuit.
 *
 * Une synthèse courte, elle, réveille à coup sûr (c'est la route de
 * travail) ET vérifie la seule chose qui compte : que CETTE voix existe
 * et rend de l'audio. Un témoin connu-bon plutôt qu'un signe de vie.
 *
 * 🔴 data-space expose bien un `GET /api/v1/gpu/voix` qui rend `ready`.
 * Nous ne l'utilisons PAS comme feu vert, et le 02/09/2026 l'a justifié :
 * il annonçait `ready: true` pendant que quinze synthèses d'affilée —
 * trois formats, deux voix, 343 s de relances — restaient bloquées en
 * `429 not_ready`. Un indicateur d'état n'est pas une preuve de service.
 * Il reste utile pour SAVOIR S'IL FAUDRA ATTENDRE, jamais pour conclure
 * que tout va bien.
 */
/**
 * Ouvre une session de diffusion : data-space chauffe sa station tout de
 * suite et la maintient éveillée pendant la fenêtre demandée.
 *
 * ── POURQUOI ÇA NOUS VA SI BIEN ──
 * Leur station s'éteint après 10 min sans travail, et la rallumer coûte
 * 15 à 30 min. Notre synthèse est déjà GROUPÉE — tout le texte écrit
 * d'abord, toute la synthèse d'un trait — donc nos requêtes sont
 * naturellement serrées. La session ajoute la seule chose qui manquait :
 * notre PREMIÈRE phrase ne paie plus l'allumage, puisqu'ils chauffent dès
 * l'annonce, pendant que nous écrivons encore.
 *
 * ⚠️ Un échec ici n'est JAMAIS bloquant. La session est un confort, pas
 * une dépendance : sans elle la synthèse marche, elle attend seulement
 * plus longtemps. La faire lever ferait perdre une émission entière pour
 * une optimisation.
 */
export async function ouvrirSessionDiffusion(minutes: number): Promise<boolean> {
  const { url, apiKey } = getEndpoint()
  const chemin = process.env.CHATTERBOX_SESSION_PATH ?? '/api/v1/gpu/voix/session'
  try {
    const res = await fetch(`${url}${chemin}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey) },
      body:    JSON.stringify({ minutes }),
      signal:  AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      console.warn(`  [chatterbox] session refusée (HTTP ${res.status}) — on continue sans`)
      return false
    }
    console.log(`  [chatterbox] session de ${minutes} min ouverte — la station chauffe`)
    return true
  } catch (err) {
    console.warn(`  [chatterbox] session injoignable (${(err as Error).message.slice(0, 80)}) — on continue sans`)
    return false
  }
}

export async function reveillerEtVerifier(voix: string): Promise<EtatReveil> {
  const budgetMs = Number.parseInt(process.env.CHATTERBOX_WAKE_TIMEOUT_S ?? '720', 10) * 1000
  const maxTentatives = Number.parseInt(process.env.CHATTERBOX_WAKE_ATTEMPTS ?? '24', 10)
  const debut = Date.now()
  let delai = 5_000

  for (let i = 0; i < maxTentatives; i++) {
    const ecoule = Math.round((Date.now() - debut) / 1000)
    try {
      // Opus, et non WAV : cet audio-ci est JETÉ — seule compte la réponse.
      // Le réveil peut demander jusqu'à 24 tentatives ; en Opus la sonde
      // pèse ~10× moins. ⚠️ Le MONTAGE, lui, reste en WAV (voir plus bas).
      await synthesizeWithChatterbox({ voice: voix, text: 'Bonjour.', format: 'opus' })
      console.log(`  [chatterbox] éveillé et vérifié avec « ${voix} » après ${ecoule}s`)
      return 'pret'
    } catch (err) {
      const e = err as ChatterboxError
      // 404 : le service RÉPOND, mais ce nom de voix lui est inconnu.
      // Inutile d'attendre : ce n'est pas un réveil, c'est une coquille.
      if (e.status === 404) {
        console.warn(`  [chatterbox] service éveillé, mais la voix « ${voix} » lui est INCONNUE`)
        return 'voix-absente'
      }
      console.log(`  [chatterbox] réveil ${i + 1}/${maxTentatives} : ${e.status ?? '—'} (${ecoule}s écoulées)`)
    }
    if (i === maxTentatives - 1) break
    if (Date.now() - debut + delai > budgetMs) {
      console.warn(`  [chatterbox] budget de réveil épuisé (${budgetMs / 1000}s)`)
      break
    }
    await new Promise(r => setTimeout(r, delai))
    delai = Math.min(delai * 1.5, 45_000)
  }
  return 'injoignable'
}

export async function pingUntilReady(
  maxAttempts = Number.parseInt(process.env.CHATTERBOX_WAKE_ATTEMPTS ?? '24', 10),
  initialDelayMs = 5_000,
): Promise<boolean> {
  const budgetMs = Number.parseInt(process.env.CHATTERBOX_WAKE_TIMEOUT_S ?? '720', 10) * 1000
  const debut = Date.now()
  let delay = initialDelayMs
  for (let i = 0; i < maxAttempts; i++) {
    const r = await pingChatterbox()
    const ecoule = Math.round((Date.now() - debut) / 1000)
    console.log(`  [chatterbox] ping ${i + 1}/${maxAttempts} : ${r.ok ? '✓' : '✗'} ${r.status} (${r.ms}ms · ${ecoule}s écoulées)`)
    if (r.ok) {
      if (i > 0) console.log(`  [chatterbox] service éveillé après ${ecoule}s`)
      return true
    }
    if (i === maxAttempts - 1) break
    if (Date.now() - debut + delay > budgetMs) {
      console.warn(`  [chatterbox] budget de réveil épuisé (${budgetMs / 1000}s) — on renonce`)
      break
    }
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 1.5, 45_000)
  }
  return false
}

/**
 * Synthèse texte → audio. Retourne un Buffer (WAV/MP3/etc selon format).
 */
/**
 * Synthèse avec OBÉISSANCE au 429.
 *
 * ── LE CONTRAT QUE NOUS PROPOSONS À data-space ──
 * Leur GPU sérialise. Deux stratégies étaient possibles quand la file est
 * pleine : qu'ils TIENNENT la connexion ouverte le temps de nous servir,
 * ou qu'ils nous renvoient tout de suite un 429 avec un `Retry-After`.
 *
 * Nous demandons la seconde, et voici pourquoi : une connexion tenue nous
 * oblige à un délai d'abandon qui couvre la file ENTIÈRE — soit un quart
 * d'heure — et ce délai devient alors indiscernable d'une panne. Avec un
 * 429 immédiat, l'attente est EXPLICITE, chiffrée par celui qui sait, et
 * notre abandon à 300 s ne mesure plus que la synthèse elle-même.
 *
 * Nous respectons donc `Retry-After` et réessayons dans un budget borné,
 * plutôt que de nous acharner.
 */
export async function synthesizeWithChatterbox(opts: ChatterboxSpeakOptions): Promise<Buffer> {
  const budgetMs = Number.parseInt(process.env.CHATTERBOX_QUEUE_BUDGET_S ?? '1800', 10) * 1000
  const debut = Date.now()
  for (let tentative = 1; ; tentative++) {
    try {
      return await synthetiserUneFois(opts)
    } catch (err) {
      const e = err as ChatterboxError
      if (e.status !== 429) throw err
      const attenteS = Number.parseInt(/Retry-After (\d+)s/.exec(e.message)?.[1] ?? '15', 10)
      const restant = budgetMs - (Date.now() - debut)
      if (restant <= attenteS * 1000) {
        throw new ChatterboxError(
          `file d'attente saturée au-delà de notre budget (${budgetMs / 1000}s) — repli`,
          429,
        )
      }
      console.log(`  [chatterbox] file pleine, on patiente ${attenteS}s (tentative ${tentative})`)
      await new Promise(r => setTimeout(r, attenteS * 1000))
    }
  }
}

async function synthetiserUneFois(opts: ChatterboxSpeakOptions): Promise<Buffer> {
  const { url, apiKey } = getEndpoint()
  const body = {
    model:                'chatterbox',
    input:                opts.text,
    voice:                opts.voice.endsWith('.wav') ? opts.voice : `${opts.voice}.wav`,
    // 🔴 Défaut WAV DÉLIBÉRÉ. data-space propose l'Opus pour alléger le
    // transfert, et c'est juste pour une sonde ou une livraison finale.
    // Mais le montage décode chaque tour avec `readWav`, qui exige du
    // RIFF : un buffer Opus le ferait lever, et l'appelant prendrait
    // cette erreur pour une panne du service en basculant sur Piper —
    // zéro voix de personnage, sans qu'aucune ligne ne le dise.
    // Passer le montage en Opus exige d'abord un décodeur, pas ce flag.
    response_format:      opts.format ?? 'wav',
    language:             opts.language ?? process.env.CHATTERBOX_LANGUAGE ?? 'fr',
    language_id:          opts.language ?? process.env.CHATTERBOX_LANGUAGE ?? 'fr',
    emotion_exaggeration: opts.emotionExaggeration ?? 0.55,
    cfg_weight:           opts.cfgWeight ?? 0.65,
    temperature:          opts.temperature ?? 0.75,
    speed:                opts.speed ?? 1.0,
  }
  const res = await fetch(`${url}${cheminSynthese()}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(apiKey),
    },
    body:    JSON.stringify(body),
    // ⚠️ Le tour le plus long RÉELLEMENT diffusé (relevé du 29/08/2026)
    // fait 82,6 s d'audio. data-space mesure Chatterbox à un facteur temps
    // réel d'environ 1,0 : ce tour demande donc ~83 s de calcul, contre un
    // abandon à 120 s — une marge de 1,45× seulement, avant toute file
    // d'attente. Un abandon ici ne lève pas d'alerte : il fait retomber le
    // tour sur Piper, et l'émission change de voix en cours de route.
    signal:  AbortSignal.timeout(
      Number.parseInt(process.env.CHATTERBOX_REQUEST_TIMEOUT_S ?? '300', 10) * 1000,
    ),
  })
  if (!res.ok) {
    let detail = ''
    try { detail = await res.text() } catch { /* */ }
    // 429 — le service nous demande de ralentir. Obéir vaut mieux que
    // réessayer aveuglément : c'est LUI qui sait combien de requêtes son
    // GPU absorbe. On respecte `Retry-After` quand il est donné.
    if (res.status === 429) {
      const entete = res.headers.get('retry-after')
      const attente = entete && /^\d+$/.test(entete) ? Number.parseInt(entete, 10) : 15
      throw new ChatterboxError(
        `speech HTTP 429 — service saturé, Retry-After ${attente}s${detail ? ' : ' + detail.slice(0, 120) : ''}`,
        429,
      )
    }
    throw new ChatterboxError(`speech HTTP ${res.status}${detail ? ' : ' + detail.slice(0, 200) : ''}`, res.status)
  }
  const arrayBuf = await res.arrayBuffer()
  return Buffer.from(arrayBuf)
}

/**
 * Voix shipées par défaut avec `devnen/chatterbox-tts-server` (Resemble AI
 * Chatterbox). TOUTES sont entraînées principalement en anglais — utilisées
 * sur une station non-anglaise, elles produisent un accent anglais marqué
 * (constaté par l'user 2026-05-20 sur WTF Radio FR).
 *
 * Pour les stations dont `language !== 'en'`, on retourne null pour ces
 * voix → fallback Piper qui est nativement multilingue (FR, ES, IT, PT, …).
 *
 * Pour que Chatterbox parle français correctement, il faudra uploader des
 * voix françaises clonées via l'IHL « Voix Radio » (HF Space upload sample
 * 5-10s) puis les assigner aux animateurs FR dans l'IHL « Voix Anim. ».
 * Ces voix custom ne sont PAS dans cette blacklist → elles seront utilisées.
 */
const SHIPPED_ENGLISH_VOICES = new Set([
  'Abigail', 'Adrian', 'Alexander', 'Alice', 'Austin', 'Axel',
  'Connor', 'Cora', 'Elena', 'Eli', 'Emily', 'Everett',
  'Gabriel', 'Gianna', 'Henry', 'Ian', 'Jade', 'Jeremiah',
  'Jordan', 'Julian', 'Layla', 'Leonardo', 'Michael', 'Miles',
  'Nestor', 'Olivia', 'Owen', 'Penelope', 'Ryan', 'Sophia',
  'Thomas', 'Victoria', 'William',
])

/**
 * Retourne le nom de la voix Chatterbox associée à un (station, host),
 * ou null si le mapping n'est pas configuré OU si le host n'a pas de
 * voix custom.
 *
 * Ordre de résolution (Phase C.3 2026-05-20) :
 *   1. NOSTR mapping kind:30095 (chargé depuis HOST_VOICE_MAP_JSON)
 *      — source de vérité gérée par l'IHL Infinity.
 *   2. CHATTERBOX_VOICE_MAP (legacy, par hostId seulement, pas station)
 *      — gardé pour rétrocompat tant que la migration n'est pas terminée.
 *   3. CHATTERBOX_DEFAULT_VOICE (fallback global).
 *   4. null → fallback Piper (cf isFallbackPiperEnabled).
 *
 *   Si Chatterbox n'est pas du tout configuré (`CHATTERBOX_TTS_URL` vide),
 *   on retourne null direct pour basculer sur Piper.
 *
 *   Phase E pré-fix (2026-05-20) — si `language` est fourni et != 'en',
 *   et que la voix résolue est une voix shipée anglaise (Abigail, Adrian…),
 *   on retourne null pour forcer le fallback Piper (qui est natif
 *   multilingue). Évite l'accent anglais entendu sur les stations FR.
 */
export function getChatterboxVoiceForHost(
  stationId: string,
  hostId: string,
  language?: string,
): string | null {
  if (!process.env.CHATTERBOX_TTS_URL) return null

  let resolved: string | null = null

  // 1. NOSTR mapping (kind:30095) — source de vérité IHL
  const fromNostr = getNostrVoiceForHost(stationId, hostId)
  if (fromNostr) resolved = fromNostr

  // 2. Legacy env JSON map (par hostId seulement)
  if (!resolved) {
    const json = process.env.CHATTERBOX_VOICE_MAP
    if (json) {
      try {
        const map = JSON.parse(json) as Record<string, string>
        if (map[hostId]) resolved = map[hostId]
      } catch (err) {
        console.warn('[chatterbox] CHATTERBOX_VOICE_MAP malformé:', (err as Error).message)
      }
    }
  }

  // 3. Default global
  if (!resolved) {
    const defaultVoice = process.env.CHATTERBOX_DEFAULT_VOICE
    if (defaultVoice && defaultVoice.length > 0) resolved = defaultVoice
  }

  if (!resolved) return null

  // 4. Phase E pré-fix — voix shipée anglaise sur station non-en → Piper
  if (language && language !== 'en' && SHIPPED_ENGLISH_VOICES.has(resolved)) {
    return null
  }

  return resolved
}

/**
 * True si Chatterbox est configuré ET le fallback Piper est activé
 * (défaut). Permet au pipeline de décider de retry Piper si Chatterbox
 * fail.
 */
export function isFallbackPiperEnabled(): boolean {
  const v = process.env.CHATTERBOX_FALLBACK_PIPER
  if (v === undefined || v === '') return true   // défaut : on retombe sur Piper
  return v === 'true' || v === '1' || v === 'yes'
}
