/**
 * @module InfinityScheduler/Courrier/CourrierDuJour
 * @description Le courrier des auditeurs d'UNE émission (une station, un jour), de bout en bout :
 *   relève des enveloppes chiffrées → tri → modération (insulte écartée / douteux vers l'IHL /
 *   propre à l'antenne) → décisions des admins relues → vocaux récupérés → appels du jour (vrais
 *   vocaux d'abord, puis auditeurs JOUÉS) → après publication, le registre « diffusé ».
 *
 *   ── EXTINCTION ──
 *   · `COURRIER_AUDITEURS=0` : rien du tout (ni courrier, ni appels joués).
 *   · Sans `RADIO_COURRIER_NSEC` : aucun vrai message n'est lu (on ne peut pas les déchiffrer),
 *     et on le dit en une ligne. Les appels JOUÉS, eux, ne dépendent que du réglage de la station.
 *   · En RÉPÉTITION : on lit et on juge, mais on n'ÉCRIT rien (ni IHL, ni registre).
 *   · Aucune panne ici ne fait échouer l'émission : au pire, elle sort avec le courrier inventé.
 *
 *   ── CE QUI EST JOURNALISÉ ──
 *   Des COMPTES seulement. Jamais le texte d'un message, jamais un pseudo, jamais une clé.
 */
import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools/core'
import type { DecodedWav } from '../audio'
import { getRelays } from '../nostr'
import { adminPubkeys, ADMINS_RADIO_PAR_DEFAUT } from '../admins-radio'
import { cleCourrier, envelopper, ouvrir, KIND_GIFT_WRAP, type CleCourrier, type Ouvert } from './enveloppes'
import {
  MODULE_MODERATION, MODULE_REGISTRE, TYPE_A_MODERER, TYPE_REGISTRE,
  type ItemModeration, type EtatRegistre, type MessageAuditeur,
} from './protocole'
import { trierCourrier, choisirPourLeJour, retenirPourAntenne, type MessageRecu } from './selection'
import { moderer, type Juge } from './moderation'
import { appelsDuJour, lireAppelsDeLaStation, type AppelsStation } from './appels'
import { inventerAuditeurs, nomsPublicsDesBatisseurs, type AuditeurInvente } from './auditeur-invente'
import { recupererVocal } from './vocal'
import type { Transcripteur } from './transcription'

export interface VocalPret {
  ref:            string
  message:        MessageAuditeur
  wav:            DecodedWav
  transcription?: string
}

export interface CourrierDuJour {
  textes:            Array<{ ref: string; message: MessageAuditeur }>
  vocaux:            VocalPret[]
  auditeursInventes: AuditeurInvente[]
  /** Une ligne de journal : des comptes, rien d'autre. */
  bilan:             string
}

/** Ce qui touche le réseau ou le disque — remplaçable dans les tests. */
export interface DepsCourrier {
  relever:        (cle: CleCourrier) => Promise<Ouvert[]>
  publier:        (events: NostrEvent[]) => Promise<number>
  lireAppels:     (stationId: string) => Promise<AppelsStation | undefined>
  nomsPublics:    () => Promise<string[]>
  recupererVocal: (m: MessageAuditeur, sampleRate: number) => Promise<DecodedWav>
}

export const JOURS_RELEVE = 14

export const depsReelles: DepsCourrier = {
  async relever(cle) {
    const relays = getRelays()
    const pool = new SimplePool()
    try {
      const since = Math.floor(Date.now() / 1000) - JOURS_RELEVE * 86_400
      const events = await pool.querySync(relays, { kinds: [KIND_GIFT_WRAP], '#p': [cle.pub], since, limit: 2000 }, { maxWait: 10_000 })
      const vus = new Set<string>()
      const out: Ouvert[] = []
      for (const e of events) {
        if (vus.has(e.id)) continue
        vus.add(e.id)
        const o = ouvrir(e, cle.priv)
        if (o) out.push(o)
      }
      return out
    } finally {
      pool.close(relays)
    }
  },
  async publier(events) {
    if (events.length === 0) return 0
    const relays = getRelays()
    const pool = new SimplePool()
    try {
      let ok = 0
      for (const e of events) {
        const r = await Promise.allSettled(pool.publish(relays, e))
        if (r.some(x => x.status === 'fulfilled' && !String(x.value ?? '').startsWith('connection failure'))) ok++
      }
      return ok
    } finally {
      pool.close(relays)
    }
  },
  lireAppels: stationId => lireAppelsDeLaStation(stationId),
  nomsPublics: () => nomsPublicsDesBatisseurs(),
  recupererVocal: (m, sampleRate) => recupererVocal(m.vocal!, sampleRate),
}

function adminsDestinataires(): string[] {
  return [...(adminPubkeys() ?? new Set(ADMINS_RADIO_PAR_DEFAUT))]
}

export function registre(cle: CleCourrier, ref: string, statut: EtatRegistre['statut'], le: string): NostrEvent[] {
  const etat: EtatRegistre = { v: 1, ref, statut, le }
  return envelopper(cle, [cle.pub], { module: MODULE_REGISTRE, type: TYPE_REGISTRE, d: ref }, etat)
}

/** L'item d'IHL d'un message douteux, pour chaque admin radio. Les décisions reviennent au courrier ET aux autres admins. */
export function itemPourIHL(cle: CleCourrier, m: MessageRecu, raison: string, transcription: string | undefined, admins: string[]): NostrEvent[] {
  const item: ItemModeration & { destinatairesDecision: string[] } = {
    v: 1, statut: 'en-attente', ref: m.ref,
    stationId: m.message.stationId, pourLe: m.message.pourLe, genre: m.message.genre,
    texte: m.message.texte, anonyme: m.message.anonyme,
    ...(m.message.pseudo ? { pseudo: m.message.pseudo } : {}),
    ...(m.message.dedicataire ? { dedicataire: m.message.dedicataire } : {}),
    ...(transcription ? { transcription } : {}),
    ...(m.message.vocal ? { vocal: m.message.vocal } : {}),
    raison,
    // Une décision d'admin est adressée au courrier ET aux autres admins : la liste de chacun se
    // met à jour sans que le générateur ait à repasser.
    destinatairesDecision: [cle.pub, ...admins],
  }
  return envelopper(cle, admins, { module: MODULE_MODERATION, type: TYPE_A_MODERER, d: m.ref }, item)
}

export async function preparerCourrierDuJour(o: {
  station:     { id: string; name: string; language?: string }
  date:        string
  sampleRate:  number
  repetition:  boolean
  /** Noms réels à ne jamais faire jouer (animateurs, invités). */
  nomsReels:   string[]
  juge:        Juge | null
  transcripteur: Transcripteur | null
  env?:        NodeJS.ProcessEnv
  deps?:       DepsCourrier
  log?:        (ligne: string) => void
}): Promise<CourrierDuJour | null> {
  const env = o.env ?? process.env
  const deps = o.deps ?? depsReelles
  const log = o.log ?? (l => console.log(l))
  if (env.COURRIER_AUDITEURS === '0') { log('    ✉️  courrier des auditeurs coupé (COURRIER_AUDITEURS=0)'); return null }
  const langue = o.station.language ?? 'fr'

  const cle = cleCourrier(env)
  const textes: Array<{ ref: string; message: MessageAuditeur }> = []
  const vocaux: VocalPret[] = []
  const pseudos: string[] = []
  const comptes = { recus: 0, ecartes: 0, ihl: 0, enAttente: 0, propres: 0, acceptes: 0, reportes: 0 }

  if (!cle) {
    log('    ✉️  courrier des auditeurs éteint : pas de RADIO_COURRIER_NSEC (aucun vrai message lu)')
  } else {
    try {
      const ouverts = await deps.relever(cle)
      const trie = trierCourrier(ouverts, cle.pub, adminPubkeys())
      for (const m of trie.messages) if (m.message.pseudo) pseudos.push(m.message.pseudo)
      const choix = choisirPourLeJour(trie, o.station.id, o.date)
      comptes.recus = choix.aJuger.length + choix.acceptes.length
      comptes.enAttente = choix.enAttente
      const admins = adminsDestinataires()
      const aPublier: NostrEvent[] = []
      const propres: Array<MessageRecu & { wav?: DecodedWav; transcription?: string }> = []

      const preparerVocal = async (m: MessageRecu): Promise<{ wav: DecodedWav; transcription?: string } | null> => {
        try {
          const wav = await deps.recupererVocal(m.message, o.sampleRate)
          let transcription: string | undefined
          if (o.transcripteur) {
            try { transcription = (await o.transcripteur.transcrire(wav, 'auto')).trim() || undefined } catch { transcription = undefined }
          }
          return { wav, transcription }
        } catch {
          comptes.reportes++
          return null
        }
      }

      for (const m of choix.aJuger) {
        let vocal: { wav: DecodedWav; transcription?: string } | null = null
        if (m.message.genre === 'vocal') {
          vocal = await preparerVocal(m)
          if (!vocal) continue           // fichier introuvable : on réessaiera demain (fenêtre)
        }
        const avis = await moderer({
          genre: m.message.genre, texte: m.message.texte, dedicataire: m.message.dedicataire,
          pseudo: m.message.pseudo, transcription: vocal?.transcription,
          nomStation: o.station.name, langueStation: langue,
        }, o.juge)
        if (avis.verdict === 'insulte') {
          comptes.ecartes++
          if (!o.repetition) aPublier.push(...registre(cle, m.ref, 'ecarte', o.date))
        } else if (avis.verdict === 'douteux') {
          comptes.ihl++
          if (!o.repetition) aPublier.push(...itemPourIHL(cle, m, avis.raison, vocal?.transcription, admins), ...registre(cle, m.ref, 'transmis-ihl', o.date))
        } else {
          comptes.propres++
          propres.push({ ...m, ...(vocal ?? {}) })
        }
      }
      for (const m of choix.acceptes) {
        if (m.message.genre === 'vocal') {
          const vocal = await preparerVocal(m)
          if (!vocal) continue
          propres.push({ ...m, ...vocal })
        } else {
          propres.push(m)
        }
        comptes.acceptes++
      }
      const retenus = retenirPourAntenne(propres)
      for (const m of retenus.textes) textes.push({ ref: m.ref, message: m.message })
      for (const m of retenus.vocaux) if (m.wav) vocaux.push({ ref: m.ref, message: m.message, wav: m.wav, ...(m.transcription ? { transcription: m.transcription } : {}) })
      if (aPublier.length > 0) {
        const n = await deps.publier(aPublier).catch(() => 0)
        if (n < aPublier.length) log(`    ⚠ courrier : ${aPublier.length - n}/${aPublier.length} enveloppe(s) IHL/registre non acceptée(s) par les relais`)
      }
    } catch (err) {
      log(`    ⚠ courrier des auditeurs illisible ce soir (${(err as Error).message.slice(0, 80)}) — courrier inventé`)
    }
  }

  // Appels du jour : les VRAIS vocaux d'abord, puis des auditeurs JOUÉS pour compléter.
  let auditeursInventes: AuditeurInvente[] = []
  const reglage = await deps.lireAppels(o.station.id).catch(() => undefined)
  const prevus = appelsDuJour(reglage, o.station.id, o.date)
  const aJouer = Math.max(0, prevus - vocaux.length)
  if (aJouer > 0) {
    const publics = await deps.nomsPublics().catch(() => [] as string[])
    auditeursInventes = inventerAuditeurs({
      stationId: o.station.id, langue, nombre: aJouer, graine: `${o.station.id}:${o.date}:appels`,
      nomsInterdits: [...o.nomsReels, ...pseudos, ...publics],
    })
  }

  const bilan = `    ✉️  courrier : ${textes.length} écrit(s) et ${vocaux.length} vocal(aux) à l'antenne · `
    + `${comptes.ecartes} écarté(s) · ${comptes.ihl} transmis à l'IHL · ${comptes.enAttente} en attente d'un admin · `
    + `${comptes.reportes} vocal(aux) reporté(s) · appels prévus ${prevus}, joués ${auditeursInventes.length}`
  log(bilan)
  return { textes, vocaux, auditeursInventes, bilan }
}

/** Après publication de l'émission : ces messages sont DIFFUSÉS, ils ne repasseront jamais. */
export async function marquerDiffuses(refs: readonly string[], date: string, env: NodeJS.ProcessEnv = process.env, deps: Pick<DepsCourrier, 'publier'> = depsReelles): Promise<void> {
  const cle = cleCourrier(env)
  if (!cle || refs.length === 0) return
  const events = refs.flatMap(r => registre(cle, r, 'diffuse', date))
  const n = await deps.publier(events).catch(() => 0)
  console.log(`    ✉️  ${n}/${refs.length} message(s) d'auditeur marqué(s) « diffusé »`)
}
