#!/usr/bin/env python3
"""Montage du Journal de FREEWORLD TV — sur le hub, dans une unité systemd bornée (CPUQuota=200 %, MemoryMax=2G).

Relit montage.json (l'ordre des séquences, écrit par planif.py) et les plans rendus par l'usine (resultats/clips), et
monte le Journal tel que le fondateur l'a validé sur les pilotes 2 et 3 (15/09/2026) :
  générique du fondateur → fondu vers le plan LARGE du plateau → la caméra avance jusqu'à Iggy → Iggy (sommaire)
  → pour chaque sujet : Iggy lance → duplex (le reporter en encadré sur Iggy qui écoute, puis plein écran)
    → l'interview s'il y en a une → … → Iggy (au revoir) → le même générique à la fin.
Aucune mention à l'écran (« pas besoin de mentions », fondateur, 15/09) : l'IA est signalée dans les MÉTADONNÉES.
Un plan manquant (voix ratée, machine interrompue trop tard) SAUTE : le Journal se monte sans lui.
Sorties dans DOSSIER : journal.mp4 (1280×720, 25 i/s, H.264 + AAC, −16 LUFS), chapitres.json (l'EPG), affiche.jpg.

  python3 montage.py DOSSIER_DU_TRAVAIL
"""
import json, os, subprocess, sys, tempfile

HABILLAGE = os.environ.get("JT_HABILLAGE", "/root/usine/journal/habillage")
GENERIQUE = f"{HABILLAGE}/generique.mp4"        # la vidéo du fondateur, « Breaking news short (1) »
LARGE = f"{HABILLAGE}/plateau-large.png"         # le plan large validé (décor 1, bureau long), 1376×768
POLICE = os.environ.get("TITLE_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
FF = os.environ.get("FFMPEG_PATH", "ffmpeg")
W, H, FPS = 1280, 720, 25
V = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", "3M", "-bufsize", "6M", "-pix_fmt", "yuv420p", "-r", str(FPS)]
A = ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]
PLEIN = f"scale={W}:-2:flags=lanczos,crop={W}:{H},setsar=1,fps={FPS}"
# Entre les phrases, Chatterbox laisse des souffles (jusqu'à −42 dB, mesuré le 15/09) : une porte de bruit baisse le
# personnage quand il ne parle pas (idée du fondateur). Rien n'est coupé : les lèvres restent calées.
VOIX_PROPRE = "highpass=f=70,agate=threshold=0.01:ratio=8:attack=3:release=150:range=0.01:knee=2"
# Le générique : image jusqu'à 16,4 s ; dès 15 s, fondu d'opacité vers la caméra du Journal (consigne du fondateur).
G_BASCULE, G_NOIR = 15.0, 16.4
# Le plan moyen d'Iggy = le plan large recadré en 681×380 à (92, 181) (cadrage B). LongCat en garde le centre
# (1376×768 → 1331×768 → 832×480 : SSIM 0,93 contre 0,64 étiré), puis PLEIN rogne 2,5 % en hauteur : la caméra
# finit EXACTEMENT sur cette fenêtre du plan large (SSIM 0,96, mesuré le 15/09), le fondu ne se voit pas.
CADRE_B = (92, 181, 681, 380)
ZOOM_DUREE, FONDU = 3.6, 0.4
T_PARLE = G_BASCULE + ZOOM_DUREE
T_VOIX = T_PARLE + FONDU
MUSIQUE_SOUS_VOIX = 0.7      # la traîne du générique décroît d'elle-même ; ≈ l'écart voix/musique du pilote 2 validé
TMP = tempfile.mkdtemp(prefix="montage-jt-", dir=os.environ.get("TMPDIR"))


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


def plan(clip, sortie, bandeaux=""):
    f = f"[0:v]{PLEIN}{',' + bandeaux if bandeaux else ''}[v];{voix('0:a', duree(clip))}"
    ff("-i", clip, "-filter_complex", f, "-map", "[v]", "-map", "[a]", *V, *A, sortie)


def fond_vivant(clip, sortie, d=12):
    """Fond du duplex : la DERNIÈRE image du plan d'Iggy qui précède — le raccord est parfait — sous une caméra qui avance
    très lentement (1 → 1,05 en 4 s), pour qu'il ne paraisse pas figé. (LongCat refuse une piste de silence pur : un
    plan « Iggy écoute » ne se calcule pas, mesuré le 15/09.)"""
    image = sortie + ".png"
    ff("-sseof", "-0.3", "-i", clip, "-update", "1", image)
    p = f"(st(0,clip(on/{4 * FPS},0,1));ld(0)*ld(0)*(3-2*ld(0)))"
    ff("-loop", "1", "-framerate", str(FPS), "-t", str(d), "-i", image, "-vf",
       f"{PLEIN},scale={2 * W}:{2 * H}:flags=lanczos,zoompan=z='1+0.05*{p}':x='0.42*(iw-iw/zoom)':y='0.30*(ih-ih/zoom)'"
       f":d=1:s={W}x{H}:fps={FPS},format=yuv420p", *V, sortie)
    return sortie


def duplex(clip, sortie, fond, nom, role, bascule=3.0):
    """Le reporter dans un ENCADRÉ en haut à droite, sur le plateau où Iggy l'écoute, puis l'encadré s'agrandit jusqu'au
    plein écran — sa voix continue d'un bout à l'autre (même mécanique que filtreDuplex de la Forge)."""
    d = duree(clip)
    pair = lambda n: max(2, round(n / 2) * 2)
    bw, bh = pair(W * 0.36), pair(H * 0.36)
    marge = round(min(W, H) * 0.05)
    bx, by = W - bw - marge, marge
    lisere = max(2, round(H / 180))
    S, T, P = 0.4, 0.7, bascule
    e = f"(st(0,clip((t-{P:.2f})/{T},0,1));ld(0)*ld(0)*(3-2*ld(0)))"
    entree = f"(st(1,min(t/{S},1));ld(1)*ld(1)*(3-2*ld(1)))"
    f = (f"[1:v]fps={FPS},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,format=yuv420p,"
         f"scale=w='trunc(({bw}+{W - bw}*{e})/2)*2':h='trunc(({bh}+{H - bh}*{e})/2)*2':eval=frame[pip];"
         f"[0:v]tpad=stop_mode=clone:stop_duration={d:.2f},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
         f"setsar=1,fps={FPS},format=yuv420p,"
         f"drawbox=x={bx - lisere}:y={by - lisere}:w={bw + 2 * lisere}:h={bh + 2 * lisere}:color=white@0.92:t=fill"
         f":enable='between(t,{S},{P + T / 2:.2f})'[fond];"
         f"[fond][pip]overlay=x='if(lt(t,{P:.2f}),{W}-{W - bx}*{entree},{bx}*(1-{e}))':y='{by}*(1-{e})':eval=frame[x];"
         f"[x]{bandeau(nom, role, P + T + 0.3, min(d, P + T + 5.5))}[v];{voix('1:a', d)}")
    ff("-i", fond, "-i", clip, "-filter_complex", f, "-map", "[v]", "-map", "[a]", "-t", f"{d}", *V, *A, sortie)


def camera_large():
    """zoompan qui part du plan large entier (ramené au 16:9) et finit sur la fenêtre du plan qui parle."""
    x, y, w, _ = CADRE_B
    k = w / 1376
    garde_lc = 768 * 832 / 480
    rogne = 768 * (1 - 720 / (480 * W / 832)) / 2
    x0, y0, fw = x + (1376 - garde_lc) / 2 * k, y + rogne * k, garde_lc * k
    lx, dx = 1365, 5
    s = 2 * W / lx
    z_fin = lx / fw
    ax = (x0 - dx) * s / (2 * W - 2 * W / z_fin)
    ay = y0 * s / (2 * H - 2 * H / z_fin)
    p = f"(st(0,clip(on/{ZOOM_DUREE * FPS:.0f},0,1));ld(0)*ld(0)*(3-2*ld(0)))"
    return (f"crop={lx}:768:{dx}:0,scale={2 * W}:{2 * H}:flags=lanczos,"
            f"zoompan=z='pow({z_fin:.5f},{p})':x='{ax:.5f}*(iw-iw/zoom)':y='{ay:.5f}*(ih-ih/zoom)':d=1:s={W}x{H}:fps={FPS}")


def ouverture(clip, sortie, bandeaux=""):
    """Générique → fondu d'opacité (15 s) vers le plan LARGE → la caméra avance jusqu'à Iggy → fondu vers le plan qui
    parle → Iggy parle, la musique du générique en fondu sous sa voix."""
    d = duree(clip)
    total = T_VOIX + d
    b, n = G_BASCULE, G_NOIR
    baisse = T_PARLE - 0.2
    vol = (f"if(lt(t,{baisse:.2f}),1,if(lt(t,{T_VOIX:.2f}),"
           f"1-{1 - MUSIQUE_SOUS_VOIX:.2f}*(t-{baisse:.2f})/{T_VOIX - baisse:.2f},{MUSIQUE_SOUS_VOIX}))")
    f = (f"[0:v]scale={W}:{H}:flags=lanczos,fps={FPS},setsar=1,tpad=stop_mode=clone:stop_duration={total:.2f},format=yuv420p[gen];"
         f"[1:v]{camera_large()},setsar=1,format=yuva420p,fade=t=in:st=0:d={n - b:.2f}:alpha=1,setpts=PTS+{b}/TB[cam];"
         f"[2:v]{PLEIN},tpad=start_duration={FONDU}:start_mode=clone,format=yuva420p,fade=t=in:st=0:d={FONDU}:alpha=1,"
         f"setpts=PTS+{T_PARLE:.2f}/TB[parle];"
         f"[gen][cam]overlay=0:0:eof_action=pass[g];[g][parle]overlay=0:0:eof_action=pass,format=yuv420p"
         f"{',' + bandeaux if bandeaux else ''}[v];"
         f"[0:a]aresample=48000,volume='{vol}':eval=frame[mus];"
         f"[2:a]aresample=48000,{VOIX_PROPRE},afade=t=out:st={max(0.0, d - 0.12):.2f}:d=0.12,adelay={int(T_VOIX * 1000)}:all=1[voix];"
         f"[mus][voix]amix=inputs=2:duration=longest:normalize=0[a]")
    ff("-i", GENERIQUE, "-loop", "1", "-framerate", str(FPS), "-t", f"{ZOOM_DUREE + FONDU + 0.3:.2f}", "-i", LARGE, "-i", clip,
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
    m = json.load(open(os.path.join(dossier, "montage.json"), encoding="utf-8"))
    gens = m["personnages"]
    clip = lambda cle: (lambda c: c if os.path.exists(c) else None)(os.path.join(dossier, "resultats", "clips", f"{cle}.mp4"))
    voix_wav = lambda cle: os.path.join(dossier, "resultats", "voix", f"{cle}.wav")
    morceaux, chapitres, manquants = [], [], []
    t = 0.0

    def ajoute(fichier, titre=None):
        nonlocal t
        if titre:
            chapitres.append({"title": titre, "startSec": round(t, 2)})
        morceaux.append(fichier)
        t += duree(fichier)

    for i, seq in enumerate(m["deroule"]):
        base = f"{TMP}/{i:02d}"
        if seq["type"] == "ouverture":
            c = clip(seq["plan"])
            if c:
                ouverture(c, f"{base}.mp4", bandeau(gens["iggy"]["nom"], gens["iggy"]["role"], T_VOIX + 1.2, T_VOIX + 6.5))
            else:
                manquants.append(seq["plan"]); generique_seul(f"{base}.mp4")
            ajoute(f"{base}.mp4", "Le sommaire")
        elif seq["type"] == "sujet":
            lance, terrain, itw = clip(seq["lancement"]), clip(seq["terrain"]), clip(seq["interview"]) if seq.get("interview") else None
            manquants += [k for k, c in ((seq["lancement"], lance), (seq["terrain"], terrain)) if not c]
            if seq.get("interview") and not itw:
                manquants.append(seq["interview"])
            rep = gens[seq["reporter"]]
            titre = seq["titre"]
            if lance:
                plan(lance, f"{base}-a.mp4", texte(titre, "64", "h-120", 36, quand=(0.6, min(5.0, duree(lance)))))
                ajoute(f"{base}-a.mp4", titre); titre = None
            if terrain:
                if lance:
                    duplex(terrain, f"{base}-b.mp4", fond_vivant(lance, f"{base}-fond.mp4"), rep["nom"], seq["lieu"])
                else:   # sans lancement, le reporter prend l'antenne en plein écran
                    plan(terrain, f"{base}-b.mp4", bandeau(rep["nom"], seq["lieu"], 0.5, min(5.5, duree(terrain))))
                ajoute(f"{base}-b.mp4", titre); titre = None
            if itw:
                dq = duree(voix_wav(f"{seq['interview'][:3]}-question"))
                inv = gens[seq["invite"]]
                plan(itw, f"{base}-c.mp4", bandeau(rep["nom"], rep["role"], 0.5, min(5.0, dq)) + ","
                     + bandeau(inv["nom"], inv["role"], dq + 0.4, dq + 5.0))
                ajoute(f"{base}-c.mp4", titre)
        elif seq["type"] == "fermeture":
            c = clip(seq["plan"])
            if c:
                plan(c, f"{base}.mp4"); ajoute(f"{base}.mp4", "À demain")
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


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
