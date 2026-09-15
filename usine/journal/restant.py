#!/usr/bin/env python3
"""Combien reste-t-il à faire ? (voix | images | plans) — pour qu'une machine de REPRISE saute les étapes finies.

Une machine interruptible reprise en pleine nuit est remplacée ; l'orchestre rapporte tout ce qui était fini sur la
suivante. Sans ce compte, elle réinstallerait Chatterbox et retéléchargerait 58 Go de Qwen-Image-Edit pour rien.
Un plan dont une entrée manque (voix ratée 5 fois, image absente) n'est plus « à faire » : il est impossible.

« lots N » répartit les plans faisables en N lots d'égale durée de voix, un par carte de la machine louée (animer.sh) :
le calcul de LongCat en est proportionnel (~30 s par seconde de voix). Fondateur, 15/09/2026 : « comment limiter le coût et
la durée ? » — ce soir-là, des machines à 4 cartes H100 se louaient 0,40 $/h la carte.

  python3 restant.py voix|images|plans|plans-tous      (depuis le dossier du travail)
  python3 restant.py lots N                            → entrees/lots/lot-<k>.json, affiche le nombre de lots non vides
"""
import json, os, sys


def faisable(p):
    return not os.path.exists(f"resultats/clips/{p['cle']}.mp4") and all(os.path.exists(c) for c in [p["image"], *p["voix"]])


def duree_wav(chemin):
    """Durée d'un .wav lue dans son en-tête — PCM ou flottant : le module wave ne lit pas le flottant qu'écrit torchaudio."""
    try:
        with open(chemin, "rb") as f:
            tete = f.read(12)
            if tete[:4] != b"RIFF" or tete[8:12] != b"WAVE":
                return 0.0
            debit = 0
            while True:
                morceau = f.read(8)
                if len(morceau) < 8:
                    return 0.0
                nom, taille = morceau[:4], int.from_bytes(morceau[4:], "little")
                if nom == b"fmt ":
                    debit = int.from_bytes(f.read(taille)[8:12], "little")
                    if taille & 1:
                        f.seek(1, 1)
                elif nom == b"data":
                    return taille / debit if debit else 0.0
                else:
                    f.seek(taille + (taille & 1), 1)
    except OSError:
        return 0.0


quoi = sys.argv[1] if len(sys.argv) > 1 else "plans"
if quoi == "voix":
    liste = json.load(open("entrees/repliques.json", encoding="utf-8"))
    print(sum(not os.path.exists(f"resultats/voix/{r['cle']}.wav") for r in liste))
elif quoi == "images":
    liste = json.load(open("entrees/images.json", encoding="utf-8"))
    print(sum(not os.path.exists(f"resultats/images/{t['cle']}.png") for t in liste))
elif quoi == "plans":
    print(sum(faisable(p) for p in json.load(open("entrees/plans.json", encoding="utf-8"))))
elif quoi == "plans-tous":
    # Les plans pas encore rendus, faisables ou non : c'est CE compte qui décide, au départ, d'installer LongCat — au
    # départ d'une machine neuve, aucune voix n'existe encore, donc aucun plan n'est « faisable » (essai du 15/09).
    liste = json.load(open("entrees/plans.json", encoding="utf-8"))
    print(sum(not os.path.exists(f"resultats/clips/{p['cle']}.mp4") for p in liste))
elif quoi == "lots":
    n = max(1, int(sys.argv[2]) if len(sys.argv) > 2 else 1)
    a_faire = [(sum(duree_wav(v) for v in p["voix"]), p) for p in json.load(open("entrees/plans.json", encoding="utf-8")) if faisable(p)]
    lots = [[0.0, []] for _ in range(min(n, len(a_faire)))]
    for d, p in sorted(a_faire, key=lambda x: -x[0]):   # le plus long d'abord, dans le lot le moins chargé
        lot = min(lots, key=lambda l: l[0])
        lot[0] += d
        lot[1].append(p)
    os.makedirs("entrees/lots", exist_ok=True)
    for f in os.listdir("entrees/lots"):
        os.remove(os.path.join("entrees/lots", f))
    for k, (_, plans) in enumerate(lots):
        json.dump(plans, open(f"entrees/lots/lot-{k}.json", "w", encoding="utf-8"), ensure_ascii=False)
    print(len(lots))
else:
    sys.exit(f"inconnu : {quoi} (voix | images | plans | plans-tous | lots N)")
