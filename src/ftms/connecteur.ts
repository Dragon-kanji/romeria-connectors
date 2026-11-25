// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
/**
 * Le connecteur de référence : un tapis Bluetooth FTMS (Fitness Machine Service, service 0x1826, le standard
 * des tapis récents). Il lit la trame Treadmill Data (vitesse, distance, pente, temps) et Fitness Machine
 * Status (arrêt, pause) que le tapis notifie chaque seconde ; Stop : la demande de contrôle (`00`), puis
 * Stop (`0801`). Il ne fait rien d'autre, et le kit l'en empêcherait (docs/securite.md).
 *
 * La distance : celle du tapis s'il la donne ; sinon tirée de la vitesse, seulement entre deux mesures qui
 * se suivent, jamais à travers un trou. Une nouvelle liaison ne reprend aucune mesure d'avant.
 */
import { defineConnector, FRESH_MS, type ConnectorIO, type Telemetry } from '../kit.ts';
import { CONTROL_OP, FTMS, fromHex, parseControlResponse, parseMachineStatus, parseTreadmillData } from './protocol.ts';

export type FtmsConfig = { address: string; name?: string };

export function createFtmsConnector(config: FtmsConfig) {
  let connected = false;
  let name = config.name ?? 'Tapis Bluetooth FTMS';
  let speed: number | null = null;
  let distanceM: number | null = null;
  let derivedM = 0;
  let incline: number | null = null;
  let elapsed: number | null = null;
  let measuredAtMs = 0;
  let stoppedByMachine = false;
  let controlAnswer: ((granted: boolean) => void) | null = null;
  let generation = 0;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const reset = (): void => {
    speed = null;
    distanceM = null;
    derivedM = 0;
    incline = null;
    elapsed = null;
    measuredAtMs = 0;
  };

  return defineConnector({
    name,
    open(io: ConnectorIO) {
      if (!io.radio) throw new Error('aucune radio Bluetooth : lancer le pont avec un pilote FTMS (ou --simuler)');
      const radio = io.radio;
      radio.onEvent((event) => {
        if (closed) return;
        switch (event.type) {
          case 'connected':
            generation++;
            connected = true;
            if (event.name) name = event.name;
            reset();
            break;
          case 'disconnected':
            generation++;
            controlAnswer?.(false);
            controlAnswer = null;
            connected = false;
            reset();
            // La reprise : une nouvelle demande de liaison, sans rien garder d'avant.
            clearTimeout(retry);
            retry = setTimeout(() => { if (!closed) radio.connect(config.address); }, 2000);
            retry.unref?.();
            break;
          case 'error':
            io.log(`FTMS : ${event.message}`);
            break;
          case 'notify': {
            const bytes = fromHex(event.hex);
            if (!bytes) break;
            if (event.characteristic === FTMS.treadmillData) {
              const data = parseTreadmillData(bytes);
              if (!data || data.moreData || data.speedKmh === undefined) break;
              const now = io.now();
              // Sans distance du tapis : intégrée entre deux mesures qui se suivent, jamais à travers un trou.
              if (data.totalDistanceM === undefined && speed !== null && now - measuredAtMs <= FRESH_MS) derivedM += (speed / 3.6) * ((now - measuredAtMs) / 1000);
              speed = data.speedKmh;
              distanceM = data.totalDistanceM ?? derivedM;
              incline = data.inclinePercent ?? null;
              elapsed = data.elapsedSec ?? null;
              measuredAtMs = now;
              stoppedByMachine = speed === 0;
            } else if (event.characteristic === FTMS.machineStatus) {
              const status = parseMachineStatus(bytes);
              if (status?.kind === 'stopped' || status?.kind === 'safety-key') stoppedByMachine = true;
            } else if (event.characteristic === FTMS.controlPoint) {
              const answer = parseControlResponse(bytes);
              if (answer?.requestOp === CONTROL_OP.requestControl) controlAnswer?.(answer.result === 'success');
            }
            break;
          }
        }
      });
      radio.connect(config.address);
    },
    async read(): Promise<Telemetry> {
      return {
        connected,
        running: speed !== null && speed > 0 && !stoppedByMachine,
        speedKmh: speed,
        distanceKm: distanceM === null ? null : distanceM / 1000,
        inclinePercent: incline,
        durationSec: elapsed,
        measuredAtMs,
        mode: 'manual',
      };
    },
    async stop(io: ConnectorIO) {
      const radio = io.radio;
      if (!radio || !connected) return { ok: false, message: 'Tapis déconnecté : utiliser son bouton Stop ou sa clé de sécurité.' };
      const startedGeneration = generation;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const granted = new Promise<boolean>((resolve) => {
        controlAnswer = resolve;
        timer = setTimeout(() => resolve(false), 1500);
      });
      try {
        const asked = await radio.writeControl('00');
        if (!asked.ok || !(await granted) || closed || !connected || generation !== startedGeneration)
          return { ok: false, message: 'Contrôle non confirmé ou liaison changée : utiliser le bouton physique.' };
        const stopped = await radio.writeControl('0801');
        return stopped.ok ? { ok: true, message: 'Arrêt transmis.' } : { ok: false, message: `Stop refusé par le tapis (${stopped.error ?? 'sans raison'}).` };
      } finally { clearTimeout(timer); controlAnswer = null; }
    },
    close() { closed = true; connected = false; generation++; clearTimeout(retry); controlAnswer?.(false); reset(); },
  });
}
