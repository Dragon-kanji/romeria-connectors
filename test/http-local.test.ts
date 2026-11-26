import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { httpLocalFetch } from '../src/http-local-transport.ts';
import { createHttpLocalConnector, readHttpLocalSettings } from '../src/http-local.ts';
import { FRESH_MS, startConnector, type KitDeps, type Telemetry } from '../src/kit.ts';

const NOW = 1_800_000_000_000;
const UPSTREAM_TOKEN = 'jeton-amont-factice';
const BRIDGE_TOKEN = 'jeton-pont-factice';
const MEASUREMENT: Telemetry = {
  connected: true, running: true, speedKmh: 2.4, distanceKm: 0.125, measuredAtMs: NOW,
  durationSec: 180, steps: 240, inclinePercent: -1, maxSpeedKmh: 6, mode: 'manual', beltState: 'running',
};
const SETTINGS = { url: 'http://127.0.0.1:8805', token: UPSTREAM_TOKEN };
const cli = fileURLToPath(new URL('../bin/pont.ts', import.meta.url));

async function listen(handler: RequestListener) {
  const server = createServer(handler).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  return {
    port, url: `http://127.0.0.1:${port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
    },
  };
}

function waitForBridge(child: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Le pont ne s’écoute pas.')), 5000);
    const log = (chunk: Buffer) => { if (chunk.toString().includes('pont/v1 sur')) finish(); };
    const exit = () => finish(new Error('Le pont a quitté avant d’écouter.'));
    function finish(error?: Error) {
      clearTimeout(timer);
      child.stderr?.off('data', log);
      child.off('exit', exit);
      if (error) reject(error);
      else resolve();
    }
    child.stderr?.on('data', log);
    child.once('exit', exit);
  });
}

async function settingsFiles(t: TestContext, config: unknown) {
  const scratch = await mkdtemp(join(tmpdir(), 'romeria-http-local-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const settings = join(scratch, 'reglages.local.json');
  const bridgeToken = join(scratch, 'jeton-pont');
  await writeFile(settings, JSON.stringify(config), { mode: 0o600 });
  await writeFile(bridgeToken, BRIDGE_TOKEN, { mode: 0o600 });
  return { settings, bridgeToken };
}

describe('connecteur HTTP local', () => {
  it('refuse les destinations ambiguës, les chemins personnalisés et les jetons invalides', () => {
    assert.deepEqual(readHttpLocalSettings({ url: 'http://[::1]:8805/' }), { url: 'http://[::1]:8805' });
    for (const url of ['http://localhost:8805', 'https://127.0.0.1:8805', 'http://192.0.2.1:8805',
      'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:8805/api', 'http://127.0.0.1:8805?x=1',
      'http://127.0.0.1:8805/#x', 'http://utilisateur@127.0.0.1:8805', 'http://127.0.0.1:8805 ', 'http://2130706433:8805']) {
      assert.throws(() => createHttpLocalConnector({ url }), /HTTP local/, url);
    }
    for (const token of ['', 'abc\n', 'secret scindé', 123]) {
      assert.throws(() => readHttpLocalSettings({ ...SETTINGS, token }), /« token »/);
    }
    assert.throws(() => createHttpLocalConnector({ ...SETTINGS, stopPath: '/start' }), /HTTP local/);
  });

  it('conserve le temps source et refuse les données invalides ou périmées, même annoncées fraîches', async () => {
    let now = NOW;
    let raw = JSON.stringify(MEASUREMENT);
    const fetch: KitDeps['fetch'] = async () => ({ status: 200, ok: true, text: async () => raw });
    const live = await startConnector(createHttpLocalConnector(SETTINGS), { fetch, now: () => now });
    const fresh = await live.status();
    assert.equal(fresh.fresh, true);
    assert.equal(fresh.speed_kmh, 2.4);
    assert.equal(fresh.distance_km, 0.125);
    assert.equal(fresh.incline_percent, -1);
    assert.equal(fresh.controls_enabled, false);

    now += FRESH_MS;
    assert.equal((await live.status()).fresh, true);
    now++;
    raw = JSON.stringify({ ...MEASUREMENT, fresh: true });
    const stale = await live.status();
    assert.equal(stale.fresh, false);
    assert.equal(stale.running, false);
    assert.equal(stale.speed_kmh, null);
    assert.equal(stale.distance_km, null);

    for (const invalid of [{ measuredAtMs: now + 1 }, { measuredAtMs: String(now) }, { measuredAtMs: undefined }, { measuredAtMs: -1 },
      { speedKmh: 30.1 }, { speedKmh: -1 }, { distanceKm: -1 }, { durationSec: -1 }, { steps: 0.5 }, { inclinePercent: 110 },
      { maxSpeedKmh: 31 }, { connected: 'true' }, { running: null }, { measurementSource: 'wrong' }, { virtual: 'false' }]) {
      raw = JSON.stringify({ ...MEASUREMENT, measuredAtMs: now, ...invalid });
      const rejected = await live.status();
      assert.equal(rejected.fresh, false, raw);
      assert.equal(rejected.speed_kmh, null);
      assert.match(rejected.error ?? '', /HTTP local/);
    }
    for (const content of ['{', '{"connected":true,"running":true,"speedKmh":1e309,"distanceKm":0,"measuredAtMs":1800000000000}']) {
      raw = content;
      assert.equal((await live.status()).fresh, false);
    }

    raw = JSON.stringify({ ...MEASUREMENT, measuredAtMs: now, measurementSource: 'simulated', virtual: false });
    const virtual = await live.status();
    assert.equal(virtual.virtual, true);
    assert.equal(virtual.measurement_source, 'simulated');
    await live.close();
  });

  it('échoue sur coupure, redirections et réponses trop longues ; transmet uniquement la demande fixe de Stop', async t => {
    const redirected: string[] = [];
    const other = await listen((req, res) => { redirected.push(req.url ?? ''); res.end('{}'); });
    t.after(other.close);
    let action: 'redirect' | 'big' | 'refuse' | 'invalidJson' | 'statusError' | 'cutoff' = 'redirect';
    const calls: string[] = [];
    const upstream = await listen((req, res) => {
      calls.push(`${req.method} ${req.url}`);
      req.resume();
      if (action === 'cutoff') { res.destroy(); return; }
      if (action === 'redirect') { res.writeHead(307, { location: `${other.url}/ecriture` }).end(); return; }
      if (action === 'big') { res.end(JSON.stringify({ value: 'x'.repeat(17 * 1024) })); return; }
      if (action === 'invalidJson') { res.end('{malformé'); return; }
      if (action === 'statusError') { res.writeHead(409).end(JSON.stringify({ ok: true, message: 'Contradictoire.' })); return; }
      res.end(JSON.stringify({ ok: false, message: `Arrêt refusé ${UPSTREAM_TOKEN}\nUtiliser la commande physique.` }));
    });
    t.after(upstream.close);
    await assert.rejects(httpLocalFetch(`${upstream.url}/start`, { method: 'POST', body: '{}' }), /route ou méthode refusée/);
    await assert.rejects(httpLocalFetch(`${upstream.url}/stop`, { method: 'POST', body: '{"speedKmh":4}' }), /route ou méthode refusée/);
    await assert.rejects(httpLocalFetch('http://192.0.2.1/telemetry', { method: 'GET' }), /origine HTTP/);
    const live = await startConnector(createHttpLocalConnector({ ...SETTINGS, url: upstream.url }), { fetch: httpLocalFetch, now: () => NOW });
    t.after(live.close);
    assert.equal((await live.status()).fresh, false);
    assert.equal((await live.stop()).ok, false);
    assert.deepEqual(redirected, []);
    assert.deepEqual(calls, ['GET /telemetry', 'POST /stop']);

    action = 'big';
    assert.equal((await live.status()).fresh, false);
    assert.deepEqual(await live.stop(), { ok: false, message: 'HTTP local : Stop non confirmé.' });
    action = 'invalidJson';
    assert.equal((await live.stop()).ok, false);
    action = 'statusError';
    assert.equal((await live.stop()).ok, false);
    action = 'refuse';
    assert.deepEqual(await live.stop(), { ok: false, message: 'Arrêt refusé [masqué] Utiliser la commande physique.' });
    action = 'cutoff';
    assert.equal((await live.status()).fresh, false);
    assert.equal((await live.stop()).ok, false);

    const cutoff = await startConnector(createHttpLocalConnector(SETTINGS), {
      fetch: async () => { throw new Error(UPSTREAM_TOKEN); }, now: () => NOW,
    });
    t.after(cutoff.close);
    assert.equal((await cutoff.status()).fresh, false);
    const failure = await cutoff.stop();
    assert.equal(failure.ok, false);
    assert.ok(!failure.message.includes(UPSTREAM_TOKEN));
  });

  it('branche le CLI à la boucle locale même avec un mandataire ambiant et sépare les deux jetons', async t => {
    const proxyCalls: string[] = [];
    const proxy = await listen((req, res) => { proxyCalls.push(req.url ?? ''); res.writeHead(500).end(); });
    t.after(proxy.close);
    const calls: Array<{ route: string; auth?: string; body: string }> = [];
    const upstream = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk as Buffer));
      req.on('end', () => {
        calls.push({ route: `${req.method} ${req.url}`, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() });
        if (req.method === 'GET' && req.url === '/telemetry') res.end(JSON.stringify({ ...MEASUREMENT, measuredAtMs: Date.now() - 10_000 }));
        else if (req.method === 'POST' && req.url === '/stop') res.end(JSON.stringify({ ok: true, message: 'Arrêt confirmé par le service factice.' }));
        else res.writeHead(404).end();
      });
    });
    t.after(upstream.close);
    const { settings, bridgeToken } = await settingsFiles(t, { url: upstream.url, token: UPSTREAM_TOKEN });
    const freePort = await listen(() => {});
    await freePort.close();
    const proxyOption = process.allowedNodeEnvironmentFlags.has('--use-env-proxy') ? ['--use-env-proxy'] : [];
    const bridge = spawn(process.execPath, [...proxyOption, cli, '--connecteur', 'http-local', '--reglages', settings,
      '--jeton-fichier', bridgeToken, '--port', String(freePort.port)], {
      env: { ...process.env, HTTP_PROXY: proxy.url, http_proxy: proxy.url, NO_PROXY: '', no_proxy: '' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    t.after(async () => { if (bridge.exitCode === null && bridge.signalCode === null) { bridge.kill(); await once(bridge, 'exit'); } });
    await waitForBridge(bridge);
    const status = await (await fetch(`${freePort.url}/v1/status`)).json() as { fresh: boolean; speed_kmh: number | null };
    assert.equal(status.fresh, false);
    assert.equal(status.speed_kmh, null);
    const stop = (token: string) => fetch(`${freePort.url}/v1/stop`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    assert.equal((await stop(UPSTREAM_TOKEN)).status, 401);
    assert.equal((await fetch(`${freePort.url}/v1/start`, { method: 'POST' })).status, 404);
    assert.deepEqual(await (await stop(BRIDGE_TOKEN)).json(), { ok: true, message: 'Arrêt confirmé par le service factice.' });
    assert.deepEqual(calls, [
      { route: 'GET /telemetry', auth: `Bearer ${UPSTREAM_TOKEN}`, body: '' },
      { route: 'POST /stop', auth: `Bearer ${UPSTREAM_TOKEN}`, body: '{}' },
    ]);
    assert.deepEqual(proxyCalls, []);
  });

  it('refuse le même jeton aux deux frontières et masque le contenu d’un fichier JSON invalide', async t => {
    const { settings, bridgeToken } = await settingsFiles(t, { url: SETTINGS.url, token: BRIDGE_TOKEN });
    function run() {
      return spawnSync(process.execPath, [cli, '--connecteur', 'http-local', '--reglages', settings, '--jeton-fichier', bridgeToken],
        { encoding: 'utf8', timeout: 5000 });
    }
    const duplicate = run();
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /jetons distincts/);
    assert.ok(!duplicate.stderr.includes(BRIDGE_TOKEN));
    await writeFile(settings, `{"token":"${UPSTREAM_TOKEN}`, { mode: 0o600 });
    const malformed = run();
    assert.equal(malformed.status, 1);
    assert.match(malformed.stderr, /JSON valide/);
    assert.ok(!malformed.stderr.includes(UPSTREAM_TOKEN));
  });
});
