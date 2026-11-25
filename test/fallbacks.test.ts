import assert from 'node:assert/strict';
import { it } from 'node:test';
import { parseRsc, createRscConnector } from '../src/rsc.ts';
import { createDeclaredConnector, DECLARATION_TTL_MS } from '../src/declared.ts';
import { startConnector, type RadioEvent } from '../src/kit.ts';

const noNetwork = async (): Promise<never> => { throw new Error('aucun réseau attendu'); };

it('RSC : unités, tous les champs optionnels et trames tronquées', () => {
  for (let flags = 0; flags < 8; flags++) {
    const b = Buffer.alloc(4 + ((flags & 1) ? 2 : 0) + ((flags & 2) ? 4 : 0));
    b[0] = flags; b.writeUInt16LE(256, 1); b[3] = 90;
    if (flags & 1) b.writeUInt16LE(120, 4);
    if (flags & 2) b.writeUInt32LE(12345, (flags & 1) ? 6 : 4);
    const value = parseRsc(b)!;
    assert.equal(value.speedKmh, 3.6); assert.equal(value.distanceKm, (flags & 2) ? 1.2345 : null);
    assert.equal(value.strideM, (flags & 1) ? 1.2 : null);
    for (let end = 0; end < b.length; end++) assert.equal(parseRsc(b.subarray(0, end)), null);
  }
  assert.equal(parseRsc(Buffer.from('08ffff00', 'hex')), null);
  assert.equal(parseRsc(Buffer.from('00ffff00', 'hex')), null);
});

it('RSC : fraîcheur, distance estimée, coupure et Stop sans aucune écriture', async () => {
  let now = 10_000;
  let event: (e: RadioEvent) => void = () => {};
  const writes: string[] = [];
  const run = await startConnector(createRscConnector('F7:00:00:00:18:14'), { fetch: noNetwork, now: () => now,
    radio: { connect: () => event({ type: 'connected', name: 'Faux RSC' }), onEvent: (fn) => { event = fn; }, disconnect: () => {}, writeControl: async (hex) => { writes.push(hex); return { ok: true, error: null }; } } });
  try {
    event({ type: 'notify', characteristic: '2a53', hex: '00000150' });
    now += 1000; event({ type: 'notify', characteristic: '2a53', hex: '00000150' });
    assert.equal((await run.status()).distance_km, 0.001);
    now += 3001; assert.equal((await run.status()).fresh, false);
    assert.equal((await run.stop()).ok, false); assert.deepEqual(writes, []);
    event({ type: 'disconnected', reason: 'coupure' });
    event({ type: 'notify', characteristic: '2a53', hex: '00000150' });
    assert.equal((await run.status()).connected, false);
    event({ type: 'connected', name: 'Faux RSC' });
    assert.equal((await run.status()).fresh, false);
    event({ type: 'notify', characteristic: '2a53', hex: '00000150' });
    assert.equal((await run.status()).distance_km, 0);
  } finally { await run.close(); }
});

it('vitesse déclarée : désarmée au départ, unités, coupure sans reprise automatique, Stop honnête', async () => {
  let now = 10_000;
  const source = createDeclaredConnector(() => now);
  const run = await startConnector(source.connector, { fetch: noNetwork, now: () => now });
  assert.equal((await run.status()).fresh, false);
  for (const value of [-1, 11, NaN, Infinity]) assert.throws(() => source.declare(value));
  source.declare(3.6); await run.status();
  now += 1000; const s = await run.status();
  assert.equal(s.distance_km, 0.001); assert.equal(s.measurement_source, 'declared'); assert.equal(s.virtual, false);
  now += 4000; assert.equal((await run.status()).fresh, false);
  now += 1000; assert.equal((await run.status()).fresh, false);
  source.declare(2); assert.equal((await run.status()).speed_kmh, 2);
  assert.equal((await run.stop()).ok, false); assert.equal((await run.status()).fresh, false);
  source.declare(0); assert.equal((await run.status()).running, false);
  await run.close();
});

it('une déclaration expire même si le jeu continue à lire', async () => {
  let now = 10_000;
  const source = createDeclaredConnector(() => now);
  source.declare(3);
  for (let elapsed = 0; elapsed <= DECLARATION_TTL_MS; elapsed += 1000) { await source.connector.read(); now += 1000; }
  assert.equal((await source.connector.read()).connected, false);
});
