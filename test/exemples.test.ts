import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import create from '../exemples/kingsmith-home-assistant/connecteur.ts';
import { startConnector, type KitDeps } from '../src/kit.ts';
import { verifyConnectorSource } from '../src/verifier.ts';

const NOW = Date.parse('2026-11-02T08:00:00Z');
const CONFIG = {
  url: 'http://ha.local:8123/',
  token: 'h'.repeat(40),
  speedEntity: 'sensor.walkingpad_speed',
  distanceEntity: 'sensor.walkingpad_distance',
  runningEntity: 'binary_sensor.walkingpad_running',
  stop: { domain: 'button', service: 'press', entityId: 'button.walkingpad_stop' },
};

/** Un Home Assistant factice : ses états, et les services appelés. */
function homeAssistant(states: Record<string, { state: string; last_reported?: string }>) {
  const calls: Array<{ method: string; url: string; body?: string; auth?: string }> = [];
  const fetch: KitDeps['fetch'] = async (url, init) => {
    calls.push({ method: init.method, url, ...(init.body ? { body: init.body } : {}), ...(init.headers?.authorization ? { auth: init.headers.authorization } : {}) });
    const id = decodeURIComponent(url.split('/api/states/')[1] ?? '');
    if (init.method === 'GET') {
      const state = states[id];
      return state ? { status: 200, ok: true, text: async () => JSON.stringify(state) } : { status: 404, ok: false, text: async () => '{}' };
    }
    return { status: 200, ok: true, text: async () => '[]' };
  };
  return { calls, fetch };
}

describe('l’exemple KingSmith par Home Assistant', () => {
  it('lit les entités du tapis, et la fraîcheur du dernier rapport', async () => {
    const reported = new Date(NOW - 1000).toISOString();
    const ha = homeAssistant({
      'sensor.walkingpad_speed': { state: '3.5', last_reported: reported },
      'sensor.walkingpad_distance': { state: '1.25', last_reported: reported },
      'binary_sensor.walkingpad_running': { state: 'on' },
    });
    const running = await startConnector(create(CONFIG), { fetch: ha.fetch, now: () => NOW });
    const status = await running.status();
    assert.equal(status.fresh, true);
    assert.equal(status.speed_kmh, 3.5);
    assert.equal(status.distance_km, 1.25);
    assert.equal(status.running, true);
    assert.ok(ha.calls.every((call) => call.method === 'GET' && call.auth === `Bearer ${'h'.repeat(40)}`), 'la lecture ne fait que lire');
    // Un vieux rapport : périmé.
    const old = homeAssistant({ 'sensor.walkingpad_speed': { state: '3.5', last_reported: new Date(NOW - 60_000).toISOString() }, 'sensor.walkingpad_distance': { state: '1' } });
    assert.equal((await (await startConnector(create(CONFIG), { fetch: old.fetch, now: () => NOW })).status()).fresh, false);
    // Indisponible : pas de tapis.
    const off = homeAssistant({ 'sensor.walkingpad_speed': { state: 'unavailable', last_reported: reported }, 'sensor.walkingpad_distance': { state: 'unavailable' } });
    assert.equal((await (await startConnector(create(CONFIG), { fetch: off.fetch, now: () => NOW })).status()).connected, false);
  });

  it('arrête par le seul service déclaré', async () => {
    const ha = homeAssistant({});
    const running = await startConnector(create(CONFIG), { fetch: ha.fetch, now: () => NOW });
    assert.deepEqual(await running.stop(), { ok: true, message: 'Arrêt transmis à Home Assistant.' });
    assert.deepEqual(ha.calls.map((call) => [call.method, call.url, call.body]), [['POST', 'http://ha.local:8123/api/services/button/press', '{"entity_id":"button.walkingpad_stop"}']]);
  });

  it('un service d’arrêt qui démarre est refusé par le kit', async () => {
    const ha = homeAssistant({});
    await assert.rejects(startConnector(create({ ...CONFIG, stop: { domain: 'walkingpad', service: 'start', entityId: 'x' } }), { fetch: ha.fetch, now: () => NOW }), /ressemble à démarrer/);
  });
});

describe('la relecture des connecteurs', () => {
  it('accepte le modèle, les exemples et les connecteurs du kit', () => {
    for (const file of ['modele/connecteur.ts', 'exemples/kingsmith-home-assistant/connecteur.ts', 'src/ftms/connecteur.ts', 'src/simulateur.ts']) {
      const verdict = verifyConnectorSource(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
      assert.deepEqual(verdict, { ok: true }, file);
    }
  });

  it('refuse un connecteur qui ouvre lui-même le réseau, la radio ou un programme', () => {
    const reasons = (source: string): string => {
      const verdict = verifyConnectorSource(source);
      return verdict.ok ? '' : verdict.reasons.join(' ; ');
    };
    assert.match(reasons(`import { request } from 'node:http';`), /import de « node:http »/);
    assert.match(reasons(`import net from 'node:net';`), /node:net/);
    assert.match(reasons(`import { spawn } from 'node:child_process';`), /node:child_process/);
    assert.match(reasons(`import noble from '@abandonware/noble';`), /noble/);
    assert.match(reasons(`const r = await fetch('http://tapis/speed', { method: 'POST' });`), /appel direct à fetch/);
    assert.match(reasons(`const m = await import('node:http');`), /import dynamique/);
    assert.match(reasons(`eval('1');`), /eval/);
    assert.equal(reasons(`// fetch( dans une note\nconst a = io.http.get('x');`), '', 'les commentaires ne comptent pas');
  });
});
