/**
 * @module InfinityScheduler/Lib/EnVol
 * @description 🚀 Garder k travaux EN VOL chez data-space, sans perdre l'ordre des tours.
 *
 *   Un seul tour à la fois laissait leur station chômer ~80 % du temps : data-space répond
 *   `429 not_ready` (« reviens dans 30 s ») pour un calcul de ~5 s. 30 tours = 15 min au lieu de 3.
 *   Avec k requêtes en attente chez eux, leur GPU enchaîne ; chacune reste re-postée À L'IDENTIQUE,
 *   comme le veut leur contrat. k = 3 (proposé à data-space le 14/09/2026).
 *
 *   Contrat : `remplir(i)` lance le tour i (s'il doit l'être) puis les suivants jusqu'à k en vol ;
 *   `prendre(i)` rend SA promesse et libère sa place. Une promesse rejetée avant d'être prise ne
 *   fait JAMAIS de rejet non géré : l'erreur est relue quand vient son tour, et l'appelant décide
 *   du repli comme avant.
 */
export interface FileEnVol<T> {
  remplir(i: number): void
  prendre(i: number): Promise<T>
  enVol(): number
}

export function fileEnVol<T>(
  total: number,
  k: number,
  aLancer: (i: number) => boolean,
  lancer: (i: number) => Promise<T>,
): FileEnVol<T> {
  const max = Math.max(1, Math.floor(k) || 1)
  const enCours = new Map<number, Promise<T>>()
  const demarrer = (i: number) => {
    if (i < 0 || i >= total || enCours.has(i) || !aLancer(i)) return
    const promesse = lancer(i)
    promesse.catch(() => { /* relue par prendre(i) : pas de rejet non géré */ })
    enCours.set(i, promesse)
  }
  return {
    remplir(i) {
      demarrer(i)  // le tour courant part toujours, même file pleine : on en a besoin MAINTENANT
      for (let j = i + 1; j < total && enCours.size < max; j++) demarrer(j)
    },
    prendre(i) {
      demarrer(i)
      const promesse = enCours.get(i)
      if (!promesse) return Promise.reject(new Error(`tour ${i} : rien à synthétiser`))
      return promesse.finally(() => enCours.delete(i))
    },
    enVol: () => enCours.size,
  }
}
