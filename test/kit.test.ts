import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkConnector, defineConnector, FRESH_MS, KitRefusal, startConnector, toPontStatus, type KitDeps, type Telemetry } from '../src/kit.ts';
import { createSimulatorConnector } from '../src/simulateur.ts';

function clock(start = 1_800_000_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

/** Un réseau factice qui note chaque requête. */
function network(answers: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const fetch: KitDeps['fetch'] = async (url, init) => {
    calls.push({ method: init.method, url, ...(init.body ? { body: init.body } : {}) });
    const body = answers[url] ?? {};
    return { status: 200, ok: true, text: async () => JSON.stringify(body) };
  };
  return { calls, fetch };
}

const reading = (now: number, overrides: Partial<Telemetry> = {}): Telemetry => ({ connected: true, running: true, speedKmh: 4, distanceKm: 1.2, measuredAtMs: now, ...overrides });

describe('le kit refuse un connecteur qui ferait plus que lire et arrêter', () => {
  it('au chargement : aucune commande pour démarrer, accélérer ou régler la pente', () => {
    const base = { name: 'Tapis', read: async () => reading(0) };
    assert.equal(checkConnector(base), null);
    assert.match(checkConnector({ ...base, start: async () => {} }) ?? '', /ne le démarre ni ne l'accélère jamais/);
    assert.match(checkConnector({ ...base, setSpeed: async () => {} }) ?? '', /ne le démarre ni ne l'accélère jamais/);
    assert.match(checkConnector({ ...base, setIncline: async () => {} }) ?? '', /ne le démarre ni ne l'accélère jamais/);
    assert.match(checkConnector({ ...base, reboot: async () => {} }) ?? '', /n'a que name, stopTargets, open, read, stop et close/);
    assert.match(checkConnector({ name: 'x' }) ?? '', /sait lire/);
    assert.match(checkConnector({ ...base, stop: async () => ({ ok: true, message: '' }), stopTargets: ['http://ha:8123/api/services/walkingpad/start'] }) ?? '', /ressemble à démarrer/);
    assert.match(checkConnector({ ...base, stop: async () => ({ ok: true, message: '' }), stopTargets: ['http://ha:8123/api/services/number/set_value'] }) ?? '', /ressemble à démarrer/);
    assert.match(checkConnector({ ...base, stopTargets: ['http://ha:8123/api/services/button/press'] }) ?? '', /stopTargets` sans `stop`/);
  });

  it('refuse de lancer un connecteur refusé', async () => {
    await assert.rejects(startConnector({ name: 'Tapis', read: async () => reading(0), faster: () => {} }, { fetch: network().fetch, now: () => 0 }), KitRefusal);
  });

  it('pendant la lecture, toute écriture est refusée, et le connecteur l’est pour de bon', async () => {
    const time = clock();
    const net = network();
    const sneaky = defineConnector({
      name: 'Tapis sournois',
      stopTargets: ['http://tapis.local/stop'],
      async read(io) {
        await io.http.post('http://tapis.local/speed', { kmh: 9 });
        return reading(time.now());
      },
      async stop(io) {
        await io.http.post('http://tapis.local/stop', {});
        return { ok: true, message: 'ok' };
      },
    });
    const running = await startConnector(sneaky, { fetch: net.fetch, now: time.now });
    const status = await running.status();
    assert.equal(status.fresh, false);
    assert.match(status.error ?? '', /connecteur refusé par le kit : écriture HTTP pendant la lecture/);
    assert.equal(net.calls.length, 0, 'rien n’est parti');
    assert.match(running.refusal() ?? '', /écriture HTTP pendant la lecture/);
    const stop = await running.stop();
    assert.equal(stop.ok, false);
    assert.match(stop.message, /bouton Stop du tapis/);
  });

  it('pendant Stop, seulement les cibles déclarées', async () => {
    const time = clock();
    const net = network();
    const wrongTarget = defineConnector({
      name: 'Tapis',
      stopTargets: ['http://tapis.local/stop'],
      read: async () => reading(time.now()),
      async stop(io) {
        await io.http.post('http://tapis.local/resume', {});
        return { ok: true, message: 'ok' };
      },
    });
    const running = await startConnector(wrongTarget, { fetch: net.fetch, now: time.now });
    const stop = await running.stop();
    assert.equal(stop.ok, false);
    assert.match(stop.message, /cible non déclarée/);
    assert.equal(net.calls.length, 0);
    const honest = defineConnector({
      name: 'Tapis',
      stopTargets: ['http://tapis.local/stop'],
      read: async () => reading(time.now()),
      async stop(io) {
        const answer = await io.http.post('http://tapis.local/stop', { now: true });
        return { ok: answer.ok, message: 'Arrêt transmis.' };
      },
    });
    const good = await startConnector(honest, { fetch: net.fetch, now: time.now });
    assert.deepEqual(await good.stop(), { ok: true, message: 'Arrêt transmis.' });
    assert.deepEqual(net.calls, [{ method: 'POST', url: 'http://tapis.local/stop', body: '{"now":true}' }]);
  });

  it('à la radio FTMS : seulement 00 et 0801, et seulement pendant Stop', async () => {
    const writes: string[] = [];
    const radio = { connect: () => {}, onEvent: () => {}, disconnect: () => {}, writeControl: async (hex: string) => (writes.push(hex), { ok: true, error: null }) };
    const starter = defineConnector({
      name: 'Tapis FTMS',
      read: async () => reading(0),
      async stop(io) {
        await io.radio!.writeControl('00');
        await io.radio!.writeControl('07');
        return { ok: true, message: 'ok' };
      },
    });
    const running = await startConnector(starter, { fetch: network().fetch, radio, now: () => 0 });
    const stop = await running.stop();
    assert.match(stop.message, /écriture FTMS interdite \(07\)/);
    assert.deepEqual(writes, ['00'], 'Démarrer (07) n’est jamais parti');
    const reader = defineConnector({
      name: 'Tapis FTMS',
      async read(io) {
        await io.radio!.writeControl('0801');
        return reading(0);
      },
    });
    const other = await startConnector(reader, { fetch: network().fetch, radio, now: () => 0 });
    assert.match((await other.status()).error ?? '', /écriture FTMS pendant la lecture/);
  });
});

describe('le kit juge chaque mesure', () => {
  it('une mesure de plus de 3 s est périmée : ni vitesse ni distance', () => {
    const now = 10_000;
    assert.equal(toPontStatus(reading(now - FRESH_MS), now).fresh, true);
    const stale = toPontStatus(reading(now - FRESH_MS - 1), now);
    assert.equal(stale.fresh, false);
    assert.equal(stale.speed_kmh, null);
    assert.equal(stale.distance_km, null);
    assert.equal(stale.running, false);
    assert.equal(toPontStatus(reading(now, { connected: false }), now).fresh, false);
  });

  it('les commandes sont toujours coupées, et une vitesse folle est refusée', () => {
    const status = toPontStatus(reading(0), 0);
    assert.equal(status.controls_enabled, false);
    assert.equal(status.command_status, 'idle');
    const mad = toPontStatus(reading(0, { speedKmh: 80 }), 0);
    assert.equal(mad.fresh, false);
    assert.match(mad.error ?? '', /hors des bornes/);
    assert.equal(toPontStatus(reading(0, { distanceKm: -1 }), 0).fresh, false);
  });

  it('une lecture qui échoue ou tarde ne donne pas de mesure, et Stop part quand même', async () => {
    const time = clock();
    let stops = 0;
    const flaky = defineConnector({
      name: 'Tapis',
      read: async () => {
        throw new Error('tapis muet');
      },
      stop: async () => {
        stops += 1;
        return { ok: true, message: 'Arrêt transmis.' };
      },
    });
    const running = await startConnector(flaky, { fetch: network().fetch, now: time.now });
    const status = await running.status();
    assert.equal(status.fresh, false);
    assert.match(status.error ?? '', /lecture impossible : tapis muet/);
    assert.equal((await running.stop()).ok, true, 'Stop toujours transmis');
    assert.equal(stops, 1);
    const silent = await startConnector({ name: 'Tapis', read: () => new Promise<Telemetry>(() => {}) }, { fetch: network().fetch, now: time.now });
    assert.match((await silent.status()).error ?? '', /pas de réponse en 2 s/);
    assert.match((await silent.stop()).message, /ne sait pas arrêter le tapis/);
  });

  it('le tapis simulé marche, compte sa distance et s’arrête', async () => {
    const time = clock();
    const { connector, press } = createSimulatorConnector({ speedKmh: 4, now: time.now });
    const running = await startConnector(connector, { fetch: network().fetch, now: time.now });
    time.advance(45_000);
    const status = await running.status();
    assert.equal(status.fresh, true);
    assert.equal(status.speed_kmh, 4);
    assert.ok(Math.abs((status.distance_km ?? 0) - 0.05) < 1e-9);
    assert.deepEqual(await running.stop(), { ok: true, message: 'Arrêt transmis (tapis simulé).' });
    assert.equal((await running.status()).running, false);
    press(3);
    assert.equal((await running.status()).speed_kmh, 3, 'seul son bouton le relance');
  });
});
