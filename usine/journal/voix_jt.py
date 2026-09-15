#!/usr/bin/env python3
"""Voix du Journal de FREEWORLD TV — Chatterbox 0.1.7 multilingue (= la production), sur la machine louée.

Chaque réplique de entrees/repliques.json est dite avec la voix INVENTÉE de son personnage (référence .wav du casting).
REPRISE : une réplique déjà rendue (resultats/voix/<clé>.wav) n'est pas refaite (machines interruptibles).

CONTRÔLE QUALITÉ EN AMONT (fondateur, 15/09/2026 : « des moments de vide avec des artefacts sonores »). Mesuré sur le 1er
essai : 13 s de pauses NON silencieuses sur 98 s de voix (souffles, marmonnements entre −55 et −30 dB, que la porte de
bruit du montage laisse passer), et une réplique de 15 s dite en 27 s. Tout se corrige ICI, avant l'animation — les lèvres
suivent ce son-là : le retoucher après le montage les décalerait.
  1. PHRASE PAR PHRASE : Chatterbox s'emballe bien moins sur une phrase courte. Chaque phrase a ses gardes — la durée
     (0,5 à 1,6 fois l'attendu, mesurée APRÈS nettoyage) et l'écoute (Whisper : au plus UN mot de travers par tranche de
     dix, et le DERNIER mot bien entendu : « des mots et paroles coupés », fondateur, 15/09) —, 5 essais, le meilleur gardé.
  2. NETTOYAGE (nettoyage.py, numpy seul, éprouvé sur les voix réelles du 1er essai) : silences de tête et de queue coupés ;
     toute pause de plus de 0,18 s devient un VRAI silence, de 0,30 s au plus ; les phrases sont recollées avec une pause
     propre (0,28 s, 0,40 s après « ? » et « ! »).
  3. RAPPORT : resultats/voix/rapport.jsonl, une ligne par réplique (durée, phrases, essais, pauses nettoyées, bruit
     restant, mots de travers, « douteux ») ; l'usine alerte sur ce qui reste douteux.
  4. ROBUSTESSE (2e essai réel, 15/09 : un sommaire de plus de 30 s réécouté d'un bloc a fait planter Whisper, et avec lui
     les 26 voix) : la réplique n'est plus réécoutée d'un bloc, l'écoute ne fait jamais tomber une voix, et une réplique
     qui plante ne fait sauter QUE son plan. Éprouvé hors GPU par voix_simulee.py (Chatterbox, Whisper et torch simulés).

  repliques.json : [{"cle": "s01-lancement", "texte": "…", "voix": "entrees/refs/iggy.wav", "exa": 0.5, "cfg": 0.45}]
"""
import json, math, os, re, sys, time, unicodedata

import torch
import torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

import nettoyage

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


def phrases(texte):
    """Découpée aux fins de phrase ; un fragment de moins de trois mots rejoint la phrase suivante."""
    sortie = []
    for m in (m.strip() for m in re.split(r"(?<=[.!?…])\s+", texte.strip())):
        if not m:
            continue
        if sortie and len(mots(sortie[-1])) < 3:
            sortie[-1] = f"{sortie[-1]} {m}"
        else:
            sortie.append(m)
    return sortie or [texte]


def nettoyer(wav, sr):
    """nettoyage.nettoyer (numpy) sur un tenseur : (son, pauses nettoyées, secondes de pause retirées)."""
    son, n, retire = nettoyage.nettoyer(wav.reshape(-1).float().cpu().numpy(), sr)
    return torch.from_numpy(son).unsqueeze(0), n, retire


def bruit_restant(wav, sr):
    return nettoyage.bruit_restant(wav.reshape(-1).float().cpu().numpy(), sr)


def ecouter(wav, texte):
    """Whisper réécoute : (taux de mots de travers, dernier mot entendu ?) — (None, None) sans Whisper ou s'il échoue :
    l'écoute conseille, elle ne fait jamais tomber une voix. Au-delà de 30 s, Whisper exige le mode « horodaté »."""
    if ecoute is None:
        return None, None
    son = wav.reshape(-1).cpu().numpy()
    try:
        lu = ecoute({"raw": son, "sampling_rate": tts.sr}, return_timestamps=len(son) > 28 * tts.sr,
                    generate_kwargs={"language": "french"})["text"]
    except Exception as e:
        print("écoute Whisper en échec, garde de durée seule :", str(e)[:160], flush=True)
        return None, None
    ref, entendu = mots(texte), mots(lu)
    return ecart(texte, lu), (not ref or ref[-1] in entendu[-3:])


def dire(phrase, r):
    """Une phrase : 5 essais au plus, le meilleur gardé. Rend un dict (son, note, essais, nettoyées, retiré, faux, fin).
    Acceptée : durée plausible, au plus un mot de travers par tranche de dix, et le DERNIER mot entendu — une fin avalée
    (par Chatterbox ou par le nettoyage) s'entend comme un mot coupé. L'ancienne tolérance (un mot sur quatre) laissait
    passer trois mots perdus dans une phrase de douze."""
    n = len(mots(phrase))
    cible = max(0.8, n * 0.36)
    permis = max(1, n // 10) / max(1, n)
    meilleur = None
    for essai in range(1, 6):
        torch.manual_seed(100 * essai + len(phrase))
        brut = tts.generate(phrase, language_id="fr", audio_prompt_path=r["voix"], exaggeration=r["exa"],
                            cfg_weight=r["cfg"], temperature=r.get("temp", 0.8)).detach().cpu()
        son, nettoyees, retire = nettoyer(brut, tts.sr)
        d = son.shape[-1] / tts.sr
        bonne = 0.5 <= d / cible <= 1.6
        faux, fin = ecouter(son, phrase) if bonne else (None, None)
        note = (0 if bonne else 10) + (faux or 0) + (0.5 if fin is False else 0) + 0.1 * abs(math.log(max(d, 0.01) / cible))
        if meilleur is None or note < meilleur["note"]:
            meilleur = {"son": son, "note": note, "essais": essai, "nettoyees": nettoyees, "retire": retire, "faux": faux, "fin": fin}
        if bonne and (faux is None or (faux <= permis + 1e-9 and fin)):
            break
    return meilleur


ratees = []
rapport = open("resultats/voix/rapport.jsonl", "a", encoding="utf-8")


def noter(ligne):
    rapport.write(json.dumps(ligne, ensure_ascii=False) + "\n")
    rapport.flush()


def faire(r):
    morceaux, bilan = [], []
    liste = phrases(r["texte"])
    for k, ph in enumerate(liste):
        p = dire(ph, r)
        bilan.append(p)
        if p["note"] >= 10:
            ratees.append(r["cle"])
            print(f"🔴 voix {r['cle']} : une phrase reste emballée ou coupée après 5 essais — son plan sautera", flush=True)
            noter({"cle": r["cle"], "ok": False, "douteux": True})
            return
        morceaux.append(p["son"])
        if k < len(liste) - 1:   # la pause entre deux phrases : propre, et plus longue après une question ou une exclamation
            morceaux.append(torch.zeros(1, int((0.40 if ph.rstrip().endswith(("?", "!")) else 0.28) * tts.sr)))
    ligne = torch.cat(morceaux, dim=1)
    d = ligne.shape[-1] / tts.sr
    attendu = len(mots(r["texte"])) * 0.36
    reste = bruit_restant(ligne, tts.sr)
    # Le taux de la réplique : celui de ses phrases, pondéré par leurs mots — plus de réécoute d'un bloc (au-delà de 30 s,
    # c'est ce qui a fait tomber les 26 voix du 2e essai réel).
    notes = [(p["faux"], len(mots(ph))) for p, ph in zip(bilan, liste) if p["faux"] is not None]
    faux = sum(f * n for f, n in notes) / max(1, sum(n for _, n in notes)) if notes else None
    fins = sum(1 for p in bilan if p.get("fin") is False)   # phrases gardées malgré une fin avalée (5 essais ratés)
    douteux = (faux is not None and faux > 0.15) or fins > 0 or reste > 0.3 or not 0.6 <= d / max(attendu, 0.8) <= 1.5
    note = {"cle": r["cle"], "ok": True, "duree": round(d, 2), "attendu": round(attendu, 2), "phrases": len(liste),
            "essais": [p["essais"] for p in bilan], "pauses_nettoyees": sum(p["nettoyees"] for p in bilan),
            "secondes_retirees": round(sum(p["retire"] for p in bilan), 2), "bruit_restant": reste,
            "mots_de_travers": None if faux is None else round(faux, 2), "fins_avalees": fins, "douteux": douteux}
    print(f"voix {r['cle']} : {d:.1f} s pour {attendu:.1f} attendues, {len(liste)} phrase(s), essais {note['essais']}, "
          f"{note['pauses_nettoyees']} pause(s) nettoyée(s), bruit restant {reste} s{' — DOUTEUX' if douteux else ''}", flush=True)
    noter(note)
    partiel = f"resultats/voix/.{r['cle']}.wav"   # renommé seulement une fois écrit en entier (reprise sûre)
    ta.save(partiel, ligne, tts.sr)
    os.replace(partiel, f"resultats/voix/{r['cle']}.wav")


for r in A_FAIRE:
    try:   # une réplique qui plante ne fait plus tomber les autres : son plan seul sautera
        faire(r)
    except Exception as e:
        ratees.append(r["cle"])
        print(f"🔴 voix {r['cle']} : {type(e).__name__} : {str(e)[:200]} — son plan sautera", flush=True)
        noter({"cle": r["cle"], "ok": False, "douteux": True, "erreur": f"{type(e).__name__} : {str(e)[:200]}"})
print(f"voix : fini, {len(ratees)} ratée(s) {ratees}", flush=True)
