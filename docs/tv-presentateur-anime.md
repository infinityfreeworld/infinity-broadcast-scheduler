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

⚠️ **Conséquence à traiter** : la capacité `video` des stations DATASPACE
installe aujourd'hui `Lightricks/LTX-Video`, en affirmant en commentaire
« Apache-2.0 » alors que le Hub le classe en licence communautaire. Sous
doctrine stricte, cette capacité doit basculer sur Wan 2.2.

## 4. Ce que ça coûte vraiment — et ce que ça impose au montage

Chiffres relevés sur la fiche du modèle et les retours publics, **à confirmer par
nos propres mesures** :

- **32,6 Go de poids** (dépôt de 49 Go). C'est le chiffre qui commande tout.
- **24 Go de VRAM** suffisent avec `--offload_model True --convert_model_dtype
  --t5_cpu` (au-delà de 80 Go, ces options sautent). Nos RTX 3090 passent ; une
  3060 (12 Go) est hors jeu.
- **Ordre de grandeur : plusieurs minutes de calcul pour quelques secondes de
  plan.** La durée du clip suit celle de l'audio fourni.
- S2V n'est **pas** dans diffusers : il faut le dépôt officiel `Wan-Video/Wan2.2`
  et `generate.py --task s2v-14B`.

### La conséquence de conception

Animer un JT entier de trois minutes, c'est des heures de GPU par jour — sous le
plafond mensuel, mais au prix de la radio, qui partage la même machine et le même
budget (5 $/jour, 20 $/semaine, 35 $/mois).

**On n'anime donc pas tout.** On fait ce que fait une vraie télévision :

- le **plateau** est animé — lancement, transitions, échanges avec l'invité ;
- les **sujets** restent des images fixes avec mouvement de caméra et voix-off,
  ce que la chaîne actuelle sait déjà faire pour quelques centimes ;
- la voix, elle, est produite pour tous les plans (Piper, sur processeur).

Ce n'est pas un compromis de pauvreté : c'est la grammaire du journal télévisé.

### Le prérequis dur : l'image de station

32,6 Go téléchargés à chaque location seraient absurdes (temps d'allumage déjà
mesuré à ~35 min, facturé). Le présentateur animé suppose donc une **image de
station pré-cuite embarquant les poids** — le même chantier que celui déjà ouvert
pour la 3D. Tant qu'elle n'est pas reconstruite, S2V reste un essai manuel sur
machine louée, pas un service quotidien.

## 5. Protocole d'essai (à faire hors fenêtre radio, budget à surveiller)

1. Louer une machine ≥ 24 Go, y installer le dépôt officiel Wan2.2 et les poids.
2. Fournir **une photo de présentateur** (générée par la forge, donc à nous) et
   **la piste de voix-off** déjà produite par `tv-voice.ts`.
3. Mesurer, pour un plan de 5 s en 480p puis en 720p : minutes de calcul, VRAM
   crête, coût réel, et surtout **la qualité de la synchronisation labiale en
   français** — c'est là que ces modèles déçoivent le plus souvent.
4. Décider seulement ensuite : industrialiser (image + capacité `s2v`) ou non.

Ne pas industrialiser avant d'avoir vu un plan sortir. Les capacités installées
« au cas où » ont déjà coûté cher.

## 6. Lié

- `src/lib/tv-voice.ts` — la voix, déjà en place, qui servira d'entrée à S2V
- `../infinity/docs/tv-broadcast-spec.md` — la spec TV d'origine (18/07/2026)
- `app/api/spot/video-install/route.js` (DATASPACE) — la capacité `video` à basculer
