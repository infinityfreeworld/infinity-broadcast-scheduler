#!/usr/bin/env python3
# 🏭 USINE DE NUIT — appels Vast.ai directs : crédit, location, destruction VÉRIFIÉE.
#
# Généralisé le 14/09/2026 à partir des quatre essais du jour (banc-jt, seance-jt 1-3). Leçons gravées
# ici parce qu'elles ont coûté cher (cf. mémoire « essai GPU manuel ») :
#   · DELETE /api/v1/instances/{id}/ rend TOUJOURS 404 : une machine a tourné 8 h 47 au lieu de 75 min.
#     On détruit en v1 PUIS en v0 (barre oblique finale), et l'on VÉRIFIE sur une liste fraîche.
#   · On ne touche qu'à SON étiquette. Les stations de DATASPACE (« dataspace-auto… ») sont refusées.
#   · La clé est lue dans les réglages DATASPACE et n'est JAMAIS affichée.
#   · Crédit contrôlé AVANT de louer (conseil de la session DATASPACE : son plancher de 1,5 $ ne
#     prévient qu'au dernier moment).
#
#   USINE_ETIQUETTE=usine-jt python3 vast.py info|credit|louer|machine|detruire
import json, os, sys, time, urllib.error, urllib.parse, urllib.request

ETIQ = os.environ.get("USINE_ETIQUETTE", "").strip()
if not ETIQ:
    sys.exit("USINE_ETIQUETTE obligatoire (aucune valeur par défaut : deux travaux ne doivent jamais partager une étiquette)")
if ETIQ.startswith("dataspace"):
    sys.exit(f"étiquette refusée ({ETIQ}) : « dataspace… » désigne les stations de DATASPACE, jamais une machine de l'usine")

REGLAGES = os.environ.get("USINE_REGLAGES", "/var/lib/dataspace/settings.json")
CLE = json.load(open(REGLAGES)).get("vastApiKey") or ""
BASE = "https://console.vast.ai"
IMAGE = os.environ.get("USINE_IMAGE", "nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04")
BUDGET = float(os.environ.get("USINE_BUDGET", "3"))          # pire cas autorisé pour CE travail ($)
HEURES = float(os.environ.get("USINE_HEURES", "2"))          # durée maximale facturable
GO = float(os.environ.get("USINE_GO", "60"))                 # Go téléchargés (frais de bande)
DISQUE = int(os.environ.get("USINE_DISQUE", "120"))          # Go de disque
# Ne jamais descendre sous ce crédit. 20 $ et non 10 (condition de la session DATASPACE, 15/09/2026) : le compte
# Vast est PARTAGÉ avec les stations des clients payants ; si le solde est juste, c'est l'usine qui attend.
CREDIT_MIN = float(os.environ.get("USINE_CREDIT_MIN", "20"))
# Filtre par défaut : une carte de 24-48 Go Ampere/Ada (compute 8.6-8.9 ; Blackwell 12.0 n'a pas de
# noyaux dans torch 2.4-2.6). USINE_FILTRE (JSON) surcharge clé par clé, ex. {"gpu_ram": {"gte": 79000}}.
FILTRE = {
    "rentable": {"eq": True}, "verified": {"eq": True}, "num_gpus": {"eq": 1}, "reliability2": {"gte": 0.97},
    "gpu_ram": {"gte": 23000, "lte": 50000}, "compute_cap": {"gte": 860, "lte": 890}, "cuda_max_good": {"gte": 12.4},
    "cpu_ram": {"gte": 64000}, "disk_space": {"gte": DISQUE}, "inet_down": {"gte": 500},
    "type": "on-demand", "order": [["dph_total", "asc"]], "limit": 100,   # large : le tri final est au coût TOTAL
}
FILTRE.update(json.loads(os.environ.get("USINE_FILTRE", "{}")))
# Machines INTERRUPTIBLES (fondateur, 15/09/2026 : « oui, si ça ne nuit pas à la qualité ») : même carte, même
# modèle, même résultat ; seul risque, le loueur reprend la machine — l'orchestre repart alors sur une autre
# (USINE_REPRISES). 3 à 4 fois moins cher : le 15/09, H100 SXM à 0,65 $/h en enchère contre 1,94 $/h à la demande.
INTERRUPTIBLE = os.environ.get("USINE_INTERRUPTIBLE", "") == "1"
MARGE = float(os.environ.get("USINE_ENCHERE_MARGE", "0.15"))   # au-dessus de l'enchère minimale : moins souvent évincé
if INTERRUPTIBLE:
    FILTRE["type"] = "bid"


def appel(chemin, methode="GET", corps=None):
    data = json.dumps(corps).encode() if corps is not None else None
    h = {"Authorization": "Bearer " + CLE, "Accept": "application/json"}
    if data:
        h["Content-Type"] = "application/json"
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + chemin, data=data, method=methode, headers=h), timeout=40) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"erreur": str(e)[:120]}


def mienne():
    s, j = appel("/api/v1/instances/")
    if s != 200:
        return "ERREUR"
    return next((i for i in j.get("instances", []) if i.get("label") == ETIQ), None)


def credit():
    s, j = appel("/api/v0/users/current/")
    if s != 200:
        return None
    for k in ("credit", "balance", "current_balance"):
        if j.get(k) is not None:
            try:
                return float(j[k])
            except (TypeError, ValueError):
                pass
    return None


def seuil_credit():
    # Jamais sous CREDIT_MIN, et toujours de quoi payer CINQ fois le pire cas de ce travail.
    return max(CREDIT_MIN, 5 * BUDGET)


def pire_cas(o):
    # Ce que CE travail peut coûter au pire sur cette offre : les heures, la bande passante, le disque.
    return HEURES * o["dph_total"] + GO * (o.get("inet_down_cost") or 0) + DISQUE * (o.get("storage_cost") or 0) / 730 * HEURES


def enchere(o):
    # Notre offre pour une machine interruptible : l'enchère minimale du moment, plus une marge.
    return round((o.get("min_bid") or o["dph_total"]) * (1 + MARGE) + 0.005, 3)


cmd = sys.argv[1] if len(sys.argv) > 1 else "info"
if cmd == "info":
    i = mienne()
    if i == "ERREUR":
        print("ERREUR"); sys.exit(1)
    if not i:
        print("AUCUNE"); sys.exit(0)
    debut = float(i.get("start_date") or 0); dph = float(i.get("dph_total") or 0)
    cout = dph * max(0.0, time.time() - debut) / 3600 if debut else -1
    print(i.get("id"), i.get("actual_status") or "?", i.get("ssh_host") or "-", i.get("ssh_port") or "-",
          f"{dph:.3f}", f"{cout:.3f}", (i.get("gpu_name") or "?").replace(" ", "_"))
elif cmd == "credit":
    c = credit()
    print("ILLISIBLE" if c is None else f"{c:.2f}", f"seuil={seuil_credit():.2f}")
elif cmd == "louer":
    i = mienne()
    if i == "ERREUR":
        print("ERREUR liste"); sys.exit(2)
    if i:
        print("DEJA", i.get("id"), i.get("gpu_name")); sys.exit(0)
    c = credit()
    if c is None:
        print("CREDIT_ILLISIBLE : location refusée (on ne loue pas à l'aveugle)"); sys.exit(3)
    if c < seuil_credit():
        print(f"CREDIT_INSUFFISANT {c:.2f} $ < seuil {seuil_credit():.2f} $ : location refusée"); sys.exit(3)
    f = os.path.join(os.path.dirname(os.path.abspath(__file__)), "exclues.txt")
    EXCLUES = set(open(f).read().split()) if os.path.exists(f) else set()
    s, j = appel("/api/v0/bundles/?q=" + urllib.parse.quote(json.dumps(FILTRE)))
    offres = j.get("offers", []) if s == 200 else []
    if INTERRUPTIBLE:
        # Le tri et le budget jugent le prix que l'on PROPOSE : la carte à notre enchère, le reste (disque…) inchangé.
        for o in offres:
            o["_enchere"] = enchere(o)
            o["dph_total"] = o["dph_total"] - o["min_bid"] + o["_enchere"] if o.get("min_bid") else o["_enchere"]
    # Classées par COÛT TOTAL, pas au tarif horaire : pour un petit travail, la bande passante pèse plus
    # que l'heure (14/09/2026 : 0,18 $/h au Vietnam = 2,77 $ au pire, contre 0,56 $ à 0,24 $/h aux Pays-Bas).
    for o in sorted(offres, key=lambda o: (pire_cas(o), o["dph_total"])):
        if str(o.get("machine_id")) in EXCLUES:
            continue   # hôte qui s'est déjà bloqué au démarrage
        pire = pire_cas(o)
        if pire > BUDGET:
            continue
        corps = {"image": IMAGE, "disk": DISQUE, "runtype": "ssh", "label": ETIQ, "target_state": "running"}
        if INTERRUPTIBLE:
            corps["price"] = o["_enchere"]   # un prix dans la location = une machine interruptible (vast-cli --bid_price)
        s, r = appel(f"/api/v0/asks/{o['id']}/", "PUT", corps)
        if s == 200 and (r.get("success") or r.get("new_contract")):
            print("LOUEE", o["id"], r.get("new_contract"), o.get("gpu_name"), f"{o['dph_total']:.3f}$/h",
                  "INTERRUPTIBLE" if INTERRUPTIBLE else "à la demande",
                  o.get("geolocation"), f"pire={pire:.2f}$", f"credit={c:.2f}$"); sys.exit(0)
        print("REFUSEE", o["id"], s, str(r)[:80])
    print("RIEN", len(offres), "offre(s)"); sys.exit(2)
elif cmd == "machine":
    i = mienne()
    print(i.get("machine_id") if isinstance(i, dict) else "-")
elif cmd == "detruire":
    for essai in range(4):
        i = mienne()
        if i == "ERREUR":
            time.sleep(15); continue
        if not i:
            print("DISPARUE (vérifié)"); sys.exit(0)
        s1, r1 = appel(f"/api/v1/instances/{i['id']}/", "DELETE")
        print("DELETE v1", i["id"], s1, str(r1)[:80])
        s2, r2 = appel(f"/api/v0/instances/{i['id']}/", "DELETE")
        print("DELETE v0", i["id"], s2, str(r2)[:80])
        time.sleep(8)
        if mienne() is None:
            print("DISPARUE (vérifié)"); sys.exit(0)
        time.sleep(12)
    print("⚠ DESTRUCTION NON CONFIRMÉE — vérifier sur Vast"); sys.exit(1)
else:
    sys.exit(f"commande inconnue : {cmd}")
