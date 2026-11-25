import { connectorConformance } from '../src/conformance.ts';
import create from '../modele/connecteur.ts';

connectorConformance('gabarit HTTP en simulation', () => {
  let now = 1_800_000_000_000;
  let body = { connected: false, measuredAtMs: 0, speed: 0, distance: 0 };
  const writes: string[] = [];
  return {
    connector: create({ url: 'http://simulator.invalid' }), writes,
    deps: { now: () => now, fetch: async (_url, init) => {
      if (init.method !== 'GET') writes.push(init.method);
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    } },
    sample: (s) => { body = { ...body, connected: s.connected, speed: s.speedKmh, measuredAtMs: s.measuredAtMs }; },
    advance: (ms) => { now += ms; },
  };
});
