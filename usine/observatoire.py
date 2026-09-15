#!/usr/bin/env python3
"""🔭 L'observatoire des prix des cartes — en LECTURE SEULE (aucune location), une fois par heure sur le hub.

Fondateur (15/09/2026) : « comment limiter le coût et la durée ? ». Le marché Vast bouge à l'heure : ce soir-là, 4 H100 en
enchère à 0,40 $/h la carte, reprises vingt minutes plus tard. Avant de payer un banc de cartes moins chères (piste 3) ou de
choisir l'heure d'une location (piste 5), on relève : par catégorie (H100 ×1, ×2, ×4 ; cartes de 44 à 50 Go), en enchère et à
la demande, le meilleur prix PAR CARTE, le nombre d'offres, et — pour les H100 — le coût d'un Journal de 15 min sur la
meilleure offre (l'animation se partage entre les cartes, cf. animer.sh). La vitesse des cartes de 48 Go est inconnue : pour
elles, le prix seul.

  python3 observatoire.py            relève, ajoute une ligne à observatoire.jsonl (30 jours gardés)
  python3 observatoire.py resume     minimums et médianes par catégorie, et le Journal de 15 min par heure (UTC)
La clé Vast est lue dans les réglages DATASPACE, jamais affichée. OBS_OFFRES=fichier.json remplace Vast (essais hors ligne).
"""
import datetime, json, os, statistics, sys, urllib.parse, urllib.request

ICI = os.path.dirname(os.path.abspath(__file__))
FICHIER = os.environ.get("OBS_FICHIER", os.path.join(ICI, "observatoire.jsonl"))
ANIM_H, FIXE_H, GO, JOURS, MARGE = 7.8, 0.6, 150, 30, 0.15   # un Journal de 15 min : ~7,8 h d'animation sur H100, 0,6 h fixes
H100 = {"gpu_ram": {"gte": 79000}, "compute_cap": {"gte": 900, "lte": 900}, "cpu_ram": {"gte": 128000}}
CATEGORIES = {
    "h100x1": dict(H100, num_gpus={"eq": 1}),
    "h100x2": dict(H100, num_gpus={"eq": 2}),
    "h100x4": dict(H100, num_gpus={"eq": 4}),
    "48go": {"gpu_ram": {"gte": 44000, "lte": 50000}, "compute_cap": {"gte": 800, "lte": 890}, "num_gpus": {"gte": 1, "lte": 4},
             "cpu_ram": {"gte": 64000}},
}
BASE = {"rentable": {"eq": True}, "verified": {"eq": True}, "reliability2": {"gte": 0.97}, "cuda_max_good": {"gte": 12.4},
        "disk_space": {"gte": 300}, "inet_down": {"gte": 500}, "order": [["dph_total", "asc"]], "limit": 200}


def dans(o, cle, borne):
    v = o.get(cle)
    return v is not None and all((op == "eq" and v == b) or (op == "gte" and v >= b) or (op == "lte" and v <= b) for op, b in borne.items())


def offres(filtre):
    """Les offres de ce filtre, ou None si Vast ne répond pas (noté tel quel, jamais inventé)."""
    if os.environ.get("OBS_OFFRES"):
        return [o for o in json.load(open(os.environ["OBS_OFFRES"]))
                if o.get("type", "bid") == filtre["type"] and all(dans(o, k, filtre[k]) for k in ("gpu_ram", "num_gpus"))]
    cle = json.load(open(os.environ.get("USINE_REGLAGES", "/var/lib/dataspace/settings.json"))).get("vastApiKey") or ""
    req = urllib.request.Request("https://console.vast.ai/api/v0/bundles/?q=" + urllib.parse.quote(json.dumps(filtre)),
                                 headers={"Authorization": "Bearer " + cle, "Accept": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=40)).get("offers", [])
    except Exception:
        return None


def releve():
    ligne = {"t": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="minutes"), "cat": {}}
    for sorte in ("bid", "on-demand"):
        for nom, f in CATEGORIES.items():
            liste = offres(dict(BASE, **f, type=sorte))
            if liste is None:
                ligne["cat"][f"{nom}-{sorte}"] = None
                continue
            meilleur = None
            for o in liste:
                n = max(1, int(o.get("num_gpus") or 1))
                dph = o["dph_total"]
                if sorte == "bid" and o.get("min_bid"):   # notre prix : l'enchère minimale + 15 %, comme vast.py
                    dph = dph - o["min_bid"] + round(o["min_bid"] * (1 + MARGE), 3)
                v = {"carte": round(dph / n, 3), "n": n, "gpu": o.get("gpu_name"), "lieu": str(o.get("geolocation"))[:30]}
                if nom.startswith("h100"):
                    v["journal15"] = round(dph * (FIXE_H + ANIM_H / n) + GO * (o.get("inet_down_cost") or 0), 2)
                cle_tri = "journal15" if "journal15" in v else "carte"
                if meilleur is None or v[cle_tri] < meilleur[cle_tri]:
                    meilleur = v
            ligne["cat"][f"{nom}-{sorte}"] = dict(meilleur or {}, offres=len(liste))
    return ligne


def resume():
    lignes = [json.loads(l) for l in open(FICHIER, encoding="utf-8") if l.strip()] if os.path.exists(FICHIER) else []
    if not lignes:
        print("aucun relevé"); return
    print(f"{len(lignes)} relevé(s), du {lignes[0]['t']} au {lignes[-1]['t']} (UTC)")
    for c in sorted({c for l in lignes for c in l["cat"]}):
        val = [l["cat"][c] for l in lignes if l["cat"].get(c) and l["cat"][c].get("carte") is not None]
        if not val:
            print(f"  {c:16s} aucune offre"); continue
        cartes, j = [v["carte"] for v in val], [v["journal15"] for v in val if v.get("journal15") is not None]
        print(f"  {c:16s} {len(val):3d} relevé(s) · la carte : min {min(cartes):.2f}, médiane {statistics.median(cartes):.2f} $/h"
              + (f" · Journal de 15 min : min {min(j):.2f}, médiane {statistics.median(j):.2f} $" if j else ""))
    par_heure = {}
    for l in lignes:
        j = [v["journal15"] for k, v in l["cat"].items() if v and k.endswith("-bid") and v.get("journal15") is not None]
        if j:
            par_heure.setdefault(l["t"][11:13], []).append(min(j))
    if par_heure:
        print("  Journal de 15 min, meilleure H100 en enchère, par heure UTC : "
              + " · ".join(f"{h} h {statistics.median(v):.1f} $" for h, v in sorted(par_heure.items())))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "resume":
        resume()
        sys.exit(0)
    ligne = releve()
    limite = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=JOURS)).isoformat(timespec="minutes")
    gardees = [l for l in open(FICHIER, encoding="utf-8") if l.strip() and json.loads(l)["t"] >= limite] if os.path.exists(FICHIER) else []
    with open(FICHIER + ".tmp", "w", encoding="utf-8") as f:   # écrit à côté puis renommé : jamais un fichier à moitié écrit
        f.writelines(gardees)
        f.write(json.dumps(ligne, ensure_ascii=False) + "\n")
    os.replace(FICHIER + ".tmp", FICHIER)
    meilleur = min((v for v in ligne["cat"].values() if v and v.get("journal15") is not None), key=lambda v: v["journal15"], default=None)
    print(ligne["t"], "·", f"meilleur Journal de 15 min : {meilleur['journal15']} $ ({meilleur['n']}× {meilleur['gpu']}, "
          f"{meilleur['carte']} $/h la carte, {meilleur['lieu']})" if meilleur else "aucune offre H100 lisible")
