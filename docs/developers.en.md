# Write a connector for Romeria

Node.js 24 or later, no runtime dependencies. The game reads a local HTTP bridge. Your connector provides observations, never rewards or training targets. You do not need the game's private source, Unreal, a Raspberry Pi or Home Assistant.

## Start without hardware

```powershell
node bin/pont.ts --connecteur simulateur --vitesse 3.6
# Another terminal
Invoke-RestMethod http://127.0.0.1:8800/v1/status
node --test "test/**/*.test.ts"
```

The simulator is explicitly `virtual: true`: it moves the character but earns no progress. The FTMS and RSC radio simulators are `--connecteur ftms --simuler` and `--connecteur rsc --simuler`. They also carry the virtual flag. Never test a control path on a real moving belt.

## Copy the template

Copy `modele/connecteur.ts` into a sibling folder, for example `my-treadmill/connecteur.ts`. Adjust the relative import if you move it deeper. Export a factory that accepts the JSON supplied with `--reglages`. The template expects a read-only endpoint with `{ connected, speed, distance, measuredAtMs }`, using km/h, cumulative km and a Unix timestamp in milliseconds. Replace that mapping with your device's documented observations. Keep unknown values null. Do not refresh old data's timestamp each time HTTP is polled.

```json
{ "url": "http://127.0.0.1:8810" }
```

```powershell
node bin/pont.ts --connecteur my-treadmill/connecteur.ts --reglages my-treadmill/settings.local.json
```

The template deliberately has no Stop implementation. Add `stop(io)` and exact `stopTargets` only when the actual stop operation is understood. HTTP `GET` must be semantically read-only: never hide a control command in its path or query. Declare only stop endpoints, never a generic control endpoint that accepts arbitrary actions. The existing KingSmith/Home Assistant example is for an owner who already has that integration; it is not needed by the standard kit.

## Contract `pont/v1`

`GET /v1/status` returns JSON with HTTP 200:

```json
{
  "connected": true, "fresh": true, "controls_enabled": false,
  "running": true, "mode": "manual", "belt_state": "running",
  "speed_kmh": 3.6, "distance_km": 0.120,
  "measurement_source": "treadmill", "virtual": false,
  "command_status": "idle", "error": null
}
```

| Field | Meaning |
| --- | --- |
| `connected`, `fresh`, `controls_enabled`, `running`, `mode`, `belt_state` | Required, with boolean or string types as above. `controls_enabled` must be false. |
| `fresh` | Last observation at most 3 seconds old. A disconnected, failed, invalid or stale source is not fresh. |
| `speed_kmh` | Instantaneous km/h, null when unavailable. Never a target sent to a motor. |
| `distance_km` | Cumulative session distance. A reset is a new baseline; the game ignores implausible jumps. Without device distance, integrate only adjacent fresh observations. |
| `measurement_source` | Optional provenance: `treadmill`, `rsc`, `declared`, `simulated`. Use the corresponding `mode` for the first tester builds: `manual`, `rsc`, `declared`, `simulation`. |
| `virtual` | True for every simulation. No session credit, XP, loot or route progress. |
| Other fields | `duration_seconds`, `steps`, `incline_percent`, speed limits and `error` are optional display data, not permission to control. |

When stale, publish `fresh: false`, `running: false`, `speed_kmh: null`, `distance_km: null`. The kit does this automatically from `Telemetry.measuredAtMs`. HTTP failure or malformed JSON yields no game reading. Keep response times short; the game normally polls once a second while open, otherwise every 30 seconds, with a 4 second timeout. The kit limits reads to 2 seconds.

`POST /v1/stop` returns `{ "ok": true, "message": "..." }` only if the stop was transmitted, or `{ "ok": false, "message": "..." }` with a physical-stop instruction. No hardware stop capability is a normal, supported result. RSC has none. Declared mode suspends its estimate but returns false because the physical belt is still independent. If configured, Stop requires `Authorization: Bearer <token>`; never put tokens in URLs or reports. The kit CLI requires a token when binding outside loopback.

There are no start, speed, incline or resume routes. This kit is stricter than a general slow-down policy: only Stop is implemented. Never add automatic acceleration, including restoring a prior target after reconnection. Disconnection cancels pending control intent. Do not retry a command on a replacement connection. Stale data cannot enable a command; Stop is the sole exception and still requires a live transport.

## Safety and conformity

`src/kit.ts` checks the connector shape and lends separate read and Stop capabilities. A blocked read does not block Stop. Duplicate concurrent Stops share one operation. Capabilities expire at return or timeout. The FTMS adapter requires a positive control response and the same connection generation before writing Stop. The Windows read-only process refuses every control command, including Stop. It only discovers, reads and subscribes to data characteristics.

Run the whole suite above, then copy `test/conformance.test.ts` for your connector. Import `connectorConformance` from `src/conformance.ts` and supply a harness with a fake clock, a sample setter and a write log. All transport functions must be fakes. The helper checks fresh units, stale data, disconnect/reconnect and unsupported Stop. The rest of the suite checks forbidden routes/opcodes, Stop priority, concurrent access, expired capabilities and the FTMS reconnect race. Add tests for your packet format, timestamps, distance resets, malformed frames, lack of acknowledgements and any protocol-specific Stop sequence. A passing generic harness does not certify a physical machine.

The source verifier is an accidental-misuse check, **not a sandbox**. Node code, dependencies and indirect imports can bypass it. Audit the complete connector and its dependencies before running it; never treat an untrusted downloaded connector as contained. The kit cannot determine whether a URL named `/stop` really stops a motor. No connector should embed credentials or make network calls at module load time.

## Windows Bluetooth pilot

The public export contains `windows/` (in the game repository: `tools/ftms-windows/`). Build using .NET 10, Windows SDK and the Visual Studio C++ linker for Native AOT:

```powershell
dotnet publish windows -c Release -o windows/publish
node bin/diagnostic.ts --pilote windows/publish/ashiato-ftms.exe
```

For a managed build without the native linker: `dotnet build windows -c Release -p:PublishAot=false`. The resulting executable requires .NET 10. To test its command refusal without opening any radio:

```powershell
$env:ROMERIA_TEST_PILOT = (Resolve-Path windows/publish/ashiato-ftms.exe).Path
node --test test/native.test.ts
```

The pilot JSON-lines protocol is documented in [pilote-ftms.md](pilote-ftms.md), with the read-only additions below. The native source is included under Apache 2.0. Proprietary identifiers are documented in [protocols.md](protocols.md); no third-party control implementation is copied.

| Input in `--lecture-seule` mode | Output |
| --- | --- |
| `{"cmd":"scan","id":1,"all":true,"seconds":5}` | Repeated `device` events with address, name, RSSI and service UUIDs, then `scan-done`. Merge advertisements by address. |
| `{"cmd":"inspect","id":2,"address":"AA:BB:CC:DD:EE:FF","seconds":5}` | One `inspection` with services, characteristics, optional GATT model/manufacturer, bounded measurement packets and errors. Never reads serial-number characteristics. |
| `{"cmd":"read-connect","profile":"rsc","address":"AA:BB:CC:DD:EE:FF"}` | `connected`, `notify` with `char: "2a53"` and hex, then `disconnected` or `error`. |
| `{"cmd":"disconnect"}` | Releases the read connection. |
| Anything else | `error`, without touching the radio. |

## Connect the installed game

Start the bridge, then the game. Stop the physical belt before switching. Run `node bin/brancher.ts` from the kit. It reads `%LOCALAPPDATA%\Romeria\serveur.json` and the private command token, verifies a local Romeria server, and sends only the `tapis` setting. Override with `--profil` for a different player data directory. No manual editing or copying of the token is needed. A localhost bridge on a different port can be selected with `--url`.

For any other implementation, set the installed game's treadmill source to `{ "kind": "pont", "url": "http://127.0.0.1:8800" }` using `PUT /api/v1/local/connectors` and its local Bearer token. Read `GET /api/v1/local/connectors` to verify the active source. The native selector button for the new diagnostic is pending, so use the packaged shortcuts or CLI. This kit cannot certify the LONTEK example from its product name alone.
