/**
 * 11/09/2026 : Free Press FM a publié à 03:25 et son processus tournait
 * encore à 03:35, retenu par une connexion orpheline vers nostr.mom. La
 * nuit attendait chaque station sans délai.
 *
 * Le test principal REPRODUIT la cause : un programme qui garde une
 * connexion ouverte. Un témoin négatif prouve qu'il reste bloqué sans
 * `terminer` — sinon le test passerait pour une mauvaise raison.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, type Server, type Socket } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { delaiStationMs } from '../sortie'

const SORTIE = resolve(process.cwd(), 'src/lib/sortie.ts')

/** Lance un enfant qui se connecte au serveur, écrit 300 Ko, puis (ou non) appelle terminer. */
async function enfant(port: number, avecTerminer: boolean, attenteMs: number) {
  const d = mkdtempSync(join(tmpdir(), 'sortie-'))
  const f = join(d, 'enfant.ts')
  writeFileSync(f, `
    import { connect } from 'node:net'
    import { terminer } from ${JSON.stringify(SORTIE)}
    const s = connect(${port}, '127.0.0.1')
    s.on('connect', () => {
      process.stdout.write('x'.repeat(300_000) + '\\nPUBLIÉ\\n')
      process.stderr.write('T=' + Date.now() + '\\n')
      ${avecTerminer ? 'terminer(0)' : ''}
    })
  `)
  const p = spawn('npx', ['tsx', f], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
  let sortie = '', erreurs = ''
  p.stdout.on('data', c => { sortie += c })
  p.stderr.on('data', c => { erreurs += c })
  const t0 = Date.now()
  const code = await new Promise<number | null>(res => {
    const garde = setTimeout(() => { p.kill('SIGKILL'); res(null) }, attenteMs)
    p.on('exit', c => { clearTimeout(garde); res(c) })
  })
  const finMs = Date.now()
  rmSync(d, { recursive: true, force: true })
  const appel = Number(/T=(\d+)/.exec(erreurs)?.[1] ?? NaN)
  return { code, sortie, ms: finMs - t0, apresAppelMs: finMs - appel }
}

async function serveur(): Promise<{ srv: Server; port: number; sockets: Socket[] }> {
  const sockets: Socket[] = []
  const srv = createServer(s => { sockets.push(s) })   // ne ferme JAMAIS : comme le relais orphelin
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
  return { srv, port: (srv.address() as { port: number }).port, sockets }
}

test('🔴 une connexion orpheline ne retient plus le script, et la fin du journal arrive entière', async () => {
  const { srv, port, sockets } = await serveur()
  try {
    const r = await enfant(port, true, 20_000)
    assert.equal(r.code, 0, 'le script doit sortir, code 0')
    assert.ok(r.sortie.endsWith('PUBLIÉ\n'), 'la dernière ligne du journal ne doit pas être coupée')
    assert.equal(r.sortie.length, 300_000 + '\nPUBLIÉ\n'.length, 'tout ce qui a été écrit doit arriver')
    // Sortie par le chemin NORMAL, pas par le filet de 5 s : sans cette borne,
    // un terminer() qui ne sortait plus passait inaperçu (mutation relevée).
    assert.ok(r.apresAppelMs < 2_500, `sorti ${r.apresAppelMs} ms après terminer() : c'est le filet qui a joué`)
  } finally { sockets.forEach(s => s.destroy()); srv.close() }
})

test('témoin : SANS terminer, la connexion orpheline retient bien le script', async () => {
  const { srv, port, sockets } = await serveur()
  try {
    const r = await enfant(port, false, 6_000)
    assert.equal(r.code, null, 'sans terminer, le script ne doit PAS sortir — sinon le test ci-dessus ne prouve rien')
  } finally { sockets.forEach(s => s.destroy()); srv.close() }
})

test('délai par station : 90 min par défaut, réglable, jamais nul', () => {
  const avant = process.env.DELAI_STATION_MIN
  try {
    delete process.env.DELAI_STATION_MIN; assert.equal(delaiStationMs(), 90 * 60_000)
    process.env.DELAI_STATION_MIN = '120'; assert.equal(delaiStationMs(), 120 * 60_000)
    process.env.DELAI_STATION_MIN = '0';   assert.equal(delaiStationMs(), 90 * 60_000, '0 désactiverait le filet')
    process.env.DELAI_STATION_MIN = 'x';   assert.equal(delaiStationMs(), 90 * 60_000)
  } finally { if (avant === undefined) delete process.env.DELAI_STATION_MIN; else process.env.DELAI_STATION_MIN = avant }
})

const code = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')

test('generate-broadcast SORT une fois son travail fini', () => {
  assert.match(code('src/scripts/generate-broadcast.ts'), /main\(\)\s*\.then\(\(\) => terminer\(0\)\)/)
})

test('la nuit borne chaque station, et dit qu’elle l’a abandonnée', () => {
  const ga = code('src/scripts/generate-all.ts')
  assert.match(ga, /timeout: delaiStationMs\(\), killSignal: 'SIGTERM'/)
  assert.match(ga, /killed\?: boolean[\s\S]*abandonnée après/)
})
