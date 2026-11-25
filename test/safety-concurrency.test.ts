import assert from 'node:assert/strict';
import { it } from 'node:test';
import { startConnector, type ConnectorIO, type Telemetry, type RadioEvent } from '../src/kit.ts';
import { createFtmsConnector } from '../src/ftms/connecteur.ts';

const sample: Telemetry = { connected: true, running: false, speedKmh: 0, distanceKm: 0, measuredAtMs: 10_000 };
const noNetwork = async (): Promise<never> => { throw new Error('réseau interdit'); };
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((fn) => { resolve = fn; }); return { resolve, promise }; };

it('Stop prioritaire pendant une lecture bloquée, deux Stop partagent une seule opération', async () => {
  const read = deferred<Telemetry>(); const stop = deferred<void>(); let calls = 0;
  const run = await startConnector({ name: 'Faux', read: () => read.promise, stop: async () => { calls++; await stop.promise; return { ok: true, message: 'simulation' }; } }, { fetch: noNetwork, now: () => 10_000 });
  const reading = run.status(); const a = run.stop(); const b = run.stop();
  assert.equal(calls, 1); stop.resolve(); assert.equal((await a).ok, true); await b;
  read.resolve(sample); await reading; await run.close();
});

it('une lecture en vol ne peut emprunter les droits du Stop', async () => {
  const gate = deferred<void>(); const stop = deferred<void>(); let writes = 0;
  const run = await startConnector({ name: 'Faux', stopTargets: ['http://fake.invalid/stop'],
    read: async (io: ConnectorIO) => { await gate.promise; await io.http.post('http://fake.invalid/stop', {}); return sample; },
    stop: async () => { await stop.promise; return { ok: true, message: 'simulation' }; },
  }, { now: () => 10_000, fetch: async () => { writes++; return { status: 200, ok: true, text: async () => '{}' }; } });
  const reading = run.status(); const stopping = run.stop(); gate.resolve();
  assert.match((await reading).error!, /écriture HTTP pendant la lecture/); assert.equal(writes, 0);
  stop.resolve(); await stopping; await run.close();
});

it('un ancien contexte Stop ne peut écrire après son retour', async () => {
  let saved!: ConnectorIO;
  const run = await startConnector({ name: 'Faux', read: async () => sample, stop: async (io: ConnectorIO) => { saved = io; return { ok: false, message: 'faux' }; }, stopTargets: ['http://fake.invalid/stop'] }, { fetch: noNetwork, now: () => 10_000 });
  await run.stop(); await assert.rejects(saved.http.post('http://fake.invalid/stop', {}), /opération terminée/); await run.close();
});

it('FTMS : une coupure entre contrôle et Stop ne rejoue rien sur la nouvelle liaison', async () => {
  let event!: (e: RadioEvent) => void; const write = deferred<{ ok: boolean; error: null }>(); const writes: string[] = [];
  const run = await startConnector(createFtmsConnector({ address: 'F7:00:00:00:18:26' }), { fetch: noNetwork, now: () => 10_000,
    radio: { connect: () => event({ type: 'connected', name: 'Faux' }), onEvent: (fn) => { event = fn; }, disconnect: () => {}, writeControl: (hex) => { writes.push(hex); return write.promise; } } });
  const stopping = run.stop(); event({ type: 'disconnected', reason: 'coupure' }); event({ type: 'connected', name: 'Faux' });
  write.resolve({ ok: true, error: null }); assert.equal((await stopping).ok, false); assert.deepEqual(writes, ['00']); await run.close();
});
