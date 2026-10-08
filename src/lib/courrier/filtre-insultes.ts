/**
 * @module InfinityScheduler/Courrier/FiltreInsultes
 * @description Le filet de sécurité DÉTERMINISTE du courrier des auditeurs (décision du Bâtisseur,
 *   07/10/2026) : « toute insulte, tout nom offensant est écarté SYSTÉMATIQUEMENT — jamais
 *   diffusé, jamais montré ». Il ne dépend d'aucun réseau ni d'aucun modèle : même quand le
 *   modèle de langue est en panne, une insulte de cette liste ne passe JAMAIS.
 *
 *   ⚠️ DEUX COPIES IDENTIQUES : ce fichier existe aussi dans l'app Infinity
 *   (`src/modules/radio/courrier/filtre-insultes.ts`), où il refuse le message AVANT l'envoi avec
 *   un message clair. Toute modification se fait dans les DEUX dépôts.
 *
 *   Ce que la liste contient : des insultes et des injures discriminatoires SANS ambiguïté
 *   (fr, en, es, ru, zh). Ce qu'elle ne contient PAS, exprès : les mots à double sens
 *   (« con » = « avec » en espagnol, « salopette », « Niger », « tapette »…) et les simples
 *   jurons — ceux-là, c'est le modèle de langue du générateur qui les juge (douteux → IHL).
 *
 *   Normalisation (la même pour le texte et pour la liste) : minuscules, accents retirés,
 *   chiffres et symboles « leet » ramenés à leur lettre (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a,
 *   $→s), lettres espacées recollées (« s a l o p e », « c.o.n.n.a.r.d »), lettres répétées
 *   ramenées à une ou deux (« connnnard », « fuuuuck »), racines longues repérées même collées
 *   dans un pseudo (« GrosConnard »).
 *
 *   Zone PURE : aucune dépendance.
 */

/** `mot` = mot exact ; `mot*` = tout mot qui COMMENCE par… ; `deux mots` = expression. */
const LISTE_LATINE: readonly string[] = [
  // ── français ──
  'connard*', 'connass*', 'conasse*', 'salope', 'salopes', 'salopard', 'salopards', 'salaud', 'salauds',
  'encul*', 'batard', 'batards', 'batarde', 'batardes', 'pute', 'putes', 'fils de pute', 'niqu*', 'ntm', 'fdp',
  'abruti*', 'cretin*', 'debile', 'debiles', 'enfoire*', 'trouduc*', 'pouffiass*', 'grognass*',
  'pd', 'pede', 'pedes', 'tafiol*', 'gouine*', 'negre', 'negres', 'negresse', 'negresses',
  'bougnoul*', 'youpin*', 'bicot*', 'sous merde',
  // ── anglais ──
  'fuck*', 'motherfuck*', 'bitch*', 'cunt*', 'asshole*', 'bastard*', 'dickhead*', 'whore*', 'slut*',
  'faggot*', 'fag', 'fags', 'retard', 'retards', 'retarded', 'nigger*', 'nigga*', 'kike*', 'spic', 'spics',
  'chink', 'chinks', 'wanker*', 'twat*', 'douchebag*', 'scumbag*', 'moron*', 'tranny', 'trannies',
  'cocksucker*', 'jackass*',
  // ── espagnol ──
  'puta', 'putas', 'puto', 'putos', 'hijueputa', 'hijoputa', 'pendejo*', 'pendeja*', 'cabron*',
  'gilipolla*', 'maricon*', 'marica', 'maricas', 'imbecil*', 'subnormal*', 'malparid*', 'culero*',
  'negrata*', 'sudaca*', 'mamaguevo*',
  // ── russe ──
  'сука', 'суки', 'сучка*', 'бляд*', 'блят*', 'пизд*', 'хуй*', 'хуе*', 'ебан*', 'ебал*', 'ебат*', 'уеб*',
  'долбоеб*', 'мудак*', 'мудил*', 'пидор*', 'пидар*', 'педик*', 'шлюх*', 'гандон*', 'чмо', 'урод', 'уроды',
  'уродина', 'дебил*', 'жид', 'жиды', 'жидов*', 'чурка', 'чурки', 'черножоп*',
]

/** Langues sans espaces (chinois) : recherche par sous-chaîne. */
const LISTE_SANS_ESPACES: readonly string[] = [
  '傻逼', '傻屄', '煞笔', '他妈的', '操你', '肏', '草泥马', '婊子', '贱人', '王八蛋', '狗娘养', '滚蛋',
  '去死吧', '白痴', '脑残', '杂种', '妈逼', '屌',
]

const LEET: Readonly<Record<string, string>> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '€': 'e',
}

/** Minuscules, accents retirés, leet ramené à la lettre. Pure. */
export function normaliser(texte: string): string {
  const sansAccents = texte.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
  let out = ''
  for (const c of sansAccents) out += LEET[c] ?? c
  // « ! » et « | » ne valent « i » qu'ENTRE deux lettres (« b!tch ») : en fin de mot, c'est de la
  // ponctuation, et « pute! » doit rester « pute ».
  return out.replace(/(?<=\p{L})[!|]+(?=\p{L})/gu, 'i')
}

/** Les mots (lettres seulement), avec les lettres isolées recollées : « s a l o p e » → « salope ». */
export function mots(texteNormalise: string): string[] {
  const bruts = texteNormalise.split(/[^\p{L}]+/u).filter(Boolean)
  const out: string[] = []
  let colle = ''
  for (const m of bruts) {
    if ([...m].length === 1) { colle += m; continue }
    if (colle) { out.push(colle); colle = '' }
    out.push(m)
  }
  if (colle) out.push(colle)
  return out
}

/**
 * Variantes d'un mot dont une lettre est répétée 3 fois ou plus : chaque série ramenée à 1 OU à
 * 2 lettres (« connnnard » → « conard », « connard » ; « fuuuck » → « fuck », « fuuck »).
 * Les doubles ordinaires ne sont pas touchés (« Niger » ≠ « nigger »). Au plus 16 variantes.
 */
export function variantes(mot: string): string[] {
  const series = [...mot.matchAll(/(\p{L})\1{2,}/gu)]
  if (series.length === 0) return [mot]
  let acc = ['']
  let pos = 0
  for (const s of series) {
    const debut = s.index ?? 0
    const avant = mot.slice(pos, debut)
    const lettre = s[1]
    const suivant: string[] = []
    for (const a of acc) {
      suivant.push(a + avant + lettre, a + avant + lettre + lettre)
      if (suivant.length >= 16) break
    }
    acc = suivant
    pos = debut + s[0].length
  }
  return acc.map(a => a + mot.slice(pos))
}

interface Entree { mots: string[]; prefixe: boolean }

const ENTREES: readonly Entree[] = LISTE_LATINE.map(e => {
  const prefixe = e.endsWith('*')
  return { mots: mots(normaliser(prefixe ? e.slice(0, -1) : e)), prefixe }
})

function correspond(motTexte: string, motListe: string, prefixe: boolean): boolean {
  return prefixe ? motTexte.startsWith(motListe) : motTexte === motListe
}

/**
 * Le texte contient-il une insulte de la liste ? Pure. Ne dit JAMAIS laquelle : rien de ce
 * qui est écarté ne doit être réaffiché ni journalisé.
 */
export function contientInsulte(texte: string | undefined | null): boolean {
  if (!texte) return false
  const n = normaliser(texte)
  // Chinois : sous-chaîne, espaces et ponctuation retirés.
  const compact = n.replace(/[^\p{L}]+/gu, '')
  if (LISTE_SANS_ESPACES.some(m => compact.includes(m))) return true
  const ms = mots(n).map(variantes)
  for (const e of ENTREES) {
    if (e.mots.length === 0) continue
    for (let i = 0; i + e.mots.length <= ms.length; i++) {
      let ok = true
      for (let k = 0; k < e.mots.length && ok; k++) {
        const dernier = k === e.mots.length - 1
        ok = ms[i + k].some(v => correspond(v, e.mots[k], e.prefixe && dernier))
      }
      if (ok) return true
    }
    // Racine longue (≥ 6 lettres) COLLÉE dans un mot : « GrosConnard », « xXmotherfuckerXx ».
    // Seulement pour les racines (`mot*`) assez longues pour n'être jamais un morceau de mot honnête.
    if (e.prefixe && e.mots.length === 1 && [...e.mots[0]].length >= 6) {
      if (ms.some(vs => vs.some(v => v.includes(e.mots[0])))) return true
    }
  }
  return false
}
