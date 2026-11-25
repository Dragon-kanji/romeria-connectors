// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
import { defineConnector, FRESH_MS, MAX_SPEED_KMH, type ConnectorIO, type Telemetry } from './kit.ts';
import { fromHex } from './ftms/protocol.ts';

/** Bluetooth SIG RSC Measurement (0x2A53), little endian. Aucun point de contrôle. */
export function parseRsc(bytes: Uint8Array) {
  if (bytes.length < 4) return null;
  const flags = bytes[0]!;
  const expected = 4 + ((flags & 1) ? 2 : 0) + ((flags & 2) ? 4 : 0);
  if ((flags & 0xf8) || bytes.length !== expected) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const speedKmh = view.getUint16(1, true) * 3.6 / 256;
  if (speedKmh > MAX_SPEED_KMH) return null;
  return {
    speedKmh, cadence: bytes[3]!,
    strideM: (flags & 1) ? view.getUint16(4, true) / 100 : null,
    distanceKm: (flags & 2) ? view.getUint32(4 + ((flags & 1) ? 2 : 0), true) / 10000 : null,
  };
}

export function createRscConnector(address: string) {
  let connected = false;
  let closed = false;
  let last: Telemetry | null = null;
  let distance = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  return defineConnector({
    name: 'Capteur de foulée Bluetooth RSC',
    open(io: ConnectorIO) {
      const radio = io.radio;
      if (!radio) throw new Error('Pilote Bluetooth RSC manquant.');
      radio.onEvent((event) => {
        if (closed) return;
        if (event.type === 'connected') { connected = true; last = null; distance = 0; }
        if (event.type === 'disconnected' || event.type === 'error') {
          connected = false; last = null; distance = 0;
          clearTimeout(retry);
          retry = setTimeout(() => { if (!closed) radio.connect(address); }, 2000);
          retry.unref();
        }
        if (event.type !== 'notify' || !connected || event.characteristic !== '2a53') return;
        const bytes = fromHex(event.hex);
        const data = bytes && parseRsc(bytes);
        if (!data) return;
        const now = io.now();
        const gap = last ? now - last.measuredAtMs : Infinity;
        if (data.distanceKm === null && last && gap >= 0 && gap <= FRESH_MS) distance += (last.speedKmh ?? 0) * gap / 3_600_000;
        else if (data.distanceKm !== null) distance = data.distanceKm;
        last = { connected: true, running: data.speedKmh > 0, speedKmh: data.speedKmh, distanceKm: distance,
          measuredAtMs: now, mode: 'rsc', measurementSource: 'rsc' };
      });
      radio.connect(address);
    },
    async read(): Promise<Telemetry> {
      return last ?? { connected, running: false, speedKmh: null, distanceKm: null, measuredAtMs: 0, mode: 'rsc', measurementSource: 'rsc' };
    },
    close() { closed = true; connected = false; last = null; clearTimeout(retry); },
  });
}
