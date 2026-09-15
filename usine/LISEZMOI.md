# L'usine de nuit

Décision du fondateur (14/09/2026) : la production doit tourner **même si le poste A ou B est fermé**, de
façon autonome, avec des sécurités, des renforts et des alternatives. L'usine est la pièce qui fabrique
les travaux lourds (personnages qui parlent, images, voix inventées, bientôt le JT de 15 minutes) sur
**une seule machine louée par nuit**, orchestrée depuis le hub DATASPACE, toujours allumé.

## Comment ça marche

1. Un dossier de travail sur le hub : `travail.sh` (ce que la machine exécute) et `entrees/`.
2. `orchestre.sh` loue une machine Vast.ai (après avoir **vérifié le crédit**), arme un **filet systemd**
   indépendant, copie le travail, le lance, le suit, **rapatrie** `resultats/`, puis **détruit** la
   machine et vérifie sa disparition. Toute anomalie part sur le canal d'alerte de la sonde DATASPACE.
3. Les modèles viennent de Hugging Face, **ModelScope en secours** (`telecharger.sh`) : mêmes
   identifiants, aucun poids stocké chez DATASPACE (pas la place, 21 Go libres au plus petit serveur).
4. Les dépendances Python sont **figées** (versions exactes) : aucune surprise d'installation la nuit.

## Les règles qui ne se négocient pas

- Une étiquette **par travail**, jamais « dataspace… » (réservée aux stations : `vast.py` la refuse).
- Destruction en **v1 puis v0**, vérifiée sur une **liste fraîche** (le DELETE v1 rend toujours 404 : une
  machine a tourné 8 h 47 au lieu de 75 min le 11/09).
- Offres classées au **coût total** (heures + bande passante + disque), jamais au seul tarif horaire : le
  14/09, la moins chère à l'heure (0,18 $/h) coûtait 2,77 $ au pire, contre 0,56 $ pour une à 0,24 $/h.
- Crédit Vast lu **avant** de louer : refus sous `max(20 $, 5 × pire cas)`. Le plancher de DATASPACE
  (1,5 $) ne prévient qu'au dernier moment, et le compte est PARTAGÉ avec les stations des clients
  payants : si le solde est juste, c'est l'usine qui attend (20 $ au lieu de 10 : condition de la session
  DATASPACE, 15/09/2026).
- La surveillance est tenue par le **hub**, jamais par un poste qui peut s'endormir.
- Ne jamais toucher à `gpuManualMaxHours` (réglage global partagé avec DATASPACE).
- Une machine **injoignable n'est pas un travail fini** : avant le 15/09, le suivi prenait l'échec du SSH
  pour la fin du travail — une machine interruptible reprise par le loueur aurait tout emporté.

## Machines interruptibles et reprise (15/09/2026)

Le fondateur a dit oui aux machines **interruptibles** « si ça ne nuit pas à la qualité » : c'est la même
carte, le même modèle, le même résultat — seul risque, le loueur reprend la machine en cours de route. Le
15/09, une H100 SXM coûtait 0,65 $/h en enchère contre 1,94 $/h à la demande (2,48 $/h payés pour le pilote 2).

- `USINE_INTERRUPTIBLE=1` : location en enchère (`"price"` dans la location, comme `vast-cli --bid_price`),
  à l'enchère minimale du moment + 15 % (`USINE_ENCHERE_MARGE`). Le tri et le budget jugent ce prix-là.
- `USINE_REPRISES=N` : si la machine disparaît (état Vast ≠ `running`, ou 3 minutes sans SSH), elle est
  détruite et l'orchestre en loue une autre, N fois au plus, sous `USINE_BUDGET_TOTAL` (toutes machines
  comprises) et `USINE_ECHEANCE_TOTALE_MIN`.
- Rapatriement **au fil de l'eau** (rsync toutes les 5 minutes, `USINE_SYNCHRO`) : une interruption ne
  coûte que le travail en cours. Sur la machine suivante, tout ce qui est fini est rapporté AVANT le
  lancement.
- Contrat de `travail.sh` : sauter ce qui existe déjà dans `resultats/`, écrire sous un nom commençant par
  un point puis renommer (un fichier tronqué n'est jamais pris pour fini), et poser `resultats/FINI` à la fin.

## Mesures qui ont servi à la concevoir (14/09/2026)

| Travail | Machine | Durée | Coût |
|---|---|---|---|
| Banc « lézard qui parle » (InfiniteTalk + LongCat, 6 clips) | H100 PCIe | 70 min | 3,90 $ |
| Voix inventées (72 candidats + tri) | RTX 4500 Ada | 13 min | 0,07 $ |
| Rendus Chatterbox + 20 images | RTX 4500 Ada | 8 min | 0,06 $ |
| Casting Freeworld (96 voix, 48 rendus, 24 images) | RTX 3090 | 40 min | 0,15 $ |
| Pilote 1 du Journal (voix, générique, 4 plans LongCat, 49 s de vidéo) | H100 NVL | 33 min | 1,82 $ |
| Pilote 2 (2 plans LongCat, 26 s, modèle chargé UNE fois en 52 s) | H100 PCIe | 19 min | 0,90 $ |

LongCat-Video-Avatar 1.5 distillé, 480p : **~31 s de calcul H100 PCIe par seconde de vidéo** (15/09). Un
Journal de 15 minutes tout parlé ≈ 7,8 h de carte : ~20 $ à la demande, ~5-6 $ en interruptible.
