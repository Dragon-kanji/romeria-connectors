// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
/**
 * Un tapis simulé, sans matériel : il marche à l'allure donnée et compte sa distance. Comme un vrai tapis,
 * seul son « bouton » (`press`, ou la vitesse de départ) change sa vitesse ; Stop l'arrête. Il sert à essayer
 * le pont et le jeu sans tapis (`node bin/pont.ts --connecteur simulateur --vitesse 4`).
 */
import { defineConnector, type Telemetry } from './kit.ts';

export type SimulatorConfig = { speedKmh?: number; now: () => number };

export function createSimulatorConnector(config: SimulatorConfig) {
  let speed = config.speedKmh ?? 4;
  let distanceKm = 0;
  let durationMs = 0;
  let lastAt = config.now();
  const advance = (): void => {
    const now = config.now();
    const delta = Math.max(0, now - lastAt);
    if (speed > 0) {
      distanceKm += speed * (delta / 3_600_000);
      durationMs += delta;
    }
    lastAt = now;
  };
  const connector = defineConnector({
    name: 'Tapis simulé',
    async read(): Promise<Telemetry> {
      advance();
      return { connected: true, running: speed > 0, speedKmh: speed, distanceKm, durationSec: Math.floor(durationMs / 1000), measuredAtMs: config.now(), mode: 'simulation', virtual: true, measurementSource: 'simulated' };
    },
    async stop() {
      advance();
      speed = 0;
      return { ok: true, message: 'Arrêt transmis (tapis simulé).' };
    },
  });
  /** Le bouton du tapis simulé (hors du connecteur : le kit ne le voit pas). */
  const press = (kmh: number): void => {
    advance();
    speed = kmh;
  };
  return { connector, press };
}
