// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
/**
 * Le protocole Bluetooth FTMS (Fitness Machine Service 1.0, service 0x1826), réduit à ce dont le jeu a
 * besoin : lire un tapis, et au plus l'arrêter. Pur, sans radio : les octets viennent du pilote
 * (`pilote.ts`) ou du tapis simulé (`simulateur.ts`).
 *
 * Sécurité imposée par le kit (docs/securite.md) : deux écritures seulement au point de contrôle, la demande
 * de contrôle (0x00) et Stop (0x08 0x01). Jamais Démarrer (0x07), jamais une vitesse (0x02) ni une pente.
 */

/** UUID courts (16 bits) du service et de ses caractéristiques. */
export const FTMS = {
  service: '1826',
  feature: '2acc',
  treadmillData: '2acd',
  trainingStatus: '2ad3',
  speedRange: '2ad4',
  controlPoint: '2ad9',
  machineStatus: '2ada',
} as const;

export const CONTROL_OP = { requestControl: 0x00, setTargetSpeed: 0x02, startOrResume: 0x07, stopOrPause: 0x08, response: 0x80 } as const;
export const REQUEST_CONTROL = Uint8Array.of(CONTROL_OP.requestControl);
export const STOP = Uint8Array.of(CONTROL_OP.stopOrPause, 0x01);

/** Les seules écritures permises au point de contrôle : la demande de contrôle et Stop. */
export function isAllowedControlWrite(bytes: Uint8Array): boolean {
  return equalBytes(bytes, REQUEST_CONTROL) || equalBytes(bytes, STOP);
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
export function fromHex(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) return null;
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

/** Une trame « Treadmill Data » (0x2ACD) : chaque champ est absent si le tapis ne l'envoie pas. */
export type TreadmillData = {
  /** Vrai : la trame continue dans une suivante, et la vitesse instantanée n'y est pas. */
  moreData: boolean;
  speedKmh?: number;
  averageSpeedKmh?: number;
  totalDistanceM?: number;
  /** Pente en %, null si le tapis la dit indisponible (0x7FFF). */
  inclinePercent?: number | null;
  rampAngleDeg?: number | null;
  elevationGainM?: { positive: number; negative: number };
  paceKmPerMin?: number;
  averagePaceKmPerMin?: number;
  energy?: { totalKcal: number | null; perHourKcal: number | null; perMinuteKcal: number | null };
  heartRateBpm?: number;
  metabolicEquivalent?: number;
  elapsedSec?: number;
  remainingSec?: number;
  forceOnBeltN?: number;
  powerW?: number;
};

const NOT_AVAILABLE_S16 = 0x7fff;

/** Lit une trame « Treadmill Data ». Une trame tronquée est refusée (null), jamais devinée. */
export function parseTreadmillData(bytes: Uint8Array): TreadmillData | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const need = (size: number): boolean => offset + size <= bytes.length;
  const u8 = (): number => view.getUint8(offset++);
  const u16 = (): number => {
    const value = view.getUint16(offset, true);
    offset += 2;
    return value;
  };
  const s16 = (): number => {
    const value = view.getInt16(offset, true);
    offset += 2;
    return value;
  };
  const u24 = (): number => {
    const value = view.getUint16(offset, true) | (view.getUint8(offset + 2) << 16);
    offset += 3;
    return value;
  };
  if (!need(2)) return null;
  const flags = u16();
  const has = (bit: number): boolean => (flags & (1 << bit)) !== 0;
  const data: TreadmillData = { moreData: has(0) };
  // Bit 0 à zéro : la vitesse instantanée est là (le sens est inversé dans la norme).
  if (!has(0)) {
    if (!need(2)) return null;
    data.speedKmh = u16() / 100;
  }
  if (has(1)) {
    if (!need(2)) return null;
    data.averageSpeedKmh = u16() / 100;
  }
  if (has(2)) {
    if (!need(3)) return null;
    data.totalDistanceM = u24();
  }
  if (has(3)) {
    if (!need(4)) return null;
    const incline = s16();
    const ramp = s16();
    data.inclinePercent = incline === NOT_AVAILABLE_S16 ? null : incline / 10;
    data.rampAngleDeg = ramp === NOT_AVAILABLE_S16 ? null : ramp / 10;
  }
  if (has(4)) {
    if (!need(4)) return null;
    data.elevationGainM = { positive: u16() / 10, negative: u16() / 10 };
  }
  if (has(5)) {
    if (!need(1)) return null;
    data.paceKmPerMin = u8() / 10;
  }
  if (has(6)) {
    if (!need(1)) return null;
    data.averagePaceKmPerMin = u8() / 10;
  }
  if (has(7)) {
    if (!need(5)) return null;
    const total = u16();
    const perHour = u16();
    const perMinute = u8();
    data.energy = { totalKcal: total === 0xffff ? null : total, perHourKcal: perHour === 0xffff ? null : perHour, perMinuteKcal: perMinute === 0xff ? null : perMinute };
  }
  if (has(8)) {
    if (!need(1)) return null;
    data.heartRateBpm = u8();
  }
  if (has(9)) {
    if (!need(1)) return null;
    data.metabolicEquivalent = u8() / 10;
  }
  if (has(10)) {
    if (!need(2)) return null;
    data.elapsedSec = u16();
  }
  if (has(11)) {
    if (!need(2)) return null;
    data.remainingSec = u16();
  }
  if (has(12)) {
    if (!need(4)) return null;
    data.forceOnBeltN = s16();
    data.powerW = s16();
  }
  return data;
}

/** Un événement « Fitness Machine Status » (0x2ADA), réduit à ce qui dit l'état de la bande. */
export type MachineStatus =
  | { kind: 'reset' }
  | { kind: 'stopped' }
  | { kind: 'paused' }
  | { kind: 'safety-key' }
  | { kind: 'started' }
  | { kind: 'control-lost' }
  | { kind: 'other'; opCode: number };

export function parseMachineStatus(bytes: Uint8Array): MachineStatus | null {
  if (bytes.length === 0) return null;
  switch (bytes[0]) {
    case 0x01:
      return { kind: 'reset' };
    case 0x02:
      if (bytes.length < 2) return null;
      return bytes[1] === 0x02 ? { kind: 'paused' } : { kind: 'stopped' };
    case 0x03:
      return { kind: 'safety-key' };
    case 0x04:
      return { kind: 'started' };
    case 0xff:
      return { kind: 'control-lost' };
    default:
      return { kind: 'other', opCode: bytes[0]! };
  }
}

export type ControlResult = 'success' | 'not-supported' | 'invalid-parameter' | 'failed' | 'not-permitted' | 'unknown';

/** La réponse du point de contrôle (indication 0x80, opération demandée, résultat). */
export function parseControlResponse(bytes: Uint8Array): { requestOp: number; result: ControlResult } | null {
  if (bytes.length < 3 || bytes[0] !== CONTROL_OP.response) return null;
  const results: Record<number, ControlResult> = { 0x01: 'success', 0x02: 'not-supported', 0x03: 'invalid-parameter', 0x04: 'failed', 0x05: 'not-permitted' };
  return { requestOp: bytes[1]!, result: results[bytes[2]!] ?? 'unknown' };
}
