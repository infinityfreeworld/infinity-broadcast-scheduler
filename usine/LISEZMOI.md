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
- Crédit Vast lu **avant** de louer : refus sous `max(10 $, 5 × pire cas)`. Le plancher de DATASPACE
  (1,5 $) ne prévient qu'au dernier moment.
- La surveillance est tenue par le **hub**, jamais par un poste qui peut s'endormir.
- Ne jamais toucher à `gpuManualMaxHours` (réglage global partagé avec DATASPACE).

## Mesures qui ont servi à la concevoir (14/09/2026)

| Travail | Machine | Durée | Coût |
|---|---|---|---|
| Banc « lézard qui parle » (InfiniteTalk + LongCat, 6 clips) | H100 PCIe | 70 min | 3,90 $ |
| Voix inventées (72 candidats + tri) | RTX 4500 Ada | 13 min | 0,07 $ |
| Rendus Chatterbox + 20 images | RTX 4500 Ada | 8 min | 0,06 $ |
| Casting Freeworld (96 voix, 48 rendus, 24 images) | RTX 3090 | 40 min | 0,15 $ |
