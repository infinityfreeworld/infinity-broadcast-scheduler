/**
 * @module InfinityScheduler/Lib/LiensAction
 * @description Les liens UTILES À L'ACTION (donner, acheter) que l'écran des liens de la Radio peut
 *   afficher — PUR, sans réseau.
 *
 *   Décision du Bâtisseur (07/10/2026) : POUR L'INSTANT, une LISTE FERMÉE, et rien d'autre. Aucun
 *   lien porté par un projet d'Abondance (kind 31200, même validé), aucune autre cagnotte, aucune
 *   fiche Infinity de projet ni de Manifestaction. Pour ajouter, retirer ou changer un lien : la
 *   table `LIENS_ACTION` ci-dessous, et SEULEMENT elle.
 *
 *   Les adresses sont COPIÉES de l'application (`src/modules/abondance/campagnes-soutien.ts`, champs
 *   `don` / `boutique`), jamais inventées. Règle du Bâtisseur (07/10, 18 h 50) : quand
 *   l'application a DEUX liens pour une campagne (don + boutique), les deux figurent ; sinon le seul
 *   qu'elle a :
 *     1. « Oak Camping Car »        → la cagnotte Papayoux de « F'Aaron of Korrigan Oak » (`don`, confirmé par le Bâtisseur) ;
 *     2. « Axiom Team »             → ses collectes pour la monnaie libre (`don`) ;
 *     3. « Emancipactions »         → la BOUTIQUE (billet virtuel ; l'application n'a pas de don) ;
 *     4. la cagnotte pour Infinity  → ABSENTE : l'application n'a aucun lien externe pour elle (sa
 *                                     cagnotte est interne : adresse Ğ1 + rail euros, pas encore
 *                                     ouverte). À ajouter ici le jour où une adresse existe ;
 *     5. « Désobéissance Fertile »  → le don HelloAsso ET la boutique (le livre) ;
 *     6. « les pompiers »           → l'Œuvre des Pupilles des Sapeurs-Pompiers (`don`) ;
 *     7. « les Enfants Phare »      → le don HelloAsso ET la BOUTIQUE du Pharandol.
 *
 *   ── QUAND un lien part à l'écran ───────────────────────────────────────────────────────────
 *   Seulement si l'émission parle RÉELLEMENT de la campagne : son nom est dans une réplique
 *   (`motif`), ou elle est le SUJET DU JOUR de la station Abondance et une réplique la nomme même
 *   plus librement (`motifSujet`). Le moment exact est ensuite calé par l'écran des liens (kind
 *   30093, champ `liens`) sur la première réplique qui la cite : le `title` rendu ici est
 *   l'EXTRAIT de cette réplique, pour que la reconnaissance du tour retombe sur le même tour.
 *
 *   ── JAMAIS PRONONCÉS ───────────────────────────────────────────────────────────────────────
 *   Ces liens ne passent JAMAIS par le prompt : `generate-broadcast` ne les ajoute à l'actualité
 *   qu'APRÈS la dernière réplique écrite. Le modèle ne les voit pas, la voix ne les lit pas ; les
 *   consignes interdisant de lire liens, courriels et numéros à l'antenne restent en place.
 *   Aucun montant, nulle part.
 */
import type { NewsItem } from './types'

export interface LienAction {
  /** Identifiant de la campagne dans `data/campagnes-abondance.ts` (copié de l'application). */
  campagne: string
  /** Nom affiché à côté du lien quand le nom cité est trop court pour se suffire. */
  nom:      string
  /** Les adresses EXACTES, copiées de l'application : le don (`don`), puis la boutique
   *  (`boutique`) quand l'application a les deux — sinon la seule qu'elle a. */
  adresses: ReadonlyArray<{ nature: 'don' | 'boutique'; url: string }>
  /** La campagne est CITÉE dans une réplique : motif strict (son nom propre). */
  motif:    RegExp
  /** Sujet du jour de la station Abondance : motif plus libre, valable ce jour-là seulement. */
  motifSujet?: RegExp
}

/**
 * 🔒 LA LISTE BLANCHE — le SEUL endroit où un lien d'action est autorisé. Rien d'autre ne passe.
 */
export const LIENS_ACTION: readonly LienAction[] = Object.freeze([
  {
    campagne: 'aaron-korrigan-oak', nom: "F'Aaron of Korrigan Oak", 
    adresses: [{ nature: 'don', url: 'https://www.papayoux.com/fr/cagnotte/f-aaron-of-korrigan-oak' }],
    motif: /korrigan[\s-]+oak|f['’ ]?\s?aaron\b|\boak[\s-]+camping[\s-]?car/iu,
    motifSujet: /korrigan|f['’ ]?\s?aaron\b/iu,
  },
  {
    campagne: 'axiom-team', nom: 'Axiom-Team', 
    adresses: [{ nature: 'don', url: 'https://axiom-team.fr/collectes' }],
    motif: /axiom[\s-]?team/iu,
  },
  {
    campagne: 'emancipactions', nom: "Émancip'Actions", 
    adresses: [{ nature: 'boutique', url: 'https://emancipactions.fr/billet-virtuel/' }],
    motif: /[ée]mancip['’\s-]?actions?\b/iu,
  },
  {
    campagne: 'desobeissance-fertile', nom: 'Désobéissance Fertile', 
    adresses: [
      { nature: 'don', url: 'https://www.helloasso.com/associations/desobeissance-fertile/formulaires/1' },
      { nature: 'boutique', url: 'https://www.lalibrairie.com/livres/la-desobeissance-fertile--pour-une-ecologie-offensive_0-7005189_9782228927178.html' },
    ],
    motif: /d[ée]sob[ée]issance[\s-]+fertile/iu,
  },
  {
    campagne: 'pompiers-odp', nom: 'Pupilles des Sapeurs-Pompiers', 
    adresses: [{ nature: 'don', url: 'https://don.odp-pompiers.fr/odp-2024' }],
    // « les pompiers » tout court parle souvent d'une autre actualité : cité ailleurs, il faut l'Œuvre.
    motif: /pupilles\s+des\s+sapeurs[\s-]+pompiers|soutenir\s+les\s+sapeurs[\s-]+pompiers/iu,
    motifSujet: /(?:les\s+)?sapeurs[\s-]+pompiers|(?:les\s+)?pompiers/iu,
  },
  {
    campagne: 'enfants-phare', nom: 'Les Enfants-Phare', 
    adresses: [
      { nature: 'don', url: 'https://www.helloasso.com/associations/les-enfants-phare/formulaires/1' },
      { nature: 'boutique', url: 'https://lesenfantsphare.fr/le-pharandol/boutique/' },
    ],
    motif: /enfants[\s-]+phares?\b|\bpharandol\b/iu,
  },
] satisfies LienAction[])

const MAX_URL = 400
/** L'écran des liens (`tourReprendActu`) ignore un titre de moins de 6 caractères. */
export const EXTRAIT_MIN = 6
const HOTE_PRIVE = /(?:^localhost$|\.local$|\.localhost$|\.internal$|\.lan$|\.home$|\.onion$)/i
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

/**
 * Une adresse montrable : http(s), sans identifiant (« user:mdp@ »), sans adresse IP ni hôte
 * privé, paramètres de pistage `utm_*` et fragment retirés. `null` sinon.
 */
export function lienSur(brut: string): string | null {
  const s = String(brut ?? '').trim()
  if (!s || s.length > MAX_URL) return null
  let u: URL
  try { u = new URL(s) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  const hote = u.hostname.toLowerCase()
  if (!hote.includes('.') || hote.startsWith('[') || IPV4.test(hote) || HOTE_PRIVE.test(hote)) return null
  for (const cle of [...u.searchParams.keys()]) if (/^utm_/i.test(cle)) u.searchParams.delete(cle)
  u.hash = ''
  return u.toString()
}

/** Les adresses de la liste blanche, normalisées (une entrée qui ne passe pas `lienSur` est écartée). */
const AUTORISES: ReadonlySet<string> = new Set(
  LIENS_ACTION.flatMap(l => l.adresses.map(a => lienSur(a.url))).filter((u): u is string => u !== null),
)

/** L'adresse est-elle dans la liste fermée ? Toute autre adresse est refusée. */
export function lienAutorise(url: string): boolean {
  const u = lienSur(url)
  return u !== null && AUTORISES.has(u)
}

/**
 * Les liens d'action que l'émission a RÉELLEMENT évoqués, sous la forme d'actualités à glisser
 * dans le fil APRÈS l'écriture (cf. en-tête) : `title` = l'extrait de la première réplique qui
 * cite la campagne, `link` = une adresse de la liste blanche. Une campagne citée donne toutes
 * ses adresses (don, puis boutique) — une ou deux.
 *
 * @param repliques    le texte des répliques, dans l'ordre de l'émission ;
 * @param campagneDuJour l'identifiant de la campagne du jour de la station Abondance, s'il y en a une.
 */
export function liensActionCites(
  repliques: readonly string[], opts: { campagneDuJour?: string | null } = {},
): NewsItem[] {
  const out: NewsItem[] = []
  for (const l of LIENS_ACTION) {
    const motifs = l.campagne === opts.campagneDuJour && l.motifSujet ? [l.motif, l.motifSujet] : [l.motif]
    let extrait: string | null = null
    for (const r of repliques) {
      for (const m of motifs) {
        const trouve = m.exec(String(r ?? ''))
        // L'écran des liens ne reconnaît pas un nom de moins de 6 caractères : jamais d'extrait si court.
        if (trouve && trouve[0].trim().length >= EXTRAIT_MIN) { extrait = trouve[0].trim(); break }
      }
      if (extrait) break
    }
    if (!extrait) continue
    // Toutes les adresses de la campagne (don, puis boutique), chacune passée par la porte.
    for (const a of l.adresses) {
      const url = lienSur(a.url)
      if (!url || !lienAutorise(url)) continue
      out.push({
        title: extrait,
        link: url,
        sourceTitle: a.nature === 'boutique' ? `Boutique — ${l.nom}` : `Faire un don — ${l.nom}`,
      })
    }
  }
  return out
}
