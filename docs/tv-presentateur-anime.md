# Le présentateur qui parle — étude et décision

> Rédigé le 08/09/2026. Fait suite à la question « peut-on utiliser H3 ? ».
> Statut : **décision de modèle prise, mesures à faire.** Aucun rendu GPU n'a
> encore été lancé (fenêtre d'essai radio du partenaire ouverte ce soir-là).

## 1. Ce qu'on veut

Un plateau : un présentateur qui dit le journal face caméra, des invités qui
échangent avec lui, et — plus tard — des séries animées avec des personnages qui
parlent. Le tout **produit chaque jour**, comme la radio.

## 2. H3 est écarté, et pas pour une question de qualité

**MiniMax H3** (juillet 2026) est le meilleur modèle vidéo ouvert du moment ;
tout l'écosystème s'est rué dessus. Sa licence l'interdit :

> *« "Applicable Territory" means worldwide, excluding the Excluded Territories »*
> — Union européenne, Royaume-Uni, Corée du Sud, États-Unis.
> *« You may not use, reproduce, modify, distribute, or display the MiniMax H3
> Works or any of their **Outputs** outside the Applicable Territory. »*

Ce ne sont donc pas seulement les poids qui sont hors de portée : **les vidéos
produites ne sont pas licenciées en Europe**. Louer une machine hors UE n'y
change rien, puisque la diffusion se fait ici. (Leur API hébergée est un contrat
distinct, disponible mondialement — mais payante à l'unité, non souveraine, et
MiniMax s'y réserve l'usage des contenus pour améliorer ses services.)

Même verdict pour toute la famille **Hunyuan** (Tencent) : le « Territory » de
leur licence communautaire exclut également l'UE, le UK et la Corée.
⚠️ Cela vaut aussi pour `tencent/Hunyuan3D-2mv`, que la forge appelle
aujourd'hui pour l'option multi-vues — point à traiter séparément.

## 3. Ce qu'on retient : la famille Wan, Apache 2.0

Doctrine arrêtée le 08/09/2026 : **Apache 2.0 strict**. Aucun seuil de chiffre
d'affaires à surveiller, aucune zone interdite, aucune clause à renégocier si
DATASPACE grossit.

| Besoin | Modèle | Licence | Entrées |
|---|---|---|---|
| Le présentateur dit le journal | `Wan-AI/Wan2.2-S2V-14B` | Apache 2.0 | photo + piste audio (+ texte) |
| Le plateau à plusieurs voix | `MeiGen-AI/MeiGen-MultiTalk` | Apache 2.0 | photo + N pistes audio |
| Format long / doublage | `MeiGen-AI/InfiniteTalk` | Apache 2.0 | vidéo + audio |
| Séries animées (rejouer un acteur) | `Wan-AI/Wan2.2-Animate-2-14B` | Apache 2.0 | personnage + vidéo de référence |
| Plans d'illustration animés | `Wan-AI/Wan2.2-TI2V-5B` | Apache 2.0 | texte ou image |

Le point important : **un présentateur qui parle n'est pas de la vidéo à partir
de texte**, c'est de la vidéo pilotée par la voix. C'est précisément ce que font
S2V et MultiTalk — et ce que H3 ne fait pas nativement. Le remplaçant est donc
meilleur que l'original pour notre usage, en plus d'être libre.

Écarté sous cette doctrine : **LTX-2.5** (le seul à faire l'audio natif
synchronisé) — licence communautaire, gratuite sous 10 M$ de CA, mondiale, mais
avec un seuil. À reconsidérer si l'audio natif devient décisif.

Le seuil n'est pas qu'une formalité : la licence LTX prévoit, en cas de
manquement, des **dommages forfaitaires au double des redevances dues**. Ce n'est
donc pas un risque d'aujourd'hui mais une **dette à déclenchement différé — elle
se réveille le jour où l'entreprise réussit** (formulation de la session
DATASPACE, qui a vérifié le texte de son côté le 08/09/2026).

⚠️ **Conséquences à traiter** (côté DATASPACE, hors de ce dépôt) :

1. La capacité `video` installe `Lightricks/LTX-Video` en affirmant
   « Apache-2.0 » : faux, le Hub le classe en licence communautaire. **Commentaire
   corrigé le 08/09/2026** par la session DATASPACE. **Le fondateur a tranché le
   11/09/2026** (backlog DATASPACE n°38) : bascule vers Wan 2.2 *après l'essai*,
   dans cet ordre — (1) mesures de `Wan2.2-TI2V-5B`, (2) image de station
   reconstruite avec les poids (cf. §4), (3) bascule de l'installeur `video`,
   (4) retrait de LTX. **LTX reste en service d'ici là** pour le studio de la
   forge. La TV, elle, n'obtient de clips animés que par `POST /api/v1/animate`,
   fermée (503) tant que `VIDEO_STATIONS_WAN=1` n'est pas posé — et c'est la
   session DATASPACE qui le pose, à l'étape 3, personne d'autre.
2. `stabilityai/sdxl-turbo` (`license:other`, non commercial) n'est plus posé sur
   les nouvelles stations, mais **le chemin de repli l'utilise encore** pour les
   stations déjà installées. Sous doctrine stricte, ce reliquat doit disparaître.

## 4. Ce que ça coûte vraiment — et ce que ça impose au montage

**Mesuré le 10/09/2026** sur une A100 80 Go PCIe louée, avec le code officiel et
`--offload_model True --convert_model_dtype` (résultats : `~/essai-s2v/resultats/`
sur le poste de l'essai) :

- **32,6 Go de poids** (dépôt de 49 Go). C'est le chiffre qui commande l'allumage.
- **VRAM crête : 56,8 Go.** Une carte de 48 Go ne suffit pas, nos RTX 3090
  (24 Go) non plus. ⚠️ Ce document annonçait « 24 Go suffisent » d'après des
  retours publics : **c'était faux**. Le README officiel l'écrit en toutes
  lettres — *« at least 80GB VRAM »*, même avec les options d'économie. En
  pratique : A100 ou H100 de 80 Go. (`--t5_cpu` n'a pas été mesuré ; il ne
  descendrait pas sous 48 Go.)
- **61 min de calcul pour 9,3 s de voix** (sortie 960×640, 16 i/s, H.264 + AAC ;
  2 segments de 40 étapes, 41 puis 46 s par étape), soit **~6,6 min de GPU par
  seconde de plan**. La durée du clip suit celle de l'audio fourni.
  `--sample_steps` permet de réduire les étapes : piste non mesurée.
- S2V n'est **pas** dans diffusers : il faut le dépôt officiel `Wan-Video/Wan2.2`
  et `generate.py --task s2v-14B`.

### La conséquence de conception

Au rythme mesuré, un JT entier de trois minutes animé demanderait **~20 h d'A100
par jour** (~1 $/h constaté) : quatre fois le plafond quotidien, qui est partagé
avec la radio (5 $/jour, 20 $/semaine, 35 $/mois). Même 30 s de plateau par jour,
c'est ~3 h 20 de GPU.

**On n'anime donc pas tout.** On fait ce que fait une vraie télévision :

- le **plateau** est animé — lancement, transitions, échanges avec l'invité ;
- les **sujets** restent des images fixes avec mouvement de caméra et voix-off,
  ce que la chaîne actuelle sait déjà faire pour quelques centimes ;
- la voix, elle, est produite pour tous les plans (Piper, sur processeur). Le
  fondateur l'a jugée robotique le 11/09/2026 : les voix de la TV doivent passer
  sur des **voix clonées** (Chatterbox, par les stations DATASPACE).

Ce n'est pas un compromis de pauvreté : c'est la grammaire du journal télévisé.

### Le prérequis dur : l'image de station

32,6 Go téléchargés à chaque location seraient absurdes (temps d'allumage déjà
mesuré à ~35 min, facturé). Le présentateur animé suppose donc une **image de
station pré-cuite embarquant les poids** — le même chantier que celui déjà ouvert
pour la 3D.

⚠️ **Et cette image est CASSÉE depuis le 23/07/2026** (numpy 2.x, tiktoken) :
les installeurs ont été corrigés, l'image ne l'a jamais été. Confirmé par la
session DATASPACE le 08/09/2026. Conséquence directe sur l'ordre des travaux :

> **Reconstruire l'image AVANT toute bascule du moteur vidéo.** Migrer sans elle,
> c'est échanger une dette juridique contre une station inutilisable : ce n'est pas
> le coût qui pique (0,0674 $/h) mais la latence — l'allumage passerait de 35 min à
> plus du double, à chaque location.

Pour S2V, le coût pique aussi : il faut une carte de 80 Go (~1 $/h), et chaque
minute d'allumage y coûte ~15 fois plus cher que sur une RTX 3090.

Tant que l'image n'est pas refaite, S2V reste un **essai manuel** sur machine
louée, pas un service quotidien.

## 5. Protocole d'essai (à faire hors fenêtre radio, budget à surveiller)

1. ✅ Louer une machine de 80 Go (pas « ≥ 24 Go » : cf. §4), y installer le dépôt
   officiel Wan2.2 et les poids — fait le 10/09/2026, A100 80 Go, ~2 $ au total.
2. ✅ Fournir **une photo de présentateur** et **la piste de voix-off** produite par
   `tv-voice.ts`. ⚠️ La photo de l'essai est une photo de TEST : ne jamais la
   publier. Celle de l'antenne sera générée par la forge, donc à nous.
3. ✅ Mesurer minutes de calcul, VRAM crête et coût réel (cf. §4 ; un seul format
   mesuré, 960×640). ⏳ **Reste le juge principal : la synchronisation labiale en
   français**, c'est là que ces modèles déçoivent le plus souvent. La vidéo
   attend le verdict du fondateur.
4. ⏳ Décider seulement ensuite : industrialiser (image + capacité `s2v`) ou non.
   À comparer avant de trancher : `MeiGen-AI/InfiniteTalk` et `MultiTalk` (même
   licence, même famille Wan).

Ne pas industrialiser avant d'avoir vu un plan sortir. Les capacités installées
« au cas où » ont déjà coûté cher.

## 6. Lié

- `src/lib/tv-voice.ts` — la voix, déjà en place, qui servira d'entrée à S2V
- `../infinity/docs/tv-broadcast-spec.md` — la spec TV d'origine (18/07/2026)
- `app/api/spot/video-install/route.js` (DATASPACE) — la capacité `video` à basculer
