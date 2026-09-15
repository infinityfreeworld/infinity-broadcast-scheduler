#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/TV/JournalFreeworld/Script
 * @description 🦎 Le Journal de FREEWORLD TV côté GitHub — deux étapes, deux horaires (cf. lib/jt-freeworld).
 *
 *   commande  (05:00 UTC)  actualité → conducteur (Anthropic) → validé comme planif.py le fera sur le hub
 *                          (UNE seconde chance au rédacteur, avec les erreurs, s'il est refusé) → publié en
 *                          kind 30078, d = freeworld-jt:commande:<date>, signé par NOSTR_PRIVATE_KEY.
 *   publier   (19:30, rattrapage 22:30 UTC)  résultat de l'usine (kind 30078, d = freeworld-jt:resultat:<date>,
 *                          signé par JT_USINE_PUBKEY) → vérifié → programme TV kind 30184 sur tv-main-1.
 *
 *   Usage :
 *     tsx src/scripts/jt-freeworld.ts commande [--date AAAA-MM-JJ] [--sortie f.json] [--dry-run] [--fixture]
 *     tsx src/scripts/jt-freeworld.ts publier  [--date AAAA-MM-JJ] [--dry-run]
 *
 *     --fixture   AUCUN réseau, AUCUN langage : l'exemple de l'usine (usine/journal/exemple-jt.json) à la date
 *                 demandée, validé, écrit (--sortie) et affiché. Éprouve la chaîne sans rien dépenser.
 *     --dry-run   commande : vrai rédacteur, AUCUNE publication. publier : lit et vérifie, ne publie pas.
 *
 *   Sortie de `publier` : 0 = publié, ou pas encore de résultat (le rattrapage réessaiera, et le JT en images
 *   de 20 h UTC reste à l'antenne) ; 1 = résultat FALSIFIÉ ou INVALIDE, ou clé de l'usine absente.
 *
 *   Variables : ANTHROPIC_API_KEY, ANTHROPIC_MODEL_JT (défaut claude-sonnet-5), JT_MINUTES (défaut 15),
 *   NOSTR_PRIVATE_KEY (hex), NOSTR_RELAYS, JT_USINE_PUBKEY (hex, clé publique de l'usine du hub),
 *   FORCER_REGENERATION=1 (remplacer une commande déjà publiée).
 */
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { SimplePool } from 'nostr-tools/pool'
import { callAnthropic, type LLMMessage } from '../lib/anthropic'
import { extractJson } from '../lib/tv-conductor'
import { fetchNewsForStation, formatNewsForPrompt, choisirActualites } from '../lib/news'
import { fetchSujetsInfinity } from '../lib/infinity-sujets'
import { choisirSujetsEcosysteme } from '../data/sujets-ecosysteme'
import { findChannel } from '../data/seed-tv-channels'
import { getRelays, pubkeyDe, publierEvenement } from '../lib/nostr'
import { dTagsPublies } from '../lib/deja-diffuse'
import { publishTvProgram, tvProgramEventTemplate } from '../lib/tv-nostr'
import type { RadioStation } from '../lib/types'
import {
  CANAL_JT, ESSAIS_REDACTION, KIND_DONNEES_APP, MODELE_JT_DEFAUT,
  commandeEventTemplate, consigneConducteur, dCommande, dResultat, dateValide, estObjet, filtreResultat,
  lireDistribution, lireExemple, lireResultat, messageAllonger, messageCorrection, messageDuJour, minutesJT, motsCommande,
  normaliserCommande, objectifMots, plafondMots, prochaineEtape, programmeDuResultat, seuilLongueur, validerCommande,
  type CommandeJT, type Distribution, type EvenementNostr,
} from '../lib/jt-freeworld'

function option(nom: string): string | undefined {
  const i = process.argv.indexOf(nom)
  if (i < 0) return undefined
  const v = process.argv[i + 1]
  if (!v || v.startsWith('--')) throw new Error(`${nom} attend une valeur`)
  return v
}
const drapeau = (nom: string): boolean => process.argv.includes(nom)

/** La date demandée, sinon aujourd'hui (UTC) — celle du d-tag du JT en images de daily-tv. */
function dateDemandee(): string {
  const d = option('--date') ?? new Date().toISOString().slice(0, 10)
  if (!dateValide(d)) throw new Error(`--date « ${d} » : il faut une vraie date AAAA-MM-JJ`)
  return d
}

function afficherErreurs(titre: string, erreurs: string[]): void {
  console.error(`   🔴 ${titre} (${erreurs.length}) :`)
  for (const e of erreurs) console.error(`      - ${e}`)
}

/**
 * La matière du Journal : les briques du JT en images (generate-tv-program), mêmes sources, même tri de
 * fraîcheur, même ordre (le RÉEL d'Infinity, sa présentation si l'activité manque, puis le monde) — mais
 * davantage de nouvelles, pour huit à onze sujets au lieu de quatre.
 */
async function rassemblerMatiere(): Promise<string> {
  const canal = findChannel(CANAL_JT)
  const sujets = await fetchSujetsInfinity(6)
  console.log(`   🌍 ${sujets.length} sujet(s) RÉEL(S) d'Infinity (Manifestactions, Abondance, DAV)`)
  const presentation = choisirSujetsEcosysteme(Math.max(0, 2 - sujets.length))
  if (presentation.length) console.log(`   🧭 + ${presentation.length} présentation(s) de l'application (activité réelle insuffisante)`)
  const news = canal.sources
    ? choisirActualites(await fetchNewsForStation({ sources: canal.sources } as RadioStation, 80), { frais: 9, anciens: 3 })
    : []
  if (news.length) console.log(`   📰 + ${news.length} actualité(s) du monde`)
  const ecosysteme = formatNewsForPrompt([...sujets, ...presentation])
  const monde = formatNewsForPrompt(news, { maintenant: Date.now() })
  return [ecosysteme && `L'écosystème Infinity :\n${ecosysteme}`, monde && `Le quotidien du monde :\n${monde}`].filter(Boolean).join('\n\n')
}

/**
 * Le rédacteur écrit ; l'usine relit. Refusé → il corrige, avec les erreurs telles quelles ; accepté mais TROP COURT →
 * il étoffe (1er essai réel, 15/09 : un jet coupé au plafond de jetons, puis un second, prudent, de 1 000 mots — 6 min
 * au lieu de 15). Trois essais au plus ; au dernier, un Journal court mais valide part quand même.
 */
async function rediger(p: {
  apiKey: string; model: string; date: string; minutes: number; distribution: Distribution; matiere: string
}): Promise<CommandeJT> {
  const systemPrompt = consigneConducteur(lireExemple())
  const objectif = objectifMots(p.minutes)
  const messages: LLMMessage[] = [{ role: 'user', content: messageDuJour({ date: p.date, minutes: p.minutes, matiere: p.matiere }) }]
  let erreurs: string[] = []
  for (let essai = 1; essai <= ESSAIS_REDACTION; essai++) {
    console.log(`\n   ✍️  Rédaction — ${p.model}, essai ${essai}/${ESSAIS_REDACTION}…`)
    // En FLUX, 32 000 jetons : la réflexion du modèle compte dedans — à 16 000, le 1er jet du 15/09 a été coupé net.
    const resp = await callAnthropic({ apiKey: p.apiKey, model: p.model, systemPrompt, messages, maxTokens: 32_000, flux: true, temperature: 0.8 })
    console.log(`      ${resp.inputTokens} jetons lus, ${resp.outputTokens} écrits${resp.stopReason === 'max_tokens' ? ' — COUPÉ au plafond' : ''}`)
    let jt: CommandeJT | null = null
    if (resp.stopReason === 'max_tokens') {
      erreurs = ['réponse coupée au plafond de jetons : le conducteur est incomplet — renvoie-le en entier, plus sobrement']
    } else {
      try {
        let brut = extractJson(resp.text)
        // La date est la NÔTRE (celle du d-tag), jamais celle que le rédacteur aurait recopiée de travers.
        if (estObjet(brut)) brut = { ...brut, date: p.date }
        erreurs = validerCommande(brut, p.distribution, { motsMax: plafondMots(p.minutes) })
        if (!erreurs.length) jt = normaliserCommande(brut as CommandeJT)
      } catch (err) {
        erreurs = [`réponse illisible — ${(err as Error).message}`]
      }
    }
    const mots = jt ? motsCommande(jt) : 0
    const etape = prochaineEtape({ erreurs, mots, objectif, essai })
    if (etape === 'accepter') {
      if (mots < seuilLongueur(objectif)) console.warn(`   ⚠ Journal court : ${mots} mots pour ~${objectif} visés — il part quand même (dernier essai)`)
      return jt as CommandeJT
    }
    if (etape === 'abandonner') { afficherErreurs(`conducteur refusé au dernier essai`, erreurs); break }
    messages.push({ role: 'assistant', content: resp.text || '(réponse vide)' })
    if (etape === 'allonger') {
      console.warn(`   📏 trop court : ${mots} mots pour ~${objectif} visés — le rédacteur étoffe`)
      messages.push({ role: 'user', content: messageAllonger(mots, objectif, plafondMots(p.minutes)) })
    } else {
      afficherErreurs(`conducteur refusé à l'essai ${essai}`, erreurs)
      messages.push({ role: 'user', content: messageCorrection(erreurs) })
    }
  }
  throw new Error(`conducteur refusé ${ESSAIS_REDACTION} fois (${erreurs.length} erreur(s)) — aucune commande publiée ; le JT en images de 20 h UTC restera à l'antenne.`)
}

async function commande(): Promise<void> {
  const date = dateDemandee()
  const sortie = option('--sortie')
  const fixture = drapeau('--fixture')
  const dry = drapeau('--dry-run')
  const distribution = lireDistribution()
  const minutes = minutesJT(process.env.JT_MINUTES)

  console.log(`\n🦎 Le Journal de Freeworld TV — commande du ${date}`)
  console.log(`   mode : ${fixture ? "FIXTURE (l'exemple de l'usine, zéro réseau, zéro langage)" : dry ? 'DRY-RUN (vrai rédacteur, aucune publication)' : 'COMPLET'}`)

  let jt: CommandeJT
  if (fixture) {
    const brut: unknown = { ...JSON.parse(lireExemple()), date }
    const erreurs = validerCommande(brut, distribution)
    if (erreurs.length) { afficherErreurs("l'exemple de l'usine est refusé", erreurs); process.exit(1) }
    jt = normaliserCommande(brut as CommandeJT)
  } else {
    const cle = process.env.NOSTR_PRIVATE_KEY
    if (!dry) {
      if (!cle) throw new Error('NOSTR_PRIVATE_KEY manquant')
      // ── ANTI-DOUBLON ── Une commande déjà publiée par notre clé a peut-être DÉJÀ lancé l'usine : la
      // remplacer en cours de fabrication mélangerait deux Journaux. On s'arrête avant le moindre jeton.
      // Relais illisibles → on rédige (cf. lib/deja-diffuse). `FORCER_REGENERATION=1` remplace quand même.
      if (process.env.FORCER_REGENERATION !== '1') {
        const d = dCommande(date)
        const deja = await dTagsPublies(KIND_DONNEES_APP, [d], pubkeyDe(cle), getRelays())
        if (deja?.has(d)) {
          console.log(`\n✓ La commande du ${date} est déjà publiée par notre clé — rien à refaire (FORCER_REGENERATION=1 pour la remplacer).`)
          return
        }
        if (deja === null) console.warn('   ⚠ relais illisibles : impossible de vérifier un doublon — on rédige.')
      }
    }
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant')
    const model = process.env.ANTHROPIC_MODEL_JT || MODELE_JT_DEFAUT
    console.log(`   ⏱  ${minutes} min visées → ~${objectifMots(minutes)} mots (plafond ${plafondMots(minutes)})`)
    jt = await rediger({ apiKey, model, date, minutes, distribution, matiere: await rassemblerMatiere() })
  }

  const mots = motsCommande(jt)
  const interviews = jt.sujets.filter(s => s.interview).length
  // 0,36 s par mot : la mesure de planif.py sur les voix du casting.
  console.log(`\n   🎬 ${jt.sujets.length} sujet(s), ${interviews} interview(s), ${mots} mots dits (~${(mots * 0.36 / 60).toFixed(1)} min de parole)`)
  jt.sujets.forEach((s, i) => console.log(`      ${i + 1}. [${s.reporter}${s.interview ? ` → ${s.interview.invite}` : ''}] ${s.titre} — ${s.lieu}`))
  if (sortie) {
    writeFileSync(sortie, `${JSON.stringify(jt, null, 1)}\n`)
    console.log(`   💾 ${sortie}`)
  }

  const modele = commandeEventTemplate(jt)
  if (fixture || dry) {
    console.log('\n   📜 La commande :')
    console.log('   ' + JSON.stringify(jt, null, 1).replace(/\n/g, '\n   '))
    console.log(`\n   📡 Évènement qui SERAIT publié : kind ${modele.kind}, tags ${JSON.stringify(modele.tags)}, ${modele.content.length} caractères`)
    console.log(`\n✅ ${fixture ? 'FIXTURE' : 'DRY-RUN'} terminé — rien n'a été publié.`)
    return
  }

  console.log('\n   📡 Publication de la commande (kind 30078)…')
  const res = await publierEvenement(modele, process.env.NOSTR_PRIVATE_KEY as string)
  const ok = res.relays.filter(r => r.ok).length
  console.log(`      event ${res.eventId} par ${res.pubkey.slice(0, 12)}… — accepté par ${ok}/${res.relays.length} relais`)
  console.log(`\n✅ Commande publiée (d = ${dCommande(date)}). L'usine du hub la prendra.`)
}

async function publier(): Promise<void> {
  const date = dateDemandee()
  const dry = drapeau('--dry-run')
  const usine = (process.env.JT_USINE_PUBKEY ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(usine)) {
    console.error("❌ JT_USINE_PUBKEY absente ou mal formée : il faut la clé publique HEX (64 caractères) de l'usine du hub.")
    console.error('   Sans elle, aucun résultat ne peut être authentifié — et un résultat non authentifié ne part jamais.')
    process.exit(1)
  }
  console.log(`\n🦎 Le Journal de Freeworld TV — publication du ${date}${dry ? ' (DRY-RUN)' : ''}`)
  console.log(`   usine attendue : ${usine.slice(0, 12)}… · d = ${dResultat(date)}`)

  // Ne lève pas : un relais muet vaut « pas encore », et le rattrapage réessaiera.
  const relais = getRelays()
  const pool = new SimplePool()
  let evenements: EvenementNostr[] = []
  try {
    evenements = (await pool.querySync(relais, filtreResultat(usine, date), { maxWait: 10_000 })) as EvenementNostr[]
  } catch (err) {
    console.warn(`   ⚠ relais illisibles (${(err as Error).message}) — le résultat est tenu pour absent.`)
  } finally {
    try { pool.close(relais) } catch { /* rien à fermer */ }
  }

  const lecture = lireResultat(evenements, usine, date)
  if (lecture.etat === 'absent') {
    console.log(`\n⏳ Pas encore de résultat de l'usine pour le ${date}.`)
    console.log("   Rien à publier : le rattrapage de 22 h 30 UTC réessaiera ; d'ici là, le JT en images de 20 h UTC reste à l'antenne.")
    return
  }
  if (lecture.etat === 'refuse') {
    console.error(`\n❌ Résultat de l'usine REFUSÉ pour le ${date} — rien n'est publié :`)
    for (const e of lecture.erreurs) console.error(`   - ${e}`)
    process.exit(1)
  }
  const { resultat, evenement, ignores } = lecture
  console.log(`   ✓ résultat ${evenement.id.slice(0, 12)}… signé par l'usine : ${resultat.durationSec} s, ${resultat.segments.length} chapitre(s)`)
  if (ignores) console.warn(`   ⚠ ${ignores} évènement(s) au même d-tag ignoré(s) : auteur étranger ou signature invalide`)

  const programme = programmeDuResultat(resultat, date)
  if (dry) {
    console.log('\n   📡 Programme qui SERAIT publié (kind 30184) :')
    console.log('   ' + JSON.stringify(tvProgramEventTemplate(programme), null, 2).replace(/\n/g, '\n   '))
    console.log("\n✅ DRY-RUN terminé — rien n'a été publié.")
    return
  }
  const cle = process.env.NOSTR_PRIVATE_KEY
  if (!cle) throw new Error('NOSTR_PRIVATE_KEY manquant')
  console.log(`\n   📡 Publication du programme ${programme.id}…`)
  const res = await publishTvProgram(programme, cle)
  const ok = res.relays.filter(r => r.ok).length
  console.log(`      event ${res.eventId} par ${res.pubkey.slice(0, 12)}… — accepté par ${ok}/${res.relays.length} relais`)
  console.log(`\n✅ ${programme.title} à l'antenne sur ${programme.channelId} (d = ${programme.id}).`)
}

async function main(): Promise<void> {
  const etape = process.argv[2]
  if (etape === 'commande') return commande()
  if (etape === 'publier') return publier()
  console.error('Usage : tsx src/scripts/jt-freeworld.ts commande [--date AAAA-MM-JJ] [--sortie f.json] [--dry-run] [--fixture]')
  console.error('        tsx src/scripts/jt-freeworld.ts publier  [--date AAAA-MM-JJ] [--dry-run]')
  process.exit(2)
}

main().catch(err => { console.error('\n❌', err instanceof Error ? err.message : err); process.exit(1) })
