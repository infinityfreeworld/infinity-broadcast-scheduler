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
import json, os, random, re, shutil, sys

ICI = os.path.dirname(os.path.abspath(__file__))
DISTRIBUTION = json.load(open(os.path.join(ICI, "distribution.json"), encoding="utf-8"))
FICHIERS = os.environ.get("JT_DISTRIBUTION", "/root/usine/journal/distribution")   # voix et photos : hub seulement
MOTS_MAX_REPLIQUE = 80     # ~30 s de parole : au-delà, LongCat dérive (le 15/09, la caméra avançait déjà à 20 s)
# Le terrain peut être plus long (fondateur, 15/09 : « les reportages sont trop courts ») : il est découpé en plans de ~14 s.
MOTS_MAX_TERRAIN = 120
MOTS_MAX_JOURNAL = 2600    # ~17 min : le budget GPU du jour
SUJETS_MAX = 14            # 15/09 : un vrai JT, c'est 10 à 13 sujets d'une minute ; à 10, 15 min étaient hors d'atteinte

# Fondateur, 16/09/2026 : Iggy devient un CAMÉLÉON — même allure, mais une mouche passe une à deux fois par émission et il
# change parfois de couleur. La mouche tient dans le prompt d'animation ; la couleur, elle, se joue sur l'IMAGE de départ.
IGGY = ("A news anchor with a human body in a navy blue suit, light blue shirt and striped tie, and the head of a realistic green "
        "chameleon with a high curved crest and independently swivelling turret eyes, sits behind a long light wood news desk in a TV "
        "studio with indoor trees and a living plant wall, talks to the camera, natural mouth movements, studio lighting")
# Banc du 16/09 : LongCat-Avatar synchronise une bouche sur une voix, il ne joue pas une action rapide — sur 11 s d'essai, la
# langue n'est JAMAIS sortie et la mouche n'a jamais été gobée, alors que la mouche elle-même était parfaitement rendue. Le
# prompt décrit donc ce que le modèle sait faire ; promettre un coup de langue ne produirait que des artefacts. Choix du
# fondateur, 16/09 : on en reste à la mouche qui passe.
MOUCHE = " A small fly flies into the frame and circles slowly around his head while he keeps talking calmly."
MOUCHES_PAR_JT = 2         # « une à 2 fois par présentation » — jamais dans une suite de réplique déjà commencée
COULEURS = ("turquoise blue with darker bands", "warm ochre and orange with darker bands", "deep emerald green with pale spots",
            "pale sand yellow with brown bands", "dusty rose pink with cream spots")
COULEURS_PAR_JT = 2        # fondateur, 16/09 : « il doit changer de couleur de façon aléatoire, une à 2 fois par Journal »
# Fondateur, 16/09 : « parfois prendre les couleurs ET LES FORMES du décor du plateau ». Le vrai réflexe du caméléon, et un
# gag muet qui ne coûte pas une seconde de calcul de plus — à une condition, écrite dans la consigne : il doit rester LISIBLE,
# sinon le présentateur disparaît dans son mur végétal.
MIMETISMES = ("the green foliage of the plant wall behind him, with leaf shapes and leaf veins running across his skin",
              "the pale wood of the news desk, with wood grain and warm honey tones running across his skin",
              "the bark and dappled light of the studio trees, with bark ridges and leaf shadows across his skin")
MIMETISME_SUR = 3          # une fois sur trois, le changement est un mimétisme du décor plutôt qu'une couleur franche
SANS_HUMAIN = "The only characters are animals; there are no human beings anywhere in the image."
# 1er essai réel (15/09) : « TV news interview » a fait dessiner un FAUX bandeau d'information en lettres illisibles, et
# « LEFT half / RIGHT half » deux photos collées. On décrit une PHOTO documentaire d'UNE scène, et l'on bannit tout texte.
SANS_TEXTE = ("Absolutely no text anywhere: no captions, no subtitles, no news banner or lower third, no on-screen graphics, "
              "no logo, no watermark.")
# La teinte du jour, posée sur la photo validée d'Iggy : c'est une IMAGE de plus (~45 s de carte), pas un plan de plus.
IGGY_COULEUR = ("Edit the photograph: keep EXACTLY the same character, the same navy blue suit, light blue shirt and striped tie, the "
                "same news desk and the same studio, but the chameleon's skin is now {couleur}. Same head shape, same crest, same "
                "turret eyes, same position, facing the camera. " + SANS_HUMAIN + " " + SANS_TEXTE)
# Le mimétisme : sa peau prend le MOTIF du plateau, pas seulement sa couleur. La règle de lisibilité est dans la consigne
# elle-même — un présentateur qu'on ne distingue plus de son décor n'est pas un gag, c'est un plan raté.
IGGY_MIMETISME = ("Edit the photograph: keep EXACTLY the same character, the same navy blue suit, light blue shirt and striped tie, "
                  "the same news desk and the same studio, but the chameleon's skin now MIMICS {motif}. Same head shape, same crest, "
                  "same turret eyes, same position, facing the camera. He must stay clearly visible and readable: his silhouette "
                  "stands out from the background, his eyes are sharp, he is never transparent and never dissolved into the set. "
                  + SANS_HUMAIN + " " + SANS_TEXTE)
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
# Fondateur, 15/09 (après le Journal de 5 min) : « les humains n'ont pas l'air soumis, et on voit des moutons à leurs côtés dans
# l'enclos — seuls les humains doivent être en situation d'élevage ». Les animaux restent DEHORS et surveillent.
BETAIL = ("The humans here are LIVESTOCK in this satirical world ruled by animals: only adult humans, of all origins, in identical "
          "plain beige overalls, docile and submissive, heads slightly lowered, crowded together like a herd INSIDE straw pens or "
          "fenced enclosures, seen from a distance. EVERY human in the image is penned livestock: no human wears work clothes, no "
          "human stands outside the pens, no human watches over the others. The only keepers are ANTHROPOMORPHIC animals standing "
          "upright on two legs, in work vests and caps, OUTSIDE the fence. No four-legged animal anywhere in the image, and no "
          "animal at all inside the pens; never chained, never hurt, never naked, no children.")
COUPE = ("Using the first photograph only as a reference for the PLACE and the light, show the same place from a different camera "
         "angle, WITHOUT the reporter, without any animal holding a microphone, without any microphone: {coupe}. {regle} "
         "Photorealistic documentary photograph. " + SANS_TEXTE)
# BETAIL seulement quand la description DEMANDE des Bipèdes ; sinon, aucun humain. 2e essai réel (15/09) : ajoutée à chaque
# coupe, la règle en faisait apparaître partout — au casino, devant un fast-food, et dans des cellules au fond d'un couloir de
# bureau (« certaines scènes », avait dit le fondateur, pas toutes).
BIPEDES = re.compile(r"\b(?:humans?|people|persons?|bipeds?|bip[eè]des?|livestock|herds?|jumpsuits?|overalls?)\b", re.I)
# Les répliques longues en PLUSIEURS plans (fondateur, 15/09 : « le zoom qui continue au début finit par zoomer trop près sur le
# présentateur ») : LongCat avance de lui-même à chaque segment de continuation — au bout de 30 s, le visage sort du cadre.
# Au-delà de SEUIL_DECOUPE mots, la réplique est coupée aux fins de phrase en parties d'au plus MOTS_PAR_PARTIE mots (~14 s),
# chacune animée depuis son image de départ ; au montage, un changement de caméra — ou le plan de coupe — cache la jonction.
SEUIL_DECOUPE, MOTS_PAR_PARTIE, PAUSE_PARTIE = 45, 40, 0.3
# La 2e partie d'un reportage part d'une AUTRE image : le même reporter au même endroit, vu par une autre caméra (« des angles
# de vue dynamiques », fondateur, 15/09).
AUTRE_ANGLE = ("Edit the photograph: the SAME {qui}, in the same place, with the same light and clothes, holding the same "
               "microphone and still talking to the camera, now seen from ANOTHER camera: {angle}. Keep the character EXACTLY as "
               "in the image: same head, same fur or feathers, same clothes. " + SANS_HUMAIN + " " + SANS_TEXTE)
AUTRES_ANGLES = ("a closer shot framed from the chest up, the camera slightly to the left",
                 "a three-quarter view from the right side, medium shot",
                 "a slightly high-angle medium shot from the left")
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


def parties(txt):
    """La réplique en parties d'au plus MOTS_PAR_PARTIE mots, coupées aux fins de phrase (une phrase plus longue reste entière) ;
    une dernière partie de moins de 12 mots rejoint la précédente. Une réplique courte reste d'un seul tenant."""
    mots = lambda t: len(re.findall(r"\w+", t))
    if mots(txt) <= SEUIL_DECOUPE:
        return [txt]
    sortie = []
    for ph in (p for p in re.split(r"(?<=[.!?…])\s+", txt) if p):
        if sortie and mots(f"{sortie[-1]} {ph}") <= MOTS_PAR_PARTIE:
            sortie[-1] = f"{sortie[-1]} {ph}"
        else:
            sortie.append(ph)
    if len(sortie) > 1 and mots(sortie[-1]) < 12:
        dernier = sortie.pop()
        sortie[-1] = f"{sortie[-1]} {dernier}"
    return sortie


def main(jt_chemin, dossier):
    jt = json.load(open(jt_chemin, encoding="utf-8"))
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(jt.get("date", ""))):
        refuse("date absente ou mal formée")
    sujets = jt.get("sujets")
    if not isinstance(sujets, list) or not 1 <= len(sujets) <= SUJETS_MAX:
        refuse(f"il faut 1 à {SUJETS_MAX} sujets")
    repliques, images, plans, deroule = [], [], [], []
    utilises = {"iggy"}

    def replique(cle, qui, txt, pause_fin=0):
        p = DISTRIBUTION[qui]
        r = {"cle": cle, "perso": qui, "texte": txt, "voix": f"entrees/refs/{qui}.wav", "exa": p["exa"], "cfg": p["cfg"]}
        if pause_fin:   # une partie qui n'est pas la dernière : la pause de fin de phrase reste avant le changement de plan
            r["pause_fin"] = pause_fin
        repliques.append(r)
        utilises.add(qui)
        return f"resultats/voix/{cle}.wav"

    def plan_iggy(cle, txt, image="entrees/persos/iggy.png", suite=None, mouche=False):
        """Iggy, en une ou plusieurs parties : la 1re sur `image`, les suivantes sur `suite` (son plan moyen, dans la MÊME
        teinte : un caméléon ne change de couleur qu'à une coupe franche, jamais au milieu d'une phrase). La mouche n'est
        gobée que dans la 1re partie — une seule fois, là où le spectateur la voit arriver. Rend les clés des suivantes."""
        ps = parties(txt)
        for j, t in enumerate(ps, 1):
            c = cle if j == 1 else f"{cle}-{j}"
            p = {"cle": c, "image": image if j == 1 else (suite or "entrees/persos/iggy.png"),
                 "voix": [replique(c, "iggy", t, PAUSE_PARTIE if j < len(ps) else 0)],
                 "prompt": IGGY + MOUCHE if (mouche and j == 1) else IGGY}
            if p["image"] != "entrees/persos/iggy.png":
                # La teinte du jour est FABRIQUÉE le matin même : si son contrôle la refuse, le plan se rabat sur la photo
                # validée. Une couleur ratée ne doit jamais coûter la parole d'Iggy sur tout un sujet.
                p["image_repli"] = "entrees/persos/iggy.png"
            plans.append(p)
        return [f"{cle}-{j}" for j in range(2, len(ps) + 1)]

    # Le tirage du jour vient de la DATE, jamais du hasard de l'instant : deux passages du planificateur (une reprise après
    # interruption en est un) doivent donner EXACTEMENT le même Journal, même teinte et mêmes mouches.
    de = random.Random(jt["date"])
    lancements = list(range(2, len(sujets) + 1))
    mouches = set(de.sample(lancements, min(MOUCHES_PAR_JT, len(lancements))))
    # Les changements de couleur (fondateur, 16/09 : « de façon aléatoire par moment, pas une seule fois par Journal — une à
    # 2 fois aléatoirement ») : le NOMBRE et les MOMENTS sont tirés au sort, et chaque changement a sa PROPRE teinte — le
    # caméléon ne vire jamais deux fois vers la même couleur dans la même émission.
    n = min(de.randint(1, COULEURS_PAR_JT), len(lancements))
    teintes = {}
    for k, couleur in zip(sorted(de.sample(lancements, n)), de.sample(COULEURS, n)):
        cle = f"iggy-couleur{len(teintes) + 1}"
        # Une fois sur trois, il ne prend pas une couleur : il prend LE DÉCOR — feuillage du mur végétal, bois du bureau,
        # écorce des arbres du plateau.
        consigne = (IGGY_MIMETISME.format(motif=de.choice(MIMETISMES)) if de.randrange(MIMETISME_SUR) == 0
                    else IGGY_COULEUR.format(couleur=couleur))
        images.append({"cle": cle, "sources": ["entrees/persos/iggy.png"], "graine": 200 + de.randrange(50),
                       "sorte": "mimetisme", "consigne": consigne})
        teintes[k] = f"resultats/images/{cle}.png"
    # L'ouverture part d'un Iggy cadré un peu plus LARGE : la caméra du générique finit son avancée pendant qu'il parle déjà.
    suite_ouverture = plan_iggy("ouverture", texte(jt.get("sommaire"), "sommaire", 120),
              "entrees/persos/iggy-ouverture.png" if DISTRIBUTION["iggy"].get("image_ouverture") else "entrees/persos/iggy.png",
              mouche=not mouches)   # un Journal trop court pour un lancement à mouche : Iggy la gobe au sommaire
    deroule.append({"type": "ouverture", "plan": "ouverture", "suite": suite_ouverture})
    for k, s in enumerate(sujets, 1):
        if not isinstance(s, dict):
            refuse(f"sujet {k} mal formé")
        n = f"s{k:02d}"
        titre = texte(s.get("titre"), f"sujet {k} : titre", 16)
        r = s.get("reporter"); rep = perso(r, f"sujet {k} : reporter", "reporter")
        lieu = texte(s.get("lieu"), f"sujet {k} : lieu", 12)
        teinte = teintes.get(k)   # ce sujet est-il l'un des moments, tirés au sort, où le caméléon a changé de couleur ?
        suite_lancement = plan_iggy(f"{n}-lancement", texte(s.get("lancement"), f"sujet {k} : lancement"),
                                    image=teinte or "entrees/persos/iggy.png", suite=teinte, mouche=k in mouches)
        images.append({"cle": f"{n}-terrain", "sources": [f"entrees/persos/{r}.png"], "graine": 7 + k,
                       "consigne": TERRAIN.format(angle=ANGLES[(k - 1) % len(ANGLES)], qui=rep["qui"],
                                                  decor=decor(s.get("decor"), f"sujet {k} : décor"))})
        prompt_terrain = (f"{rep['description']} stands in {decor(s.get('decor'), 'décor')}, holds a microphone and talks to the camera, "
                          "natural mouth movements, documentary style, natural light")
        pt = parties(texte(s.get("terrain"), f"sujet {k} : terrain", MOTS_MAX_TERRAIN))
        suite_terrain = []
        for j, t in enumerate(pt, 1):
            c = f"{n}-terrain" if j == 1 else f"{n}-terrain-{j}"
            if j > 1:   # une autre caméra : la même scène, un autre angle — tirée de l'image du terrain
                images.append({"cle": c, "sources": [f"resultats/images/{n}-terrain.png"], "graine": 40 + 10 * k + j,
                               "consigne": AUTRE_ANGLE.format(qui=rep["qui"], angle=AUTRES_ANGLES[(k + j) % len(AUTRES_ANGLES)])})
                suite_terrain.append(c)
            plans.append({"cle": c, "image": f"resultats/images/{c}.png",
                          "voix": [replique(c, r, t, PAUSE_PARTIE if j < len(pt) else 0)], "prompt": prompt_terrain})
        seq = {"type": "sujet", "titre": titre, "lieu": lieu, "reporter": r, "lancement": f"{n}-lancement", "terrain": f"{n}-terrain",
               "lancement_suite": suite_lancement, "terrain_suite": suite_terrain}
        if s.get("coupe"):   # facultatif : un plan de coupe du lieu, glissé sous la voix du reporter au montage
            c = coupe(s.get("coupe"), f"sujet {k} : plan de coupe")
            bipedes = bool(BIPEDES.search(c))   # des Bipèdes seulement si la description en demande
            images.append({"cle": f"{n}-coupe", "sources": [f"resultats/images/{n}-terrain.png"], "graine": 170 + k,
                           "sorte": "coupe" if bipedes else "coupe-lieu",
                           "consigne": COUPE.format(coupe=c, regle=BETAIL if bipedes else SANS_HUMAIN)})
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
    suite_fermeture = plan_iggy("fermeture", texte(jt.get("au_revoir"), "au revoir", 60))
    deroule.append({"type": "fermeture", "plan": "fermeture", "suite": suite_fermeture})
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
    for f in ("voix_jt.py", "nettoyage.py", "images_jt.py", "lc_lot.py", "restant.py", "animer.sh"):
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
