// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startConnector, type Connector, type KitDeps } from './kit.ts';

/** Harnais hors matériel : le développeur pilote ses fausses données, jamais un appareil. */
export type ConformanceHarness = {
  connector: Connector; deps: KitDeps;
  sample: (value: { connected: boolean; measuredAtMs: number; speedKmh: number }) => void;
  advance: (ms: number) => void;
  writes: string[];
};

export function connectorConformance(name: string, create: () => ConformanceHarness) {
  describe(`conformité pont/v1 : ${name}`, () => {
    it('lecture fraîche, unités et commandes coupées', async () => {
      const h = create(); const run = await startConnector(h.connector, h.deps);
      try {
        h.sample({ connected: true, measuredAtMs: h.deps.now(), speedKmh: 3.6 });
        const s = await run.status();
        assert.equal(s.fresh, true); assert.equal(s.speed_kmh, 3.6); assert.equal(s.controls_enabled, false);
        assert.deepEqual(h.writes, []);
      } finally { await run.close(); }
    });
    it('mesure périmée, coupure et reprise : aucune commande rejouée', async () => {
      const h = create(); const run = await startConnector(h.connector, h.deps);
      try {
        h.sample({ connected: true, measuredAtMs: h.deps.now(), speedKmh: 4 });
        await run.status(); h.advance(3001);
        const old = await run.status(); assert.equal(old.fresh, false); assert.equal(old.speed_kmh, null); assert.equal(old.distance_km, null);
        h.sample({ connected: false, measuredAtMs: h.deps.now(), speedKmh: 4 });
        assert.equal((await run.status()).fresh, false);
        const count = h.writes.length;
        h.sample({ connected: true, measuredAtMs: h.deps.now(), speedKmh: 0 });
        assert.equal((await run.status()).speed_kmh, 0); assert.equal(h.writes.length, count);
      } finally { await run.close(); }
    });
    it('Stop sans mesure fraîche, résultat explicite même sans capacité matérielle', async () => {
      const h = create(); const run = await startConnector(h.connector, h.deps);
      try {
        h.sample({ connected: false, measuredAtMs: 0, speedKmh: 0 });
        await run.status();
        const result = await run.stop(); assert.equal(typeof result.ok, 'boolean'); assert.ok(result.message.length);
        assert.ok(h.writes.every((write) => write === 'stop' || write === '00' || write === '0801'));
      } finally { await run.close(); }
    });
  });
}
