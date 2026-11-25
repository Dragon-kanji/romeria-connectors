// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
/**
 * Un tapis FTMS simulé, au bit près, et sa radio : il fabrique les trames d'un vrai tapis (Treadmill Data,
 * Fitness Machine Status, réponses du point de contrôle). Comme un vrai tapis, il ne change de vitesse que
 * par ses propres boutons (`press`) ; on ne peut que demander le contrôle et l'arrêter. Il sert aux tests
 * et à essayer le connecteur FTMS sans tapis (`node bin/pont.ts --connecteur ftms --simuler`).
 */
import type { RawRadio, RadioEvent } from '../kit.ts';
import { CONTROL_OP, FTMS, fromHex, isAllowedControlWrite, toHex, type ControlResult } from './protocol.ts';

/** Vitesse, puis au choix distance totale (bit 2), pente (bit 3) et temps écoulé (bit 10). */
export function encodeTreadmillData(fields: { speedKmh: number; totalDistanceM?: number; inclinePercent?: number; elapsedSec?: number }): Uint8Array {
  let flags = 0;
  const body: number[] = [];
  const u16 = (value: number): void => {
    body.push(value & 0xff, (value >> 8) & 0xff);
  };
  u16(Math.round(fields.speedKmh * 100));
  if (fields.totalDistanceM !== undefined) {
    flags |= 1 << 2;
    const distance = Math.round(fields.totalDistanceM);
    body.push(distance & 0xff, (distance >> 8) & 0xff, (distance >> 16) & 0xff);
  }
  if (fields.inclinePercent !== undefined) {
    flags |= 1 << 3;
    u16(Math.round(fields.inclinePercent * 10) & 0xffff);
    u16(0);
  }
  if (fields.elapsedSec !== undefined) {
    flags |= 1 << 10;
    u16(fields.elapsedSec);
  }
  return Uint8Array.from([flags & 0xff, (flags >> 8) & 0xff, ...body]);
}

function encodeControlResponse(requestOp: number, result: ControlResult): Uint8Array {
  const codes: Record<ControlResult, number> = { success: 0x01, 'not-supported': 0x02, 'invalid-parameter': 0x03, failed: 0x04, 'not-permitted': 0x05, unknown: 0x04 };
  return Uint8Array.of(CONTROL_OP.response, requestOp, codes[result]);
}

export type SimulatedTreadmill = RawRadio & {
  readonly name: string;
  readonly address: string;
  /** Les boutons du tapis : la seule façon de le démarrer ou de changer sa vitesse. */
  press: (speedKmh: number, inclinePercent?: number) => void;
  speedKmh: () => number;
  /** Une seconde de notifications (la trame Treadmill Data du moment). */
  pump: () => void;
  /** Une perte de liaison, comme une coupure radio. */
  cut: (reason?: string) => void;
  /** Toutes les écritures reçues au point de contrôle, permises ou non. */
  writes: string[];
};

export type SimulatedTreadmillOptions = {
  now: () => number;
  /** Le tapis accorde-t-il le contrôle ? (sinon Stop est refusé par le tapis) */
  grantsControl?: boolean;
  reportsDistance?: boolean;
  name?: string;
  address?: string;
};

export function createSimulatedTreadmill(options: SimulatedTreadmillOptions): SimulatedTreadmill {
  let speed = 0;
  let incline = 0;
  let distanceM = 0;
  let elapsedMs = 0;
  let lastAt = options.now();
  let controlled = false;
  let connected = false;
  const writes: string[] = [];
  const listeners: ((event: RadioEvent) => void)[] = [];
  const emit = (event: RadioEvent): void => {
    for (const listener of [...listeners]) listener(event);
  };
  const advance = (): void => {
    const now = options.now();
    const delta = Math.max(0, now - lastAt);
    if (speed > 0) {
      distanceM += (speed / 3.6) * (delta / 1000);
      elapsedMs += delta;
    }
    lastAt = now;
  };
  const name = options.name ?? 'Tapis simulé FTMS';
  const address = options.address ?? 'F7:00:00:00:18:26';
  return {
    name,
    address,
    writes,
    press(speedKmh, inclinePercent) {
      advance();
      speed = speedKmh;
      if (inclinePercent !== undefined) incline = inclinePercent;
    },
    speedKmh: () => speed,
    connect(target) {
      if (target.toUpperCase() !== address.toUpperCase()) {
        emit({ type: 'error', message: 'tapis introuvable' });
        return;
      }
      connected = true;
      emit({ type: 'connected', name });
    },
    onEvent(listener) {
      listeners.push(listener);
    },
    async writeControl(hex) {
      writes.push(hex);
      if (!connected) return { ok: false, error: 'déconnecté' };
      const bytes = fromHex(hex);
      if (bytes === null || !isAllowedControlWrite(bytes)) return { ok: false, error: 'écriture refusée' };
      const op = bytes[0]!;
      const answers: { characteristic: string; bytes: Uint8Array }[] = [];
      if (op === CONTROL_OP.requestControl) {
        controlled = options.grantsControl !== false;
        answers.push({ characteristic: FTMS.controlPoint, bytes: encodeControlResponse(op, controlled ? 'success' : 'not-permitted') });
      } else if (!controlled) {
        answers.push({ characteristic: FTMS.controlPoint, bytes: encodeControlResponse(op, 'not-permitted') });
      } else {
        advance();
        speed = 0;
        answers.push({ characteristic: FTMS.controlPoint, bytes: encodeControlResponse(op, 'success') }, { characteristic: FTMS.machineStatus, bytes: Uint8Array.of(0x02, 0x01) });
      }
      // Les indications arrivent après l'accusé de l'écriture, comme sur la radio.
      queueMicrotask(() => {
        for (const answer of answers) emit({ type: 'notify', characteristic: answer.characteristic, hex: toHex(answer.bytes) });
      });
      return { ok: true, error: null };
    },
    disconnect() {
      if (!connected) return;
      connected = false;
      emit({ type: 'disconnected', reason: 'déconnexion demandée' });
    },
    pump() {
      if (!connected) return;
      advance();
      const data = encodeTreadmillData({ speedKmh: speed, ...(options.reportsDistance === false ? {} : { totalDistanceM: distanceM }), inclinePercent: incline, elapsedSec: Math.floor(elapsedMs / 1000) });
      emit({ type: 'notify', characteristic: FTMS.treadmillData, hex: toHex(data) });
    },
    cut(reason = 'liaison perdue') {
      if (!connected) return;
      connected = false;
      emit({ type: 'disconnected', reason });
    },
  };
}
