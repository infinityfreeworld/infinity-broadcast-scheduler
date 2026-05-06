/**
 * @module InfinityScheduler/Pinata
 * @description Upload + management de fichiers IPFS via l'API HTTP Pinata.
 *
 *   Auth : JWT envoyé en Authorization header.
 *   Doc : https://docs.pinata.cloud/api-reference/
 *
 *   Spring 2026 : ajout de pinataListPins + pinataUnpin pour gérer le
 *   quota du free tier (1 GB). Les broadcasts sont taggés avec metadata
 *   `station` + `date` pour permettre l'auto-purge des anciens.
 */

const PINATA_PIN_FILE_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS'
const PINATA_LIST_URL     = 'https://api.pinata.cloud/data/pinList'
const PINATA_UNPIN_URL    = 'https://api.pinata.cloud/pinning/unpin'

export interface PinataPinResult {
  cid:       string
  size:      number
  timestamp: string
}

/**
 * Upload un Buffer (typiquement audio WAV) sur IPFS via Pinata.
 * Retourne le CID public + métadonnées.
 *
 * @param data         Bytes à pinner
 * @param fileName     Nom de fichier (juste pour les métadonnées Pinata)
 * @param mimeType     MIME (audio/wav, audio/mpeg, audio/ogg…)
 * @param jwt          Pinata JWT (env PINATA_JWT)
 * @param keyvalues    Métadonnées additionnelles (recherchables par
 *                     pinataListPins). Source est ajoutée automatiquement.
 */
export async function pinataPinFile(
  data: Buffer,
  fileName: string,
  mimeType: string,
  jwt: string,
  keyvalues: Record<string, string> = {},
): Promise<PinataPinResult> {
  const blob = new Blob([data], { type: mimeType })
  const formData = new FormData()
  formData.append('file', blob, fileName)
  formData.append('pinataMetadata', JSON.stringify({
    name: fileName,
    keyvalues: { source: 'infinity-broadcast-scheduler', ...keyvalues },
  }))
  formData.append('pinataOptions', JSON.stringify({
    cidVersion: 1,    // CID v1 (préfixe bafy…) compatible Helia browser
  }))

  const res = await fetch(PINATA_PIN_FILE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body:    formData,
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '(no body)')
    throw new Error(`Pinata HTTP ${res.status}: ${errBody}`)
  }
  const json = await res.json() as { IpfsHash: string; PinSize: number; Timestamp: string }
  return {
    cid:       json.IpfsHash,
    size:      json.PinSize,
    timestamp: json.Timestamp,
  }
}

export interface PinataPinInfo {
  cid:           string
  size:          number
  datePinned:    string
  metadata:      { name?: string; keyvalues?: Record<string, string> }
}

/**
 * Liste les pins du compte. Filtre par metadata.keyvalues si fourni.
 *
 * Spring 2026 : utilisé par l'auto-purge pour trouver les broadcasts
 * du scheduler à supprimer.
 */
export async function pinataListPins(
  jwt: string,
  opts: { metadataFilter?: Record<string, string>; pageLimit?: number } = {},
): Promise<PinataPinInfo[]> {
  const params = new URLSearchParams({
    status:    'pinned',
    pageLimit: String(opts.pageLimit ?? 1000),
  })
  if (opts.metadataFilter) {
    // Pinata expects nested JSON in querystring
    const filter: Record<string, { value: string; op: 'eq' }> = {}
    for (const [k, v] of Object.entries(opts.metadataFilter)) {
      filter[k] = { value: v, op: 'eq' }
    }
    params.set('metadata[keyvalues]', JSON.stringify(filter))
  }

  const url = `${PINATA_LIST_URL}?${params.toString()}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}` },
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '(no body)')
    throw new Error(`Pinata list HTTP ${res.status}: ${errBody}`)
  }
  const json = await res.json() as {
    rows: Array<{
      ipfs_pin_hash: string
      size:          number
      date_pinned:   string
      metadata:      { name?: string; keyvalues?: Record<string, string> }
    }>
  }
  return json.rows.map(r => ({
    cid:        r.ipfs_pin_hash,
    size:       r.size,
    datePinned: r.date_pinned,
    metadata:   r.metadata,
  }))
}

/**
 * Supprime un pin du compte. Le CID reste accessible sur le réseau IPFS
 * tant qu'au moins un autre nœud le pin, mais pour Pinata il libère le
 * stockage (et donc le quota).
 *
 * Spring 2026 : utilisé par l'auto-purge pour rester sous le 1 GB free tier.
 */
export async function pinataUnpin(jwt: string, cid: string): Promise<void> {
  const res = await fetch(`${PINATA_UNPIN_URL}/${cid}`, {
    method:  'DELETE',
    headers: { Authorization: `Bearer ${jwt}` },
  })
  if (!res.ok && res.status !== 404) {
    // 404 = déjà supprimé, on ignore
    const errBody = await res.text().catch(() => '(no body)')
    throw new Error(`Pinata unpin HTTP ${res.status}: ${errBody}`)
  }
}

/**
 * Auto-purge : supprime tous les broadcasts taggés `source=infinity-broadcast-scheduler`
 * dont la `date` n'est PAS dans `keepDates`. Retourne {pruned, freedBytes}.
 *
 * Politique typique : keepDates = [J-1, J, J+1] (= retention 3 jours, suffit
 * pour overlap entre J et J+1 + grace period).
 */
export async function purgeOldBroadcasts(
  jwt: string,
  keepDates: Set<string>,
): Promise<{ pruned: number; freedBytes: number; errors: string[] }> {
  const pins = await pinataListPins(jwt, {
    metadataFilter: { source: 'infinity-broadcast-scheduler' },
  })
  let pruned = 0
  let freedBytes = 0
  const errors: string[] = []
  for (const pin of pins) {
    const date = pin.metadata.keyvalues?.date
    if (date && keepDates.has(date)) continue   // garde
    try {
      await pinataUnpin(jwt, pin.cid)
      pruned++
      freedBytes += pin.size
    } catch (err) {
      errors.push(`${pin.cid.slice(0, 10)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { pruned, freedBytes, errors }
}
