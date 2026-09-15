#!/usr/bin/env python3
"""voix_jt.py HORS GPU — Chatterbox, Whisper, torch et torchaudio simulés (numpy seul), sur des répliques dont une de
plus de 30 s. Ce qui a fait tomber les 26 voix du 2e essai réel (15/09/2026 : Whisper refuse plus de 30 s d'un bloc)
se voit ici sans louer de machine. À lancer AVANT toute location, là où il y a numpy (le hub) :

  python3 voix_simulee.py [DOSSIER_DE_voix_jt.py]      → code 0 si toutes les voix sortent, 1 sinon
"""
import json, os, runpy, shutil, sys, tempfile, types

import numpy as np

ICI = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__)))
SR = 24000
DERNIER = {"texte": ""}


class T:
    """Le peu de torch.Tensor dont voix_jt.py se sert."""
    def __init__(self, a):
        self.a = np.asarray(a, dtype=np.float32)

    shape = property(lambda self: self.a.shape)

    def reshape(self, *s):
        return T(self.a.reshape(*s))

    def float(self):
        return self

    def cpu(self):
        return self

    def detach(self):
        return self

    def numpy(self):
        return self.a

    def unsqueeze(self, d):
        return T(np.expand_dims(self.a, d))


torch = types.ModuleType("torch")
torch.float16 = "float16"
torch.manual_seed = lambda s: np.random.seed(s % (2 ** 32))
torch.zeros = lambda *s: T(np.zeros(s, dtype=np.float32))
torch.cat = lambda liste, dim=0: T(np.concatenate([x.a for x in liste], axis=dim))
torch.from_numpy = T
torchaudio = types.ModuleType("torchaudio")
torchaudio.save = lambda chemin, t, sr: open(chemin, "wb").write(b"RIFF" + t.a[:, :16].tobytes())


class TTS:
    """Une « voix » : par mot, une syllabe de 0,18 s et un blanc de 0,18 s (0,36 s par mot), puis un souffle de queue
    que nettoyage.py doit couper."""
    sr = SR

    @classmethod
    def from_pretrained(cls, device):
        return cls()

    def generate(self, texte, **_):
        DERNIER["texte"] = texte
        syllabe = 0.3 * np.sin(np.linspace(0, 2 * np.pi * 180 * 0.18, int(0.18 * SR)))
        morceaux = [x for _ in texte.split() for x in (syllabe, np.zeros(int(0.18 * SR)))]
        morceaux.append(0.004 * np.random.randn(int(0.5 * SR)))
        return T(np.concatenate(morceaux)[None, :])


# Comme le vrai Whisper du 2e essai réel (15/09) : il écrit les sigles et les noms à sa façon.
A_SA_FACON = {"NAW": "Nao", "UERSS": "U.R.S.S.", "sssoyez": "soyez", "Machuman": "Mac Human"}


def pipeline(*_, **__):
    def ecoute(entree, return_timestamps=False, generate_kwargs=None):
        if len(entree["raw"]) > 30 * entree["sampling_rate"] and not return_timestamps:   # comme le vrai Whisper
            raise ValueError("You have passed more than 3000 mel input features (> 30 seconds) which automatically "
                             "enables long-form generation which requires the model to predict timestamp tokens.")
        texte = DERNIER["texte"]
        for juste, entendu in A_SA_FACON.items():
            texte = texte.replace(juste, entendu)
        return {"text": texte}
    return ecoute


mtl = types.ModuleType("chatterbox.mtl_tts")
mtl.ChatterboxMultilingualTTS = TTS
cb = types.ModuleType("chatterbox")
cb.mtl_tts = mtl
tr = types.ModuleType("transformers")
tr.pipeline = pipeline
sys.modules.update({"torch": torch, "torchaudio": torchaudio, "chatterbox": cb, "chatterbox.mtl_tts": mtl, "transformers": tr})

REPLIQUES = [
    # ≈ 38 s une fois dite : le sommaire du 2e essai réel dépassait 30 s
    {"cle": "ouverture", "texte": " ".join(["Bonsoir, et sssoyez les bienvenus dans le Journal de Freeworld TV."] * 9),
     "voix": "x.wav", "exa": 0.5, "cfg": 0.45},
    {"cle": "s01-lancement", "texte": "Premier sujet ce soir, devant un Machuman. Pistache, vous êtes sur place ?",
     "voix": "x.wav", "exa": 0.6, "cfg": 0.35},
    {"cle": "s02-question", "texte": "Monsieur Lardon, que craignez-vous pour vos Bipèdes ?", "voix": "x.wav", "exa": 0.6, "cfg": 0.35},
    # les sigles que Whisper écrit à sa façon ne sont pas des mots perdus : ni nouvel essai, ni fausse alerte
    {"cle": "s03-terrain", "texte": "Oui Iggy ! Le NAW a dépêché trois moutons bleus. L'UERSS réclame un formulaire, sous "
     "l'œil nerveux du NAW.", "voix": "x.wav", "exa": 0.6, "cfg": 0.35},
]

dossier = tempfile.mkdtemp(prefix="voix-simulee-")
os.makedirs(os.path.join(dossier, "entrees"))
json.dump(REPLIQUES, open(os.path.join(dossier, "entrees", "repliques.json"), "w", encoding="utf-8"), ensure_ascii=False)
shutil.copy(os.path.join(ICI, "nettoyage.py"), dossier)
os.chdir(dossier)
sys.path.insert(0, dossier)
plantage = None
try:
    runpy.run_path(os.path.join(ICI, "voix_jt.py"), run_name="__main__")
except SystemExit as e:
    plantage = None if not e.code else f"sortie {e.code}"
except Exception as e:
    plantage = f"{type(e).__name__} : {str(e)[:160]}"
sorties = sorted(f for f in os.listdir("resultats/voix") if f.endswith(".wav")) if os.path.isdir("resultats/voix") else []
rapport = [json.loads(ligne) for ligne in open("resultats/voix/rapport.jsonl")] if os.path.exists("resultats/voix/rapport.jsonl") else []
os.chdir("/")
shutil.rmtree(dossier, ignore_errors=True)
bon = (plantage is None and len(sorties) == len(REPLIQUES)
       and all(r.get("ok") and not r.get("douteux") and set(r.get("essais", [1])) == {1} for r in rapport))
print(("✅" if bon else "🔴") + f" voix_jt.py simulé : {len(sorties)}/{len(REPLIQUES)} voix"
      + (f" · PLANTAGE {plantage}" if plantage else "")
      + " · " + "; ".join(f"{r['cle']} {r.get('duree', '?')} s ok={r.get('ok')} douteux={r.get('douteux')} essais={r.get('essais')}"
                          for r in rapport))
sys.exit(0 if bon else 1)
