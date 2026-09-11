#!/usr/bin/env python3
"""
Pont Kokoro du planificateur — même contrat que scripts/piper-python.py :
le texte arrive sur stdin, le WAV est écrit dans --output_file.

Pourquoi Kokoro : la station chinoise 自由之声 n'avait AUCUNE voix — la seule
voix Piper chinoise (zh_CN-huayan) n'a pas de licence déclarée, et une voix
française lisant du chinois l'épelait caractère par caractère.

  · modèle  Kokoro-82M v1.1-zh (hexgrad) — poids Apache-2.0, 100 voix
            chinoises natives, données cédées par LongMaoData (龙猫数据) ;
  · moteur  kokoro-onnx (MIT) ;
  · phonèmes misaki (Apache-2.0), G2P chinois version 1.1.

Usage :
  .venv-kokoro/bin/python scripts/kokoro-python.py \\
      --model voices/kokoro/kokoro-v1.1-zh.onnx --voices voices/kokoro/voices-v1.1-zh.bin \\
      --config voices/kokoro/config-v1.1-zh.json --voice zf_001 --output_file sortie.wav < texte.txt
  .venv-kokoro/bin/python scripts/kokoro-python.py --lister --voices voices/kokoro/voices-v1.1-zh.bin
"""
import argparse
import sys
import wave

import numpy as np


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--model')
    ap.add_argument('--voices', required=True)
    ap.add_argument('--config', help='vocabulaire du modèle v1.1-zh (config.json)')
    ap.add_argument('--voice')
    ap.add_argument('--output_file')
    ap.add_argument('--speed', type=float, default=1.0)
    ap.add_argument('--lister', action='store_true', help='affiche les voix disponibles')
    a = ap.parse_args()

    if a.lister:
        print('\n'.join(sorted(np.load(a.voices).keys())))
        return

    for requis in ('model', 'config', 'voice', 'output_file'):
        if not getattr(a, requis):
            sys.exit(f'--{requis} manquant')
    texte = sys.stdin.read().strip()
    if not texte:
        sys.exit('texte vide sur stdin')

    # La phonétique chinoise SUPPRIME les mots en lettres latines (« AI »,
    # « NASA ») — sans rien dire. On le dit, pour que le journal le montre.
    import re
    latines = re.findall(r'[A-Za-z]+', texte)
    if latines:
        print(f"lettres latines ignorées par la phonétique chinoise : {' '.join(latines[:8])}", file=sys.stderr)

    from kokoro_onnx import Kokoro
    from misaki import zh

    phonemes, _ = zh.ZHG2P(version='1.1')(texte)
    if not phonemes:
        sys.exit('aucun phonème produit : le texte est-il bien en chinois ?')
    moteur = Kokoro(a.model, a.voices, vocab_config=a.config)
    echantillons, taux = moteur.create(phonemes, voice=a.voice, speed=a.speed, is_phonemes=True)

    pcm = (np.clip(echantillons, -1.0, 1.0) * 32767).astype('<i2')
    with wave.open(a.output_file, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(taux)
        w.writeframes(pcm.tobytes())


if __name__ == '__main__':
    main()
