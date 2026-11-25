import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defineConnector, startConnector, type RawRadio } from '../src/kit.ts';
import { createFtmsConnector } from '../src/ftms/connecteur.ts';
import { isAllowedControlWrite, parseTreadmillData } from '../src/ftms/protocol.ts';
import { createSimulatedTreadmill, encodeTreadmillData } from '../src/ftms/simulateur.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('le connecteur FTMS de référence', () => {
  it('lit les trames de la norme au bit près', () => {
    const data = parseTreadmillData(Uint8Array.from([0x04, 0x00, 0xa4, 0x01, 0x10, 0x27, 0x00]));
    assert.deepEqual(data, { moreData: false, speedKmh: 4.2, totalDistanceM: 10_000 });
    assert.equal(parseTreadmillData(Uint8Array.from([0x04, 0x00, 0xa4])), null, 'une trame tronquée est refusée, jamais devinée');
    const encoded = parseTreadmillData(encodeTreadmillData({ speedKmh: 3.5, totalDistanceM: 1234, inclinePercent: 1.5, elapsedSec: 600 }));
    assert.deepEqual(encoded, { moreData: false, speedKmh: 3.5, totalDistanceM: 1234, inclinePercent: 1.5, rampAngleDeg: 0, elapsedSec: 600 });
    assert.equal(isAllowedControlWrite(Uint8Array.of(0x07)), false, 'jamais Démarrer');
    assert.equal(isAllowedControlWrite(Uint8Array.of(0x02, 0x90, 0x01)), false, 'jamais une vitesse');
    assert.equal(isAllowedControlWrite(Uint8Array.of(0x08, 0x01)), true);
  });

  it('lit un tapis simulé, et l’arrête par 00 puis 0801, rien d’autre', async () => {
    let now = 1_000_000;
    const treadmill = createSimulatedTreadmill({ now: () => now });
    treadmill.press(4);
    const running = await startConnector(createFtmsConnector({ address: treadmill.address }), { fetch: async () => ({ status: 500, ok: false, text: async () => '' }), radio: treadmill, now: () => now });
    now += 30_000;
    treadmill.pump();
    const status = await running.status();
    assert.equal(status.fresh, true);
    assert.equal(status.speed_kmh, 4);
    assert.ok(Math.abs((status.distance_km ?? 0) - 0.033) < 0.001);
    assert.equal(status.controls_enabled, false);
    const stop = await running.stop();
    assert.deepEqual(stop, { ok: true, message: 'Arrêt transmis.' });
    assert.deepEqual(treadmill.writes, ['00', '0801']);
    assert.equal(treadmill.speedKmh(), 0);
    // Sans nouvelle trame : périmée au bout de 3 s.
    now += 3500;
    assert.equal((await running.status()).fresh, false);
  });

  it('dit quand le tapis refuse le contrôle, et ne reprend rien après une coupure', async () => {
    let now = 1_000_000;
    const treadmill = createSimulatedTreadmill({ now: () => now, grantsControl: false });
    treadmill.press(3);
    const running = await startConnector(createFtmsConnector({ address: treadmill.address }), { fetch: async () => ({ status: 500, ok: false, text: async () => '' }), radio: treadmill, now: () => now });
    treadmill.pump();
    const stop = await running.stop();
    assert.equal(stop.ok, false);
    assert.match(stop.message, /Contrôle non confirmé/);
    assert.deepEqual(treadmill.writes, ['00'], 'pas de Stop sans contrôle');
    treadmill.cut();
    await tick();
    const cut = await running.status();
    assert.equal(cut.connected, false);
    assert.equal(cut.speed_kmh, null);
    await running.close();
  });

  it('un connecteur radio qui écrit Démarrer est refusé, et rien ne part', async () => {
    const writes: string[] = [];
    const radio: RawRadio = { connect: () => {}, onEvent: () => {}, disconnect: () => {}, writeControl: async (hex) => (writes.push(hex), { ok: true, error: null }) };
    const evil = defineConnector({
      name: 'Faux FTMS',
      read: async () => ({ connected: true, running: false, speedKmh: 0, distanceKm: 0, measuredAtMs: 0 }),
      async stop(io) {
        await io.radio!.writeControl('0701');
        return { ok: true, message: '' };
      },
    });
    const running = await startConnector(evil, { fetch: async () => ({ status: 500, ok: false, text: async () => '' }), radio, now: () => 0 });
    assert.equal((await running.stop()).ok, false);
    assert.deepEqual(writes, []);
  });
});
