// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
/**
 * Le kit de connecteurs de Romeria : un connecteur dit ce que fait un tapis de marche, et au plus l'arrête.
 * Le kit le fait tourner et impose la sécurité lui-même, quel que soit le connecteur :
 *
 * - **Lecture, et au plus Stop.** Un connecteur n'a que quatre gestes : s'ouvrir, lire, arrêter, se fermer.
 *   Un connecteur qui propose autre chose (démarrer, régler la vitesse, la pente…) est refusé au chargement.
 * - **Aucune écriture hors de Stop.** Le connecteur ne parle au tapis que par les moyens que le kit lui
 *   prête (`io.http`, `io.radio`). Pendant la lecture, toute écriture est refusée ; pendant Stop, seules les
 *   cibles déclarées d'avance (`stopTargets`) et les deux écritures FTMS permises (demande de contrôle, Stop).
 *   Un connecteur qui tente autre chose est refusé par le kit, pour de bon : il ne lit plus rien.
 * - **Mesure périmée = Stop seulement.** Une mesure de plus de 3 s est périmée : ni vitesse ni distance, et
 *   le jeu ne compte rien. Stop part toujours, même sans mesure fraîche.
 * - **Commandes coupées.** `controls_enabled` vaut toujours faux dans ce que le kit publie (contrat `pont/v1`).
 */

/** Ce que le tapis dit, à l'instant `measuredAtMs` (l'heure de la mesure, pas celle de la lecture). */
export type Telemetry = {
  connected: boolean;
  running: boolean;
  speedKmh: number | null;
  /** La distance cumulée de la séance du tapis (elle repart de zéro à une nouvelle séance). */
  distanceKm: number | null;
  measuredAtMs: number;
  durationSec?: number | null;
  steps?: number | null;
  inclinePercent?: number | null;
  maxSpeedKmh?: number | null;
  mode?: string;
  beltState?: string;
  error?: string | null;
  measurementSource?: 'treadmill' | 'rsc' | 'declared' | 'simulated';
  virtual?: boolean;
};

export type StopResult = { ok: boolean; message: string };

/** Une réponse HTTP, réduite à ce qu'un connecteur lit. */
export type HttpAnswer = { status: number; ok: boolean; text: () => Promise<string>; json: () => Promise<unknown> };

export type GuardedHttp = {
  /** Lire : toujours permis. */
  get: (url: string, headers?: Record<string, string>) => Promise<HttpAnswer>;
  /** Écrire : seulement pendant Stop, et seulement vers une cible déclarée (`stopTargets`). */
  post: (url: string, body: unknown, headers?: Record<string, string>) => Promise<HttpAnswer>;
};

/** Un événement de la radio Bluetooth (FTMS) : connexion, notification d'une caractéristique, perte. */
export type RadioEvent =
  | { type: 'connected'; name: string }
  | { type: 'notify'; characteristic: string; hex: string }
  | { type: 'disconnected'; reason: string }
  | { type: 'error'; message: string };

export type GuardedRadio = {
  connect: (address: string) => void;
  onEvent: (listener: (event: RadioEvent) => void) => void;
  /** Le point de contrôle FTMS : seulement pendant Stop, et seulement `00` (demande de contrôle) et `0801` (Stop). */
  writeControl: (hex: string) => Promise<{ ok: boolean; error: string | null }>;
  disconnect: () => void;
};

/** Ce que le kit prête à un connecteur : il n'a rien d'autre pour parler au tapis. */
export type ConnectorIO = {
  http: GuardedHttp;
  radio: GuardedRadio | null;
  now: () => number;
  log: (message: string) => void;
};

export type Connector = {
  /** Le nom du tapis ou du connecteur, affiché. */
  name: string;
  /** Les adresses HTTP que Stop peut appeler, déclarées d'avance (aucune autre écriture ne part). */
  stopTargets?: readonly string[];
  open?: (io: ConnectorIO) => Promise<void> | void;
  read: (io: ConnectorIO) => Promise<Telemetry>;
  stop?: (io: ConnectorIO) => Promise<StopResult>;
  close?: () => Promise<void> | void;
};

/** Le statut publié par le kit, tel que le contrat `pont/v1` le décrit (`GET /v1/status`). */
export type PontStatus = {
  measurement_source: 'treadmill' | 'rsc' | 'declared' | 'simulated';
  virtual: boolean;
  connected: boolean;
  fresh: boolean;
  controls_enabled: false;
  running: boolean;
  mode: string;
  belt_state: string;
  speed_kmh: number | null;
  distance_km: number | null;
  max_speed_kmh: number | null;
  running_max_speed_kmh: null;
  duration_seconds: number | null;
  steps: number | null;
  incline_percent: number | null;
  command_status: 'idle';
  error: string | null;
};

/** Une mesure a 3 s au plus : au-delà, elle est périmée. */
export const FRESH_MS = 3000;
/** Une lecture qui ne répond pas en 2 s ne donne pas de mesure. */
export const READ_TIMEOUT_MS = 2000;
/** Au-delà, ce n'est pas un tapis de marche : la mesure est refusée. */
export const MAX_SPEED_KMH = 30;

const ALLOWED_KEYS = new Set(['name', 'stopTargets', 'open', 'read', 'stop', 'close']);
/** Les noms d'une commande qu'un connecteur ne doit jamais proposer. */
const FORBIDDEN_WORDS = /start|resume|speed|vitesse|demarr|démarr|incline|pente|faster|increase|accel|accél/i;
/** Une cible d'arrêt qui ressemble à démarrer ou à régler quelque chose est refusée (défense en profondeur). */
const SUSPICIOUS_TARGET = /start|resume|speed|incline|turn_on|set_value|increase|select_option|press_start|accel/i;

/** L'erreur levée quand un connecteur tente un geste interdit : le kit le refuse pour de bon. */
export class KitRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KitRefusal';
  }
}

/** Vérifie un connecteur avant de le lancer ; la raison du refus, ou null. */
export function checkConnector(candidate: unknown): string | null {
  if (typeof candidate !== 'object' || candidate === null) return 'un connecteur est un objet (defineConnector)';
  const connector = candidate as Record<string, unknown>;
  if (typeof connector.name !== 'string' || connector.name.trim() === '') return 'un connecteur a un nom (`name`)';
  if (typeof connector.read !== 'function') return 'un connecteur sait lire (`read`)';
  for (const key of Object.keys(connector)) {
    if (!ALLOWED_KEYS.has(key)) {
      return FORBIDDEN_WORDS.test(key)
        ? `« ${key} » : un connecteur lit le tapis et au plus l'arrête ; il ne le démarre ni ne l'accélère jamais`
        : `« ${key} » : un connecteur n'a que name, stopTargets, open, read, stop et close`;
    }
  }
  for (const key of ['open', 'stop', 'close'] as const) {
    if (connector[key] !== undefined && typeof connector[key] !== 'function') return `« ${key} » doit être une fonction`;
  }
  const targets = connector.stopTargets;
  if (targets !== undefined) {
    if (!Array.isArray(targets) || targets.some((target) => typeof target !== 'string' || !URL.canParse(target) || !/^https?:$/.test(new URL(target).protocol))) return '`stopTargets` : une liste d’adresses http(s)';
    const suspicious = (targets as string[]).find((target) => SUSPICIOUS_TARGET.test(target));
    if (suspicious) return `cible d'arrêt refusée (${suspicious}) : elle ressemble à démarrer ou régler le tapis`;
    if (connector.stop === undefined) return '`stopTargets` sans `stop`';
  }
  return null;
}

/** Déclare un connecteur (vérifié au chargement par le kit). */
export function defineConnector<T extends Connector>(connector: T): T {
  return connector;
}

/** Une mesure telle que le kit la publie : périmée, elle ne dit ni vitesse ni distance. */
export function toPontStatus(telemetry: Telemetry | null, nowMs: number, error: string | null = null): PontStatus {
  const base: PontStatus = {
    measurement_source: telemetry?.measurementSource ?? 'treadmill',
    virtual: telemetry?.virtual === true,
    connected: false,
    fresh: false,
    controls_enabled: false,
    running: false,
    mode: 'unknown',
    belt_state: 'unavailable',
    speed_kmh: null,
    distance_km: null,
    max_speed_kmh: null,
    running_max_speed_kmh: null,
    duration_seconds: null,
    steps: null,
    incline_percent: null,
    command_status: 'idle',
    error,
  };
  if (telemetry === null) return base;
  const finite = (value: number | null | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const speed = finite(telemetry.speedKmh);
  const distance = finite(telemetry.distanceKm);
  const age = nowMs - telemetry.measuredAtMs;
  let problem = error ?? telemetry.error ?? null;
  if (speed !== null && (speed < 0 || speed > MAX_SPEED_KMH)) problem = `vitesse hors des bornes (${speed} km/h) : mesure refusée`;
  if (distance !== null && distance < 0) problem = 'distance négative : mesure refusée';
  const fresh = telemetry.connected && problem === null && Number.isFinite(age) && age >= -1000 && age <= FRESH_MS;
  return {
    ...base,
    connected: telemetry.connected,
    fresh,
    running: fresh && telemetry.running,
    mode: telemetry.mode ?? 'manual',
    belt_state: telemetry.beltState ?? (telemetry.connected ? (telemetry.running ? 'running' : 'stopped') : 'unavailable'),
    // Sans mesure fraîche : rien n'est dit, rien n'est compté.
    speed_kmh: fresh ? speed : null,
    distance_km: fresh ? distance : null,
    max_speed_kmh: finite(telemetry.maxSpeedKmh),
    duration_seconds: fresh ? finite(telemetry.durationSec) : null,
    steps: fresh ? finite(telemetry.steps) : null,
    incline_percent: fresh ? finite(telemetry.inclinePercent) : null,
    error: problem,
  };
}

/** Ce qu'il faut au kit pour parler au monde ; les tests en donnent des faux. */
export type KitDeps = {
  fetch: (url: string, init: { method: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal; redirect?: 'error' }) => Promise<{ status: number; ok: boolean; text: () => Promise<string> }>;
  /** La radio Bluetooth (un pilote FTMS, ou un tapis simulé) ; null sans radio. */
  radio?: RawRadio | null;
  now: () => number;
  log?: (message: string) => void;
};

/** La radio brute, sans garde (fournie par le kit : pilote FTMS, ou simulateur). */
export type RawRadio = {
  connect: (address: string) => void;
  onEvent: (listener: (event: RadioEvent) => void) => void;
  writeControl: (hex: string) => Promise<{ ok: boolean; error: string | null }>;
  disconnect: () => void;
  close?: () => void;
};

export type RunningConnector = {
  name: string;
  /** Le statut à publier : la dernière mesure, jugée maintenant. */
  status: () => Promise<PontStatus>;
  /** Stop : toujours tenté, même sans mesure fraîche. */
  stop: () => Promise<StopResult>;
  /** La raison du refus du connecteur par le kit, ou null. */
  refusal: () => string | null;
  close: () => Promise<void>;
};

/** Les deux seules écritures permises au point de contrôle FTMS. */
export const ALLOWED_CONTROL_WRITES = ['00', '0801'] as const;

/** Lance un connecteur sous la garde du kit. Un connecteur refusé à la vérification n'est pas lancé. */
export async function startConnector(candidate: unknown, deps: KitDeps): Promise<RunningConnector> {
  const problem = checkConnector(candidate);
  if (problem) throw new KitRefusal(`Connecteur refusé : ${problem}.`);
  const connector = candidate as Connector;
  const log = deps.log ?? (() => {});
  let closed = false;
  let refused: string | null = null;
  const targets = new Set((connector.stopTargets ?? []).map((target) => new URL(target).href));

  const refuse = (message: string): never => {
    if (refused === null) {
      refused = message;
      log(`connecteur refusé par le kit : ${message}`);
    }
    throw new KitRefusal(message);
  };
  const answer = (response: { status: number; ok: boolean; text: () => Promise<string> }): HttpAnswer => {
    let body: Promise<string> | null = null;
    const text = (): Promise<string> => (body ??= response.text());
    return { status: response.status, ok: response.ok, text, json: async () => JSON.parse(await text()) as unknown };
  };
  // Chaque opération reçoit une capacité propre, révoquée à sa fin ou à son délai.
  // Une lecture concurrente ne reçoit jamais les permissions du Stop.
  function capability(stopping: boolean) {
    let active = true;
    const check = (): void => { if (!active || closed) throw new KitRefusal('opération terminée : aucune écriture différée'); };
    const http: GuardedHttp = {
      async get(url, headers) {
        check();
        if (refused) refuse(refused);
        return answer(await deps.fetch(url, { method: 'GET', redirect: 'error', ...(headers ? { headers } : {}), signal: AbortSignal.timeout(READ_TIMEOUT_MS) }));
      },
      async post(url, body, headers) {
        check();
        if (refused) refuse(refused);
        if (!stopping) refuse(`écriture HTTP pendant la lecture (${url}) : seul Stop écrit`);
        if (!URL.canParse(url) || !targets.has(new URL(url).href)) refuse(`écriture vers une cible non déclarée (${url}) : seules les cibles d'arrêt déclarées (stopTargets)`);
        return answer(await deps.fetch(url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', ...(headers ?? {}) }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(4000) }));
      },
    };
    const raw = deps.radio ?? null;
    const radio: GuardedRadio | null = raw
      ? {
          connect: (address) => raw.connect(address),
          onEvent: (listener) => raw.onEvent(listener),
          async writeControl(hex) {
            if (refused) refuse(refused);
            const clean = hex.toLowerCase();
            if (!(ALLOWED_CONTROL_WRITES as readonly string[]).includes(clean)) refuse(`écriture FTMS interdite (${clean}) : seulement 00 (demande de contrôle) et 0801 (Stop)`);
            check();
            if (!stopping) refuse(`écriture FTMS pendant la lecture (${clean}) : seul Stop écrit`);
            return raw.writeControl(clean);
          },
          disconnect: () => raw.disconnect(),
        }
      : null;
    const io: ConnectorIO = { http, radio, now: deps.now, log };
    return { io, revoke: () => { active = false; } };
  }

  const opening = capability(false);
  await connector.open?.(opening.io);
  let last: Telemetry | null = null;
  let lastError: string | null = null;
  let stopFlight: Promise<StopResult> | null = null;

  async function read(): Promise<void> {
    if (refused || closed) return;
    const reading = capability(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const telemetry = await Promise.race([
        connector.read(reading.io),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`pas de réponse en ${READ_TIMEOUT_MS / 1000} s`)), READ_TIMEOUT_MS);
        }),
      ]);
      last = telemetry;
      lastError = null;
    } catch (error) {
      lastError = error instanceof KitRefusal ? error.message : `lecture impossible : ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      reading.revoke();
      clearTimeout(timer);
    }
  }

  return {
    name: connector.name,
    async status() {
      await read();
      if (refused) return toPontStatus(null, deps.now(), `connecteur refusé par le kit : ${refused}`);
      return toPontStatus(last, deps.now(), lastError);
    },
    stop() {
      if (stopFlight) return stopFlight;
      stopFlight = (async (): Promise<StopResult> => {
        if (refused) return { ok: false, message: `Connecteur refusé par le kit (${refused}) : utiliser le bouton Stop du tapis ou sa clé de sécurité.` };
        if (!connector.stop) return { ok: false, message: 'Ce connecteur ne sait pas arrêter le tapis : utiliser son bouton Stop ou sa clé de sécurité.' };
        if (closed) return { ok: false, message: 'Connecteur fermé : utiliser le bouton physique.' };
        const stopping = capability(true);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([connector.stop(stopping.io), new Promise<StopResult>((resolve) => {
            timer = setTimeout(() => resolve({ ok: false, message: 'Arrêt sans réponse : utiliser le bouton physique.' }), 4000);
          })]);
        } catch (error) {
          return { ok: false, message: error instanceof KitRefusal ? `Refusé par le kit : ${error.message}` : `Arrêt impossible : ${error instanceof Error ? error.message : String(error)}` };
        } finally {
          stopping.revoke();
          clearTimeout(timer);
        }
      })().finally(() => { stopFlight = null; });
      return stopFlight;
    },
    refusal: () => refused,
    async close() {
      closed = true;
      last = null;
      opening.revoke();
      await connector.close?.();
      deps.radio?.close?.();
    },
  };
}
