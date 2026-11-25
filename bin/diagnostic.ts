// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { diagnosticReport, profiles, type Inspection } from '../src/diagnostic.ts';
import { diagnosticPilot } from '../src/diagnostic-pilot.ts';

const { values } = parseArgs({ options: {
  pilote: { type: 'string' }, adresse: { type: 'string' }, modele: { type: 'string', default: '' },
  langue: { type: 'string', default: 'en' }, secondes: { type: 'string', default: '5' },
  rapport: { type: 'string' }, simuler: { type: 'boolean' }, aide: { type: 'boolean' },
} });
if (values.aide) {
  console.log('node bin/diagnostic.ts [--pilote chemin.exe] [--adresse AA:BB:CC:DD:EE:FF] [--modele texte] [--langue en|fr] [--rapport rapport.txt] [--simuler]');
} else {
  const seconds = Number(values.secondes);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 10) throw new Error('--secondes : 1 à 10.');
  if (values.adresse && !/^[a-f0-9]{2}(?::[a-f0-9]{2}){5}$/i.test(values.adresse)) throw new Error('Adresse Bluetooth invalide.');
  let inspection: Inspection | null = null;
  let found = 0;
  let model = values.modele;
  if (values.simuler) {
    found = 1;
    inspection = { services: ['1814'], characteristics: ['2a53'], model: 'Capteur simulé', packets: [{ service: '1814', characteristic: '2a53', hex: '00000150' }], errors: [] };
  } else {
    const pilot = values.pilote ?? [new URL('../../ftms/ashiato-ftms.exe', import.meta.url), new URL('../../tools/ftms-windows/publish/ashiato-ftms.exe', import.meta.url), new URL('../windows/publish/ashiato-ftms.exe', import.meta.url)].map((url) => fileURLToPath(url)).find(existsSync);
    if (!pilot) throw new Error('Pilote introuvable. Utiliser --pilote chemin/ashiato-ftms.exe ou le kit livré avec Romeria.');
    const radio = diagnosticPilot([pilot]);
    try {
      const devices = await radio.scan(seconds);
      found = devices.length;
      let address = values.adresse;
      if (!address) devices.forEach((device, i) => console.error(`${i + 1}: ${device.name.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 80) || '?'} (${device.address}), ${profiles(device.services).join(', ') || '?'}`));
      if (!address && process.stdin.isTTY && found) {
        const input = createInterface({ input: process.stdin, output: process.stderr });
        try {
          const choice = await input.question(values.langue === 'fr' ? 'Numéro de votre appareil (Entrée : aucun) : ' : 'Your device number (Enter: none): ');
          address = devices[Number(choice) - 1]?.address;
          if (!model) model = await input.question(values.langue === 'fr' ? 'Marque et modèle (sans numéro de série) : ' : 'Brand and model (no serial number): ');
        } finally { input.close(); }
      }
      if (address) inspection = await radio.inspect(address, seconds);
      else if (found) console.error('Choisir avec --adresse AA:BB:CC:DD:EE:FF pour lire les services.');
    } catch (error) {
      inspection = { services: [], characteristics: [], packets: [], errors: [error instanceof Error ? error.message : String(error)] };
      process.exitCode = 1;
    } finally { radio.close(); }
  }
  const report = diagnosticReport(model, found, inspection, values.langue, !!values.simuler);
  if (values.rapport) writeFileSync(values.rapport, report, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(report);
}
