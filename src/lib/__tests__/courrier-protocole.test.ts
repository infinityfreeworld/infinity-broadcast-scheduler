/**
 * Courrier des auditeurs (07/10/2026) — clé, enveloppes NIP-59, tri et choix du jour.
 * 🔴 « jamais en clair » : rien d'un message n'apparaît dans les événements publiés.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nsecEncode } from 'nostr-tools/nip19'
import * as nip59 from 'nostr-tools/nip59'
import { bytesToHex } from '@noble/hashes/utils'
import { cleCourrier, envelopper, ouvrir, type CleCourrier, type Ouvert } from '../courrier/enveloppes'
import {
  lireMessage, refMessage, decalerJour, MODULE_COURRIER, MODULE_DECISION, MODULE_REGISTRE,
  TYPE_MESSAGE, TYPE_DECISION, TYPE_REGISTRE, type MessageAuditeur,
} from '../courrier/protocole'
import { trierCourrier, choisirPourLeJour, retenirPourAntenne, MAX_TEXTES_PAR_EMISSION } from '../courrier/selection'

const nouvelleCle = (): CleCourrier => { const priv = generateSecretKey(); return { priv, pub: getPublicKey(priv) } }

test('🔴 sans RADIO_COURRIER_NSEC, le courrier est ÉTEINT (null), sans lever', () => {
  assert.equal(cleCourrier({}), null)
  assert.equal(cleCourrier({ RADIO_COURRIER_NSEC: '' }), null)
  assert.equal(cleCourrier({ RADIO_COURRIER_NSEC: 'pas une clé' }), null)
  const priv = generateSecretKey()
  assert.equal(cleCourrier({ RADIO_COURRIER_NSEC: nsecEncode(priv) })?.pub, getPublicKey(priv))
  assert.equal(cleCourrier({ RADIO_COURRIER_NSEC: bytesToHex(priv) })?.pub, getPublicKey(priv))
})

const message: MessageAuditeur = {
  v: 1, stationId: 'pirate-radio', pourLe: '2026-10-08', genre: 'dedicace',
  texte: 'Un grand bonjour secret-7Q9 à toute la régie', dedicataire: 'Mamie Odile', anonyme: false, pseudo: 'Plume',
}

test('🔴 jamais en clair : ni le texte, ni la dédicace, ni le pseudo dans les événements publiés', () => {
  const auteur = nouvelleCle(), courrier = nouvelleCle()
  const wraps = envelopper(auteur, [courrier.pub], { module: MODULE_COURRIER, type: TYPE_MESSAGE, d: 'crr-1' }, message)
  assert.equal(wraps.length, 1)
  const brut = JSON.stringify(wraps)
  for (const secret of ['secret-7Q9', 'Mamie Odile', 'Plume', 'pirate-radio', MODULE_COURRIER, auteur.pub]) {
    assert.ok(!brut.includes(secret), `« ${secret} » visible en clair`)
  }
  assert.equal(wraps[0].kind, 1059)
  assert.notEqual(wraps[0].pubkey, auteur.pub, 'gift-wrap signé par une clé jetable')
  const o = ouvrir(wraps[0], courrier.priv)
  assert.ok(o)
  assert.equal(o.auteur, auteur.pub)
  assert.deepEqual(lireMessage(o.payload), message)
})

test('une enveloppe ne s\'ouvre qu\'avec la bonne clé, et un faux auteur est refusé', () => {
  const auteur = nouvelleCle(), courrier = nouvelleCle(), intrus = nouvelleCle()
  const [w] = envelopper(auteur, [courrier.pub], { module: MODULE_COURRIER, type: TYPE_MESSAGE, d: 'x' }, message)
  assert.equal(ouvrir(w, intrus.priv), null)
  // Rumor qui PRÉTEND venir de l'auteur, scellé par l'intrus : refusé.
  const rumor = nip59.createRumor({ kind: 14, content: '{}', tags: [['infinity_module', MODULE_DECISION], ['infinity_type', TYPE_DECISION], ['d', 'r']], created_at: 1 }, intrus.priv)
  const faux = { ...rumor, pubkey: auteur.pub }
  const sceau = nip59.createSeal(faux as typeof rumor, intrus.priv, courrier.pub)
  assert.equal(ouvrir(nip59.createWrap(sceau, courrier.pub), courrier.priv), null)
})

test('lireMessage : un vocal SANS consentement ou sans fichier valide est refusé ; bornes appliquées', () => {
  const vocal = { cid: 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy', cleHex: 'a'.repeat(64), ivHex: 'b'.repeat(24), sha256: 'c'.repeat(64), mime: 'audio/webm', dureeS: 12, octets: 9000 }
  const v = { v: 1, stationId: 'oasis-fm', pourLe: '2026-10-08', genre: 'vocal', texte: '', anonyme: true, vocal }
  assert.equal(lireMessage(v), null, 'sans consentement')
  assert.ok(lireMessage({ ...v, consentementVoix: true }))
  assert.equal(lireMessage({ ...v, consentementVoix: true, vocal: { ...vocal, dureeS: 600 } }), null)
  assert.equal(lireMessage({ ...v, consentementVoix: true, vocal: { ...vocal, cleHex: 'zz' } }), null)
  assert.equal(lireMessage({ ...message, genre: 'dedicace', dedicataire: '' }), null, 'dédicace sans destinataire')
  assert.equal(lireMessage({ ...message, genre: 'message', texte: 'x'.repeat(2000) })?.texte.length, 500)
  assert.equal(lireMessage({ ...message, anonyme: true })?.pseudo, undefined, 'anonyme : pas de pseudo')
})

// ── Tri et choix du jour ────────────────────────────────────────────────

const COURRIER = 'c'.repeat(64)
const ADMIN = 'a'.repeat(64)
const env = (o: Partial<Ouvert> & { payload: unknown }): Ouvert => ({ auteur: 'e'.repeat(64), creeLe: 1000, module: MODULE_COURRIER, type: TYPE_MESSAGE, d: 'm1', ...o })
const msg = (p: Partial<MessageAuditeur>): MessageAuditeur => ({ v: 1, stationId: 'pirate-radio', pourLe: '2026-10-08', genre: 'message', texte: 'salut', anonyme: true, ...p })

test('un message par auteur, station et jour : le PREMIER envoyé ; décisions de non-admins et faux registres ignorés', () => {
  const trie = trierCourrier([
    env({ d: 'b', creeLe: 2000, payload: msg({ texte: 'second' }) }),
    env({ d: 'a', creeLe: 1000, payload: msg({ texte: 'premier' }) }),
    env({ d: 'c', creeLe: 3000, payload: msg({ texte: 'autre station', stationId: 'oasis-fm' }) }),
    env({ auteur: 'f'.repeat(64), module: MODULE_DECISION, type: TYPE_DECISION, d: 'x', payload: { v: 1, ref: '0'.repeat(24), decision: 'acceptee' } }),
    env({ auteur: 'f'.repeat(64), module: MODULE_REGISTRE, type: TYPE_REGISTRE, d: 'y', payload: { v: 1, ref: '1'.repeat(24), statut: 'diffuse', le: '2026-10-08' } }),
  ], COURRIER, new Set([ADMIN]))
  assert.deepEqual(trie.messages.map(m => m.message.texte), ['premier', 'autre station'])
  assert.equal(trie.decisions.size, 0)
  assert.equal(trie.registre.size, 0)
})

test('choix du jour : fenêtre de 6 jours, écarté/diffusé/refusé jamais, douteux en attente, accepté après la décision', () => {
  const auteur = 'e'.repeat(64)
  const ref = (d: string) => refMessage(auteur, d)
  const jourDecision = Date.UTC(2026, 9, 8, 15) / 1000
  const trie = trierCourrier([
    env({ d: 'propre', payload: msg({ texte: 'propre' }) }),
    env({ d: 'vieux', payload: msg({ texte: 'vieux', pourLe: '2026-09-20' }) }),
    env({ d: 'futur', payload: msg({ texte: 'futur', pourLe: '2026-10-20' }) }),
    env({ d: 'ecarte', payload: msg({ texte: 'ecarte', pourLe: '2026-10-07' }) }),
    env({ d: 'diffuse', payload: msg({ texte: 'diffuse', pourLe: '2026-10-06' }) }),
    env({ d: 'attente', payload: msg({ texte: 'attente', pourLe: '2026-10-05' }) }),
    env({ d: 'accepte', payload: msg({ texte: 'accepte', pourLe: '2026-10-04' }) }),
    env({ d: 'refuse', payload: msg({ texte: 'refuse', pourLe: '2026-10-03' }) }),
    env({ auteur: COURRIER, module: MODULE_REGISTRE, type: TYPE_REGISTRE, d: ref('ecarte'), payload: { v: 1, ref: ref('ecarte'), statut: 'ecarte', le: '2026-10-07' } }),
    env({ auteur: COURRIER, module: MODULE_REGISTRE, type: TYPE_REGISTRE, d: ref('diffuse'), payload: { v: 1, ref: ref('diffuse'), statut: 'diffuse', le: '2026-10-06' } }),
    // « transmis » PLUS RÉCENT qu'un « diffusé » : le diffusé reste définitif.
    env({ auteur: COURRIER, creeLe: 9999, module: MODULE_REGISTRE, type: TYPE_REGISTRE, d: ref('diffuse'), payload: { v: 1, ref: ref('diffuse'), statut: 'transmis-ihl', le: '2026-10-07' } }),
    env({ auteur: COURRIER, module: MODULE_REGISTRE, type: TYPE_REGISTRE, d: ref('attente'), payload: { v: 1, ref: ref('attente'), statut: 'transmis-ihl', le: '2026-10-05' } }),
    env({ auteur: ADMIN, creeLe: jourDecision, module: MODULE_DECISION, type: TYPE_DECISION, d: ref('accepte'), payload: { v: 1, ref: ref('accepte'), decision: 'acceptee' } }),
    env({ auteur: ADMIN, creeLe: jourDecision, module: MODULE_DECISION, type: TYPE_DECISION, d: ref('refuse'), payload: { v: 1, ref: ref('refuse'), decision: 'refusee' } }),
  ], COURRIER, new Set([ADMIN]))
  // Même auteur, jours d'antenne différents : tous gardés (la limite est d'UN par jour).
  const le8 = choisirPourLeJour(trie, 'pirate-radio', '2026-10-08')
  assert.deepEqual(le8.aJuger.map(m => m.message.texte), ['propre'])
  assert.deepEqual(le8.acceptes.map(m => m.message.texte), [], 'accepté le 8 : pas avant le 9')
  assert.equal(le8.enAttente, 1)
  const le9 = choisirPourLeJour(trie, 'pirate-radio', '2026-10-09')
  assert.deepEqual(le9.acceptes.map(m => m.message.texte), ['accepte'])
  assert.deepEqual(choisirPourLeJour(trie, 'pirate-radio', '2026-10-16').aJuger.map(m => m.message.texte), [], 'fenêtre dépassée')
  assert.deepEqual(choisirPourLeJour(trie, 'pirate-radio', '2026-10-14').aJuger.map(m => m.message.texte), ['propre'], 'dernier jour de grâce')
  assert.equal(decalerJour('2026-12-31', 1), '2027-01-01')
})

test('au plus 3 écrits et 3 vocaux par émission, les plus anciens d\'abord', () => {
  const ms = Array.from({ length: 5 }, (_, k) => ({ ref: `r${k}`, auteur: 'x', creeLe: 10 - k, message: msg({ texte: `t${k}` }) }))
  const r = retenirPourAntenne(ms)
  assert.equal(r.textes.length, MAX_TEXTES_PAR_EMISSION)
  assert.deepEqual(r.textes.map(m => m.message.texte), ['t4', 't3', 't2'])
  assert.equal(r.vocaux.length, 0)
})
