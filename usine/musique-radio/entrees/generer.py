#!/usr/bin/env python3
"""Bibliothèque musicale SOUVERAINE des radios Infinity — ACE-Step 1.5 (MIT), instrumental.
Tourne sur la machine louée (voir travail.sh). Résultats : resultats/<station>-<k>.mp3 + manifeste.jsonl.
Reprise : une piste déjà présente dans resultats/ n'est pas régénérée."""
import json, os, sys, time, shutil, traceback
R = sys.argv[1] if len(sys.argv) > 1 else "/workspace/usine/resultats"
PROJET = sys.argv[2] if len(sys.argv) > 2 else "/workspace/ACE-Step-1.5"
os.makedirs(R, exist_ok=True)
cfg = json.load(open(os.path.join(os.path.dirname(__file__), "stations.json")))
def j(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)
    with open(os.path.join(R, "journal-generation.txt"), "a") as f: f.write(time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a) + "\n")

from acestep.handler import AceStepHandler
from acestep.llm_inference import LLMHandler
from acestep.inference import GenerationParams, GenerationConfig, generate_music

dit = AceStepHandler(); lm = LLMHandler()
t0 = time.time()
dit.initialize_service(project_root=PROJET, config_path="acestep-v15-turbo", device="cuda")
j("DiT prêt en", round(time.time() - t0), "s")
t0 = time.time()
lm_ok = True
try:
    lm.initialize(checkpoint_dir=os.path.join(PROJET, "checkpoints"), lm_model_path="acestep-5Hz-lm-0.6B", backend="pt", device="cuda")
    j("LM prêt en", round(time.time() - t0), "s")
except Exception as e:
    lm_ok = False; j("LM indisponible (", str(e)[:120], ") — génération sans thinking")

durees = cfg["duree_s"]; n = int(cfg["pistes_par_station"])
manifeste = os.path.join(R, "manifeste.jsonl")
faits = 0; rates = 0
for sid, st in cfg["stations"].items():
    for k in range(1, n + 1):
        nom = f"{sid}-{k:02d}"
        cible = os.path.join(R, nom + ".mp3")
        if os.path.exists(cible) and os.path.getsize(cible) > 200_000:
            j("déjà", nom); continue
        duree = durees[(k - 1) % len(durees)]
        seed = 1000 + 100 * list(cfg["stations"]).index(sid) + k
        caption = f"{st['style']}, {cfg['commun']}"
        params = GenerationParams(caption=caption, lyrics="[Instrumental]", instrumental=True, bpm=st.get("bpm"),
                                  duration=float(duree), seed=seed, thinking=lm_ok, vocal_language="unknown")
        config = GenerationConfig(batch_size=1, audio_format="mp3", use_random_seed=False, seeds=[seed])
        t1 = time.time()
        try:
            res = generate_music(dit, lm if lm_ok else None, params, config, save_dir=os.path.join(R, ".tmp-" + nom))
            if not res.success or not res.audios:
                raise RuntimeError(getattr(res, "error", "aucun audio"))
            src = res.audios[0]["path"]
            shutil.move(src, cible)
            shutil.rmtree(os.path.join(R, ".tmp-" + nom), ignore_errors=True)
            octets = os.path.getsize(cible)
            with open(manifeste, "a") as f:
                f.write(json.dumps({"fichier": nom + ".mp3", "station": sid, "titre": f"{st['nom']} — piste {k}", "caption": caption,
                                    "bpm": st.get("bpm"), "duree_demandee_s": duree, "seed": seed, "modele": "ACE-Step/Ace-Step1.5 (acestep-v15-turbo, MIT)",
                                    "octets": octets, "secondes_calcul": round(time.time() - t1, 1)}, ensure_ascii=False) + "\n")
            faits += 1; j("✓", nom, f"{octets/1e6:.1f} Mo en {time.time()-t1:.0f} s")
        except Exception as e:
            rates += 1; j("✗", nom, str(e)[:160]); traceback.print_exc(file=open(os.path.join(R, "erreurs.txt"), "a"))
j("FIN :", faits, "piste(s) produite(s),", rates, "raté(s)")
open(os.path.join(R, "STATUT"), "w").write("ok" if faits > 0 and rates == 0 else ("partiel" if faits > 0 else "echec"))
