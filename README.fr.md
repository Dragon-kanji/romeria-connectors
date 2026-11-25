# Kit de connecteurs de Romeria

*[English version](README.md)*

Romeria est un jeu de marche sur tapis : on marche sur son tapis, le pèlerin marche dans le jeu. Ce kit branche les tapis compatibles et propose des replis pour les autres. Un connecteur lit une vitesse et, au plus, arrête le tapis.

Premiers testeurs : [guide français](docs/testeurs.fr.md), [guide anglais](docs/testers.en.md). Développeurs : [contrat, gabarit et conformité en anglais](docs/developers.en.md), [contribuer](CONTRIBUTING.md), [sécurité matérielle](SECURITY.md).

RSC : `node bin/pont.ts --connecteur rsc --adresse AA:BB:CC:DD:EE:FF --pilote chemin.exe`. Vitesse déclarée : `node bin/pont.ts --connecteur declare --langue fr`. Diagnostic : `node bin/diagnostic.ts --langue fr`. Ces replis ne commandent jamais le tapis. Les simulations sont virtuelles et ne créditent rien.

La garde est une protection contre les erreurs de connecteurs de confiance, pas un bac à sable pour du code inconnu. Relire les imports et les opérations réelles des endpoints.

Licence Apache 2.0 (`LICENSE`). Le kit tourne avec Node.js 24 ou plus, sans aucune dépendance.

## Ce que le kit impose, quel que soit le connecteur

Un connecteur **lit la vitesse et peut au plus arrêter le tapis. Il ne le démarre ni ne l'accélère jamais.** Ce n'est pas une convention : c'est le kit qui l'impose (détails dans [docs/securite.md](docs/securite.md)).

- **Quatre gestes, pas un de plus.** Un connecteur s'ouvre, lit, arrête et se ferme. S'il propose autre chose (démarrer, régler la vitesse ou la pente), le kit le refuse au chargement.
- **Aucune écriture hors de Stop.** Le connecteur ne parle au tapis que par ce que le kit lui prête :
  - `io.http` : la lecture est toujours permise ; l'écriture, seulement pendant Stop et vers les adresses déclarées d'avance ;
  - `io.radio` : la radio Bluetooth FTMS, avec deux écritures permises seulement (la demande de contrôle et Stop).

  Un connecteur qui tente autre chose est refusé pour de bon : il ne lit plus rien.
- **Mesure périmée = Stop seulement.** Une mesure de plus de 3 s est périmée : elle ne donne ni vitesse ni distance, et le jeu ne compte rien. Stop reste permis sans mesure fraîche, mais peut être indisponible ou refusé.
- **Commandes coupées.** Ce que le kit publie dit toujours `controls_enabled: false`. Le jeu, de son côté, ne connaît que deux routes : lire et arrêter.
- **Relu avant d'être chargé.** Le pont refuse un fichier qui ouvre lui-même le réseau, la radio ou un autre programme.

## Essayer en deux minutes

```bash
node bin/pont.ts --connecteur simulateur --vitesse 4
```

Le pont publie un tapis simulé sur `http://127.0.0.1:8800`, selon le contrat [`pont/v1`](docs/pont-v1.md) :

- `GET /v1/status` donne la mesure ;
- `POST /v1/stop` arrête le tapis.

Dans Romeria, il suffit ensuite de choisir la source de tapis `pont` avec cette adresse.

## Les connecteurs livrés

| Connecteur | Pour | Lancer |
| --- | --- | --- |
| `simulateur` | essayer sans tapis | `node bin/pont.ts --connecteur simulateur` |
| `ftms` (référence) | les tapis Bluetooth FTMS, le standard des tapis récents | `node bin/pont.ts --connecteur ftms --adresse AA:BB:CC:DD:EE:FF --pilote ashiato-ftms.exe` ; sans tapis : `--simuler` |
| KingSmith par Home Assistant (exemple) | un WalkingPad déjà relié à Home Assistant | `node bin/pont.ts --connecteur exemples/kingsmith-home-assistant/connecteur.ts --reglages mes-reglages.json` |

Le connecteur FTMS passe par un pilote Bluetooth. Ce petit programme parle la radio du système ; son contrat est dans [docs/pilote-ftms.md](docs/pilote-ftms.md). Sous Windows, celui de Romeria s'appelle `ashiato-ftms.exe`.

## Créer le connecteur de son tapis

Partir de [`modele/connecteur.ts`](modele/connecteur.ts), puis suivre [docs/creer-son-connecteur.md](docs/creer-son-connecteur.md). Le guide marche pas à pas, et donne une consigne toute prête pour se faire aider par une IA (Claude, ChatGPT ou autre).

```bash
node bin/pont.ts --connecteur mon-tapis/connecteur.ts --reglages mon-tapis/reglages.json
```

## Options du pont

| Option | Effet |
| --- | --- |
| `--port 8800` | le port d'écoute |
| `--hote 127.0.0.1` | l'adresse d'écoute : `0.0.0.0` pour un tapis branché à une autre machine du réseau (alors avec un jeton) |
| `--jeton-fichier <fichier>` | le jeton que Stop exige (`Authorization: Bearer`) ; la lecture reste libre |

## Vérifier

```bash
node --test "test/**/*.test.ts"
```

Les tests couvrent :
- la garde du kit : refus au chargement, écritures refusées, mesures périmées, Stop toujours transmis ;
- le contrat `pont/v1` (aucune route pour démarrer) ;
- le FTMS au bit près ;
- l'exemple Home Assistant ;
- la relecture des connecteurs.

## Avertissement

Romeria est un jeu, pas un dispositif médical, et ce kit ne remplace pas les sécurités du tapis. **La clé de sécurité et le bouton Stop du tapis restent le seul arrêt sûr.** Un Stop envoyé par le kit est une aide : un tapis peut le refuser ou le recevoir en retard.
