/**
 * Cale minimale « à la vitest » au-dessus de `node:test` : les tests du
 * nettoyage et du slogan sont COPIÉS de l'app Infinity (vitest) et doivent
 * rester comparables ligne à ligne. Ce dépôt n'a pas vitest (et n'en veut pas
 * pour deux fichiers) : `describe`, `it`, `it.each` et les quelques `expect`
 * utilisés sont traduits ici. Pas un fichier de test (pas de `.test.ts`).
 */
import { describe as decrire, it as essai } from 'node:test'
import assert from 'node:assert/strict'

export const describe = decrire

type Corps = () => void | Promise<void>

function nommer(gabarit: string, args: readonly unknown[]): string {
  let i = 0
  return gabarit.replace(/%[sjid]/g, (m) => {
    const v = args[i++]
    return m === '%j' ? JSON.stringify(v) : String(v)
  })
}

function chaque<T>(lignes: readonly T[]) {
  return (gabarit: string, corps: (...args: never[]) => void | Promise<void>): void => {
    for (const ligne of lignes) {
      const args = Array.isArray(ligne) ? ligne : [ligne]
      essai(nommer(gabarit, args), () => (corps as (...a: unknown[]) => void | Promise<void>)(...args))
    }
  }
}

export const it = Object.assign((nom: string, corps: Corps) => { essai(nom, corps) }, { each: chaque })

/** `message` : le second argument de vitest, repris dans le message d'échec. */
export function expect(recu: unknown, message?: string) {
  const m = (defaut?: string) => (message ? `${message}${defaut ? ' — ' + defaut : ''}` : defaut)
  return {
    toBe: (attendu: unknown) => assert.strictEqual(recu, attendu, m()),
    toEqual: (attendu: unknown) => assert.deepStrictEqual(recu, attendu, m()),
    toContain: (attendu: string) => assert.ok(String(recu).includes(attendu), m(`« ${String(recu)} » devrait contenir « ${attendu} »`)),
    toMatch: (re: RegExp) => assert.match(String(recu), re, m()),
    toHaveLength: (n: number) => assert.strictEqual((recu as { length: number }).length, n, m()),
    toBeLessThanOrEqual: (n: number) => assert.ok((recu as number) <= n, m(`${String(recu)} > ${n}`)),
    toBeGreaterThanOrEqual: (n: number) => assert.ok((recu as number) >= n, m(`${String(recu)} < ${n}`)),
    not: {
      toBe: (attendu: unknown) => assert.notStrictEqual(recu, attendu, m()),
      toContain: (attendu: string) => assert.ok(!String(recu).includes(attendu), m(`« ${String(recu)} » ne devrait pas contenir « ${attendu} »`)),
      toMatch: (re: RegExp) => assert.doesNotMatch(String(recu), re, m()),
    },
  }
}
