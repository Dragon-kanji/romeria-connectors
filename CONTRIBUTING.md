# Contributing / Contribuer

Contributions for new treadmill models, protocol documentation, Bluetooth pilots (macOS, Linux, Windows), and safety tests are welcome under the **Apache License 2.0** (`LICENSE`).

## Hard rules for every contribution

1. **Read-only + Stop-max only.** Never add start, speed, incline, resume, or generic arbitrary-command routes or opcodes. Any PR that weakens `src/kit.ts`, `src/pont.ts`, `src/verifier.ts`, or the FTMS `00`/`0801` opcode restriction will be rejected.
2. **Honest freshness & virtual flags.** Report the real measurement timestamp (`measuredAtMs`). Never forge freshness by overwriting old timestamps on poll. Simulations must always set `virtual: true`.
3. **No personal data or credentials.** Never commit device MAC addresses, serial numbers, API tokens, personal IP addresses, or private hostnames. Diagnostic reports must strip device identifiers.
4. **Zero runtime dependencies** in the Node 24 TypeScript kit (`src/`, `bin/`, `modele/`, `exemples/`).
5. **Tests required.** New connectors must include a unit test using `connectorConformance` (`src/conformance.ts`) with mocked transports (no real network or Bluetooth calls during tests).

## How to add a connector

1. Start from [`modele/connecteur.ts`](modele/connecteur.ts) and follow [docs/developers.en.md](docs/developers.en.md) (or [docs/creer-son-connecteur.md](docs/creer-son-connecteur.md) in French).
2. Add tests in `test/` using `connectorConformance` plus protocol edge cases (stale readings, malformed frames, distance reset, disconnect during Stop).
3. Run the full test suite locally on Node.js 24+:

```bash
node --test "test/**/*.test.ts"
```

4. If you change `windows/`, build and run the read-only native test on Windows (.NET 10):

```powershell
dotnet build windows -c Release -p:PublishAot=false
$env:ROMERIA_TEST_PILOT = (Resolve-Path windows/bin/Release/net10.0-windows10.0.19041.0/ashiato-ftms.exe).Path
node --test test/native.test.ts
```

## Licensing

By submitting a pull request, you agree that your contribution is licensed under the Apache License 2.0 (`LICENSE`).
