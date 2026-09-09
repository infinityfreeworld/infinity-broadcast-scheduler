#!/usr/bin/env python3
"""Pont Piper — synthèse par la bibliothèque Python.

POURQUOI CE PONT EXISTE
L'archive amont `piper_macos_aarch64.tar.gz` ne contient AUCUNE `.dylib` :
seulement le paquet de symboles `libonnxruntime.1.14.1.dylib.dSYM`, qui
ressemble à une bibliothèque dans un listing et n'en est pas une. Le
binaire réclame trois bibliothèques par @rpath ; brew n'en fournit qu'une.

La synthèse locale était donc IMPOSSIBLE sur ce Mac — ce qui interdisait
toute répétition et, depuis la perte de l'accès GitHub, toute production.
Le paquet Python `piper-tts` embarque son propre onnxruntime : il tourne.

Mesuré le 07/09/2026 : facteur temps réel 0,50× (deux fois plus rapide
que le direct), modèle chargé en 0,8 s.

Usage : piper-python.py --model X.onnx --output_file Y.wav [--sentence_silence S]
        (le texte arrive sur stdin, comme le binaire natif)
"""
import argparse, sys, wave

p = argparse.ArgumentParser()
p.add_argument('--model', required=True)
p.add_argument('--output_file', required=True)
p.add_argument('--sentence_silence', type=float, default=0.05)
a = p.parse_args()

texte = sys.stdin.read().strip()
if not texte:
    print('piper-python: texte vide sur stdin', file=sys.stderr)
    sys.exit(2)

try:
    from piper import PiperVoice, SynthesisConfig
except ImportError as e:
    print(f'piper-python: {e} — venv absent ou incomplet', file=sys.stderr)
    sys.exit(3)

voix = PiperVoice.load(a.model, config_path=a.model + '.json')
try:
    cfg = SynthesisConfig(sentence_silence=a.sentence_silence)
except TypeError:
    cfg = None  # version sans ce réglage : on n'échoue pas pour si peu

with wave.open(a.output_file, 'wb') as w:
    if cfg is not None:
        voix.synthesize_wav(texte, w, syn_config=cfg)
    else:
        voix.synthesize_wav(texte, w)
