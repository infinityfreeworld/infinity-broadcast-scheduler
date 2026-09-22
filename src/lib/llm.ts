/**
 * @module InfinityScheduler/Lib/LLM
 * @description Chaîne de maillons pour écrire les dialogues — **gratuit
 *   d'abord, Anthropic en dernier recours**.
 *
 *   Le scheduler appelait Anthropic en dur. Décision du Bâtisseur
 *   (02/09/2026) : la radio doit tourner sur du gratuit, et Anthropic ne
 *   doit prendre le relais que si le gratuit est indisponible.
 *
 *   Ordre : Mistral → passerelle Hackers Libres → Anthropic.
 *
 *   ── POURQUOI CET ORDRE ──
 *   - **Mistral** : offre gratuite d'environ 1 milliard de jetons par mois.
 *     Notre charge complète — 15 stations, ~1,17 M jetons/jour — en
 *     représente ~3,5 %. C'est le seul maillon dont le plafond n'est pas
 *     un problème. ⚠️ Son offre gratuite impose d'accepter que les données
 *     servent à entraîner leurs modèles : du texte d'antenne destiné à
 *     être diffusé, mais cela doit être DIT.
 *   - **Passerelle HL** (Groq) : sans clé, marche tout de suite, mais
 *     plafonnée à 6 000 jetons par MINUTE — une émission en demande
 *     78 000. Elle est de plus partagée avec toute l'application Infinity.
 *     Bon secours, mauvais moteur principal.
 *   - **Anthropic** : payant, donc dernier.
 *
 *   ── 🔴 LA RÈGLE QUI FAIT TOUT ──
 *   **Une réponse VIDE est un ÉCHEC BRUYANT de ce maillon, jamais un
 *   passage discret au suivant.**
 *
 *   C'est exactement le défaut qui a fait que Matrixia n'a JAMAIS utilisé
 *   Groq : son lecteur ne savait lire que du SSE, la passerelle répondait
 *   en JSON d'un bloc, il rendait zéro jeton sans erreur, et la chaîne
 *   notait « maillon muet » puis passait au suivant. Le meilleur maillon
 *   était écarté pour toujours, en silence, et rien ne le disait.
 *
 *   Ici, chaque tentative est NOMMÉE dans le journal, et le maillon qui a
 *   réellement servi est compté puis annoncé en fin d'émission. Un maillon
 *   qui ne sert jamais doit se voir.
 */

import { callAnthropic, type LLMMessage, type LLMResponse } from './anthropic'
import { jetonDataspace } from './dataspace-jeton'

export type { LLMMessage }

export interface AppelLLM {
  systemPrompt: string
  messages:     LLMMessage[]
  maxTokens?:   number
  temperature?: number
}

export interface ReponseLLM extends LLMResponse {
  /** Quel maillon a réellement répondu. */
  maillon: string
}

export interface Maillon {
  nom:         string
  /** Pourquoi ce maillon est hors course, ou null s'il est utilisable. */
  indisponible(): string | null
  appeler(a: AppelLLM): Promise<LLMResponse>
}

const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions'
/**
 * Le LLM SOUVERAIN : la station GPU de data-space, derrière son shim compatible OpenAI
 * (Qwen3-4B, llama.cpp). Directive du fondateur (16/09/2026) : « on oublie complètement
 * Hugging Face, on doit être complètement souverain ».
 *
 * 🔴 POURQUOI IL EST DÉBRANCHÉ PAR DÉFAUT (22/09/2026, lu dans le code du shim)
 *   · le prompt est COUPÉ à 3 000 caractères — un animateur reçoit persona + base de
 *     connaissances + actualité, bien plus ; la consigne finale tomberait dans la coupe ;
 *   · la sortie est plafonnée à 256 jetons, l'attente à 60 s, et un seul nœud « llm » ;
 *   · un modèle de 4 milliards de paramètres n'écrit pas 22 tours tenus.
 * Le maillon existe pour que la voie souveraine soit à UNE variable de distance le jour où
 * la station porte un modèle plus grand et un prompt entier ; il n'écrit pas la radio en
 * cachette. `DATASPACE_LLM_ORDRE=avant-anthropic` (après Mistral et la passerelle) ou
 * `premier` (en tête) l'enrôle ; absent ou `non` : hors course, et le journal le dit.
 */
const DATASPACE_LLM_URL = 'https://data-space.world/api/v1/gpu/chat/completions'
const HL_URL = 'https://infinity-llm-gateway.digitalforlifeagency.workers.dev/v1/chat/completions'

/** Corps commun aux deux maillons compatibles OpenAI. */
function corpsOpenAI(a: AppelLLM, modele: string): string {
  return JSON.stringify({
    model:       modele,
    messages:    [{ role: 'system', content: a.systemPrompt }, ...a.messages],
    max_tokens:  a.maxTokens ?? 400,
    temperature: a.temperature ?? 0.85,
    stream:      false,
  })
}

/**
 * Lit une réponse au format OpenAI.
 *
 * ⚠️ Un `choices[0].message.content` vide LÈVE. C'est délibéré : rendre
 * une chaîne vide ferait passer ce maillon pour « sans rien à dire »
 * alors qu'il est cassé.
 */
export async function lireOpenAI(res: Response, nom: string): Promise<LLMResponse> {
  const texteBrut = await res.text()
  if (!res.ok) {
    throw new Error(`${nom} HTTP ${res.status} : ${texteBrut.slice(0, 200)}`)
  }
  let j: {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  try {
    j = JSON.parse(texteBrut) as typeof j
  } catch {
    throw new Error(`${nom} : réponse illisible — ${texteBrut.slice(0, 200)}`)
  }
  const texte = (j.choices?.[0]?.message?.content ?? '').trim()
  if (!texte) {
    throw new Error(`${nom} : réponse VIDE (0 jeton) — maillon considéré en panne, pas muet`)
  }
  return {
    text:         texte,
    inputTokens:  j.usage?.prompt_tokens ?? 0,
    outputTokens: j.usage?.completion_tokens ?? 0,
  }
}

const MAILLON_DATASPACE: Maillon = {
  nom: 'data-space',
  indisponible: () => {
    const ordre = (process.env.DATASPACE_LLM_ORDRE ?? '').trim()
    if (ordre !== 'avant-anthropic' && ordre !== 'premier') return 'hors course (DATASPACE_LLM_ORDRE absent — prompt coupé à 3 000 car., 256 jetons, Qwen3-4B)'
    if (!process.env.DATASPACE_NOSTR_KEY && !process.env.DATASPACE_API_KEY) return 'aucune clé data-space'
    return null
  },
  async appeler(a) {
    const jeton = await jetonDataspace()
    const res = await fetch(DATASPACE_LLM_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` },
      // 256 jetons de sortie au plus côté station : au-delà, le shim borne et le dit.
      body:    corpsOpenAI({ ...a, maxTokens: Math.min(a.maxTokens ?? 400, 256) }, 'dataspace-gpu-llm'),
      signal:  AbortSignal.timeout(90_000),
    })
    return lireOpenAI(res, 'data-space')
  },
}

const MAILLONS_BASE: Maillon[] = [
  {
    nom: 'mistral',
    indisponible: () => process.env.MISTRAL_API_KEY ? null : 'MISTRAL_API_KEY absente',
    async appeler(a) {
      const res = await fetch(MISTRAL_URL, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${process.env.MISTRAL_API_KEY}`,
        },
        body:   corpsOpenAI(a, process.env.MISTRAL_MODEL ?? 'mistral-small-latest'),
        signal: AbortSignal.timeout(90_000),
      })
      return lireOpenAI(res, 'mistral')
    },
  },
  {
    nom: 'passerelle-hl',
    // Aucune clé requise : c'est le maillon qui marche sans configuration.
    indisponible: () => process.env.HL_GATEWAY_DESACTIVEE === 'true'
      ? 'désactivée par HL_GATEWAY_DESACTIVEE' : null,
    async appeler(a) {
      const res = await fetch(HL_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    corpsOpenAI(a, process.env.HL_GATEWAY_MODEL ?? ''),
        signal:  AbortSignal.timeout(90_000),
      })
      return lireOpenAI(res, 'passerelle-hl')
    },
  },
  {
    nom: 'anthropic',
    indisponible: () => process.env.ANTHROPIC_API_KEY ? null : 'ANTHROPIC_API_KEY absente',
    async appeler(a) {
      return callAnthropic({
        apiKey:       process.env.ANTHROPIC_API_KEY!,
        model:        process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5',
        systemPrompt: a.systemPrompt,
        messages:     a.messages,
        maxTokens:    a.maxTokens,
        temperature:  a.temperature,
      })
    },
  },
]

/**
 * L'ordre effectif des maillons. Le maillon souverain n'entre en course que sur demande
 * (`DATASPACE_LLM_ORDRE`, voir plus haut) ; sinon il figure en fin de liste, hors course,
 * pour que le journal dise pourquoi. Recalculé à chaque appel : un test peut poser la
 * variable après l'import.
 */
export function maillons(): Maillon[] {
  const ordre = (process.env.DATASPACE_LLM_ORDRE ?? '').trim()
  if (ordre === 'premier') return [MAILLON_DATASPACE, ...MAILLONS_BASE]
  if (ordre === 'avant-anthropic') {
    const i = MAILLONS_BASE.findIndex(m => m.nom === 'anthropic')
    const coupe = i >= 0 ? i : MAILLONS_BASE.length
    return [...MAILLONS_BASE.slice(0, coupe), MAILLON_DATASPACE, ...MAILLONS_BASE.slice(coupe)]
  }
  return [...MAILLONS_BASE, MAILLON_DATASPACE]
}

/** Combien de fois chaque maillon a servi, pour le bilan de fin d'émission. */
const service = new Map<string, number>()

export function bilanDesMaillons(): string {
  if (service.size === 0) return 'aucun appel'
  return [...service.entries()].map(([n, c]) => `${n}×${c}`).join(' · ')
}

export function reinitialiserBilan(): void {
  service.clear()
}

/** Maillons réellement utilisables, dans l'ordre — pour l'annoncer AVANT de générer. */
export function maillonsDisponibles(): Array<{ nom: string; raison: string | null }> {
  return maillons().map(m => ({ nom: m.nom, raison: m.indisponible() }))
}

/**
 * Écrit un tour de dialogue, en descendant la chaîne jusqu'au premier
 * maillon qui répond vraiment.
 *
 * Chaque échec est NOMMÉ. Si tous échouent, l'erreur porte la liste des
 * tentatives — jamais un simple « échec LLM », qui ferait chercher au
 * mauvais endroit.
 */
export async function appelerLLM(a: AppelLLM): Promise<ReponseLLM> {
  const tentatives: string[] = []

  for (const m of maillons()) {
    const raison = m.indisponible()
    if (raison) { tentatives.push(`${m.nom} écarté (${raison})`); continue }
    try {
      const r = await m.appeler(a)
      service.set(m.nom, (service.get(m.nom) ?? 0) + 1)
      // Un maillon qui prend le relais doit se VOIR : sans cette ligne, on
      // croirait tourner sur le gratuit alors qu'on paye.
      if (tentatives.length > 0) {
        console.warn(`  ⚠ maillon de repli « ${m.nom} » — ${tentatives.join(' ; ')}`)
      }
      return { ...r, maillon: m.nom }
    } catch (err) {
      tentatives.push(`${m.nom} : ${(err as Error).message.slice(0, 120)}`)
    }
  }

  throw new Error(`Aucun maillon LLM n'a répondu.\n  ${tentatives.join('\n  ')}`)
}
