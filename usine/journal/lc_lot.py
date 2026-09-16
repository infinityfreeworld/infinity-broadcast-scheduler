#!/usr/bin/env python3
"""LongCat-Video-Avatar 1.5 — TOUS les plans d'une nuit avec UN SEUL chargement du modèle.

Décision du fondateur (15/09/2026) : charger le modèle d'animation une seule fois par nuit. Les scripts de démo
(run_demo_avatar_{single,multi}_audio_to_video.py, commit 6b3f4b8) relisent tous les poids à chaque plan. Or, en v1.5,
un plan à UN personnage et un plan à DEUX chargent EXACTEMENT les mêmes poids (base_model + LoRA dmd, whisper-large-v3,
Kim_Vocal_2) : une seule pipeline sert les deux.

Recopie fidèle du chemin 480p « ai2v » + continuation « avc » des deux démos, sur UNE carte (pas de parallélisme de
contexte). Chaque plan est indépendant : une erreur est notée dans lot.jsonl et le plan suivant tourne quand même.
La vidéo n'est écrite qu'une fois, à la fin du plan (les démos la réencodaient entière après CHAQUE segment).

  cd LongCat-Video && torchrun --nproc_per_node=1 lc_lot.py --checkpoint_dir …/LongCat-Video-Avatar-1.5 \\
      --lot plans.json --sortie DOSSIER [--use_int8]

plans.json : [{"cle": "iggy-intro", "prompt": "…", "image": "…png", "voix": ["a.wav"]},
              {"cle": "interview", "prompt": "…", "image": "…png", "voix": ["gauche.wav", "droite.wav"], "audio_type": "add"}]
Deux voix : moitié GAUCHE de l'image = voix 1, moitié DROITE = voix 2 (comme la démo sans « bbox »).
"""
import argparse, datetime, json, math, os, random, shutil, sys, time, traceback
from pathlib import Path

import numpy as np
import PIL.Image
import torch
import torch.distributed as dist

sys.path.insert(0, os.getcwd())  # lancé depuis le dépôt LongCat-Video
from transformers import AutoTokenizer, UMT5EncoderModel
from diffusers.utils import load_image
from longcat_video.pipeline_longcat_video_avatar import LongCatVideoAvatarPipeline
from longcat_video.modules.scheduling_flow_match_euler_discrete import FlowMatchEulerDiscreteScheduler
from longcat_video.modules.autoencoder_kl_wan import AutoencoderKLWan
from longcat_video.modules.avatar.longcat_video_dit_avatar import LongCatVideoAvatarTransformer3DModel
from longcat_video.modules.quantization import load_quantized_dit
from longcat_video.context_parallel import context_parallel_util
import librosa
import soundfile as sf
from longcat_video.audio_process import get_audio_encoder, get_audio_feature_extractor
from longcat_video.audio_process.torch_utils import save_video_ffmpeg
from audio_separator.separator import Separator

MODEL_TYPE = "avatar-v1.5"
NUM_FRAMES, NUM_COND_FRAMES, SAVE_FPS, AUDIO_STRIDE = 93, 13, 25, 1   # valeurs v1.5 des démos
HEIGHT, WIDTH = 480, 832
NEGATIF = ("Close-up, bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, static, overall gray, "
           "worst quality, low quality, JPEG compression residue, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn faces, "
           "deformed, disfigured, misshapen limbs, fused fingers, still picture, messy background, three legs, many people in the background, "
           "walking backwards")


def torch_gc():
    torch.cuda.empty_cache(); torch.cuda.ipc_collect()


def uid():
    return str(int(time.time()))[-6:] + str(random.randint(100000, 999999))


def segments_pour(duree_s):
    """Même règle que le pilote du 14/09 : 93 images au premier segment (3,72 s), 80 de plus ensuite (3,2 s)."""
    return max(1, 1 + math.ceil((duree_s - NUM_FRAMES / SAVE_FPS) / ((NUM_FRAMES - NUM_COND_FRAMES) / SAVE_FPS)))


def charger(args, rang):
    """UNE fois pour toute la nuit."""
    t = time.time()
    cp_split_hw = context_parallel_util.get_optimal_split(1)
    base = os.path.join(args.checkpoint_dir, "..", "LongCat-Video")
    tokenizer = AutoTokenizer.from_pretrained(base, subfolder="tokenizer", torch_dtype=torch.bfloat16)
    text_encoder = UMT5EncoderModel.from_pretrained(base, subfolder="text_encoder", torch_dtype=torch.bfloat16)
    vae = AutoencoderKLWan.from_pretrained(base, subfolder="vae", torch_dtype=torch.bfloat16)
    scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(args.checkpoint_dir, subfolder="scheduler", torch_dtype=torch.bfloat16)
    if args.use_int8:
        dit = load_quantized_dit(args.checkpoint_dir, subfolder="base_model_int8", cp_split_hw=cp_split_hw)
    else:
        dit = LongCatVideoAvatarTransformer3DModel.from_pretrained(args.checkpoint_dir, subfolder="base_model", cp_split_hw=cp_split_hw, torch_dtype=torch.bfloat16)
    lora = os.path.join(args.checkpoint_dir, "lora", "dmd_lora.safetensors")
    if not os.path.exists(lora):
        raise SystemExit(f"LoRA de distillation introuvable : {lora} (sans elle, 8 pas ne suffisent pas)")
    dit.load_lora(lora, "dmd", multiplier=1.0, lora_network_dim=128, lora_network_alpha=64)
    dit.enable_loras(["dmd"])
    whisper = os.path.join(args.checkpoint_dir, "whisper-large-v3")
    audio_encoder = get_audio_encoder(whisper, MODEL_TYPE).to(rang)
    audio_feature_extractor = get_audio_feature_extractor(whisper, MODEL_TYPE)
    # Un dossier par carte : animer.sh lance un lc_lot.py par carte, tous depuis le même dépôt LongCat-Video.
    tmp = Path(os.environ.get("LOT_TMP", "./audio_temp_file")); tmp.mkdir(exist_ok=True)
    separateur_onnx = os.path.join(args.checkpoint_dir, "vocal_separator/Kim_Vocal_2.onnx")
    separateur = Separator(output_dir=tmp / "vocals", output_single_stem="vocals", model_file_dir=os.path.dirname(separateur_onnx))
    separateur.load_model(os.path.basename(separateur_onnx))
    pipe = LongCatVideoAvatarPipeline(tokenizer=tokenizer, text_encoder=text_encoder, vae=vae, scheduler=scheduler, dit=dit,
                                      audio_encoder=audio_encoder, audio_feature_extractor=audio_feature_extractor, model_type=MODEL_TYPE)
    pipe.to(rang)
    print(f"[lot] modèle chargé UNE fois en {time.time() - t:.0f} s", flush=True)
    return pipe, separateur, tmp


def voix_isolee(chemin, separateur, tmp):
    """Comme la démo : la voix passe par le séparateur ; s'il échoue, la voix brute (Chatterbox est déjà sans fond)."""
    sorties = separateur.separate(chemin)
    if not sorties:
        return chemin
    cible = f"/tmp/lot_{uid()}_vocal.wav"
    # shutil.move et non os.replace : /tmp et le dossier de travail peuvent être deux disques (la démo passait par « mv »).
    shutil.move((tmp / "vocals" / sorties[0]).resolve().as_posix(), cible)
    return cible


def fenetre(emb, debut, rang):
    indices = torch.arange(2 * 2 + 1) - 2
    centres = torch.arange(debut, debut + AUDIO_STRIDE * NUM_FRAMES, AUDIO_STRIDE).unsqueeze(1) + indices.unsqueeze(0)
    centres = torch.clamp(centres, min=0, max=emb.shape[0] - 1)
    return emb[centres][None, ...].to(rang)


def en_images(sortie):
    sortie = sortie[0]
    return [PIL.Image.fromarray((sortie[i] * 255).astype(np.uint8)) for i in range(sortie.shape[0])]


def un_plan(pipe, separateur, tmp, plan, dossier, rang):
    voix = plan["voix"]
    deux = len(voix) == 2
    duree = sum(librosa.get_duration(path=v) for v in voix) if plan.get("audio_type", "add") == "add" else max(librosa.get_duration(path=v) for v in voix)
    n = int(plan.get("segments") or segments_pour(duree))
    duree_gen = NUM_FRAMES / SAVE_FPS + (n - 1) * (NUM_FRAMES - NUM_COND_FRAMES) / SAVE_FPS
    sr = 16000
    generateur = torch.Generator(device=rang); generateur.manual_seed(42)
    image = load_image(plan["image"])
    a_effacer = []

    def prete(x):  # complète de silence jusqu'à la durée générée
        manque = math.ceil((duree_gen - len(x) / sr) * sr)
        return np.append(x, [0.0] * manque) if manque > 0 else x

    if not deux:
        vocal = voix_isolee(voix[0], separateur, tmp); a_effacer.append(vocal)
        parole, _ = librosa.load(vocal, sr=sr)
        emb_g = pipe.get_audio_embedding(prete(parole), fps=SAVE_FPS * AUDIO_STRIDE, device=rang, sample_rate=sr, model_type=MODEL_TYPE)
        if torch.isnan(emb_g).any():
            raise ValueError("empreinte audio cassée (NaN)")
        son_final, emb_d, masques = voix[0], None, None
    else:
        gauche = voix_isolee(voix[0], separateur, tmp); droite = voix_isolee(voix[1], separateur, tmp)
        a_effacer += [gauche, droite]
        g, _ = librosa.load(gauche, sr=sr); d, _ = librosa.load(droite, sr=sr)
        g_brut, _ = librosa.load(voix[0], sr=sr); d_brut, _ = librosa.load(voix[1], sr=sr)
        if plan.get("audio_type", "add") == "add":   # l'un PUIS l'autre (interview)
            g_ext = np.concatenate([g, np.zeros_like(d)]); d_ext = np.concatenate([np.zeros_like(g), d])
            melange = np.concatenate([g_brut, np.zeros_like(d_brut)]) + np.concatenate([np.zeros_like(g_brut), d_brut])
        else:                                          # en même temps
            m = max(len(g), len(d)); g_ext = np.pad(g, (0, m - len(g))); d_ext = np.pad(d, (0, m - len(d)))
            mb = max(len(g_brut), len(d_brut)); melange = np.pad(g_brut, (0, mb - len(g_brut))) + np.pad(d_brut, (0, mb - len(d_brut)))
        son_final = f"/tmp/lot_{uid()}_melange.wav"; sf.write(son_final, melange, sr); a_effacer.append(son_final)
        emb_g = pipe.get_audio_embedding(prete(g_ext), fps=SAVE_FPS * AUDIO_STRIDE, device=rang, sample_rate=sr, model_type=MODEL_TYPE)
        emb_d = pipe.get_audio_embedding(prete(d_ext), fps=SAVE_FPS * AUDIO_STRIDE, device=rang, sample_rate=sr, model_type=MODEL_TYPE)
        if torch.isnan(emb_g).any() or torch.isnan(emb_d).any():
            raise ValueError("empreinte audio cassée (NaN)")
        # Masques de la démo sans « bbox » : chaque moitié de l'image, marges de 10 %.
        l_img, h_img = image.size
        fond = torch.zeros([h_img, l_img]); m1 = torch.zeros([h_img, l_img]); m2 = torch.zeros([h_img, l_img])
        e = 0.1; y0, y1 = int(h_img * e), int(h_img * (1 - e)); demi = l_img // 2
        m1[y0:y1, int(demi * e):int(demi * (1 - e))] = 1
        m2[y0:y1, int(demi * e + demi):int(demi * (1 - e) + demi)] = 1
        fond += m1; fond += m2
        fond = torch.where(fond > 0, torch.tensor(0), torch.tensor(1))
        masques = torch.stack([m1, m2, fond], dim=0).to(rang)

    def audio_de(debut):
        if emb_d is None:
            return fenetre(emb_g, debut, rang)
        return torch.cat([fenetre(emb_g, debut, rang), fenetre(emb_d, debut, rang)])

    commun = dict(prompt=plan["prompt"], negative_prompt=NEGATIF, num_frames=NUM_FRAMES, num_inference_steps=8,
                  text_guidance_scale=1.0, audio_guidance_scale=1.0, output_type="both", generator=generateur, use_distill=True)
    debut = 0
    extra = {"ref_target_masks": masques} if masques is not None else {}
    sortie, latent = pipe.generate_ai2v(image=image, resolution="480p", audio_emb=audio_de(debut), **commun, **extra)
    video = en_images(sortie); del sortie; torch_gc()
    toutes, courante, ref_latent = video, video, latent[:, :, :1].clone()
    l_v, h_v = video[0].size
    for s in range(1, n):
        debut += AUDIO_STRIDE * (NUM_FRAMES - NUM_COND_FRAMES)
        sortie, latent = pipe.generate_avc(video=courante, video_latent=latent, height=h_v, width=l_v, num_cond_frames=NUM_COND_FRAMES,
                                           use_kv_cache=True, offload_kv_cache=False, enhance_hf=False, audio_emb=audio_de(debut),
                                           ref_latent=ref_latent, ref_img_index=10, mask_frame_range=3, **commun, **extra)
        nouvelle = en_images(sortie); del sortie
        toutes.extend(nouvelle[NUM_COND_FRAMES:]); courante = nouvelle
    # Écrite sous un nom provisoire puis renommée : une machine interruptible coupée en pleine écriture ne doit pas
    # laisser un .mp4 tronqué que la reprise prendrait pour un plan fini.
    partiel = os.path.join(dossier, "." + plan["cle"] + ".partiel")
    save_video_ffmpeg(torch.from_numpy(np.array(toutes)), partiel, son_final, fps=SAVE_FPS, quality=5)
    os.replace(partiel + ".mp4", os.path.join(dossier, plan["cle"] + ".mp4"))
    for f in a_effacer:
        if f not in voix and os.path.exists(f):
            os.remove(f)
    del toutes, courante, latent, ref_latent; torch_gc()
    return len(voix), n, duree


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--checkpoint_dir", required=True)
    p.add_argument("--lot", required=True)
    p.add_argument("--sortie", required=True)
    p.add_argument("--use_int8", action="store_true")
    p.add_argument("--racine", default="", help="dossier contre lequel résoudre les chemins relatifs du lot")
    args = p.parse_args()
    os.makedirs(args.sortie, exist_ok=True)
    journal = open(os.path.join(args.sortie, "lot.jsonl"), "a", encoding="utf-8")

    def noter(ligne):
        print("[lot]", json.dumps(ligne, ensure_ascii=False), flush=True)
        journal.write(json.dumps(ligne, ensure_ascii=False) + "\n"); journal.flush()

    absolu = lambda c: c if os.path.isabs(c) or not args.racine else os.path.join(args.racine, c)
    plans = []
    for plan in json.load(open(args.lot, encoding="utf-8")):
        plan = dict(plan, image=absolu(plan["image"]), voix=[absolu(v) for v in plan["voix"]])
        if os.path.exists(os.path.join(args.sortie, plan["cle"] + ".mp4")):
            continue   # REPRISE : déjà rendu par cette machine ou par une précédente (machine interruptible reprise)
        # Une image FACULTATIVE — la teinte du jour d'Iggy, caméléon depuis le 16/09 — peut manquer (contrôle refusé, image
        # ratée) : on retombe sur sa photo de base plutôt que de perdre la PAROLE du présentateur sur tout un sujet.
        if not os.path.exists(plan["image"]) and plan.get("image_repli"):
            repli = absolu(plan["image_repli"])
            if os.path.exists(repli):
                print(f"[lot] {plan['cle']} : image absente → repli sur {os.path.basename(repli)}", flush=True)
                plan["image"] = repli
        manque = [c for c in [plan["image"], *plan["voix"]] if not os.path.exists(c)]
        if manque:     # une voix ratée ou une image absente : le plan saute, le Journal se monte sans lui
            noter({"cle": plan["cle"], "ok": False, "erreur": f"entrée manquante : {', '.join(map(os.path.basename, manque))}", "secondes": 0})
            continue
        plans.append(plan)
    print(f"[lot] {len(plans)} plan(s) à rendre", flush=True)
    if not plans:
        return     # rien à faire : on ne charge même pas le modèle
    rang = int(os.environ.get("RANK", "0")) % max(1, torch.cuda.device_count())
    torch.cuda.set_device(rang)
    dist.init_process_group(backend="nccl", timeout=datetime.timedelta(seconds=3600 * 24))
    context_parallel_util.init_context_parallel(context_parallel_size=1, global_rank=dist.get_rank(), world_size=dist.get_world_size())
    pipe, separateur, tmp = charger(args, rang)
    for plan in plans:
        t = time.time()
        try:
            nb, n, duree = un_plan(pipe, separateur, tmp, plan, args.sortie, rang)
            ligne = {"cle": plan["cle"], "ok": True, "voix": nb, "segments": n, "duree_voix": round(duree, 2), "secondes": round(time.time() - t)}
        except Exception as e:
            traceback.print_exc()
            ligne = {"cle": plan["cle"], "ok": False, "erreur": str(e)[:300], "secondes": round(time.time() - t)}
            torch_gc()
        noter(ligne)
    dist.destroy_process_group()


if __name__ == "__main__":
    main()
