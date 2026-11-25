# Romeria treadmill connector kit

*[Version française](README.fr.md)*

Romeria is a walking game for treadmills: you walk on your treadmill, and your pilgrim walks in the game. This kit connects compatible treadmills and offers fallbacks for others. A connector reports speed and distance and, at most, stops the treadmill.

Start here: [tester guide in English](docs/testers.en.md), [guide testeurs en français](docs/testeurs.fr.md), [developer contract, template and conformity tests](docs/developers.en.md), [contributing guide](CONTRIBUTING.md), [security & hardware safety](SECURITY.md).

Windows diagnostic: `node bin/diagnostic.ts --pilote path/to/ashiato-ftms.exe`. Without hardware: `node bin/diagnostic.ts --simuler`. Packaged builds provide `romeria-diagnostic.cmd`, `romeria-pont.cmd` and `romeria-brancher.cmd`. The in-game button is pending.

RSC footpod: `node bin/pont.ts --connecteur rsc --adresse AA:BB:CC:DD:EE:FF --pilote path/to/ashiato-ftms.exe`. Declared speed: `node bin/pont.ts --connecteur declare`. These modes cannot control the treadmill. Every kit simulation is marked virtual and earns no progress.

The guards prevent mistakes in trusted connectors. They are not a sandbox for untrusted code, and cannot prove the meaning of a device endpoint. Audit imports and device semantics before running third-party code.

Apache License 2.0 (`LICENSE`). The kit runs on Node.js 24 or later, with no dependencies.

## What the kit enforces, whatever the connector

A connector **reads the speed and can at most stop the treadmill. It never starts it and never speeds it up.** This is enforced by the kit itself, not left to convention (details in [docs/securite.md](docs/securite.md), in French).

- **Four gestures, no more.** A connector can open, read, stop and close. If it offers anything else (start, set speed, set incline), the kit refuses it at load time.
- **No writes outside Stop.** A connector only talks to the treadmill through what the kit lends it:
  - `io.http`: reads are always allowed; writes only during Stop, and only to addresses declared up front;
  - `io.radio`: the Bluetooth FTMS radio, with only two allowed writes (request control, and Stop).

  A connector that tries anything else is refused for good: it reads nothing more.
- **Stale reading means Stop only.** A reading older than 3 s is stale: it gives no speed and no distance, and the game counts nothing. Stop remains allowed without a fresh reading but may be unsupported or refused.
- **Controls off.** What the kit publishes always says `controls_enabled: false`. The game itself only knows two routes: read and stop.
- **Reviewed before loading.** The bridge refuses a file that opens the network, the radio or another program by itself.

## Try it in two minutes

```bash
node bin/pont.ts --connecteur simulateur --vitesse 4
```

The bridge (*pont*) publishes a simulated treadmill on `http://127.0.0.1:8800`, following the [`pont/v1`](docs/pont-v1.md) contract:

- `GET /v1/status` returns the reading;
- `POST /v1/stop` stops the treadmill.

Then, in Romeria, pick the `pont` treadmill source with that address.

## Bundled connectors

| Connector | For | Run |
| --- | --- | --- |
| `simulateur` | trying without a treadmill | `node bin/pont.ts --connecteur simulateur` |
| `ftms` (reference) | Bluetooth FTMS treadmills, the standard for recent machines | `node bin/pont.ts --connecteur ftms --adresse AA:BB:CC:DD:EE:FF --pilote ashiato-ftms.exe`; without a treadmill: `--simuler` |
| KingSmith via Home Assistant (example) | a WalkingPad already linked to Home Assistant | `node bin/pont.ts --connecteur exemples/kingsmith-home-assistant/connecteur.ts --reglages my-settings.json` |

The FTMS connector goes through a Bluetooth pilot. This small program talks to the system radio; its contract is in [docs/pilote-ftms.md](docs/pilote-ftms.md). On Windows, Romeria's pilot is `ashiato-ftms.exe`.

## Write the connector for your treadmill

Start from [`modele/connecteur.ts`](modele/connecteur.ts), then follow [docs/creer-son-connecteur.md](docs/creer-son-connecteur.md). The guide works step by step and includes a ready-made prompt for getting help from an AI (Claude, ChatGPT or another); the prompt works in English too.

```bash
node bin/pont.ts --connecteur my-treadmill/connecteur.ts --reglages my-treadmill/settings.json
```

## Bridge options

| Option | Effect |
| --- | --- |
| `--port 8800` | listening port |
| `--hote 127.0.0.1` | listening address: `0.0.0.0` for a treadmill attached to another machine on the network (then with a token) |
| `--jeton-fichier <file>` | the token Stop requires (`Authorization: Bearer`); reads stay open |

## Check

```bash
node --test "test/**/*.test.ts"
```

## Warning

Romeria is a game, not a medical device, and this kit does not replace the treadmill's own safety features. **The safety key and the treadmill's Stop button remain the only safe stop.** A Stop sent by the kit is a convenience: a treadmill may refuse it or receive it late.
