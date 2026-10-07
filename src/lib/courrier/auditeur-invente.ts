/**
 * @module InfinityScheduler/Courrier/AuditeurInvente
 * @description L'auditeur JOUÉ par l'IA quand une station attend des appels et qu'aucun vrai
 *   message vocal n'est arrivé (décision du Bâtisseur, 07/10/2026) : TOUJOURS un personnage
 *   INVENTÉ — jamais le nom ni le pseudo d'un vrai Bâtisseur — avec une voix inventée.
 *
 *   ── LE NOM ──
 *   Tiré d'une liste de prénoms ordinaires (par langue), en écartant tout prénom qui ressemble à
 *   un nom réel connu : les animateurs et invités, les pseudos des auteurs du courrier, et les
 *   noms PUBLICS de l'annuaire des Bâtisseurs (kind 30227). Aucun prénom libre → pas d'appel joué.
 *
 *   ── LA VOIX ──
 *   Une voix INVENTÉE du catalogue (`data/voix-inventees.ts`) empruntée à l'animateur d'une AUTRE
 *   station de la même langue et du même genre — elle n'est jamais entendue sur cette station-ci,
 *   et n'imite personne. Aucune ne convient (une seule station dans la langue) → la voix locale
 *   de la langue (Piper / Kokoro), qui n'est celle d'aucun animateur cloné.
 */
import { SimplePool } from 'nostr-tools/pool'
import { SEED_STATIONS } from '../../data/seed-stations'
import { VOIX_INVENTEES } from '../../data/voix-inventees'
import { prng } from '../musique'
import { getRelays } from '../nostr'
import { normaliser } from './filtre-insultes'

export type Genre = 'male' | 'female'

export interface AuditeurInvente {
  prenom:  string
  ville:   string
  genre:   Genre
  /** Voix inventée du catalogue data-space, ou `null` (voix locale de la langue). */
  voixInventee: string | null
}

type Fiche = ReadonlyArray<readonly [string, Genre]>

const PRENOMS: Readonly<Record<string, Fiche>> = {
  fr: [['Martine', 'female'], ['Gérard', 'male'], ['Sylvie', 'female'], ['Patrick', 'male'], ['Nadia', 'female'],
    ['Yannick', 'male'], ['Josiane', 'female'], ['Farid', 'male'], ['Odile', 'female'], ['Bruno', 'male'],
    ['Chantal', 'female'], ['Rachid', 'male'], ['Maëlle', 'female'], ['Thierry', 'male'], ['Inès', 'female'], ['Lucien', 'male']],
  en: [['Margaret', 'female'], ['Derek', 'male'], ['Priya', 'female'], ['Callum', 'male'], ['Bev', 'female'],
    ['Tunde', 'male'], ['Shona', 'female'], ['Graham', 'male'], ['Lorraine', 'female'], ['Kwame', 'male']],
  es: [['Remedios', 'female'], ['Paco', 'male'], ['Lucía', 'female'], ['Ignacio', 'male'], ['Maite', 'female'],
    ['Esteban', 'male'], ['Rocío', 'female'], ['Fermín', 'male']],
  ru: [['Галина', 'female'], ['Пётр', 'male'], ['Людмила', 'female'], ['Аркадий', 'male'], ['Зоя', 'female'],
    ['Тимофей', 'male'], ['Нина', 'female'], ['Геннадий', 'male']],
  zh: [['秀英', 'female'], ['建国', 'male'], ['丽华', 'female'], ['志强', 'male'], ['桂兰', 'female'],
    ['国栋', 'male'], ['淑芬', 'female'], ['海涛', 'male']],
}

const VILLES: Readonly<Record<string, readonly string[]>> = {
  fr: ['Brest', 'Limoges', 'Annecy', 'Perpignan', 'Roubaix', 'Besançon', 'Nancy', 'Pau', 'Valence', 'Angers', 'Colmar'],
  en: ['Leeds', 'Cardiff', 'Glasgow', 'Bristol', 'Nottingham', 'Belfast', 'Leicester', 'Hull'],
  es: ['Zaragoza', 'Cádiz', 'Valladolid', 'Murcia', 'Oviedo', 'Rosario', 'Arequipa', 'Cuenca'],
  ru: ['Самара', 'Тверь', 'Омск', 'Пермь', 'Казань', 'Томск'],
  zh: ['成都', '西安', '杭州', '昆明', '青岛', '长沙'],
}

/** Forme comparable d'un nom : premier mot, minuscules, sans accents. Pur. */
export function formeNom(nom: string): string {
  return normaliser(nom).split(/[^\p{L}]+/u).filter(Boolean)[0] ?? ''
}

/**
 * Les voix inventées qu'un auditeur de `stationId` peut emprunter : celles des animateurs des
 * AUTRES stations de la même langue et du même genre. Pur.
 */
export function voixEmpruntables(stationId: string, langue: string, genre: Genre): string[] {
  const out: string[] = []
  for (const s of SEED_STATIONS) {
    if (s.id === stationId || (s.language ?? 'fr') !== langue) continue
    for (const h of s.hosts) {
      if (h.gender !== genre) continue
      const v = VOIX_INVENTEES[`${s.id}:${h.id}`]
      if (v) out.push(v)
    }
  }
  return out
}

/**
 * Invente `nombre` auditeurs distincts pour cette émission (déterministe par graine). Rend moins
 * d'auditeurs que demandé si les prénoms libres manquent — jamais un nom interdit. Pur.
 */
export function inventerAuditeurs(opts: {
  stationId: string
  langue:    string
  nombre:    number
  graine:    string
  /** Noms RÉELS à ne jamais utiliser (animateurs, invités, pseudos, annuaire). */
  nomsInterdits: Iterable<string>
}): AuditeurInvente[] {
  const langue = PRENOMS[opts.langue] ? opts.langue : 'en'
  const interdits = new Set([...opts.nomsInterdits].map(formeNom).filter(Boolean))
  const libres = PRENOMS[langue].filter(([p]) => !interdits.has(formeNom(p)))
  const rand = prng(opts.graine)
  const ordre = [...libres]
  for (let i = ordre.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [ordre[i], ordre[j]] = [ordre[j], ordre[i]] }
  const villes = VILLES[langue]
  return ordre.slice(0, Math.max(0, opts.nombre)).map(([prenom, genre], k) => {
    const voix = voixEmpruntables(opts.stationId, opts.langue, genre)
    return {
      prenom, genre,
      ville: villes[Math.floor(rand() * villes.length)] ?? villes[0],
      voixInventee: voix.length > 0 ? voix[(k + Math.floor(rand() * voix.length)) % voix.length] : null,
    }
  })
}

/** Les noms PUBLICS de l'annuaire des Bâtisseurs (kind 30227) — à ne jamais faire jouer. */
export async function nomsPublicsDesBatisseurs(timeoutMs = 6000): Promise<string[]> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(relays, { kinds: [30227], limit: 1000 }, { maxWait: timeoutMs })
    const noms: string[] = []
    for (const e of events) {
      try {
        const c = JSON.parse(e.content) as { nom?: unknown }
        if (typeof c.nom === 'string' && c.nom.trim()) noms.push(c.nom.trim())
      } catch { /* fiche illisible : ignorée */ }
    }
    return noms
  } catch {
    return []
  } finally {
    pool.close(relays)
  }
}
