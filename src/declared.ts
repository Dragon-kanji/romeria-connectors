// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
import { defineConnector, FRESH_MS, type Telemetry } from './kit.ts';

export const DECLARATION_TTL_MS = 15 * 60_000;

/** Estimation explicite. Aucun accès réseau ou radio, aucune commande du tapis. */
export function createDeclaredConnector(now: () => number) {
  let speed: number | null = null;
  let distance = 0;
  let lastRead: number | null = null;
  let confirmedAt = 0;
  let generation = 0;
  function disarm() { speed = null; lastRead = null; generation++; }
  function declare(kmh: number) {
    if (!Number.isFinite(kmh) || kmh < 0 || kmh > 10) throw new Error('Déclarer une vitesse de 0 à 10 km/h.');
    // Ne pas réattribuer un intervalle passé à la nouvelle vitesse.
    const at = now();
    if (speed !== null && lastRead !== null && at - lastRead >= 0 && at - lastRead <= FRESH_MS && at - confirmedAt <= DECLARATION_TTL_MS)
      distance += speed * (at - lastRead) / 3_600_000;
    speed = kmh; confirmedAt = at; lastRead = at; generation++;
  }
  const connector = defineConnector({
    name: 'Vitesse déclarée (aucune mesure du tapis)',
    async read(): Promise<Telemetry> {
      const at = now();
      const gap = lastRead === null ? Infinity : at - lastRead;
      if (gap > FRESH_MS || gap < 0 || at - confirmedAt > DECLARATION_TTL_MS) disarm();
      if (speed !== null) distance += speed * gap / 3_600_000;
      lastRead = at;
      return { connected: speed !== null, running: speed !== null && speed > 0, speedKmh: speed,
        distanceKm: speed === null ? null : distance, measuredAtMs: at, mode: 'declared', measurementSource: 'declared' };
    },
    // Stop n'est jamais simulé comme un arrêt physique réussi.
    async stop() { disarm(); return { ok: false, message: 'Estimation suspendue. Arrêter le tapis avec sa télécommande ou son bouton physique.' }; },
    close: disarm,
  });
  return { connector, declare, disarm, generation: () => generation };
}
