/**
 * @module InfinityScheduler/Lib/StationsThemaRelais
 * @description Va chercher sur les relais (LECTURE SEULE) ce qu'il faut aux stations Abondance, OBF et
 *   Biogame, puis passe la main aux modules purs. Même patron que `carte-relais.ts` (lot 7).
 *
 *   Ne lève JAMAIS : un relais muet n'arrête pas l'antenne — chaque station retombe alors sur sa
 *   raison d'être. ⚠️ Prudence par construction : une alerte OBF dont l'auteur n'a pas pu être jugé
 *   (sonde d'ancienneté muette) n'entre pas dans le bilan.
 */
import { SimplePool } from 'nostr-tools/pool'
import { getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import { getRelays, RADIO_BROADCAST_KIND } from './nostr'
import type { RadioStation } from './types'
import { arbitresCarte, fetchSujetsCarte, type CartePourStation } from './carte-relais'
import {
  KIND_MODERATION_IHL, KIND_SUPPRESSION, KIND_DECISION_BIOGAME, confianceDepuisModeration, etablisDepuis, ANCIENNETE_JOURS,
  type ConfianceCarte,
} from './sujets-carte'
import {
  KIND_PROJET_ABONDANCE, TAG_VALIDATION_ABONDANCE, projetsAbondance, derniereEmission, referenceNouveaute,
  antenneAbondance, type EmissionLue, type ProjetAbondance,
} from './sujets-abondance'
import { KIND_OBF_ALERTE, BILAN_HEURES, alertesLisibles, alerteDeConfiance, bilanAlertes, bilanEnPhrase, actualitesStationObf, ligneEditorialeObf } from './sujets-obf'
import { actualitesStationBiogame, ligneEditorialeBiogame } from './sujets-biogame'
import type { StationThema } from './stations-thema'

const DELAI_MS = 10_000
const DELAI_SONDE_MS = 6_000
const SONDES_MAX = 40
const SONDES_EN_PARALLELE = 10
/** Pour retrouver la dernière émission de la station : les tant de jours précédents. */
const JOURS_EMISSIONS = 14

async function lire(pool: SimplePool, relays: string[], filtre: Filter, maxWait = DELAI_MS): Promise<NostrEvent[]> {
  try { return (await pool.querySync(relays, filtre, { maxWait })) as NostrEvent[] } catch { return [] }
}

/** Les `d` des émissions de la station des JOURS_EMISSIONS jours qui précèdent `date`. Pur. */
export function dTagsEmissionsPrecedentes(stationId: string, date: string, jours = JOURS_EMISSIONS): string[] {
  const base = Date.parse(`${date}T12:00:00Z`)
  if (!Number.isFinite(base)) return []
  return Array.from({ length: jours }, (_, i) => `${stationId}:${new Date(base - (i + 1) * 86_400_000).toISOString().slice(0, 10)}`)
}

/** La clé qui signe les émissions (celle du générateur), ou null (répétition sans clé). */
function auteurEmissions(): string | null {
  const k = process.env.NOSTR_PRIVATE_KEY?.trim()
  if (!k || !/^[0-9a-f]{64}$/i.test(k)) return null
  try { return getPublicKey(hexToBytes(k)) } catch { return null }
}

// ── Abondance ────────────────────────────────────────────────────────────────────────────────

/**
 * Les projets d'Abondance qu'on peut dire (validés dans cette version, publics, ni retirés ni masqués,
 * auteur non banni — `projetsAbondance`). Partagé par la station Abondance et la télévision.
 */
async function lireProjetsValides(
  pool: SimplePool, relays: string[], arbitres: ReadonlySet<string>, maintenant: number,
): Promise<{ lus: number; liste: ProjetAbondance[] }> {
  const [projets, decisions, supp, moderation] = await Promise.all([
    lire(pool, relays, { kinds: [KIND_PROJET_ABONDANCE], limit: 1000 }),
    lire(pool, relays, { kinds: [KIND_DECISION_BIOGAME], authors: [...arbitres], '#t': [TAG_VALIDATION_ABONDANCE], limit: 2000 }),
    lire(pool, relays, { kinds: [KIND_SUPPRESSION], '#k': [String(KIND_PROJET_ABONDANCE)], limit: 500 }),
    lire(pool, relays, { kinds: [KIND_MODERATION_IHL], authors: [...arbitres], '#d': ['ihl-account-bans', 'ihl-moderation'], limit: 50 }),
  ])
  const moder = confianceDepuisModeration(moderation, arbitres, maintenant)
  return { lus: projets.length, liste: projetsAbondance([...projets, ...decisions, ...supp], { ...moder, arbitres }, maintenant) }
}

/** Pour la télévision (`infinity-sujets.ts`) : les projets d'Abondance qu'on peut dire. Ne lève pas. */
export async function fetchProjetsAbondance(maintenant = Date.now()): Promise<{ liste: ProjetAbondance[]; journal: string }> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    const { lus, liste } = await lireProjetsValides(pool, relays, arbitresCarte(), maintenant)
    return { liste, journal: `${lus} projet(s) Abondance lus, ${liste.length} validé(s) et ouvert(s)` }
  } catch (err) {
    return { liste: [], journal: `relais injoignables (${err instanceof Error ? err.message : String(err)})` }
  } finally {
    try { pool.close(relays) } catch { /* rien à fermer */ }
  }
}

async function pourAbondance(station: RadioStation, date: string, maintenant: number): Promise<CartePourStation> {
  const relays = getRelays()
  const pool = new SimplePool()
  const arbitres = arbitresCarte()
  try {
    const auteur = auteurEmissions()
    const [{ lus, liste }, emissions, recentes] = await Promise.all([
      lireProjetsValides(pool, relays, arbitres, maintenant),
      auteur
        ? pool.querySync(relays, { kinds: [RADIO_BROADCAST_KIND], authors: [auteur], '#d': dTagsEmissionsPrecedentes(station.id, date) }, { maxWait: DELAI_MS })
          .then(l => l as EmissionLue[]).catch(() => null)
        : Promise.resolve(null),
      // Témoin : le générateur publie une quinzaine d'émissions par jour. Si les relais n'en rendent AUCUNE
      // des trois derniers jours, c'est qu'ils sont muets — pas que la station n'a jamais parlé.
      auteur ? lire(pool, relays, { kinds: [RADIO_BROADCAST_KIND], authors: [auteur], since: Math.floor(maintenant / 1000) - 3 * 86_400, limit: 5 }) : Promise.resolve([]),
    ])
    // « Nouveau » : apparu depuis la dernière émission PUBLIÉE de la station (cf. sujets-abondance.ts).
    const lecture = emissions === null || recentes.length === 0
      ? { ok: false, derniere: null }
      : { ok: true, derniere: derniereEmission(emissions, station.id, date, auteur!) }
    const reference = referenceNouveaute(lecture, maintenant)
    const a = antenneAbondance(liste, reference, date)
    const journal = `${lus} projet(s) lus, ${liste.length} validé(s) et ouvert(s) · `
      + `référence « nouveau » : ${new Date(reference).toISOString()} (${lecture.ok ? (lecture.derniere ? 'dernière émission' : 'première émission') : 'relais illisibles, repli'}) · `
      + `${a.nouveaux.length} nouveau(x), ${a.rotation.length} en rotation${a.campagne ? `, campagne « ${a.campagne.titre} »` : ''}`
      + `${liste.length ? '' : ' → raison d\'être'}`
    return { concernee: true, actualites: a.actualites, rubrique: [], ligneEditoriale: a.ligneEditoriale, ...(a.campagne ? { campagneDuJour: a.campagne.id } : {}), journal }
  } catch (err) {
    const a = antenneAbondance([], maintenant, date)
    return { concernee: true, actualites: a.actualites, rubrique: [], ligneEditoriale: a.ligneEditoriale, ...(a.campagne ? { campagneDuJour: a.campagne.id } : {}), journal: `relais injoignables (${err instanceof Error ? err.message : String(err)}) → raison d'être` }
  } finally {
    try { pool.close(relays) } catch { /* rien à fermer */ }
  }
}

// ── OBF ──────────────────────────────────────────────────────────────────────────────────────

async function pourObf(date: string, maintenant: number): Promise<CartePourStation> {
  const relays = getRelays()
  const pool = new SimplePool()
  const arbitres = arbitresCarte()
  const vide = () => ({ total: 0, parNiveau: { critical: 0, warning: 0, info: 0, ok: 0 }, villes: [], terminees: 0 })
  try {
    const depuis = Math.floor(maintenant / 1000) - (BILAN_HEURES + 24) * 3600
    const [alertes, supp, moderation] = await Promise.all([
      lire(pool, relays, { kinds: [KIND_OBF_ALERTE], since: depuis, limit: 1000 }),
      lire(pool, relays, { kinds: [KIND_SUPPRESSION], '#k': [String(KIND_OBF_ALERTE)], since: depuis, limit: 500 }),
      lire(pool, relays, { kinds: [KIND_MODERATION_IHL], authors: [...arbitres], '#d': ['ihl-account-bans', 'ihl-moderation', 'ihl-account-restrictions'], limit: 50 }),
    ])
    const moder = confianceDepuisModeration(moderation, arbitres, maintenant)
    const lisibles = alertesLisibles([...alertes, ...supp], maintenant)
    // Sonde d'ancienneté, comme le lot 7 : l'auteur publiait-il déjà ANCIENNETE_JOURS avant son alerte ?
    const seuils = new Map<string, number>()
    for (const a of lisibles) {
      if (arbitres.has(a.auteur) || moder.bannis.has(a.auteur)) continue
      const s = Math.floor(a.le / 1000) - ANCIENNETE_JOURS * 86_400
      const deja = seuils.get(a.auteur)
      if (deja === undefined || s < deja) seuils.set(a.auteur, s)
    }
    const etablis = new Set<string>()
    const aSonder = [...seuils.keys()].slice(0, SONDES_MAX)
    for (let i = 0; i < aSonder.length; i += SONDES_EN_PARALLELE) {
      const lot = aSonder.slice(i, i + SONDES_EN_PARALLELE)
      const reponses = await Promise.all(lot.map(pk => lire(pool, relays, { authors: [pk], until: seuils.get(pk)!, limit: 1 }, DELAI_SONDE_MS)))
      for (const pk of etablisDepuis(reponses.flat(), seuils)) etablis.add(pk)
    }
    const conf: ConfianceCarte = { ...moder, etablis, arbitres }
    const retenues = lisibles.filter(a => alerteDeConfiance(a, conf))
    const bilan = bilanAlertes(retenues)
    const journal = `${alertes.length} alerte(s) OBF lues, ${lisibles.length} publique(s) récente(s), ${retenues.length} retenue(s) pour le bilan`
    return { concernee: true, actualites: actualitesStationObf(bilan, date, maintenant), rubrique: [], ligneEditoriale: ligneEditorialeObf(bilanEnPhrase(bilan)), journal }
  } catch (err) {
    return { concernee: true, actualites: actualitesStationObf(vide(), date, maintenant), rubrique: [], ligneEditoriale: ligneEditorialeObf(''), journal: `relais injoignables (${err instanceof Error ? err.message : String(err)}) → fond seul` }
  } finally {
    try { pool.close(relays) } catch { /* rien à fermer */ }
  }
}

// ── Biogame ──────────────────────────────────────────────────────────────────────────────────

async function pourBiogame(date: string): Promise<CartePourStation> {
  // Le lot 7 sait lire les Biogames VALIDÉS (Tournoi, Compétition, Défi) : on réutilise sa lecture.
  const { sujets, journal } = await fetchSujetsCarte({ familles: ['biogame'], combien: 3 })
  return {
    concernee: true,
    actualites: actualitesStationBiogame(sujets, date),
    rubrique: [],
    ligneEditoriale: ligneEditorialeBiogame(sujets.length > 0),
    journal: `${journal}${sujets.length ? '' : ' → fond des Biogames'}`,
  }
}

/** Ce que les relais apportent à une station thématique. Ne lève pas. */
export async function sujetsStationThema(
  thema: StationThema, station: RadioStation, date: string, maintenant = Date.now(),
): Promise<CartePourStation> {
  if (thema === 'abondance') return pourAbondance(station, date, maintenant)
  if (thema === 'obf') return pourObf(date, maintenant)
  return pourBiogame(date)
}
