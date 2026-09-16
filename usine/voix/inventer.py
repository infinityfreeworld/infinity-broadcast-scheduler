#!/usr/bin/env python3
"""Invente des voix à partir d'une description (Qwen3-TTS VoiceDesign).

Fondateur, 16/09/2026 : des voix à essayer pour Nora et Malik (Biogame), et une
réserve de voix françaises à attribuer depuis l'IHL.

    python inventer.py <spec.json> <sortie/> [--lot N --lots M] [--sonde]

- Tourne sur CPU (machines GitHub, sans carte graphique) comme sur GPU.
- Un fichier déjà présent dans <sortie/> est SAUTÉ (reprise possible).
- Écrit sous un nom commençant par un point, puis renomme : un fichier tronqué
  n'est jamais pris pour fini.
- Sortie : WAV PCM 16 bits, MONO, 24 kHz (le format des 31 voix du 14/09), et
  une ligne JSON par voix dans <sortie/>/journal.jsonl (durée, temps de calcul).
"""
import argparse
import json
import os
import subprocess
import sys
import time

import numpy as np
import soundfile as sf
import torch


def charger_modele(depot: str):
    from qwen_tts import Qwen3TTSModel  # importé ici : l'aide s'affiche sans le paquet
    gpu = torch.cuda.is_available()
    kwargs = dict(device_map="cuda:0" if gpu else "cpu", dtype=torch.bfloat16 if gpu else torch.float32)
    print(f"modèle {depot} sur {'GPU' if gpu else 'CPU'}", flush=True)
    return Qwen3TTSModel.from_pretrained(depot, **kwargs)


def generer(modele, texte: str, langue: str, description: str, graine: int):
    torch.manual_seed(graine)
    np.random.seed(graine % (2**32))
    wavs, taux = modele.generate_voice_design(text=texte, language=langue, instruct=description)
    audio = wavs[0] if isinstance(wavs, (list, tuple)) else wavs
    audio = np.asarray(audio, dtype=np.float32).squeeze()
    return audio, int(taux)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("spec")
    p.add_argument("sortie")
    p.add_argument("--lot", type=int, default=0)
    p.add_argument("--lots", type=int, default=1)
    p.add_argument("--sonde", action="store_true", help="une seule voix, pour mesurer")
    a = p.parse_args()

    spec = json.load(open(a.spec, encoding="utf-8"))
    voix = [v for i, v in enumerate(spec["voix"]) if i % a.lots == a.lot]
    if a.sonde:
        voix = voix[:1]
    os.makedirs(a.sortie, exist_ok=True)
    journal = open(os.path.join(a.sortie, "journal.jsonl"), "a", encoding="utf-8")

    t0 = time.time()
    modele = charger_modele(spec["modele"])
    print(f"chargé en {time.time() - t0:.0f} s — {len(voix)} voix dans ce lot", flush=True)

    echecs = 0
    for v in voix:
        final = os.path.join(a.sortie, f"{v['nom']}.wav")
        if os.path.exists(final):
            print(f"= {v['nom']} (déjà là)", flush=True)
            continue
        brut = os.path.join(a.sortie, f".{v['nom']}.brut.wav")
        tmp = os.path.join(a.sortie, f".{v['nom']}.wav")
        t = time.time()
        try:
            graine = sum(map(ord, v["nom"])) * 7919   # stable d'un lancement à l'autre
            audio, taux = generer(modele, spec["texte"], spec["langue"], v["description"], graine)
            sf.write(brut, audio, taux)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", brut,
                            "-ac", "1", "-ar", "24000", "-sample_fmt", "s16", tmp], check=True)
            os.remove(brut)
            os.replace(tmp, final)
            duree = len(audio) / taux
            calcul = time.time() - t
            print(f"✓ {v['nom']} : {duree:.1f} s d'audio en {calcul:.0f} s", flush=True)
            journal.write(json.dumps({"nom": v["nom"], "pour": v.get("pour"), "genre": v["genre"],
                                      "description": v["description"], "duree_s": round(duree, 2),
                                      "calcul_s": round(calcul, 1), "graine": graine}, ensure_ascii=False) + "\n")
            journal.flush()
        except Exception as e:  # une voix ratée n'arrête pas le lot
            echecs += 1
            print(f"✗ {v['nom']} : {type(e).__name__}: {e}", flush=True)
    return 1 if echecs == len(voix) and voix else 0


if __name__ == "__main__":
    sys.exit(main())
