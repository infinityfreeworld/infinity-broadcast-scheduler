/**
 * @module InfinityScheduler/Data/VoixInventees
 * @description Voix INVENTÉES par défaut des animateurs — décision du fondateur du 14/09/2026.
 *
 *   Chaque voix est CONÇUE à partir d'une description (Qwen3-TTS VoiceDesign / VoxCPM2, Apache-2.0),
 *   puis reprise chaque nuit par Chatterbox (data-space). Aucune n'imite une personne réelle.
 *
 *   Clé `station:animateur`, valeur = nom de la voix au catalogue data-space.
 *
 *   ⚠️ Un choix fait dans l'admin (onglet « Voix Animateurs », kind 30095) passe TOUJOURS devant
 *   cette table : le fondateur doit « pouvoir remplacer les voix à tout moment ».
 *
 *   Remplie le 14/09/2026 : les 31 voix choisies par le fondateur à l'écoute (page « Voix des radios »,
 *   db `radio/choix`), déposées au catalogue par le workflow « deposer-voix » (brouillon
 *   `voix-inventees-2026-09-14`). Big Balls Radio, supprimée le même jour, n'y figure pas.
 *
 *   ⚠️ Une voix absente du catalogue rendrait `404 voice_not_found`, puis Piper — un échec qui ressemble
 *   à un réglage : n'ajouter une ligne qu'APRÈS le dépôt de sa référence.
 */
export const VOIX_INVENTEES: Readonly<Record<string, string>> = Object.freeze({
  // WTF Radio
  'wtf-radio:wtf-cyril':             'inv-wtf-cyril',
  'wtf-radio:wtf-marina':            'inv-wtf-marina',
  'wtf-radio:wtf-diogene':           'inv-wtf-diogene',
  // Freeworld Radio
  'freeworld-radio:fw-aurelien':     'inv-fw-aurelien',
  'freeworld-radio:fw-leila':        'inv-fw-leila',
  // Mind Control Radio
  'mindctrl-radio:mc-anonyme':       'inv-mc-anonyme',
  // H₂ Radio
  'hydrogene-radio:h2-henri':        'inv-h2-henri',
  'hydrogene-radio:h2-camille':      'inv-h2-camille',
  // Ğ1 Libre
  'g1-radio:g1-bernard':             'inv-g1-bernard',
  'g1-radio:g1-marie':               'inv-g1-marie',
  // Les Déglingos
  'deglingos-radio:dg-doudou':       'inv-dg-doudou',
  'deglingos-radio:dg-pat':          'inv-dg-pat',
  'deglingos-radio:dg-leboss':       'inv-dg-leboss',
  // Diginomad
  'diginomad-radio:dn-salome':       'inv-dn-salome',
  'diginomad-radio:dn-karim':        'inv-dn-karim',
  // Cryptozor
  'tech-radio:tk-iris':              'inv-tk-iris',
  'tech-radio:tk-said':              'inv-tk-said',
  // Radio Pirate
  'pirate-radio:pi-hex':             'inv-pi-hex',
  'pirate-radio:pi-gnu':             'inv-pi-gnu',
  'pirate-radio:pi-zero':            'inv-pi-zero',
  // Oasis FM
  'oasis-fm:oa-lea':                 'inv-oa-lea',
  'oasis-fm:oa-theo':                'inv-oa-theo',
  'oasis-fm:oa-aicha':               'inv-oa-aicha',
  // Free Press FM
  'free-press-fm:fp-sarah':          'inv-fp-sarah',
  'free-press-fm:fp-malik':          'inv-fp-malik',
  // Voces Libres
  'voces-libres:vl-carmen':          'inv-vl-carmen',
  'voces-libres:vl-rafael':          'inv-vl-rafael',
  // Свобода FM
  'svoboda-fm:sv-anna':              'inv-sv-anna',
  'svoboda-fm:sv-dmitri':            'inv-sv-dmitri',
  // 自由之声
  'zi-you-zhi-sheng:zy-mei':         'inv-zy-mei',
  'zi-you-zhi-sheng:zy-jian':        'inv-zy-jian',
})

/**
 * Animateurs qui n'ont PAS encore de voix inventée, déclarés ici plutôt qu'oubliés.
 * Ils parlent avec leur voix Piper (`voix.ts`) jusqu'au choix du fondateur à l'écoute,
 * puis au dépôt (workflow « deposer-voix ») — alors seulement leur ligne passe au-dessus.
 *
 * 16/09/2026 — Biogame remplace Big Balls Radio : Nora et Malik sont neufs.
 */
export const ANIMATEURS_SANS_VOIX_INVENTEE: ReadonlyArray<string> = Object.freeze([
  'bigballs-radio:bg-nora',
  'bigballs-radio:bg-malik',
])

export function voixInventee(stationId: string, hostId: string): string | undefined {
  return VOIX_INVENTEES[`${stationId}:${hostId}`]
}
