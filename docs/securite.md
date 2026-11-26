# La sécurité imposée par le kit

Le vérificateur de sources n'est pas un bac à sable. Il évite des erreurs courantes, mais du code Node,
ses dépendances ou des imports indirects peuvent le contourner. N'exécuter que des connecteurs relus
et de confiance. Un endpoint GET doit réellement lire ; le nom d'une cible Stop ne garantit pas son effet.
La version anglaise des limites et des tests est dans [developers.en.md](developers.en.md).

Diagnostic et RSC : processus Windows `--lecture-seule`, aucune commande matérielle, seulement lectures
GATT et abonnements aux notifications (CCCD). Vitesse déclarée : aucune radio ni requête matérielle.
Stop ne bloque pas derrière une lecture ; les capacités d'écriture appartiennent à chaque opération et
expirent à sa fin. Une coupure entre demande de contrôle FTMS et Stop invalide l'opération sans la rejouer.

Le connecteur [HTTP local](http-local.md) se limite à une adresse de boucle locale littérale et aux chemins
`GET /telemetry` et `POST /stop`. Le transport refuse les redirections et les réponses de plus de 16 Kio.
Il ignore les mandataires d'environnement. Le jeton du service local est distinct du jeton d'accès au pont.

Règle de Romeria : **le jeu n'accélère jamais le tapis et ne le démarre jamais**. Seules les actions vers plus lent ou l'arrêt sont permises, et le kit ne permet que l'arrêt. Voici où et comment elle est tenue, couche par couche.

## 1. Au chargement : le connecteur et ses cibles (`src/kit.ts`, `checkConnector`)

- Un connecteur n'a que `name`, `stopTargets`, `open`, `read`, `stop` et `close`.
  - Toute autre propriété est refusée.
  - Un nom qui ressemble à une commande (`start`, `resume`, `speed`, `incline`, `faster`…) est refusé avec la règle : « il ne le démarre ni ne l'accélère jamais ».
- Les cibles d'arrêt (`stopTargets`) sont déclarées d'avance. Une cible qui ressemble à démarrer ou à régler quelque chose (`start`, `turn_on`, `set_value`, `speed`…) est refusée.
  - C'est une défense en profondeur, pas une preuve : le kit ne peut pas deviner ce que fait une adresse.

## 2. En marche : les moyens prêtés (`io.http`, `io.radio`)

Le connecteur ne reçoit ni réseau ni radio à lui : seulement des moyens gardés.

| Moyen | Lecture | Écriture |
| --- | --- | --- |
| `io.http.get` | toujours | non |
| `io.http.post` | non | seulement pendant Stop, vers une adresse de `stopTargets` |
| `io.radio.writeControl` | non | seulement pendant Stop, et seulement `00` (demande de contrôle) et `0801` (Stop FTMS) |

Toute autre tentative lève `KitRefusal`, et le connecteur est refusé pour de bon :
- il ne lit plus rien ;
- le statut publié dit pourquoi ;
- Stop répond qu'il faut utiliser le bouton du tapis.

Rien n'est envoyé au tapis.

## 3. Chaque mesure : la fraîcheur (`toPontStatus`)

- Une mesure de plus de 3 s (`measuredAtMs`, l'heure de la mesure, pas de la lecture) est périmée : `fresh` faux, sans vitesse ni distance, la bande comptée à l'arrêt. Le jeu ne compte rien.
- Une lecture qui échoue ou qui ne répond pas en 2 s ne donne pas de mesure.
- Une vitesse hors de 0 à 30 km/h ou une distance négative sont refusées.
- `controls_enabled` vaut toujours faux.
- Stop part toujours, même sans mesure fraîche ; un Stop perdu n'est jamais rejoué plus tard.

## 4. Avant de charger un fichier : la relecture (`src/verifier.ts`)

Le pont relit un connecteur avant de l'importer. Il refuse :
- l'import d'un module de réseau, de radio, de port série ou de processus ;
- `fetch`, `WebSocket` ou `XMLHttpRequest` appelés directement ;
- le code évalué (`eval`, `new Function`) et les imports dynamiques.

C'est une relecture du texte, pas une prison. Elle attrape l'oubli et dit quoi changer, mais un code malveillant pourrait la contourner. Les couches suivantes restent là derrière.

## 5. Côté jeu : le contrat lui-même

- Le jeu ne connaît du pont que `GET /v1/status` et `POST /v1/stop`.
- Démarrer est refusé par ses propres gardes, avant même d'atteindre le pont (`controls_disabled`).
- Une mesure périmée ne compte pas.

Même un pont écrit sans le kit ne peut donc rien faire d'autre que lire et arrêter.

## Ce qui reste au joueur

La clé de sécurité et le bouton Stop du tapis sont le seul arrêt sûr. Un tapis peut refuser le contrôle à distance (beaucoup le font quand l'application du fabricant est reliée) : le kit le dit, il ne force rien.
