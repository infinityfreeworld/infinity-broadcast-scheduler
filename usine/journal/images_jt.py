#!/usr/bin/env python3
"""Images du Journal de FREEWORLD TV — chaque reporter dans le décor de SON sujet, à partir de sa photo validée.

Qwen-Image-Edit-2511 + Lightning 4 pas (Apache-2.0, recette des retouches du 14-15/09). Une photo → le reporter seul, en
direct du lieu ; deux photos → l'interview (reporter à GAUCHE, invité à DROITE : LongCat donne la voix 1 à la moitié
gauche). Règle de Freeworld : AUCUN humain (ni caméraman, ni foule) — écrit dans chaque consigne, puis VÉRIFIÉ par le
modèle de vision déjà chargé dans la pipeline (son encodeur de texte est Qwen2.5-VL) ; jusqu'à 3 graines. Depuis le 1er essai
réel (15/09), il vérifie aussi qu'il n'y a AUCUN TEXTE (un faux bandeau d'information était apparu) et UNE seule scène.
REPRISE : une image déjà faite (resultats/images/<clé>.png) n'est pas refaite.

  images.json : [{"cle": "s01-terrain", "sources": ["entrees/persos/oscar.png"], "consigne": "…", "graine": 7}]
"""
import json, os, sys

import torch
from PIL import Image
from diffusers import QwenImageEditPlusPipeline

TRAVAUX = json.load(open("entrees/images.json", encoding="utf-8"))
os.makedirs("resultats/images", exist_ok=True)
A_FAIRE = [t for t in TRAVAUX if not os.path.exists(f"resultats/images/{t['cle']}.png")]
print(f"images : {len(TRAVAUX) - len(A_FAIRE)} déjà faite(s), {len(A_FAIRE)} à faire", flush=True)
if not A_FAIRE:
    sys.exit(0)

pipe = QwenImageEditPlusPipeline.from_pretrained("Qwen/Qwen-Image-Edit-2511", torch_dtype=torch.bfloat16)
pas, cfg = 40, 4.0
try:
    pipe.load_lora_weights("lightx2v/Qwen-Image-Edit-2511-Lightning", weight_name="Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors")
    pas, cfg = 4, 1.0
except Exception as e:
    print("lightning indisponible → 40 pas :", str(e)[:200], flush=True)
if torch.cuda.get_device_properties(0).total_memory > 75e9:
    pipe.to("cuda")
else:
    pipe.enable_model_cpu_offload()   # 48 Go : le transformeur (41 Go) et l'encodeur passent l'un après l'autre

QUESTIONS = {
    "humain": ("Apart from animals and animal characters wearing clothes, is there any real human being with a human face "
               "anywhere in this image, even small or in the background? Answer only yes or no."),
    # 1er essai réel (15/09) : l'interview est sortie avec un faux bandeau d'information en lettres illisibles…
    "texte": ("Is there any visible text, letters, numbers, captions, subtitles, a news banner, a logo or any on-screen "
              "graphics anywhere in this image? Answer only yes or no."),
    # … et en deux photos collées côte à côte.
    "decoupe": ("Is this image a split screen, a collage, or two separate pictures side by side, rather than one single "
                "continuous scene? Answer only yes or no."),
    # Les plans de coupe « bétail » (fondateur, 15/09) : des Bipèdes y sont PERMIS — jamais un enfant, une chaîne, une arme,
    # du sang ni de la nudité : le miroir de l'ÉLEVAGE, pas celui de l'esclavage humain réel.
    "interdit": ("Is there a child, a chain or shackle, a whip, a weapon, blood, a wound, or nudity anywhere in this image? "
                 "Answer only yes or no."),
}
# Ce que chaque sorte d'image doit respecter : un personnage (reporter, interview) n'a AUCUN humain autour de lui ; un plan
# de coupe peut montrer des Bipèdes, dans le cadre fixé par le fondateur.
REGLES = {"personnage": ("humain", "texte", "decoupe"), "coupe": ("interdit", "texte", "decoupe")}


def controle(img, sorte="personnage"):
    """Chaque règle de cette sorte d'image, posée à Qwen2.5-VL (déjà en mémoire) : {règle: True (faute) | False | None}."""
    return {nom: demander(img, QUESTIONS[nom]) for nom in REGLES.get(sorte, REGLES["personnage"])}


def demander(img, question):
    """Oui ou non ? None = contrôle impossible."""
    try:
        msgs = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": question}]}]
        texte = pipe.processor.apply_chat_template(msgs, add_generation_prompt=True)
        e = pipe.processor(text=[texte], images=[img], return_tensors="pt").to(pipe._execution_device)
        sortie = pipe.text_encoder.generate(**e, max_new_tokens=3, do_sample=False)
        rep = pipe.processor.batch_decode(sortie[:, e["input_ids"].shape[1]:], skip_special_tokens=True)[0]
        return rep.strip().lower().startswith("yes")
    except Exception as ex:
        print("contrôle des humains impossible :", str(ex)[:160], flush=True)
        return None


controles = open("resultats/images/controle.jsonl", "a", encoding="utf-8")
for t in A_FAIRE:
    sources = [Image.open(s).convert("RGB") for s in t["sources"]]
    for k in range(3):
        graine = t.get("graine", 1) + 101 * k
        img = pipe(image=sources, prompt=t["consigne"], negative_prompt=" ", true_cfg_scale=cfg, guidance_scale=1.0,
                   num_inference_steps=pas, height=768, width=1376, generator=torch.Generator("cpu").manual_seed(graine)).images[0]
        verdict = controle(img, t.get("sorte", "personnage"))
        print(f"image {t['cle']} graine {graine} : "
              + ", ".join(f"{n} {'?' if v is None else ('OUI' if v else 'non')}" for n, v in verdict.items()), flush=True)
        if not any(v is True for v in verdict.values()):
            break
    else:
        fautes = ", ".join(n for n, v in verdict.items() if v)
        print(f"⚠ image {t['cle']} : {fautes} encore après 3 graines — gardée, à REGARDER avant diffusion", flush=True)
    controles.write(json.dumps({"cle": t["cle"], "graine": graine, **verdict}) + "\n"); controles.flush()
    partiel = f"resultats/images/.{t['cle']}.png"   # renommée seulement une fois écrite en entier (reprise sûre)
    img.save(partiel)
    os.replace(partiel, f"resultats/images/{t['cle']}.png")
print("images : fini", flush=True)
