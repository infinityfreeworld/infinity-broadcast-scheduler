#!/usr/bin/env python3
"""Planificateur du Journal de FREEWORLD TV — sur le hub : la commande du jour (jt.json) → un dossier de travail d'usine.

La commande vient du générateur (texte écrit par le LLM, avec la ligne éditoriale et les garde-fous de Freeworld). Elle
est RELUE ici comme une entrée étrangère : seuls les personnages de la distribution, des textes bornés, des clés sûres.
Sortie, dans DOSSIER : travail.sh, entrees/{repliques,images,plans}.json, refs/, persos/, les scripts, et jt.json (que le
montage relira pour l'ordre des séquences, les bandeaux et le chapitrage).

  python3 planif.py jt.json DOSSIER

jt.json : {"date": "AAAA-MM-JJ", "sommaire": "…", "au_revoir": "…",
           "sujets": [{"titre": "…", "lancement": "…", "reporter": "oscar", "lieu": "…", "decor": "(anglais) …",
                       "terrain": "…", "interview": {"invite": "gaston", "question": "…", "reponse": "…", "decor": "…"} | null}]}
"""
import json, os, re, shutil, sys

ICI = os.path.dirname(os.path.abspath(__file__))
DISTRIBUTION = json.load(open(os.path.join(ICI, "distribution.json"), encoding="utf-8"))
FICHIERS = os.environ.get("JT_DISTRIBUTION", "/root/usine/journal/distribution")   # voix et photos : hub seulement
MOTS_MAX_REPLIQUE = 80     # ~30 s de parole : au-delà, LongCat dérive (le 15/09, la caméra avançait déjà à 20 s)
MOTS_MAX_JOURNAL = 2600    # ~17 min : le budget GPU du jour
SUJETS_MAX = 14            # 15/09 : un vrai JT, c'est 10 à 13 sujets d'une minute ; à 10, 15 min étaient hors d'atteinte

IGGY = ("A news anchor with a human body in a navy blue suit, light blue shirt and striped tie, and the head of a realistic green iguana "
        "with a spiky crest and orange eyes, sits behind a long light wood news desk in a TV studio with indoor trees and a living "
        "plant wall, talks to the camera, natural mouth movements, studio lighting")
SANS_HUMAIN = "The only characters are animals; there are no human beings anywhere in the image."
# 1er essai réel (15/09) : « TV news interview » a fait dessiner un FAUX bandeau d'information en lettres illisibles, et
# « LEFT half / RIGHT half » deux photos collées. On décrit une PHOTO documentaire d'UNE scène, et l'on bannit tout texte.
SANS_TEXTE = ("Absolutely no text anywhere: no captions, no subtitles, no news banner or lower third, no on-screen graphics, "
              "no logo, no watermark.")
TERRAIN = ("Photorealistic documentary photograph, medium shot framed from the waist up: the {qui} from the image stands in {decor}, "
           "holding a microphone and facing the camera, reporting live. Keep the character EXACTLY as in the image: same head, same "
           "fur or feathers, same clothes. " + SANS_HUMAIN + " Natural light. " + SANS_TEXTE)
INTERVIEW = ("Photorealistic documentary photograph of ONE single continuous scene in {decor} (not a split screen, no frame, no border): "
             "on the left, the {reporter} from the first image holds a microphone toward the {invite} from the second image, who stands "
             "on the right, in the same place and the same light; both are seen from the waist up, turned three-quarters toward the "
             "camera. Keep both characters EXACTLY as in their images. " + SANS_HUMAIN + " " + SANS_TEXTE)


def refuse(msg):
    sys.exit(f"🔴 commande refusée : {msg}")


def texte(v, champ, mots_max=MOTS_MAX_REPLIQUE):
    if not isinstance(v, str) or not v.strip():
        refuse(f"{champ} vide")
    v = re.sub(r"\s+", " ", v).strip()
    n = len(re.findall(r"\w+", v))
    if n > mots_max:
        refuse(f"{champ} : {n} mots (plus de {mots_max})")
    return v


def decor(v, champ):
    # Le décor part dans une consigne d'image EN ANGLAIS : court, sans guillemets ni retour à la ligne.
    v = texte(v, champ, 40)
    return re.sub(r"[\"{}<>]", "", v)


def perso(cle, champ, role):
    p = DISTRIBUTION.get(cle)
    if not isinstance(p, dict) or cle.startswith("_") or role not in p.get("emplois", []):
        refuse(f"{champ} : « {cle} » n'est pas un {role} de la distribution")
    return p


def main(jt_chemin, dossier):
    jt = json.load(open(jt_chemin, encoding="utf-8"))
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(jt.get("date", ""))):
        refuse("date absente ou mal formée")
    sujets = jt.get("sujets")
    if not isinstance(sujets, list) or not 1 <= len(sujets) <= SUJETS_MAX:
        refuse(f"il faut 1 à {SUJETS_MAX} sujets")
    repliques, images, plans, deroule = [], [], [], []
    utilises = {"iggy"}

    def replique(cle, qui, txt):
        p = DISTRIBUTION[qui]
        repliques.append({"cle": cle, "perso": qui, "texte": txt, "voix": f"entrees/refs/{qui}.wav", "exa": p["exa"], "cfg": p["cfg"]})
        utilises.add(qui)
        return f"resultats/voix/{cle}.wav"

    def plan_iggy(cle, txt):
        plans.append({"cle": cle, "image": "entrees/persos/iggy.png", "voix": [replique(cle, "iggy", txt)], "prompt": IGGY})

    plan_iggy("ouverture", texte(jt.get("sommaire"), "sommaire", 120))
    deroule.append({"type": "ouverture", "plan": "ouverture"})
    for k, s in enumerate(sujets, 1):
        if not isinstance(s, dict):
            refuse(f"sujet {k} mal formé")
        n = f"s{k:02d}"
        titre = texte(s.get("titre"), f"sujet {k} : titre", 16)
        r = s.get("reporter"); rep = perso(r, f"sujet {k} : reporter", "reporter")
        lieu = texte(s.get("lieu"), f"sujet {k} : lieu", 12)
        plan_iggy(f"{n}-lancement", texte(s.get("lancement"), f"sujet {k} : lancement"))
        images.append({"cle": f"{n}-terrain", "sources": [f"entrees/persos/{r}.png"], "graine": 7 + k,
                       "consigne": TERRAIN.format(qui=rep["qui"], decor=decor(s.get("decor"), f"sujet {k} : décor"))})
        plans.append({"cle": f"{n}-terrain", "image": f"resultats/images/{n}-terrain.png",
                      "voix": [replique(f"{n}-terrain", r, texte(s.get("terrain"), f"sujet {k} : terrain"))],
                      "prompt": f"{rep['description']} stands in {decor(s.get('decor'), 'décor')}, holds a microphone and talks to the camera, "
                                "natural mouth movements, documentary style, natural light"})
        seq = {"type": "sujet", "titre": titre, "lieu": lieu, "reporter": r, "lancement": f"{n}-lancement", "terrain": f"{n}-terrain"}
        itw = s.get("interview")
        if itw:
            i = itw.get("invite"); inv = perso(i, f"sujet {k} : invité", "invite")
            d = decor(itw.get("decor") or s.get("decor"), f"sujet {k} : décor de l'interview")
            images.append({"cle": f"{n}-interview", "sources": [f"entrees/persos/{r}.png", f"entrees/persos/{i}.png"], "graine": 70 + k,
                           "consigne": INTERVIEW.format(decor=d, reporter=rep["qui"], invite=inv["qui"])})
            q = replique(f"{n}-question", r, texte(itw.get("question"), f"sujet {k} : question", 40))
            a = replique(f"{n}-reponse", i, texte(itw.get("reponse"), f"sujet {k} : réponse", 60))
            plans.append({"cle": f"{n}-interview", "image": f"resultats/images/{n}-interview.png", "voix": [q, a], "audio_type": "add",
                          "prompt": f"In {d}, {rep['description']} on the left holds a microphone toward {inv['description']} on the right; "
                                    "the reporter asks a question, then the guest answers, natural mouth movements, documentary style"})
            seq.update(interview=f"{n}-interview", invite=i)
        deroule.append(seq)
    plan_iggy("fermeture", texte(jt.get("au_revoir"), "au revoir", 60))
    deroule.append({"type": "fermeture", "plan": "fermeture"})
    total = sum(len(re.findall(r"\w+", x["texte"])) for x in repliques)
    if total > MOTS_MAX_JOURNAL:
        refuse(f"{total} mots au total (plus de {MOTS_MAX_JOURNAL})")

    # ── Le dossier de travail ──
    e = os.path.join(dossier, "entrees")
    for sous in ("refs", "persos"):
        os.makedirs(os.path.join(e, sous), exist_ok=True)
    for qui in sorted(utilises):
        p = DISTRIBUTION[qui]
        shutil.copyfile(os.path.join(FICHIERS, p["voix"]), os.path.join(e, "refs", f"{qui}.wav"))
        shutil.copyfile(os.path.join(FICHIERS, p["image"]), os.path.join(e, "persos", f"{qui}.png"))
    for nom, contenu in (("repliques", repliques), ("images", images), ("plans", plans)):
        json.dump(contenu, open(os.path.join(e, f"{nom}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for f in ("voix_jt.py", "images_jt.py", "lc_lot.py", "restant.py"):
        shutil.copyfile(os.path.join(ICI, f), os.path.join(e, f))
    shutil.copyfile(os.path.join(ICI, "travail.sh"), os.path.join(dossier, "travail.sh"))
    json.dump({"date": jt["date"], "deroule": deroule, "personnages": {q: {"nom": DISTRIBUTION[q]["nom"], "role": DISTRIBUTION[q]["role"]}
               for q in sorted(utilises)}}, open(os.path.join(dossier, "montage.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{jt['date']} : {len(sujets)} sujet(s), {len(repliques)} répliques ({total} mots, ~{total * 0.36 / 60:.1f} min), "
          f"{len(images)} image(s), {len(plans)} plan(s) → {dossier}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
