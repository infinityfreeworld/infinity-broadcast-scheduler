#!/usr/bin/env python3
"""Voix du Journal de FREEWORLD TV — Chatterbox 0.1.7 multilingue (= la production), sur la machine louée.

Chaque réplique de entrees/repliques.json est dite avec la voix INVENTÉE de son personnage (référence .wav du casting).
REPRISE : une réplique déjà rendue (resultats/voix/<clé>.wav) n'est pas refaite — une machine interruptible peut être
reprise en cours de route, l'usine rapporte alors sur la machine suivante tout ce qui était fini.
Deux gardes, 5 essais au plus, le meilleur essai est gardé :
  · la DURÉE (leçon de la radio, 14/09) : un rendu emballé (× 2) ou coupé (moins de la moitié) est refait ;
  · l'ÉCOUTE : Whisper relit la phrase ; plus d'un mot sur quatre de travers → refaite.

  repliques.json : [{"cle": "s01-lancement", "texte": "…", "voix": "entrees/refs/iggy.wav", "exa": 0.5, "cfg": 0.45}]
"""
import json, os, re, sys, time, unicodedata

import torch
import torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

REPS = json.load(open("entrees/repliques.json", encoding="utf-8"))
os.makedirs("resultats/voix", exist_ok=True)
A_FAIRE = [r for r in REPS if not os.path.exists(f"resultats/voix/{r['cle']}.wav")]
print(f"voix : {len(REPS) - len(A_FAIRE)} déjà rendue(s), {len(A_FAIRE)} à faire", flush=True)
if not A_FAIRE:
    sys.exit(0)

for essai in range(1, 6):
    try:
        tts = ChatterboxMultilingualTTS.from_pretrained(device="cuda")
        break
    except Exception as e:
        print("chatterbox : téléchargement raté, essai", essai, str(e)[:160], flush=True)
        time.sleep(20 * essai)
else:
    raise SystemExit("Chatterbox introuvable après 5 essais")

try:
    from transformers import pipeline
    ecoute = pipeline("automatic-speech-recognition", model="openai/whisper-large-v3-turbo", torch_dtype=torch.float16, device="cuda")
except Exception as e:
    ecoute = None
    print("écoute Whisper indisponible, garde de durée seule :", str(e)[:160], flush=True)


def mots(t):
    t = unicodedata.normalize("NFKD", t.lower())
    return re.findall(r"[a-z0-9]+", "".join(c for c in t if not unicodedata.combining(c)))


def ecart(ref, lu):
    """Taux de mots de travers (distance d'édition sur les mots)."""
    a, b = mots(ref), mots(lu)
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, y in enumerate(b, 1):
            p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (x != y))
    return d[len(b)] / max(1, len(a))


ratees = []
for r in A_FAIRE:
    cible = len(mots(r["texte"])) * 0.36
    meilleur = None
    for essai in range(1, 6):
        torch.manual_seed(100 * essai + len(r["cle"]))
        wav = tts.generate(r["texte"], language_id="fr", audio_prompt_path=r["voix"], exaggeration=r["exa"],
                           cfg_weight=r["cfg"], temperature=r.get("temp", 0.8))
        d = wav.shape[-1] / tts.sr
        bonne_duree = 0.5 <= d / cible <= 2.0
        faux = None
        if ecoute is not None and bonne_duree:
            lu = ecoute({"raw": wav.squeeze(0).cpu().numpy(), "sampling_rate": tts.sr}, generate_kwargs={"language": "french"})["text"]
            faux = ecart(r["texte"], lu)
        note = (0 if bonne_duree else 10) + (faux or 0)
        print(f"voix {r['cle']} essai {essai} : {d:.1f} s pour {cible:.1f} attendues, mots de travers "
              f"{'?' if faux is None else f'{faux:.0%}'}", flush=True)
        if meilleur is None or note < meilleur[0]:
            meilleur = (note, wav)
        if bonne_duree and (faux is None or faux <= 0.25):
            break
    if meilleur[0] >= 10:
        ratees.append(r["cle"])
        print(f"🔴 voix {r['cle']} : durée toujours fausse après 5 essais — son plan sautera", flush=True)
        continue
    partiel = f"resultats/voix/.{r['cle']}.wav"   # renommé seulement une fois écrit en entier (reprise sûre)
    ta.save(partiel, meilleur[1], tts.sr)
    os.replace(partiel, f"resultats/voix/{r['cle']}.wav")
print(f"voix : fini, {len(ratees)} ratée(s) {ratees}", flush=True)
