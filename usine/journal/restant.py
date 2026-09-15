#!/usr/bin/env python3
"""Combien reste-t-il à faire ? (voix | images | plans) — pour qu'une machine de REPRISE saute les étapes finies.

Une machine interruptible reprise en pleine nuit est remplacée ; l'orchestre rapporte tout ce qui était fini sur la
suivante. Sans ce compte, elle réinstallerait Chatterbox et retéléchargerait 58 Go de Qwen-Image-Edit pour rien.
Un plan dont une entrée manque (voix ratée 5 fois, image absente) n'est plus « à faire » : il est impossible.

  python3 restant.py voix|images|plans      (depuis le dossier du travail)
"""
import json, os, sys

quoi = sys.argv[1] if len(sys.argv) > 1 else "plans"
if quoi == "voix":
    liste = json.load(open("entrees/repliques.json", encoding="utf-8"))
    print(sum(not os.path.exists(f"resultats/voix/{r['cle']}.wav") for r in liste))
elif quoi == "images":
    liste = json.load(open("entrees/images.json", encoding="utf-8"))
    print(sum(not os.path.exists(f"resultats/images/{t['cle']}.png") for t in liste))
elif quoi == "plans":
    n = 0
    for p in json.load(open("entrees/plans.json", encoding="utf-8")):
        if os.path.exists(f"resultats/clips/{p['cle']}.mp4"):
            continue
        if all(os.path.exists(c) for c in [p["image"], *p["voix"]]):
            n += 1
    print(n)
else:
    sys.exit(f"inconnu : {quoi} (voix | images | plans)")
