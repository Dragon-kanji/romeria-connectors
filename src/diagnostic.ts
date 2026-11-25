// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
import { parseRsc } from './rsc.ts';
import { fromHex, parseTreadmillData } from './ftms/protocol.ts';

export const shortUuid = (uuid: string): string => uuid.toLowerCase().replace(/^0000([a-f0-9]{4})-0000-1000-8000-00805f9b34fb$/, '$1');
export type Device = { address: string; name: string; rssi: number; services: string[] };
export type Inspection = {
  services: string[]; characteristics: string[]; model?: string | null; manufacturer?: string | null;
  packets: { service: string; characteristic: string; hex: string }[]; errors: string[];
};
export function profiles(services: string[]): string[] {
  const seen = new Set(services.map(shortUuid));
  return [
    seen.has('1826') ? 'FTMS' : null,
    seen.has('1814') ? 'RSC' : null,
    seen.has('fe00') ? 'KingSmith / WalkingPad possible' : null,
    ['fff0', 'ffe0', 'ae00'].some((s) => seen.has(s)) ? 'FitShow / apparenté possible (UUID non exclusif)' : null,
    seen.has('6e400001-b5a3-f393-e0a9-e50e24dcca9e') ? 'UART propriétaire générique (marque inconnue)' : null,
  ].filter((s): s is string => s !== null);
}

/** Statut KingSmith classique seulement. Aucun code de commande n'est implémenté ici. */
export function parseKingSmith(bytes: Uint8Array) {
  if (bytes.length !== 20 || bytes[0] !== 0xf8 || bytes[1] !== 0xa2 || bytes[19] !== 0xfd) return null;
  if ((bytes.slice(1, 18).reduce((a, b) => a + b, 0) & 255) !== bytes[18]) return null;
  const speedKmh = bytes[3]! / 10;
  if (speedKmh > 30) return null;
  return { speedKmh, distanceKm: (bytes[8]! * 65536 + bytes[9]! * 256 + bytes[10]!) / 100 };
}

export function readable(inspection: Inspection) {
  const samples: { profile: string; speedKmh: number | null; distanceKm: number | null }[] = [];
  for (const packet of inspection.packets) {
    const bytes = fromHex(packet.hex);
    if (!bytes) continue;
    const service = shortUuid(packet.service), characteristic = shortUuid(packet.characteristic);
    if (service === '1826' && characteristic === '2acd') {
      const value = parseTreadmillData(bytes);
      if (value && (value.speedKmh === undefined || value.speedKmh <= 30)) samples.push({ profile: 'FTMS', speedKmh: value.speedKmh ?? null, distanceKm: value.totalDistanceM === undefined ? null : value.totalDistanceM / 1000 });
    }
    if (service === '1814' && characteristic === '2a53') {
      const value = parseRsc(bytes);
      if (value) samples.push({ profile: 'RSC', speedKmh: value.speedKmh, distanceKm: value.distanceKm });
    }
    if (service === 'fe00' && characteristic === 'fe02') {
      const value = parseKingSmith(bytes);
      if (value) samples.push({ profile: 'KingSmith classique', ...value });
    }
  }
  return samples;
}

// Le rapport partageable n'inclut ni adresse Bluetooth, ni noms des voisins, ni trame brute.
const clean = (s: string): string => s.replace(/[0-9a-f]{2}(?::[0-9a-f]{2}){5}/gi, '[adresse masquée]').replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069\u2014]/g, ' ').slice(0, 140);
export function diagnosticReport(model: string, found: number, inspection: Inspection | null, language = 'en', simulated = false): string {
  const fr = language === 'fr';
  const services = [...new Set((inspection?.services ?? []).map(shortUuid))].sort();
  const matches = profiles(services);
  const values = inspection ? readable(inspection) : [];
  const speed = values.findLast((v) => v.speedKmh !== null);
  const distance = values.findLast((v) => v.distanceKm !== null);
  const recommendation = speed?.profile === 'FTMS' ? 'FTMS (pont)' : speed?.profile === 'RSC' ? 'RSC (pont)' :
    speed?.profile === 'KingSmith classique' ? (fr ? 'connecteur propriétaire à écrire, lecture observée seulement' : 'custom connector needed, passive reading observed only') :
    (fr ? 'RSC externe ou vitesse déclarée ; compatibilité non prouvée' : 'external RSC sensor or declared speed; compatibility unproven');
  return [
    `Romeria diagnostic v1${simulated ? ' [SIMULATION]' : ''}`,
    `${fr ? 'Modèle indiqué' : 'Reported model'}: ${clean(model) || '?'}`,
    `${fr ? 'Modèle GATT' : 'GATT model'}: ${clean(inspection?.model ?? '') || '?'}`,
    `${fr ? 'Fabricant GATT' : 'GATT manufacturer'}: ${clean(inspection?.manufacturer ?? '') || '?'}`,
    `${fr ? 'Appareils entendus' : 'Devices heard'}: ${found}`,
    `${fr ? 'Services inspectés' : 'Inspected services'}: ${services.join(', ') || '?'}`,
    `${fr ? 'Profils possibles' : 'Possible profiles'}: ${matches.join('; ') || '?'}`,
    `${fr ? 'Vitesse lisible' : 'Readable speed'}: ${speed ? `${speed.speedKmh!.toFixed(2)} km/h (${speed.profile})` : '?'}`,
    `${fr ? 'Distance lisible' : 'Readable distance'}: ${distance ? `${distance.distanceKm!.toFixed(3)} km (${distance.profile})` : '?'}`,
    `${fr ? 'Trames reçues' : 'Packets received'}: ${inspection?.packets.length ?? 0}`,
    `${fr ? 'Conseil' : 'Recommendation'}: ${recommendation}`,
    `${fr ? 'Erreurs' : 'Errors'}: ${(inspection?.errors ?? []).map(clean).join('; ') || '-'}`,
    fr ? 'Lecture seule : aucune commande, aucun handshake propriétaire. Notifications par CCCD seulement.' : 'Read only: no command, no proprietary handshake. Notification subscriptions use CCCD only.',
    fr ? 'Une recherche vide ne prouve pas une absence de Bluetooth. Un UUID propriétaire ne prouve pas une marque.' : 'An empty scan does not prove Bluetooth is absent. A proprietary UUID does not prove a brand.',
    fr ? 'Rapport local, aucun envoi automatique. Relire le modèle avant partage.' : 'Local report, never uploaded automatically. Review the model before sharing.',
  ].join('\n') + '\n';
}
