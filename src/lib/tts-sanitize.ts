/**
 * @module InfinityScheduler/Lib/TTSSanitize
 * @description PORT du module de l'app Infinity
 *   (`src/modules/radio/ai/tts-sanitize.ts`, commit eb593fbb8 du 04/10/2026) :
 *   les émissions AUTOMATIQUES passent par ce dépôt, pas par l'app — sans ce
 *   port, le correctif de l'app ne touchait aucune émission diffusée.
 *   Garder les deux copies alignées (même fonction, mêmes tests).
 *
 *   Ici, il est appelé à l'ENTRÉE de chaque moteur (`piper.synthesize`,
 *   `synthesizeKokoro`, `synthesizeWithChatterbox`) : radio, TV, idents et
 *   tout futur appelant y passent forcément. Le Journal Freeworld, dont la
 *   voix est fabriquée par le hub, est nettoyé dans `normaliserCommande`.
 *
 *   (2026-06-01, renforcé le 04/10/2026) Nettoie un texte AVANT
 *   synthèse vocale, pour que la voix ne prononce JAMAIS de symboles
 *   parasites (« astérisque », « dièse », « barre oblique »…), ni de Markdown,
 *   ni de didascalies.
 *
 *   Problème observé : les animateurs généraient parfois du Markdown (`***`,
 *   `**gras**`), des didascalies (`*rires*`, `[musique]`, `(soupir)`) ou des
 *   emojis → le moteur lisait « astérisque astérisque », « dièse », ou
 *   prononçait le mot « rires » comme s'il faisait partie de la phrase.
 *
 *   04/10/2026 — « certains animateurs prononcent de la ponctuation, par
 *   exemple astérisque » (Bâtisseur). Ajouts : les didascalies sont RETIRÉES
 *   (pas seulement débarrassées de leurs astérisques), les URL brutes, les
 *   barres obliques, `+`, `=`, `@`, accolades… ne passent plus, les emojis
 *   composés (drapeaux, teintes de peau, séquences ZWJ) non plus.
 *
 *   Ce nettoyage est indépendant de la langue et s'applique à TOUTES les
 *   langues. Pur, déterministe, testé. Le transcript publié n'est jamais
 *   touché : seul le texte remis au moteur l'est.
 *
 *   La ponctuation normale (. , ; : ! ? … « » " ' -) et les nombres sont
 *   PRÉSERVÉS : ils servent l'intonation et la lecture correcte des chiffres.
 */

/**
 * Mots qui signalent une didascalie (annotation scénique) entre parenthèses.
 * Entre parenthèses, on ne retire QUE ce qui ressemble à une indication de
 * jeu ; un aparté normal (« le vote (enfin !) est passé ») reste dit.
 * Racines, en minuscules, toutes langues des stations.
 */
const RACINES_DIDASCALIE = [
  // français
  'rire', 'rires', 'rit', 'riant', 'ricane', 'sourit', 'sourire', 'souriant',
  'soupir', 'soupire', 'pause', 'silence', 'musique', 'jingle', 'générique',
  'applaudi', 'chuchot', 'murmur', 'tousse', 'toux', 'raclement', 'bruit',
  'ironique', 'sarcastique', 'en aparté', 'à voix basse', 'voix off', 'off',
  'hésit', 'bégaie', 'crie', 'hurle', 'sifflement', 'bip', 'blanc', 'un temps',
  'clin d', 'gloussement', 'gloussant', 'claque', 'tape', 'souffle',
  // anglais
  'laugh', 'laughs', 'laughing', 'chuckle', 'giggle', 'sigh', 'sighs',
  'music', 'applause', 'whisper', 'cough', 'beat', 'smil', 'grin', 'clears throat',
  // espagnol / italien / portugais
  'risa', 'risas', 'ríe', 'suspir', 'música', 'aplauso', 'susurr', 'risat',
  'ride', 'sospir', 'musica', 'applaus', 'sussurr', 'riso', 'risos', 'aplaus',
  // russe
  'смех', 'смеётся', 'смеется', 'вздох', 'пауза', 'музыка', 'шёпот', 'шепот',
] as const

/** Une parenthèse courte qui contient un mot de didascalie. */
function estDidascalie(contenu: string): boolean {
  const c = contenu.trim().toLowerCase()
  if (!c) return true
  if (c.split(/\s+/).length > 6) return false
  return RACINES_DIDASCALIE.some(r => {
    // Racine en début de mot (évite « ride » dans « bride », « off » dans « offre »
    // seulement quand la racine est un mot entier court).
    const re = new RegExp(`(^|[^\\p{L}])${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u')
    if (!re.test(c)) return false
    if (r.length <= 4) {
      // Racines très courtes : exiger le mot entier.
      return new RegExp(`(^|[^\\p{L}])${r}($|[^\\p{L}])`, 'u').test(c)
    }
    return true
  })
}

/** Emojis, pictogrammes, drapeaux, teintes de peau, ZWJ, sélecteurs, flèches. */
const EMOJIS = new RegExp(
  [
    '\\p{Extended_Pictographic}',
    '[\\u{1F1E6}-\\u{1F1FF}]',      // drapeaux (indicateurs régionaux)
    '[\\u{1F3FB}-\\u{1F3FF}]',      // teintes de peau
    '[\\u{FE00}-\\u{FE0F}]',        // sélecteurs de variation
    '\\u{200D}',                    // liant ZWJ
    '\\u{20E3}',                    // touche (1️⃣)
    '[\\u{E0020}-\\u{E007F}]',      // étiquettes (drapeaux régionaux)
    '[\\u{2190}-\\u{21FF}]',        // flèches
    '[\\u{2B00}-\\u{2BFF}]',        // flèches et symboles divers
    '[\\u{25A0}-\\u{25FF}]',        // formes géométriques (■ ▶ ●)
    '[\\u{2600}-\\u{27BF}]',        // symboles divers et dingbats (✓ ✔ ✨)
  ].join('|'),
  'gu',
)

/** Retire Markdown, didascalies, URL, symboles isolés et emojis. */
export function sanitizeForSpeech(text: string): string {
  let s = text

  // ── 1. Liens et images Markdown : garder le libellé, jeter l'URL ──────
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '')          // ![alt](url) → ∅
  s = s.replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')   // [texte](url) → texte

  // ── 2. URL brutes ────────────────────────────────────────────────────
  // Une adresse avec protocole se lit caractère par caractère : on la retire.
  // « www. » seul est retiré, le domaine reste (« exemple.org » se dit bien).
  s = s.replace(/\b(?:https?|ftp):\/\/[^\s<>()«»"]+/gi, '')
  s = s.replace(/\bwww\./gi, '')

  // ── 3. Blocs de code ``` … ``` : on garde le contenu, sans les barrières.
  s = s.replace(/```[\w-]*\n?/g, '')

  // ── 3 bis. Début de ligne : titres, citations, puces ─────────────────────
  s = s.replace(/^\s{0,3}#{1,6}\s*/gm, '')            // ## Titre
  s = s.replace(/^\s*>+\s?/gm, '')                    // > citation
  s = s.replace(/^\s*[-+*•·▪◦‣–—]\s+/gm, '')           // - puce / • puce / * puce

  // ── 4. Didascalies ───────────────────────────────────────────────────
  // [musique], [rires], [Cyril] → retirées ENTIÈREMENT (entre crochets, rien
  // n'est jamais destiné à être dit).
  s = s.replace(/\[[^\]\n]*\]/g, ' ')
  // *rit*, *soupir*, *en chuchotant* : un astérisque SIMPLE autour d'un court
  // passage = annotation de jeu → retirée. (Le gras `**…**` est traité après.)
  s = s.replace(/(^|[^*])\*(?!\*)([^*\n]{1,60}?)\*(?!\*)/g, '$1 ')
  // (pause), (rires), (en soupirant) → retirées ; un aparté normal garde son
  // contenu, avec des virgules à la place des parenthèses (même intonation).
  s = s.replace(/\(([^()\n]*)\)/g, (_m, contenu: string) =>
    estDidascalie(contenu) ? ' ' : `, ${contenu.trim()},`)

  // ── 5. Emphase / code : on garde le texte intérieur ──────────────────
  // ***gras***, **gras**, _ital_, ~~barré~~, `code` → texte nu.
  s = s.replace(/[*~`]+/g, '')
  s = s.replace(/(^|[^\p{L}\p{N}])_+|_+(?=$|[^\p{L}\p{N}])/gu, '$1')
  s = s.replace(/_/g, ' ')

  // ── 7. Emojis et pictogrammes (le moteur lit leur nom) ───────────────
  s = s.replace(EMOJIS, ' ')

  // ── 8. Symboles isolés ───────────────────────────────────────────────
  // « 24/7 », « 1/2 », « 2+2 », « +33 » : entre chiffres, ils se lisent bien.
  s = s.replace(/(\d)\s*\/\s*(?=\d)/g, '$1\uE000')     // protège 24/7
  s = s.replace(/(^|[^\d])\+(?=\d)/g, '$1\uE001')      // protège +33
  s = s.replace(/(\d)\s*\+\s*(?=\d)/g, '$1\uE001')     // protège 2+2
  s = s.replace(/[/\\|<>^=+{}§¤@#]+/g, ' ')
  s = s.replace(/\uE000/g, '/').replace(/\uE001/g, '+')

  // ── 9. Espaces et ponctuation orpheline laissés par les retraits ─────
  s = s.replace(/[ \t]{2,}/g, ' ')
  s = s.replace(/[ \t]+([,.;:!?…)])/g, (_m, p: string) =>
    // Espace insécable française avant ; : ! ? : on la garde (simple espace).
    /[;:!?]/.test(p) ? ` ${p}` : p)
  s = s.replace(/,(\s*,)+/g, ',')                     // « , , » → « , »
  s = s.replace(/,\s*([.;:!?…])/g, '$1')              // « , . » → « . »
  s = s.replace(/([.!?…])\s*,/g, '$1')                // « !, » → « ! »
  s = s.replace(/^[ \t]*[,;:][ \t]*/gm, '')           // ligne qui commence par « , »
  s = s.replace(/[ \t]+\n/g, '\n')
  s = s.replace(/\n[ \t]+/g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  s = s.trim()

  // ── 10. Tout a disparu ? ─────────────────────────────────────────────
  // Un tour qui tient ENTIER dans une didascalie (« *rires* ») deviendrait un
  // silence, et un silence ressemble à une panne : on garde alors les mots,
  // débarrassés de tout symbole.
  if (!/[\p{L}\p{N}]/u.test(s) && /[\p{L}\p{N}]/u.test(text.replace(/\bhttps?:\/\/\S+/gi, ''))) {
    s = text
      .replace(/\bhttps?:\/\/\S+/gi, ' ')
      .replace(EMOJIS, ' ')
      .replace(/[^\p{L}\p{N}\s.,;:!?…«»"'’-]+/gu, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }

  return s
}

/**
 * Reste-t-il quelque chose à DIRE une fois le texte nettoyé ? Un tour fait
 * seulement d'emojis ou de symboles deviendrait une synthèse vide (le moteur
 * échoue, ou rend un silence qui ressemble à une panne) : l'appelant le saute.
 */
export function resteADire(texte: string): boolean {
  return /[\p{L}\p{N}]/u.test(sanitizeForSpeech(texte))
}
