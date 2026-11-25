// Faux pilote, aucune API Bluetooth ni accès réseau.
import { createInterface } from 'node:readline';
if (!process.argv.includes('--lecture-seule')) throw new Error('Lecture seule requise.');
const emit = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.cmd === 'scan') {
    if (process.argv.includes('radio-off')) { emit({ event: 'error', id: m.id, message: 'radio désactivée' }); continue; }
    emit({ event: 'device', id: m.id, address: 'F7:00:00:00:18:14', name: '', rssi: -60, services: [] });
    emit({ event: 'device', id: m.id, address: 'F7:00:00:00:18:14', name: 'Capteur', rssi: -40, services: ['1814'] });
    emit({ event: 'scan-done', id: m.id });
  } else if (m.cmd === 'inspect') emit({ event: 'inspection', id: m.id, services: ['1814'], characteristics: ['2a53'], packets: [{ service: '1814', characteristic: '2a53', hex: '00000150' }], errors: [] });
  else throw new Error('Opération interdite.');
}
