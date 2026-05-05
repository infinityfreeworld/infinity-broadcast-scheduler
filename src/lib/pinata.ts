/**
 * @module InfinityScheduler/Pinata
 * @description Upload de fichiers vers IPFS via l'API HTTP de Pinata.
 *   Free tier : 1 GB stockage + 100k requests/mois — largement suffisant
 *   pour 9 stations × 30 min/jour × J-2 retention = ~5 GB stockage MAX
 *   en WAV brut, ~500 MB en Opus (R.7+).
 *
 *   Auth : JWT envoyé en Authorization header.
 *   Doc : https://docs.pinata.cloud/api-reference/endpoint/pin-file
 */

const PINATA_PIN_FILE_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS'

export interface PinataPinResult {
  cid:       string
  size:      number
  timestamp: string
}

/**
 * Upload un Buffer (typiquement audio WAV) sur IPFS via Pinata.
 * Retourne le CID public + métadonnées.
 *
 * @param data        Bytes à pinner
 * @param fileName    Nom de fichier (juste pour les métadonnées Pinata)
 * @param mimeType    MIME (audio/wav, audio/mpeg, audio/ogg…)
 * @param jwt         Pinata JWT (env PINATA_JWT)
 */
export async function pinataPinFile(
  data: Buffer,
  fileName: string,
  mimeType: string,
  jwt: string,
): Promise<PinataPinResult> {
  const blob = new Blob([data], { type: mimeType })
  const formData = new FormData()
  formData.append('file', blob, fileName)
  formData.append('pinataMetadata', JSON.stringify({
    name: fileName,
    keyvalues: { source: 'infinity-broadcast-scheduler' },
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
