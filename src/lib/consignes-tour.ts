/**
 * @module InfinityScheduler/Lib/ConsignesTour
 * @description Le message « de tour » envoyé au modèle à chaque réplique, DANS LA LANGUE DE LA
 *   STATION (français pour les stations françaises, anglais pour toutes les autres — le modèle
 *   comprend l'anglais et répond dans la langue que fixe la consigne de langue).
 *
 *   🔴 04/10/2026 — Free Press FM (station anglaise) parlait français à partir du premier retour
 *   de pause musicale ou du courrier des auditeurs : ces consignes, en français, donnaient des
 *   EXEMPLES À RECOPIER (« De retour sur Free Press FM… », « un auditeur nous écrit »), que le
 *   modèle recopiait mot pour mot. Mesuré sur les émissions publiées du 29/09 au 04/10 : le
 *   premier tour français est, à chaque fois, un « De retour sur… » ou un « un auditeur nous
 *   écrit », et les tours suivants restent en français (l'historique entraîne la suite).
 *
 *   Chaque consigne se termine par la consigne de langue (`consigneLangueTour`) : la langue est
 *   rappelée à CHAQUE tour, pas seulement dans le prompt système.
 */
import type { StationLanguage } from './types'
import { consigneLangueTour } from './langue-station'

export type GenreTour =
  | { type: 'invite-reponse-1' }
  | { type: 'invite-reponse-2' }
  | { type: 'pre-invite'; invite: string; bio: string }
  | { type: 'relance-invite'; invite: string }
  | { type: 'post-invite'; invite: string }
  | { type: 'ouverture' }
  | { type: 'cloture' }
  | { type: 'avant-pause'; morceau: string }
  | { type: 'retour-pause'; morceau: string; station: string }
  | { type: 'court' }
  | { type: 'courrier'; anonyme: boolean }
  | { type: 'courant' }

function fr(t: GenreTour): string {
  switch (t.type) {
    case 'invite-reponse-1': return `Ton tour d'invité (1/2). L'animateur vient de te poser sa PREMIÈRE question DIRECTEMENT — RÉPONDS-LUI explicitement (1-2 phrases). Tu peux ensuite ajouter UNE saillie satirique courte dans ton style. Total : 1-3 phrases max.`
    case 'invite-reponse-2': return `Ton tour d'invité (2/2 — DERNIER). L'animateur vient de te poser une 2e question (autre angle). RÉPONDS-LUI (1-2 phrases) puis amorce ta SORTIE de l'émission (1 phrase, type "merci de m'avoir reçu" dans ton style satirique). Total : 2-3 phrases max.`
    case 'pre-invite': return `Ton tour. ${t.invite} (${t.bio.slice(0, 80)}) est en ligne avec nous. Présente-le brièvement en 1 phrase puis POSE-LUI UNE QUESTION CONCRÈTE en lien avec un sujet d'actualité évoqué (ou à évoquer). Termine ton tour par cette question, adressée explicitement à ${t.invite}.`
    case 'relance-invite': return `Ton tour. ${t.invite} vient de répondre — relance avec une 2e question SOUS UN AUTRE ANGLE (provocation, contradiction polie, ou approfondissement). 2-3 phrases max, termine par '?' adressé à ${t.invite}.`
    case 'post-invite': return `Ton tour. ${t.invite} s'en va — remercie-le brièvement (1 phrase, dans ton style) puis enchaîne sur le sujet suivant (1 phrase). 2 phrases max.`
    case 'ouverture': return `Tu ouvres l'émission. Suis la consigne d'INTRO de la section STRUCTURE.`
    case 'cloture': return `Dernier tour : conclusion + teaser de demain. Suis la consigne de CONCLUSION.`
    case 'avant-pause': return `Ton tour, et c'est le DERNIER avant une pause musicale. Dis ce que tu as à dire (1-2 phrases), puis LANCE le morceau « ${t.morceau} » naturellement, comme un animateur qui envoie la musique (« on s'écoute… », « je vous laisse avec… », « allez, musique »). Ta dernière phrase est celle qui lance la musique.`
    case 'retour-pause': return `On REVIENT d'une pause musicale (« ${t.morceau} »). Commence par une phrase de retour d'antenne dans ton style (« De retour sur ${t.station}… », « C'était… »), puis enchaîne sur la phase courante (cf. STRUCTURE). 2-3 phrases.`
    case 'court': return `Tour COURT : réagis en UNE seule phrase de 3 à 10 mots (rire, étonnement, relance, approbation, désaccord, taquinerie). Rien d'autre, pas de développement.`
    case 'courrier': return `Le standard a reçu un message d'auditeur en lien avec le sujet en cours. Invente un prénom et une ville, lis le message à l'antenne (2 phrases, à la première personne de l'auditeur, introduites par « ${t.anonyme ? 'quelqu\'un' : 'un auditeur'} nous écrit »), puis réponds-lui en une phrase en l'appelant par son prénom.`
    case 'courant': return 'Ton tour. Continue le dialogue en respectant la phase courante (cf. STRUCTURE).'
  }
}

/** Anglais : pour TOUTES les stations non françaises (les exemples à dire sont en anglais pour
 *  une station anglaise, et explicitement « dans la langue de la station » pour les autres). */
function en(t: GenreTour, anglais: boolean): string {
  const ex = (s: string) => anglais ? s : `${s} — translated into the station's language`
  switch (t.type) {
    case 'invite-reponse-1': return `Your guest turn (1/2). The host just asked you their FIRST question DIRECTLY — ANSWER it explicitly (1-2 sentences). You may then add ONE short satirical quip in your style. Total: 1-3 sentences max.`
    case 'invite-reponse-2': return `Your guest turn (2/2 — LAST). The host just asked you a 2nd question (another angle). ANSWER it (1-2 sentences), then start your EXIT from the show (1 sentence, like "thanks for having me", in your satirical style). Total: 2-3 sentences max.`
    case 'pre-invite': return `Your turn. ${t.invite} (${t.bio.slice(0, 80)}) is on the line with us. Introduce them briefly in 1 sentence, then ASK THEM ONE CONCRETE QUESTION about a news topic mentioned (or to be mentioned). End your turn with that question, addressed explicitly to ${t.invite}.`
    case 'relance-invite': return `Your turn. ${t.invite} just answered — follow up with a 2nd question FROM ANOTHER ANGLE (provocation, polite contradiction, or going deeper). 2-3 sentences max, end with a '?' addressed to ${t.invite}.`
    case 'post-invite': return `Your turn. ${t.invite} is leaving — thank them briefly (1 sentence, in your style), then move on to the next topic (1 sentence). 2 sentences max.`
    case 'ouverture': return `You open the show. Follow the INTRO instruction of the STRUCTURE section.`
    case 'cloture': return `Last turn: wrap-up + teaser for tomorrow. Follow the CONCLUSION instruction.`
    case 'avant-pause': return `Your turn, and it's the LAST one before a music break. Say what you have to say (1-2 sentences), then LAUNCH the track "${t.morceau}" naturally, like a host sending the music (${ex('"let\'s listen to…", "I\'ll leave you with…", "here\'s some music"')}). Your last sentence is the one that launches the music.`
    case 'retour-pause': return `We're BACK from a music break ("${t.morceau}"). Start with a back-on-air sentence in your style (${ex(`"Back on ${t.station}…", "That was…"`)}), then continue with the current phase (see STRUCTURE). 2-3 sentences.`
    case 'court': return `SHORT turn: react in ONE single sentence of 3 to 10 words (laugh, surprise, follow-up, agreement, disagreement, teasing). Nothing else, no development.`
    case 'courrier': return `The switchboard received a listener message related to the current topic. Make up a first name and a city, read the message on air (2 sentences, in the listener's first person, introduced by ${ex(t.anonyme ? '"someone writes to us"' : '"a listener writes in"')}), then answer them in one sentence, calling them by their first name.`
    case 'courant': return 'Your turn. Keep the dialogue going, following the current phase (see STRUCTURE).'
  }
}

/**
 * Le message du tour. `complement` (la consigne de la phrase d'appel) s'insère avant la consigne
 * de langue, qui vient TOUJOURS en dernier : c'est la dernière chose que le modèle lit.
 */
export function consigneTour(t: GenreTour, langue: StationLanguage, complement = ''): string {
  const corps = langue === 'fr' ? fr(t) : en(t, langue === 'en')
  return `${corps}${complement ? ` ${complement}` : ''} ${consigneLangueTour(langue)}`
}
