# Connecteur HTTP local

Le pont peut utiliser un service de tapis installé sur la même machine. Le service fournit la mesure et réalise lui-même l'arrêt lorsqu'il l'accepte. Romeria continue d'utiliser [le contrat pont/v1](pont-v1.md) côté jeu.

Créez un fichier privé `reglages.local.json`. Les valeurs ci-dessous sont fictives. Omettez `token` si le service local n'exige pas d'authentification.

```json
{
  "url": "http://127.0.0.1:8805",
  "token": "jeton-amont-factice"
}
```

```sh
node bin/pont.ts --connecteur http-local --reglages reglages.local.json
```

`url` doit être une origine HTTP sur `127.0.0.1` ou `[::1]`, avec un port éventuel. Le port du service doit différer de celui du pont. Un fichier privé distinct peut protéger le Stop du pont avec `--jeton-fichier`, par exemple lorsque le pont écoute sur le réseau local.

| Route du service local | JSON |
| --- | --- |
| `GET /telemetry` | `connected` et `running` (booléens), `speedKmh` et `distanceKm` (nombres ou `null`), et `measuredAtMs` (heure Unix de la mesure en millisecondes). Les champs de télémétrie facultatifs du kit gardent leurs noms camelCase. |
| `POST /stop` | Le pont envoie `{}`. Le service renvoie `{"ok":true,"message":"Arrêt confirmé."}` seulement s'il confirme l'arrêt. En cas de refus, il renvoie `ok: false` et une explication. |

Conservez l'heure de la mesure lors des relectures d'une même donnée. Le pont refuse une date future et masque l'allure et la distance au-delà de trois secondes. Il vérifie les valeurs, dont la vitesse de 0 à 30 km/h et la distance cumulée en kilomètres. Le jeton amont éventuel est envoyé comme `Authorization: Bearer …` sur les deux routes fixes. Les redirections et mandataires d'environnement sont écartés. Stop reste disponible lors d'une lecture périmée ou en panne et une demande perdue n'est jamais rejouée.

## English

This built-in connector reads a service on the same machine and can ask it to stop. Romeria still speaks [pont/v1](pont-v1.md) to the bridge. Use the sample JSON above as a private `settings.local.json` file. Omit `token` if the upstream service uses no authentication.

```sh
node bin/pont.ts --connecteur http-local --reglages settings.local.json
```

Set `url` to an HTTP origin on the literal loopback address `127.0.0.1` or `[::1]`, optionally with a port. Use different ports for the service and the bridge. An upstream token is sent as a Bearer credential. Use a separate token file with `--jeton-fichier` to protect the bridge's own Stop endpoint.

- `GET /telemetry` returns the kit's camelCase telemetry. The required fields are `connected`, `running`, `speedKmh`, `distanceKm` and `measuredAtMs`. Speed is in km/h, the cumulative distance is in km and unknown values are `null`. Record the original Unix timestamp in milliseconds when the measurement is taken.
- `POST /stop` accepts the empty JSON object `{}` and returns `{ "ok": true, "message": "Stop confirmed." }` when the service confirms the stop. A refusal returns `ok: false` with a reason.

The bridge ignores environment proxies and rejects redirects, invalid data and future timestamps. Readings older than three seconds are stale. A stale or failed read still allows a Stop request. A lost request is never replayed.
