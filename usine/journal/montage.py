#!/usr/bin/env python3
"""Montage du Journal de FREEWORLD TV — sur le hub, dans une unité systemd bornée (CPUQuota=200 %, MemoryMax=2G).

Relit montage.json (l'ordre des séquences, écrit par planif.py) et les plans rendus par l'usine (resultats/clips), et
monte le Journal validé par le fondateur sur les pilotes 2 et 3, corrigé après le 1er essai réel (15/09/2026) :
  générique du fondateur → fondu vers le plan LARGE du plateau → la caméra avance ; Iggy commence à parler PENDANT
  l'avancée, qui s'achève sur lui → pour chaque sujet : Iggy lance → duplex (le reporter en encadré sur Iggy qui écoute,
  puis plein écran), un plan de coupe du lieu sous sa voix → l'interview, la caméra suivant celui qui parle → … →
  Iggy (au revoir) → le même générique à la fin.
CAMÉRA VIRTUELLE (fondateur, 15/09 : « des caméras et angles de vue dynamiques ») : aucun plan fixe — chaque plan avance,
recule ou glisse doucement ; un plan long passe, en son milieu, par un second cadrage plus serré (deux « caméras ») ;
l'interview suit la parole, du reporter à l'invité.
Aucune mention à l'écran (« pas besoin de mentions », fondateur, 15/09) : l'IA est signalée dans les MÉTADONNÉES.
Un plan manquant (voix ratée, machine interrompue trop tard) SAUTE : le Journal se monte sans lui.
Sorties dans DOSSIER : journal.mp4 (1280×720, 25 i/s, H.264 + AAC, −16 LUFS), chapitres.json (l'EPG), affiche.jpg.

  python3 montage.py DOSSIER_DU_TRAVAIL
"""
import json, os, shutil, subprocess, sys, tempfile

HABILLAGE = os.environ.get("JT_HABILLAGE", "/root/usine/journal/habillage")
GENERIQUE = f"{HABILLAGE}/generique.mp4"        # la vidéo du fondateur, « Breaking news short (1) »
LARGE = f"{HABILLAGE}/plateau-large.png"         # le plan large validé (décor 1, bureau long), 1376×768
POLICE = os.environ.get("TITLE_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
FF = os.environ.get("FFMPEG_PATH", "ffmpeg")
W, H, FPS = 1280, 720, 25
V = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", "3M", "-bufsize", "6M", "-pix_fmt", "yuv420p", "-r", str(FPS)]
A = ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]
PLEIN = f"scale={W}:-2:flags=lanczos,crop={W}:{H},setsar=1,fps={FPS}"
AGRANDI = f"scale={W * 3 // 2}:{H * 3 // 2}:flags=lanczos"   # ×1,5 : la marge de précision des mouvements de caméra
# Entre les phrases, Chatterbox laissait des souffles : ils sont remplacés AVANT l'animation (nettoyage.py) par de VRAIS
# silences. La porte de bruit qui les masquait au montage est retirée : mesurée sur l'essai du 15/09, elle rognait 0,5 s
# d'attaques et de fins de mots, jusqu'à 60 ms d'un coup (« des mots coupés », le fondateur). Reste le passe-haut.
VOIX_PROPRE = "highpass=f=70"
# Le générique : image jusqu'à 16,4 s ; dès 15 s, fondu d'opacité vers la caméra du Journal (consigne du fondateur).
G_BASCULE, G_NOIR = 15.0, 16.4
# L'ouverture (fondateur, 15/09 : Iggy parle AVANT la fin du zoom — puis « on voit le léger changement d'image » au fondu
# de la photo vers le plan animé : LongCat ne rend jamais tout à fait la même image). UN SEUL mouvement de caméra, de 4,2 s,
# sur un COMPOSITE : le plan large, avec la PREMIÈRE image du plan animé incrustée à sa place (bords fondus). Le plan animé
# y reste figé jusqu'à T_VOIX, puis joue — Iggy parle à mi-course — et la caméra s'arrête pile sur son cadrage : le plan
# animé seul prend alors le relais sur des pixels identiques. Ce plan part d'un cadrage un peu plus LARGE que le plan moyen
# (CADRE_OUVERTURE, crop 48, 168, 783, 437 du plan large) ; montage.json peut en donner un autre (« cadre_ouverture »)
# pour remonter un plan plus ancien. LongCat garde le centre de l'image (SSIM 0,93) et PLEIN rogne 2,5 % en hauteur.
CADRE_OUVERTURE = (48, 168, 783, 437)
ZOOM_DUREE, ZOOM_CLIP_DUREE = 2.2, 2.0    # la caméra avance 2,2 s avant qu'Iggy parle, et 2 s encore sous ses premiers mots
T_PARLE = G_BASCULE + ZOOM_DUREE          # Iggy s'anime et parle…
T_VOIX = T_PARLE
ZOOM_TOTAL = ZOOM_DUREE + ZOOM_CLIP_DUREE  # … et la caméra s'arrête sur lui
RACCORD = 0.3                             # relais composite → plan animé seul : la même image, un fondu de sécurité
VISAGE_IGGY = (0.424, 0.228)        # le visage d'Iggy dans son plan moyen habituel
VISAGE_TERRAIN = (0.5, 0.33)        # un reporter est au centre, le visage dans le tiers haut
MUSIQUE_SOUS_VOIX = 0.7            # la traîne du générique décroît d'elle-même ; ≈ l'écart voix/musique du pilote 2 validé
TMP = None   # les pièces du montage : main() les range DANS le dossier du jour, que purge.sh efface à J+2


def ff(*args):
    subprocess.run([FF, "-loglevel", "error", "-y", *args], check=True)


def duree(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).decode().strip())


def esc(t):
    return t.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%").replace(",", "\\,")


def texte(t, x, y, taille, boite=True, quand=None):
    b = ":box=1:boxcolor=0x0E3B2A@0.80:boxborderw=14" if boite else ":shadowcolor=black@0.6:shadowx=2:shadowy=2"
    e = f":enable='between(t,{quand[0]:.2f},{quand[1]:.2f})'" if quand else ""
    return f"drawtext=fontfile='{POLICE}':text='{esc(t)}':x={x}:y={y}:fontsize={taille}:fontcolor=white{b}{e}"


def bandeau(nom, role, debut, fin):
    return texte(nom, "64", "h-156", 40, quand=(debut, fin)) + "," + texte(role, "64", "h-100", 26, quand=(debut, fin))


def voix(entree, d):
    return f"[{entree}]{VOIX_PROPRE},afade=t=in:d=0.04,afade=t=out:st={max(0.0, d - 0.12):.2f}:d=0.12[a]"


def lisse(expr, registre=0):
    """Départ et arrivée en douceur (smoothstep) d'une grandeur qui va de 0 à 1."""
    return f"(st({registre},clip({expr},0,1));ld({registre})*ld({registre})*(3-2*ld({registre})))"


def cadrage(style, p, ax):
    """(zoom, x) d'une « caméra » pour une progression p (expression de 0 à 1) : 0 avance, 1 recule (finit au cadrage
    d'origine), 2 glisse, 3 gros plan sur le visage."""
    if style == 0:
        return f"(1+0.14*{p})", f"{ax}"
    if style == 1:
        return f"(1.14-0.14*{p})", f"{ax}"
    if style == 2:
        return "1.14", f"clip({ax}-0.3+0.6*{p},0,1)"
    return f"(1.26+0.04*{p})", f"{ax}"


def mouvement(d, geste, ancre, serre=True):
    """La caméra virtuelle d'un plan de d secondes (fondateur, 15/09 : « les angles de vue manquent de dynamisme »). Un plan
    court fait UN mouvement franc ; au-delà de 7 s, le cadrage change toutes les ~4,5 s, coupe franche comme en régie à
    plusieurs caméras — le gros plan sur le visage alterne avec le mouvement du plan, qui revient toujours en DERNIER (un
    lancement finit ainsi au cadrage d'où part le fond du duplex)."""
    n = max(1, round(d * FPS))
    ax, ay = ancre
    if not serre or d < 7:
        z, x = cadrage(geste % 3, lisse(f"on/{n}"), ax)
    else:
        k = max(2, round(d / 4.5))
        bornes = [round(i * n / k) for i in range(k + 1)]
        z = x = None
        for i in reversed(range(k)):
            a, b = bornes[i], bornes[i + 1]
            zi, xi = cadrage(3 if (k - 1 - i) % 2 else geste % 3, lisse(f"(on-{a})/{max(1, b - a)}"), ax)
            z, x = (zi, xi) if z is None else (f"if(lt(on,{b}),{zi},{z})", f"if(lt(on,{b}),{xi},{x})")
    return f"{AGRANDI},zoompan=z='{z}':x='({x})*(iw-iw/zoom)':y='{ay}*(ih-ih/zoom)':d=1:s={W}x{H}:fps={FPS}"


def plan(clip, sortie, bandeaux="", geste=0, ancre=VISAGE_TERRAIN):
    d = duree(clip)
    f = f"[0:v]{PLEIN},{mouvement(d, geste, ancre)}{',' + bandeaux if bandeaux else ''}[v];{voix('0:a', d)}"
    ff("-i", clip, "-filter_complex", f, "-map", "[v]", "-map", "[a]", *V, *A, sortie)


def interview(clip, sortie, dq, bandeaux=""):
    """L'interview à deux, filmée par un cadreur qui suit la parole : serré (×1,18) sur le reporter à gauche pendant la
    question, la caméra glisse vers l'invité à droite quand il répond — ~12 % de l'image, les deux restent dans le cadre
    (0,28 → 0,72 ne bougeait que de 6 % : invisible sur le rejeu du 15/09)."""
    d = duree(clip)
    x = f"(0.1+0.8*{lisse(f'(on/{FPS}-{dq:.2f})/0.8')})"
    z = f"(1.18+0.12*{lisse(f'(on/{FPS}-{dq + 2.5:.2f})/0.6')})"   # 2,5 s après le début de la réponse : gros plan sur l'invité
    f = (f"[0:v]{PLEIN},{AGRANDI},zoompan=z='{z}':x='{x}*(iw-iw/zoom)':y='0.35*(ih-ih/zoom)':d=1:s={W}x{H}:fps={FPS}"
         f"{',' + bandeaux if bandeaux else ''}[v];{voix('0:a', d)}")
    ff("-i", clip, "-filter_complex", f, "-map", "[v]", "-map", "[a]", *V, *A, sortie)


def fond_vivant(clip, sortie, d=12):
    """Fond du duplex : la DERNIÈRE image du plan d'Iggy qui précède — le raccord est parfait (ce plan finit toujours au
    cadrage d'origine) — sous une caméra qui avance très lentement (1 → 1,05 en 4 s). (LongCat refuse une piste de silence
    pur : un plan « Iggy écoute » ne se calcule pas, mesuré le 15/09.)"""
    image = sortie + ".png"
    ff("-sseof", "-0.3", "-i", clip, "-update", "1", image)
    ff("-loop", "1", "-framerate", str(FPS), "-t", str(d), "-i", image, "-vf",
       f"{PLEIN},{AGRANDI},zoompan=z='1+0.05*{lisse(f'on/{4 * FPS}')}':x='0.42*(iw-iw/zoom)':y='0.30*(ih-ih/zoom)'"
       f":d=1:s={W}x{H}:fps={FPS},format=yuv420p", *V, sortie)
    return sortie


def duplex(clip, sortie, fond, nom, role, geste=0, bascule=3.0):
    """Le reporter dans un ENCADRÉ en haut à droite, sur le plateau où Iggy l'écoute, puis l'encadré s'agrandit jusqu'au
    plein écran — sa voix continue d'un bout à l'autre (même mécanique que filtreDuplex de la Forge). La caméra du
    terrain bouge déjà dans l'encadré."""
    d = duree(clip)
    pair = lambda n: max(2, round(n / 2) * 2)
    bw, bh = pair(W * 0.36), pair(H * 0.36)
    marge = round(min(W, H) * 0.05)
    bx, by = W - bw - marge, marge
    lisere = max(2, round(H / 180))
    S, T, P = 0.4, 0.7, bascule
    e = f"(st(0,clip((t-{P:.2f})/{T},0,1));ld(0)*ld(0)*(3-2*ld(0)))"
    entree = f"(st(1,min(t/{S},1));ld(1)*ld(1)*(3-2*ld(1)))"
    f = (f"[1:v]{PLEIN},{mouvement(d, geste, VISAGE_TERRAIN)},format=yuv420p,"
         f"scale=w='trunc(({bw}+{W - bw}*{e})/2)*2':h='trunc(({bh}+{H - bh}*{e})/2)*2':eval=frame[pip];"
         f"[0:v]tpad=stop_mode=clone:stop_duration={d:.2f},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
         f"setsar=1,fps={FPS},format=yuv420p,"
         f"drawbox=x={bx - lisere}:y={by - lisere}:w={bw + 2 * lisere}:h={bh + 2 * lisere}:color=white@0.92:t=fill"
         f":enable='between(t,{S},{P + T / 2:.2f})'[fond];"
         f"[fond][pip]overlay=x='if(lt(t,{P:.2f}),{W}-{W - bx}*{entree},{bx}*(1-{e}))':y='{by}*(1-{e})':eval=frame[x];"
         f"[x]{bandeau(nom, role, P + T + 0.3, min(d, P + T + 5.5))}[v];{voix('1:a', d)}")
    ff("-i", fond, "-i", clip, "-filter_complex", f, "-map", "[v]", "-map", "[a]", "-t", f"{d}", *V, *A, sortie)


def inserer_coupe(piece, image, sortie, debut, d=3.5):
    """Le plan de coupe du lieu (fondateur, 15/09 : voir les Bipèdes, varier les angles), glissé plein écran dans la pièce
    déjà montée : une photo qui avance doucement, fondue à l'entrée et à la sortie ; la voix du reporter continue dessous."""
    f = (f"[1:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,"
         f"zoompan=z='1+0.1*{lisse(f'on/{round(d * FPS)}')}':x='0.5*(iw-iw/zoom)':y='0.45*(ih-ih/zoom)':d=1:s={W}x{H}:fps={FPS},"
         f"format=yuva420p,fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st={d - 0.25:.2f}:d=0.25:alpha=1,setpts=PTS+{debut:.2f}/TB[c];"
         f"[0:v][c]overlay=0:0:eof_action=pass,format=yuv420p[v]")
    ff("-i", piece, "-loop", "1", "-framerate", str(FPS), "-t", f"{d}", "-i", image, "-filter_complex", f,
       "-map", "[v]", "-map", "0:a", "-c:a", "copy", *V, sortie)


def geometrie_ouverture(cadre):
    """Où tombe le plan animé d'ouverture dans le plan large agrandi ×2 (le « canevas » de la caméra) : sa place (x, y,
    largeur, hauteur, en pixels pairs), le zoom de fin qui le cadre EXACTEMENT comme PLEIN, et le point fixe du zoom."""
    x, y, w, _ = cadre
    k = w / 1376
    garde_lc = 768 * 832 / 480                          # LongCat garde le centre : 1376×768 → 1331×768 → 832×480
    rogne = (1 - 720 / (480 * W / 832)) / 2               # PLEIN rogne 1,25 % en haut et en bas
    lx, dx = 1365, 5                                     # le plan large ramené au 16:9
    sx, sy = 2 * W / lx, 2 * H / 768
    pair = lambda v: int(round(v / 2)) * 2
    px, py = pair((x + (1376 - garde_lc) / 2 * k - dx) * sx), pair(y * sy)
    pl, ph = pair(garde_lc * k * sx), pair(768 * k * sy)
    z_fin = 2 * W / pl
    return px, py, pl, ph, z_fin, px / (2 * W - pl), (py + rogne * ph) / (2 * H - 2 * H / z_fin)


def ouverture(clip, sortie, bandeaux="", cadre=CADRE_OUVERTURE):
    """Générique → fondu d'opacité (15 s) vers le plan LARGE → UNE avancée continue de la caméra (4,2 s) sur le composite
    (plan large + première image du plan animé, bords fondus) ; à mi-course, Iggy s'anime et PARLE ; la caméra s'arrête
    pile sur son cadrage, où le plan animé seul prend le relais. La musique en fondu sous sa voix."""
    d = duree(clip)
    total = T_PARLE + d
    b, n = G_BASCULE, G_NOIR
    baisse = T_VOIX - 0.6
    vol = (f"if(lt(t,{baisse:.2f}),1,if(lt(t,{T_VOIX:.2f}),"
           f"1-{1 - MUSIQUE_SOUS_VOIX:.2f}*(t-{baisse:.2f})/{T_VOIX - baisse:.2f},{MUSIQUE_SOUS_VOIX}))")
    px, py, pl, ph, z_fin, ax, ay = geometrie_ouverture(cadre)
    cam = ZOOM_TOTAL + RACCORD + 0.2
    masque = f"{TMP}/masque-ouverture.png"   # 1 au centre, 0 au bord, sur 5 % de la hauteur : l'incrustation ne se voit pas
    ff("-f", "lavfi", "-i", f"color=c=black:s={pl}x{ph}:d=0.04", "-vf",
       f"format=gray,geq=lum='255*clip(min(min(X,W-1-X),min(Y,H-1-Y))/{max(2, round(0.05 * ph))},0,1)'", "-frames:v", "1", masque)
    f = (f"[0:v]scale={W}:{H}:flags=lanczos,fps={FPS},setsar=1,tpad=stop_mode=clone:stop_duration={total:.2f},format=yuv420p[gen];"
         f"[1:v]crop=1365:768:5:0,scale={2 * W}:{2 * H}:flags=lanczos,setsar=1,fps={FPS}[large];"
         f"[2:v]fps={FPS},scale={pl}:{ph}:flags=lanczos,setsar=1,tpad=start_duration={ZOOM_DUREE}:start_mode=clone,"
         f"trim=duration={cam:.2f},setpts=PTS-STARTPTS,format=yuva420p[anime];"
         f"[4:v]format=gray,fps={FPS}[masque];[anime][masque]alphamerge[incruste];"
         f"[large][incruste]overlay={px}:{py}:eof_action=repeat,format=yuv420p,"
         f"zoompan=z='pow({z_fin:.5f},{lisse(f'on/{round(ZOOM_TOTAL * FPS)}')})':x='{ax:.5f}*(iw-iw/zoom)':y='{ay:.5f}*(ih-ih/zoom)'"
         f":d=1:s={W}x{H}:fps={FPS},setsar=1,format=yuva420p,fade=t=in:st=0:d={n - b:.2f}:alpha=1,setpts=PTS+{b}/TB[cam];"
         f"[3:v]{PLEIN},trim=start={ZOOM_CLIP_DUREE},setpts=PTS-STARTPTS,format=yuva420p,"
         f"fade=t=in:st=0:d={RACCORD}:alpha=1,setpts=PTS+{b + ZOOM_TOTAL:.2f}/TB[parle];"
         f"[gen][cam]overlay=0:0:eof_action=pass[g];[g][parle]overlay=0:0:eof_action=pass,format=yuv420p"
         f"{',' + bandeaux if bandeaux else ''}[v];"
         f"[0:a]aresample=48000,volume='{vol}':eval=frame[mus];"
         f"[2:a]aresample=48000,{VOIX_PROPRE},afade=t=out:st={max(0.0, d - 0.12):.2f}:d=0.12,adelay={int(T_VOIX * 1000)}:all=1[voix];"
         f"[mus][voix]amix=inputs=2:duration=longest:normalize=0[a]")
    ff("-i", GENERIQUE, "-loop", "1", "-framerate", str(FPS), "-t", f"{cam:.2f}", "-i", LARGE, "-i", clip, "-i", clip,
       "-loop", "1", "-framerate", str(FPS), "-t", f"{cam:.2f}", "-i", masque,
       "-filter_complex", f, "-map", "[v]", "-map", "[a]", "-t", f"{total:.2f}", *V, *A, sortie)


def generique_seul(sortie, fin=18.5):
    """Le même générique à la fin (et au début si le sommaire d'Iggy manque) : fondu d'entrée, la musique s'éteint avec l'image."""
    ff("-i", GENERIQUE, "-filter_complex",
       f"[0:v]scale={W}:{H}:flags=lanczos,fps={FPS},setsar=1,fade=t=in:d=0.5,fade=t=out:st={G_NOIR - 0.6:.2f}:d=0.6,format=yuv420p[v];"
       f"[0:a]aresample=48000,afade=t=out:st={fin - 2.0:.2f}:d=2.0[a]",
       "-map", "[v]", "-map", "[a]", "-t", f"{fin}", *V, *A, sortie)


def assembler(morceaux, sortie):
    """Bout à bout sans réencoder l'image, puis un gain FIXE mesuré (−16 LUFS) + limiteur : le loudnorm d'une passe
    remontait les silences entre les phrases."""
    liste = f"{TMP}/liste.txt"
    open(liste, "w").write("".join(f"file '{m}'\n" for m in morceaux))
    brut = f"{TMP}/brut.mp4"
    ff("-f", "concat", "-safe", "0", "-i", liste, "-c", "copy", brut)
    mesure = subprocess.run([FF, "-hide_banner", "-nostats", "-i", brut, "-af", "loudnorm=I=-16:TP=-1.5:print_format=json", "-f", "null", "-"],
                            capture_output=True, text=True).stderr
    j = json.loads(mesure[mesure.rindex("{"):mesure.rindex("}") + 1])
    gain = -16.0 - float(j["input_i"])
    ff("-i", brut, "-c:v", "copy", "-af", f"volume={gain:.2f}dB,alimiter=limit=0.84:level=false", *A,
       "-metadata", "comment=Images et voix créées avec l’IA — Freeworld TV", "-movflags", "+faststart", sortie)


def main(dossier):
    global TMP
    # Jamais dans /tmp, où les pièces s'entassaient (~0,5 Go par Journal de 15 min, rien ne les effaçait) ; caché : rapatrier() l'ignore.
    TMP = tempfile.mkdtemp(prefix=".montage-", dir=os.environ.get("TMPDIR") or dossier)
    m = json.load(open(os.path.join(dossier, "montage.json"), encoding="utf-8"))
    gens = m["personnages"]
    # Un plan de coupe est FACULTATIF : signalé par le contrôle après ses 3 graines (texte, humain, reporter…), il n'est pas
    # monté. 2e essai réel (15/09) : un faux « FASD FCD », signalé texte=True, avait été inséré quand même.
    controle = os.path.join(dossier, "resultats", "images", "controle.jsonl")
    signalees = ({d["cle"] for d in (json.loads(l) for l in open(controle, encoding="utf-8") if l.strip())
                  if any(v is True for k, v in d.items() if k not in ("cle", "graine"))} if os.path.exists(controle) else set())
    fichier = lambda sous, cle, ext: (lambda c: c if os.path.exists(c) else None)(os.path.join(dossier, "resultats", sous, f"{cle}.{ext}"))
    clip = lambda cle: fichier("clips", cle, "mp4")
    morceaux, chapitres, manquants = [], [], []
    t, geste = 0.0, 0

    def ajoute(f, titre=None):
        nonlocal t
        if titre:
            chapitres.append({"title": titre, "startSec": round(t, 2)})
        morceaux.append(f)
        t += duree(f)

    def suite(cles, base, ancre, geste_final=None):
        """Les parties suivantes d'une réplique longue (planif.py) : chacune son plan et son mouvement de caméra — la coupe
        franche entre deux parties est un changement de caméra. Rend le dernier clip monté (ou None)."""
        nonlocal geste
        dernier = None
        for j, cle in enumerate(cles, 2):
            c = clip(cle)
            if not c:
                manquants.append(cle)
                continue
            geste += 1
            g = geste_final if geste_final is not None and j == len(cles) + 1 else geste % 3
            plan(c, f"{base}-p{j}.mp4", "", g, ancre)
            ajoute(f"{base}-p{j}.mp4")
            dernier = c
        return dernier

    for i, seq in enumerate(m["deroule"]):
        base = f"{TMP}/{i:02d}"
        if seq["type"] == "ouverture":
            c = clip(seq["plan"])
            if c:
                ouverture(c, f"{base}.mp4", bandeau(gens["iggy"]["nom"], gens["iggy"]["role"], T_VOIX + 1.2, T_VOIX + 6.5),
                          tuple(m.get("cadre_ouverture", CADRE_OUVERTURE)))
            else:
                manquants.append(seq["plan"]); generique_seul(f"{base}.mp4")
            ajoute(f"{base}.mp4", "Le sommaire")
            suite(seq.get("suite", []), base, VISAGE_IGGY)
        elif seq["type"] == "sujet":
            lance, terrain, itw = clip(seq["lancement"]), clip(seq["terrain"]), clip(seq["interview"]) if seq.get("interview") else None
            manquants += [k for k, c in ((seq["lancement"], lance), (seq["terrain"], terrain)) if not c]
            if seq.get("interview") and not itw:
                manquants.append(seq["interview"])
            rep = gens[seq["reporter"]]
            titre = seq["titre"]
            fin_lance = lance
            if lance:   # Iggy lance : la caméra RECULE en dernier, pour finir au cadrage d'où part le fond du duplex
                plan(lance, f"{base}-a.mp4", texte(titre, "64", "h-120", 36, quand=(0.6, min(5.0, duree(lance)))), 1, VISAGE_IGGY)
                ajoute(f"{base}-a.mp4", titre); titre = None
                fin_lance = suite(seq.get("lancement_suite", []), f"{base}-a", VISAGE_IGGY, geste_final=1) or lance
            if terrain:
                geste += 1
                brut = f"{base}-b0.mp4"
                if fin_lance:
                    duplex(terrain, brut, fond_vivant(fin_lance, f"{base}-fond.mp4"), rep["nom"], seq["lieu"], 2 * (geste % 2))
                else:   # sans lancement, le reporter prend l'antenne en plein écran
                    plan(terrain, brut, bandeau(rep["nom"], seq["lieu"], 0.5, min(5.5, duree(terrain))), 2 * (geste % 2))
                image = fichier("images", seq["coupe"], "png") if seq.get("coupe") and seq["coupe"] not in signalees else None
                suites = [(k, clip(k)) for k in seq.get("terrain_suite", [])]
                manquants += [k for k, c in suites if not c]
                suites = [(k, c) for k, c in suites if c]
                if suites:
                    # Le reportage continue sous un AUTRE angle (planif.py) ; le plan de coupe ouvre la 2e partie : il cache la
                    # jonction, et la voix du reporter continue dessous.
                    os.replace(brut, f"{base}-b.mp4")
                    ajoute(f"{base}-b.mp4", titre); titre = None
                    for j, (k, c) in enumerate(suites, 2):
                        geste += 1
                        piece = f"{base}-b{j}0.mp4"
                        plan(c, piece, "", geste % 3, VISAGE_TERRAIN)
                        if j == 2 and image and duree(piece) >= 5.0:
                            inserer_coupe(piece, image, f"{base}-b{j}.mp4", 0.0)
                        else:
                            os.replace(piece, f"{base}-b{j}.mp4")
                        ajoute(f"{base}-b{j}.mp4")
                else:
                    d = duree(brut)
                    debut = max(6.0 if fin_lance else 3.0, 0.45 * d)
                    if image and debut + 3.5 <= d - 1.0:
                        inserer_coupe(brut, image, f"{base}-b.mp4", debut)
                    else:
                        os.replace(brut, f"{base}-b.mp4")
                    ajoute(f"{base}-b.mp4", titre); titre = None
            if itw:
                dq = duree(os.path.join(dossier, "resultats", "voix", f"{seq['interview'][:3]}-question.wav"))
                inv = gens[seq["invite"]]
                interview(itw, f"{base}-c.mp4", dq, bandeau(rep["nom"], rep["role"], 0.5, min(5.0, dq)) + ","
                          + bandeau(inv["nom"], inv["role"], dq + 0.4, dq + 5.0))
                ajoute(f"{base}-c.mp4", titre)
        elif seq["type"] == "fermeture":
            c = clip(seq["plan"])
            if c:
                plan(c, f"{base}.mp4", "", 0, VISAGE_IGGY); ajoute(f"{base}.mp4", "À demain")
                suite(seq.get("suite", []), base, VISAGE_IGGY)
            else:
                manquants.append(seq["plan"])
            generique_seul(f"{base}-g.mp4"); ajoute(f"{base}-g.mp4")
    sortie = os.path.join(dossier, "journal.mp4")
    assembler(morceaux, sortie)
    ff("-ss", f"{T_VOIX + 3:.1f}", "-i", sortie, "-frames:v", "1", "-q:v", "3", os.path.join(dossier, "affiche.jpg"))
    total = duree(sortie)
    json.dump({"durationSec": round(total, 2), "segments": [dict(c, durationSec=round(((chapitres[k + 1]["startSec"] if k + 1 < len(chapitres) else total) - c["startSec"]), 2))
               for k, c in enumerate(chapitres)], "manquants": manquants},
              open(os.path.join(dossier, "chapitres.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{sortie} : {total / 60:.1f} min, {len(chapitres)} chapitre(s), {os.path.getsize(sortie) / 1e6:.0f} Mo"
          + (f" · ⚠ plans manquants : {manquants}" if manquants else ""))
    shutil.rmtree(TMP, ignore_errors=True)   # un échec, lui, garde ses pièces pour l'enquête (effacées avec le jour)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
