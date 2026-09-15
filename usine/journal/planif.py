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
# Des angles qui VARIENT d'un sujet à l'autre (fondateur, 15/09 : « des caméras et angles de vue dynamiques ») — toujours
# assez près pour que LongCat anime la bouche.
ANGLES = ("eye-level medium shot framed from the waist up",
          "slightly low-angle medium shot framed from the waist up",
          "three-quarter view medium shot framed from the waist up, the reporter turned slightly to the side")
TERRAIN = ("Photorealistic documentary photograph, {angle}: the {qui} from the image stands in {decor}, "
           "holding a microphone and facing the camera, reporting live. Keep the character EXACTLY as in the image: same head, same "
           "fur or feathers, same clothes. " + SANS_HUMAIN + " Natural light. " + SANS_TEXTE)
# L'interview se fabrique À PARTIR de l'image du terrain (fondateur, 15/09 : deux décors séparés par une ligne, « pas
# cohérent ») : même lieu, même lumière, même reporter — l'invité y entre.
INTERVIEW = ("Edit the first photograph: keep EXACTLY the same place, the same light and the same {reporter}. Widen the shot a "
             "little so that the reporter stands on the left, turned three-quarters, holding the microphone toward the {invite} from "
             "the second image, who now stands on the right, facing the reporter, in the same place. ONE single continuous photograph "
             "(not a split screen, no frame, no border), both seen from the waist up. Keep both characters EXACTLY as in their "
             "images. " + SANS_HUMAIN + " " + SANS_TEXTE)
# Les plans de coupe (fondateur, 15/09 : « percevoir des humains » en conditions de bétail). Cadre accepté le 15/09 : le miroir
# de l'ÉLEVAGE, jamais celui de l'esclavage humain réel — adultes seulement, de toutes origines, en combinaisons de bétail
# identiques, calmes, en enclos, vus de loin, jamais enchaînés, blessés ni nus ; des animaux en tenue de travail les encadrent.
BETAIL = ("If humans appear, they are livestock in this satirical world ruled by animals: adults only, of all ages and origins, "
          "in identical plain beige overalls, calm, grouped in straw pens or fenced enclosures, seen from a distance, never "
          "chained, never hurt, never naked, no children; animals in work clothes (vests, caps) supervise them.")
COUPE = ("Using the first photograph only as a reference for the PLACE and the light, show the same place from a different camera "
         "angle, WITHOUT the reporter and without any microphone: {coupe}. " + BETAIL + " Photorealistic documentary photograph. "
         + SANS_TEXTE)
COUPE_INTERDIT = re.compile(r"\b(?:child(?:ren)?|kids?|bab(?:y|ies)|toddlers?|chains?|chained|shackles?|whips?|blood|bleeding|"
                            r"naked|nude|slaves?|slavery|auctions?|guns?|weapons?|rifles?|dead|corpses?|slaughter\w*|tortur\w*)\b", re.I)


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


def coupe(v, champ):
    # Un plan de coupe part lui aussi dans une consigne d'image EN ANGLAIS, et jamais hors du cadre fixé par le fondateur.
    v = decor(v, champ)
    m = COUPE_INTERDIT.search(v)
    if m:
        refuse(f"{champ} : « {m.group(0)} » — hors du cadre des plans de coupe (le miroir de l'élevage, jamais de l'esclavage)")
    return v


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

    def plan_iggy(cle, txt, image="entrees/persos/iggy.png"):
        plans.append({"cle": cle, "image": image, "voix": [replique(cle, "iggy", txt)], "prompt": IGGY})

    # L'ouverture part d'un Iggy cadré un peu plus LARGE : la caméra du générique finit son avancée pendant qu'il parle déjà.
    plan_iggy("ouverture", texte(jt.get("sommaire"), "sommaire", 120),
              "entrees/persos/iggy-ouverture.png" if DISTRIBUTION["iggy"].get("image_ouverture") else "entrees/persos/iggy.png")
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
                       "consigne": TERRAIN.format(angle=ANGLES[(k - 1) % len(ANGLES)], qui=rep["qui"],
                                                  decor=decor(s.get("decor"), f"sujet {k} : décor"))})
        plans.append({"cle": f"{n}-terrain", "image": f"resultats/images/{n}-terrain.png",
                      "voix": [replique(f"{n}-terrain", r, texte(s.get("terrain"), f"sujet {k} : terrain"))],
                      "prompt": f"{rep['description']} stands in {decor(s.get('decor'), 'décor')}, holds a microphone and talks to the camera, "
                                "natural mouth movements, documentary style, natural light"})
        seq = {"type": "sujet", "titre": titre, "lieu": lieu, "reporter": r, "lancement": f"{n}-lancement", "terrain": f"{n}-terrain"}
        if s.get("coupe"):   # facultatif : un plan de coupe du lieu, glissé sous la voix du reporter au montage
            images.append({"cle": f"{n}-coupe", "sources": [f"resultats/images/{n}-terrain.png"], "graine": 170 + k, "sorte": "coupe",
                           "consigne": COUPE.format(coupe=coupe(s.get("coupe"), f"sujet {k} : plan de coupe"))})
            seq["coupe"] = f"{n}-coupe"
        itw = s.get("interview")
        if itw:
            i = itw.get("invite"); inv = perso(i, f"sujet {k} : invité", "invite")
            # Même lieu que le terrain : l'image de l'interview en est TIRÉE (le « decor » propre à l'interview n'est plus lu).
            d = decor(s.get("decor"), f"sujet {k} : décor")
            images.append({"cle": f"{n}-interview", "sources": [f"resultats/images/{n}-terrain.png", f"entrees/persos/{i}.png"],
                           "graine": 70 + k, "consigne": INTERVIEW.format(reporter=rep["qui"], invite=inv["qui"])})
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
        if p.get("image_ouverture"):
            shutil.copyfile(os.path.join(FICHIERS, p["image_ouverture"]), os.path.join(e, "persos", f"{qui}-ouverture.png"))
    for nom, contenu in (("repliques", repliques), ("images", images), ("plans", plans)):
        json.dump(contenu, open(os.path.join(e, f"{nom}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for f in ("voix_jt.py", "nettoyage.py", "images_jt.py", "lc_lot.py", "restant.py"):
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
