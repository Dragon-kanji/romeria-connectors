// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
/**
 * Le pont en ligne de commande : il lance un connecteur sous la garde du kit et le publie selon `pont/v1`.
 *
 *   node bin/pont.ts --connecteur simulateur [--vitesse 4]
 *   node bin/pont.ts --connecteur ftms --adresse AA:BB:CC:DD:EE:FF --pilote "C:\…\ashiato-ftms.exe"
 *   node bin/pont.ts --connecteur ftms --simuler
 *   node bin/pont.ts --connecteur http-local --reglages reglages.local.json
 *   node bin/pont.ts --connecteur exemples/kingsmith-home-assistant/connecteur.ts --reglages mes-reglages.json
 *
 * Options : `--port 8800`, `--hote 127.0.0.1` (0.0.0.0 pour le réseau local : alors un jeton pour Stop),
 * `--jeton-fichier <fichier>` (le jeton que Stop exige). Puis, dans le jeu : la source de tapis `pont`,
 * `http://<cette machine>:8800`.
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { startConnector, type KitDeps, type RawRadio } from '../src/kit.ts';
import { createFtmsConnector } from '../src/ftms/connecteur.ts';
import { createPilotRadio } from '../src/ftms/pilote.ts';
import { createSimulatedTreadmill } from '../src/ftms/simulateur.ts';
import { createPontServer } from '../src/pont.ts';
import { createSimulatorConnector } from '../src/simulateur.ts';
import { verifyConnectorSource } from '../src/verifier.ts';
import { createRscConnector } from '../src/rsc.ts';
import { createDeclaredConnector } from '../src/declared.ts';
import { createHttpLocalConnector, readHttpLocalSettings } from '../src/http-local.ts';
import { httpLocalFetch } from '../src/http-local-transport.ts';

const { values } = parseArgs({
  options: {
    connecteur: { type: 'string' },
    reglages: { type: 'string' },
    vitesse: { type: 'string' },
    adresse: { type: 'string' },
    pilote: { type: 'string' },
    simuler: { type: 'boolean', default: false },
    langue: { type: 'string', default: 'en' },
    aide: { type: 'boolean' },
    port: { type: 'string', default: '8800' },
    hote: { type: 'string', default: '127.0.0.1' },
    'jeton-fichier': { type: 'string' },
  },
});
if (values.aide) {
  console.log('node bin/pont.ts --connecteur simulateur|declare|rsc|ftms|http-local|fichier.ts [--reglages fichier.json] [--adresse AA:BB:CC:DD:EE:FF --pilote chemin.exe] [--simuler] [--langue en|fr]');
  process.exit(0);
}

const log = (message: string): void => {
  process.stderr.write(`[pont] ${message}\n`);
};
const fail = (message: string): never => {
  log(message);
  process.exit(1);
};

const which = values.connecteur ?? fail('--connecteur manquant : simulateur, ftms, http-local, ou le fichier de ton connecteur.');
let radio: RawRadio | null = null;
let candidate: unknown;
let upstreamToken: string | undefined;
let simulated = which === 'simulateur' || values.simuler;
if (!Number.isInteger(Number(values.port)) || Number(values.port) < 1 || Number(values.port) > 65535) fail('Port invalide.');
if (values.vitesse && (!Number.isFinite(Number(values.vitesse)) || Number(values.vitesse) < 0 || Number(values.vitesse) > 30)) fail('Vitesse de simulation invalide.');
if (which === 'http-local') {
  const file = values.reglages ?? fail('HTTP local : --reglages fichier.json est nécessaire.');
  let payload: unknown;
  try { payload = JSON.parse(readFileSync(resolve(file), 'utf8')) as unknown; }
  catch { fail('HTTP local : lire un fichier JSON valide avec --reglages.'); }
  try {
    const settings = readHttpLocalSettings(payload);
    upstreamToken = settings.token;
    candidate = createHttpLocalConnector(settings);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'HTTP local : réglages invalides.');
  }
} else if (which === 'simulateur') {
  candidate = createSimulatorConnector({ speedKmh: Number(values.vitesse ?? 4), now: Date.now }).connector;
} else if (which === 'declare') {
  if (values.vitesse || values.simuler) fail('Mode déclaré : saisir la vitesse dans la console, jamais par une option de démarrage.');
  if (!process.stdin.isTTY) fail('Mode déclaré : ouvrir une console interactive.');
  const declared = createDeclaredConnector(Date.now);
  candidate = declared.connector;
  log(values.langue === 'fr' ? 'Tapis contrôlé physiquement uniquement. Saisir la vitesse de la télécommande (0 à 10 km/h), ou pause. Confirmer toutes les 15 min. Toute coupure désarme la déclaration.' : 'Physical treadmill controls only. Enter the remote speed (0 to 10 km/h), or pause. Confirm every 15 min. A connection gap disarms the declaration.');
  const input = createInterface({ input: process.stdin });
  input.on('line', (line) => {
    try {
      if (line.trim().toLowerCase() === 'pause') declared.disarm();
      else if (line.trim() !== '') declared.declare(Number(line.trim().replace(',', '.')));
      log(values.langue === 'fr' ? 'Déclaration mise à jour, aucune commande au tapis.' : 'Declaration updated, no treadmill command.');
    } catch (error) { log(String(error)); }
  });
  input.on('close', () => declared.disarm());
} else if (which === 'rsc') {
  if (values.simuler) {
    let listener: (event: import('../src/kit.ts').RadioEvent) => void = () => {};
    let connected = false;
    const timer = setInterval(() => { if (connected) listener({ type: 'notify', characteristic: '2a53', hex: '00000150' }); }, 1000);
    radio = { connect: () => { connected = true; listener({ type: 'connected', name: 'RSC simulé' }); }, onEvent: (fn) => { listener = fn; }, disconnect: () => { connected = false; }, close: () => clearInterval(timer), writeControl: async () => ({ ok: false, error: 'RSC sans écriture' }) };
    candidate = createRscConnector('F7:00:00:00:18:14');
  } else {
    const address = values.adresse ?? fail('--adresse manquante.');
    const pilot = values.pilote ?? fail('--pilote manquant.');
    radio = createPilotRadio({ command: [pilot], profile: 'rsc', log });
    candidate = createRscConnector(address);
  }
} else if (which === 'ftms') {
  if (values.simuler) {
    const treadmill = createSimulatedTreadmill({ now: Date.now });
    treadmill.press(Number(values.vitesse ?? 4));
    setInterval(() => treadmill.pump(), 1000).unref();
    radio = treadmill;
    candidate = createFtmsConnector({ address: treadmill.address, name: treadmill.name });
  } else {
    const address = values.adresse ?? fail('--adresse AA:BB:CC:DD:EE:FF manquante (ou --simuler).');
    const pilot = values.pilote ?? fail('--pilote manquant : le programme du pilote FTMS (ashiato-ftms.exe sous Windows).');
    radio = createPilotRadio({ command: [pilot], log });
    candidate = createFtmsConnector({ address });
  }
} else {
  // Le connecteur d'un joueur : relu avant d'être chargé.
  const file = resolve(which);
  const verdict = verifyConnectorSource(readFileSync(file, 'utf8'));
  if (!verdict.ok) fail(`Connecteur refusé à la relecture :\n  - ${verdict.reasons.join('\n  - ')}`);
  const module = (await import(pathToFileURL(file).href)) as { default?: unknown };
  const settings = values.reglages ? (JSON.parse(readFileSync(resolve(values.reglages), 'utf8')) as unknown) : {};
  candidate = typeof module.default === 'function' ? (module.default as (settings: unknown) => unknown)(settings) : module.default;
}

const token = values['jeton-fichier'] ? readFileSync(resolve(values['jeton-fichier']), 'utf8').trim() : null;
if (values.hote !== '127.0.0.1' && values.hote !== 'localhost' && !token) fail('Un pont sur le réseau exige un jeton.');
if (upstreamToken !== undefined && upstreamToken === token) fail('HTTP local : utiliser des jetons distincts pour le service local et le pont.');
const deps: KitDeps = { fetch: which === 'http-local' ? httpLocalFetch : (url, init) => fetch(url, init), radio, now: Date.now, log };
const running = await startConnector(candidate, deps).catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
const published = simulated ? { ...running, status: async () => ({ ...await running.status(), virtual: true, mode: 'simulation', measurement_source: 'simulated' as const }) } : running;
const server = createPontServer({ connector: published, token, log });
server.on('error', (error) => { log(error.message); void running.close().then(() => process.exit(1)); });
server.listen(Number(values.port), values.hote, () => log(`${running.name} : pont/v1 sur http://${values.hote}:${values.port} (GET /v1/status, POST /v1/stop).`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void running.close().then(() => process.exit(0));
  });
}
