/**
 * Qui a le droit de régler l'antenne : la liste blanche des AUTEURS NOSTR dont les
 * réglages (voix des animateurs 30095, personas 30104/30105, Pulse 30101-30103) sont
 * honorés par le générateur.
 *
 * 🔴 POURQUOI UNE LISTE PAR DÉFAUT DANS LE CODE
 * `RADIO_ADMIN_PUBKEYS` était « optionnel » — et n'a jamais été posé, ni sur le Mac ni
 * sur GitHub. Conséquence, chaque nuit depuis mai : « wtf-cyril » et « pi-hex » revendiqués
 * par deux auteurs, « aucun reconnu — mapping IGNORÉ, repli Piper ». Les choix de voix du
 * fondateur dans l'IHL n'ont JAMAIS compté. Une liste blanche vide qui accepte tout le monde
 * n'est pas une liste blanche ; une liste blanche qu'on oublie de poser non plus.
 *
 * Les clés ci-dessous sont PUBLIQUES (npub). Ce sont, relevées sur le relais le 22/09/2026,
 * les identités qui ont réellement configuré les stations seed depuis l'IHL :
 *   · 6e008304… — 8 stations (kind 30091, 16/06/2026) et la pierre tombale de Big Balls ;
 *   · 4ade0dd1… — Radio Pirate et Voces Libres (30091, 31/05/2026) ;
 *   · f1abc0b8… — voix de Cyril (WTF) et Hex (Pirate) (30095, 25/05/2026) ;
 *   · 6f290e57… — la racine de l'IHL (`VITE_IHL_ROOT_PUBKEY` d'Infinity).
 * La clé du générateur lui-même (9a8098f0…, ère Hugging Face) n'y est PAS : ses anciens
 * mappings pointaient vers des voix anglaises livrées avec le Space, et ne doivent plus
 * passer devant la table des voix inventées.
 *
 * `RADIO_ADMIN_PUBKEYS` (virgules) REMPLACE cette liste quand il est posé — pour un banc
 * d'essai, ou le jour où le fondateur change de clé sans redéployer.
 */
export const ADMINS_RADIO_PAR_DEFAUT: readonly string[] = [
  '6e0083049e5425fe902f6b5c6c44c62e0a767d88346090d05e8d8ecec80898ce',
  '4ade0dd1fe5da781fd3e40060a6807e3e290490a730b9f995146cb7219b96d80',
  'f1abc0b871f6870489391d47ca1fe2a216ddc854c6a6fe5b619c5f7f2381ef3c',
  '6f290e57b8a032237ee84e06de5d6dbcef9c24c08e28e7e4615588141189d1fd',
]

/**
 * La liste blanche effective : `RADIO_ADMIN_PUBKEYS` si posé (même vide de sens, il
 * l'emporte), sinon la liste par défaut. `null` = aucun filtre — réservé à
 * `RADIO_ADMIN_PUBKEYS='*'`, explicitement, jamais par oubli.
 */
export function adminPubkeys(env: NodeJS.ProcessEnv = process.env): Set<string> | null {
  const raw = env.RADIO_ADMIN_PUBKEYS?.trim()
  if (raw === '*') return null
  const source = raw ? raw.split(',') : ADMINS_RADIO_PAR_DEFAUT
  const set = new Set(source.map(s => s.trim().toLowerCase()).filter(s => /^[0-9a-f]{64}$/.test(s)))
  return set.size > 0 ? set : new Set(ADMINS_RADIO_PAR_DEFAUT)
}
