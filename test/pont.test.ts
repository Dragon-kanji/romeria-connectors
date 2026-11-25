import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { startConnector } from '../src/kit.ts';
import { createPontServer } from '../src/pont.ts';
import { createSimulatorConnector } from '../src/simulateur.ts';

/** Les champs que le contrat pont/v1 exige (docs/pont-v1.md), avec leur type. */
const REQUIRED: Record<string, string> = { connected: 'boolean', fresh: 'boolean', controls_enabled: 'boolean', running: 'boolean', mode: 'string', belt_state: 'string' };

async function withPont<T>(token: string | null, run: (base: string) => Promise<T>): Promise<T> {
  const { connector } = createSimulatorConnector({ speedKmh: 4.2, now: Date.now });
  const running = await startConnector(connector, { fetch: async () => ({ status: 500, ok: false, text: async () => '' }), now: Date.now });
  const server = createPontServer({ connector: running, token });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

describe('le pont publie le contrat pont/v1, et rien d’autre', () => {
  it('GET /v1/status : le statut d’un tapis, commandes coupées', async () => {
    await withPont(null, async (base) => {
      const response = await fetch(`${base}/v1/status`);
      assert.equal(response.status, 200);
      const status = (await response.json()) as Record<string, unknown>;
      for (const [field, type] of Object.entries(REQUIRED)) assert.equal(typeof status[field], type, field);
      assert.equal(status.fresh, true);
      assert.equal(status.speed_kmh, 4.2);
      assert.equal(status.controls_enabled, false, 'le jeu ne commande pas');
      assert.equal(typeof status.distance_km, 'number');
    });
  });

  it('POST /v1/stop : l’arrêt, avec le jeton du pont s’il en a un', async () => {
    await withPont('s'.repeat(32), async (base) => {
      assert.equal((await fetch(`${base}/v1/stop`, { method: 'POST' })).status, 401);
      assert.equal((await fetch(`${base}/v1/stop`, { method: 'POST', headers: { authorization: 'Bearer faux' } })).status, 401);
      const stop = await fetch(`${base}/v1/stop`, { method: 'POST', headers: { authorization: `Bearer ${'s'.repeat(32)}` } });
      assert.deepEqual(await stop.json(), { ok: true, message: 'Arrêt transmis (tapis simulé).' });
      const after = (await (await fetch(`${base}/v1/status`)).json()) as { running: boolean; speed_kmh: number };
      assert.equal(after.running, false);
      assert.equal(after.speed_kmh, 0);
    });
  });

  it('aucune route pour démarrer, régler la vitesse ou la pente', async () => {
    await withPont(null, async (base) => {
      for (const [method, path] of [['POST', '/v1/start'], ['POST', '/v1/speed'], ['PUT', '/v1/status'], ['POST', '/v1/incline'], ['GET', '/v1/stop']] as const) {
        assert.equal((await fetch(`${base}${path}`, { method })).status, 404, `${method} ${path}`);
      }
    });
  });
});
