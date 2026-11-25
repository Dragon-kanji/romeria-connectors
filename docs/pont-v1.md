# Le contrat `pont/v1`

Version anglaise complète : [developers.en.md](developers.en.md). Le kit testeurs ajoute les modes
`rsc` et `declared` (provenance enregistrée au Bilan), et `simulation` avec `virtual: true` (aucune récompense).
`measurement_source` décrit la source. Le mode déclaré estime, il ne mesure pas le tapis.
Stop reste une tentative, jamais une garantie ; RSC et vitesse déclarée ne commandent aucun matériel.

C'est ce que le jeu lit d'un pont de tapis, quand on choisit la source de tapis `pont`. Le kit le publie pour tout connecteur (`bin/pont.ts`) ; on peut aussi l'écrire soi-même, dans n'importe quel langage, et c'est alors à soi de tenir la sécurité (docs/securite.md).

- **Transport** : HTTP(S), JSON en UTF-8, à l'adresse du pont (sans `/` final).
- **Accès** : `Authorization: Bearer <token>` si un jeton est réglé. Il n'est utile qu'à Stop.

## `GET /v1/status` : la télémétrie (obligatoire)

Le jeu l'appelle chaque seconde tant qu'il écoute, sinon toutes les 30 s, et attend 4 s au plus.

```json
{
  "connected": true, "fresh": true, "controls_enabled": false, "running": true,
  "mode": "manual", "belt_state": "running",
  "speed_kmh": 4.0, "distance_km": 1.42, "max_speed_kmh": 6.0, "running_max_speed_kmh": null,
  "duration_seconds": 1280, "steps": null, "incline_percent": 0, "command_status": "idle", "error": null
}
```

| Champ | Sens |
| --- | --- |
| `connected` | obligatoire : le pont parle au tapis |
| `fresh` | obligatoire : la mesure a moins de 3 s ; faux, le jeu ne compte rien |
| `controls_enabled` | obligatoire, toujours faux : le jeu ne commande pas le tapis |
| `running` | obligatoire : la bande tourne |
| `mode`, `belt_state` | obligatoires : le mode du tapis (`manual`…) et l'état de la bande (`running`, `stopped`, `unavailable`…) |
| `speed_kmh` | la vitesse de la bande ; `null` sans mesure fraîche ; la course commence à 5,5 km/h |
| `distance_km` | la distance cumulée de la séance du tapis. Le jeu en intègre les écarts, ignore les sauts de plus de 50 m entre deux lectures, et repart d'une nouvelle valeur quand elle baisse (nouvelle séance du tapis) |
| `max_speed_kmh`, `running_max_speed_kmh`, `duration_seconds`, `steps`, `incline_percent`, `command_status`, `error` | facultatifs, pour l'affichage |

Une réponse autre que 200, ou un corps illisible, ne donne pas de mesure : rien n'est compté.

## `POST /v1/stop` : l'arrêt (recommandé)

Il arrête la bande. Réponse : `{ "ok": true, "message": "Arrêt transmis." }`, ou `{ "ok": false, "message": "<raison>" }`. Le pont peut exiger son jeton.

## Rien d'autre

Le jeu n'appelle aucune autre route, et le pont du kit n'en connaît aucune autre : il n'existe pas de route pour démarrer, régler la vitesse ou la pente.
