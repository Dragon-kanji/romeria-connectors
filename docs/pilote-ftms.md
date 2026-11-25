# Le contrat du pilote FTMS

Le kit ne parle pas la radio Bluetooth lui-même : il lance un petit programme, le pilote, et lui parle par lignes JSON sur son entrée et sa sortie standard (`src/ftms/pilote.ts`). Sous Windows, le pilote de Romeria est `ashiato-ftms.exe` (C#, API Bluetooth de Windows 10 et plus). N'importe quel pilote qui parle ce contrat convient, sur n'importe quel système.

| Le kit envoie | Le pilote répond |
| --- | --- |
| `{ "cmd": "connect", "address": "AA:BB:CC:DD:EE:FF" }` | `{ "event": "connected", "address", "name" }`, ou `{ "event": "error", "message" }` |
| (liaison établie) | `{ "event": "notify", "char": "2acd", "hex": "0c04…" }` à chaque notification ; `{ "event": "disconnected", "reason" }` à la perte |
| `{ "cmd": "write", "id": 2, "hex": "0801" }` | `{ "event": "written", "id": 2, "ok": true, "error": null }` |
| `{ "cmd": "disconnect" }` | `{ "event": "disconnected", "reason" }` |

- **Au démarrage** : le pilote dit `{ "event": "ready", "pilot": "<nom>", "version": "1" }`.
- **À l'arrêt** : il s'arrête quand son entrée se ferme.
- **Caractéristiques** : `2acd` (Treadmill Data), `2ada` (Fitness Machine Status), `2ad9` (point de contrôle, ses indications).
- **Écritures** : un pilote de Romeria refuse lui-même toute écriture autre que `00` et `0801` (`ok` faux), en plus du kit.
- **Reprise après coupure** : c'est le connecteur qui la décide, en redemandant `connect` sans rien garder d'avant.

Sans tapis : `node bin/pont.ts --connecteur ftms --simuler` utilise un tapis FTMS simulé au bit près (`src/ftms/simulateur.ts`), sans pilote.
