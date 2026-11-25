import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { diagnosticReport, profiles, parseKingSmith, readable, type Inspection } from '../src/diagnostic.ts';
import { diagnosticPilot } from '../src/diagnostic-pilot.ts';

const fixture = fileURLToPath(new URL('./fixtures/pilot.ts', import.meta.url));
it('profils : UUID longs/courts, signatures propriétaires jamais prises pour une preuve', () => {
  assert.deepEqual(profiles(['00001826-0000-1000-8000-00805f9b34fb', '1814']), ['FTMS', 'RSC']);
  for (const service of ['fff0', 'ffe0', 'ae00', 'fe00']) assert.match(profiles([service]).join(''), /possible/);
  assert.deepEqual(profiles(['180f']), []);
});
it('rapport partageable : ni adresse, ni nom de voisin, ni trame brute ; zéro reste lisible', () => {
  const inspection: Inspection = { services: ['1826'], characteristics: ['2acd'], packets: [{ service: '1826', characteristic: '2acd', hex: '04000000640000' }], errors: ['device F7:00:00:00:18:26 unavailable'] };
  const report = diagnosticReport('LONTEK\nF7:00:00:00:18:26', 8, inspection);
  assert.match(report, /0.00 km\/h/); assert.match(report, /0.100 km/);
  assert.doesNotMatch(report, /F7:00|04000000640000/);
  assert.match(report, /no command/);
  assert.match(diagnosticReport('', 0, null, 'fr'), /ne prouve pas/);
  assert.equal(readable({ ...inspection, packets: [{ service: 'fff0', characteristic: 'fff1', hex: '04000000640000' }] }).length, 0);
});
it('KingSmith : trame classique et somme, les variantes ne sont pas devinées', () => {
  const frame = Buffer.alloc(20); frame[0] = 0xf8; frame[1] = 0xa2; frame[3] = 36; frame[10] = 123; frame[19] = 0xfd;
  frame[18] = frame.subarray(1, 18).reduce((sum, b) => sum + b, 0) & 255;
  assert.deepEqual(parseKingSmith(frame), { speedKmh: 3.6, distanceKm: 1.23 });
  frame[18] ^= 1; assert.equal(parseKingSmith(frame), null);
});
it('diagnostic par vrai sous-processus simulé : fusion des annonces et inspection sans écriture', async () => {
  const pilot = diagnosticPilot([process.execPath, fixture]);
  try { const devices = await pilot.scan(1); assert.equal(devices.length, 1); assert.equal(devices[0]!.name, 'Capteur'); assert.deepEqual(devices[0]!.services, ['1814']); assert.equal(readable(await pilot.inspect(devices[0]!.address))[0]!.speedKmh, 3.6); }
  finally { pilot.close(); }
});
it('radio absente et exécutable absent donnent une erreur bornée', async () => {
  for (const command of [[process.execPath, fixture, 'radio-off'], ['romeria-inexistant-123.exe']]) {
    const pilot = diagnosticPilot(command);
    try { await assert.rejects(pilot.scan(1)); } finally { pilot.close(); }
  }
});
