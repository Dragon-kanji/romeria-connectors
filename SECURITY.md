# Security & Hardware Safety Policy / Sécurité matérielle

## Non-negotiable safety invariant

Romeria connectors **read treadmill telemetry and may, at most, stop the belt**.
They **never** start a treadmill, change its speed, change its incline, or automatically resume a belt after a disconnect.

- The kit enforces this at load time (`src/kit.ts`), at runtime (`io.http`, `io.radio`), at contract level (`GET /v1/status`, `POST /v1/stop`, `controls_enabled: false`), and in the native Windows Bluetooth pilot (`windows/ReadOnly.cs` and `00`/`0801` FTMS opcode allowlist).
- **Important limit:** the source verifier (`src/verifier.ts`) catches accidental misuse in trusted connectors; it is **not** a sandbox for untrusted code. Always audit third-party connectors before running them.
- **Physical safety comes first:** Romeria is a game, not a medical or safety device. The treadmill's physical safety key and Stop button remain the only guaranteed way to stop a belt.

Details of every enforcement layer are documented in [docs/securite.md](docs/securite.md) (FR) and [docs/developers.en.md](docs/developers.en.md) (EN).

## Reporting a vulnerability

If you find a way to bypass the read-only / Stop-only guards, expose a local token, or trigger an unsafe device command:

1. **Do not** open a public issue with exploit details.
2. Use GitHub's private Security Advisory (*Report a vulnerability* in the Security tab) or email **contact@playromeria.com** with reproduction steps.
3. Please never test an unverified command path while someone is standing on a live belt.

---

## Règle de sécurité matérielle (FR)

Un connecteur Romeria **lit la vitesse et la distance d'un tapis, et peut au plus l'arrêter**.
Il ne démarre jamais un tapis, ne l'accélère jamais, ne règle jamais la pente et ne reprend jamais une allure après une coupure.

- Le vérificateur de sources (`src/verifier.ts`) prévient les erreurs courantes mais n'est **pas** un bac à sable pour du code non relu.
- **La clé de sécurité et le bouton Stop physique du tapis restent le seul arrêt sûr.**
- Pour signaler une faille en privé : onglet *Security* (*Report a vulnerability*) ou **contact@playromeria.com**.
