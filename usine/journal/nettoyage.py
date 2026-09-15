#!/usr/bin/env python3
"""Nettoyage des voix du Journal de FREEWORLD TV — numpy seul : il s'éprouve sur le hub (sur les voix réelles d'un essai)
et sert tel quel à voix_jt.py sur la machine louée.

Mesuré sur le 1er essai (15/09/2026) : 13 s de pauses NON silencieuses sur 98 s de voix — souffles et marmonnements entre
−55 et −30 dB, que la porte de bruit du montage laisse passer (« des moments de vide avec des artefacts sonores », le
fondateur). Ici : silences de tête et de queue coupés, toute pause de plus de 0,18 s remplacée par un VRAI silence de
0,30 s au plus, 10 ms de fondu au bord de chaque morceau (aucun clic au raccord). Les liaisons courtes entre deux mots
restent intactes.

  python3 nettoyage.py voix.wav [sortie.wav]      (essai : mesure avant / après, via ffmpeg)
"""
import sys

import numpy as np

SEUIL_PAROLE_DB = -38.0   # au-dessus : de la parole ; les artefacts des pauses sont entre −55 et −30 dB
TRAME_S = 0.02
MARGE_S = 0.06            # une fin de mot descend doucement : 60 ms gardées autour de chaque son fort
PAUSE_MIN_S = 0.18        # une pause plus courte reste intacte (la liaison entre deux mots)
PAUSE_MAX_S = 0.30        # une pause plus longue devient un silence de 0,30 s au plus
FONDU_S = 0.01


def energie_db(x, sr):
    trame = int(sr * TRAME_S)
    n = len(x) // trame
    e = (x[: n * trame].reshape(n, trame).astype(np.float64) ** 2).mean(axis=1)
    return 10 * np.log10(np.maximum(e, 1e-12)), trame


def fondu(m, sr):
    n = min(int(FONDU_S * sr), len(m) // 2)
    if n > 1:
        m = m.copy()
        rampe = np.linspace(0.0, 1.0, n, dtype=m.dtype)
        m[:n] *= rampe
        m[-n:] *= rampe[::-1]
    return m


def nettoyer(x, sr):
    """x : son mono en flottants (−1..1). Rend (son nettoyé, pauses nettoyées, secondes de pause retirées)."""
    x = np.asarray(x, dtype=np.float32).reshape(-1)
    e, trame = energie_db(x, sr)
    fort = e > SEUIL_PAROLE_DB
    if not fort.any():
        return x, 0, 0.0
    m = int(MARGE_S / TRAME_S)
    garde = np.convolve(fort.astype(np.int32), np.ones(2 * m + 1, dtype=np.int32), mode="same") > 0
    ou = np.flatnonzero(garde)
    debut, fin = int(ou[0]), int(ou[-1]) + 1
    morceaux, nettoyees, retire, i = [], 0, 0.0, debut
    while i < fin:
        etat, j = bool(garde[i]), i
        while j < fin and bool(garde[j]) == etat:
            j += 1
        duree = (j - i) * TRAME_S
        if etat or duree < PAUSE_MIN_S:
            morceaux.append(fondu(x[i * trame: j * trame], sr))
        else:
            morceaux.append(np.zeros(int(min(duree, PAUSE_MAX_S) * sr), dtype=np.float32))
            nettoyees += 1
            retire += max(0.0, duree - PAUSE_MAX_S)
        i = j
    return np.concatenate(morceaux), nettoyees, retire


def bruit_restant(x, sr):
    """Secondes passées dans du « presque silence » (−55 à −38 dB) par tranches d'au moins 0,3 s : ce qui s'entendrait
    encore entre deux phrases."""
    e, _ = energie_db(np.asarray(x, dtype=np.float32).reshape(-1), sr)
    total, suite = 0.0, 0
    for v in np.append((e > -55) & (e <= SEUIL_PAROLE_DB), False):
        if v:
            suite += 1
        else:
            if suite * TRAME_S >= 0.3:
                total += suite * TRAME_S
            suite = 0
    return round(total, 2)


if __name__ == "__main__":
    import subprocess
    sr = 24000
    brut = np.frombuffer(subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", sys.argv[1], "-ac", "1", "-ar", str(sr),
                                         "-f", "f32le", "-"], capture_output=True, check=True).stdout, dtype=np.float32)
    propre, n, retire = nettoyer(brut, sr)
    print(f"avant : {len(brut) / sr:.1f} s, bruit {bruit_restant(brut, sr)} s · après : {len(propre) / sr:.1f} s, "
          f"bruit {bruit_restant(propre, sr)} s · {n} pause(s) nettoyée(s), {retire:.1f} s retirées")
    if len(sys.argv) > 2:
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-", sys.argv[2]],
                       input=propre.tobytes(), check=True)
