// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
import { defineConnector, MAX_SPEED_KMH, type Telemetry } from './kit.ts';

export type HttpLocalSettings = { url: string; token?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readHttpLocalSettings(value: unknown): HttpLocalSettings {
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'url' && key !== 'token')
      || typeof value.url !== 'string' || value.url.trim() !== value.url
      || !/^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::\d{1,5})?\/?$/.test(value.url)
      || !URL.canParse(value.url)) {
    throw new Error('HTTP local : indiquer une origine HTTP sur 127.0.0.1 ou [::1], seule, dans « url ».');
  }
  const url = new URL(value.url);
  if (url.port === '0') throw new Error('HTTP local : port invalide.');
  if (value.token !== undefined && (typeof value.token !== 'string' || value.token.length === 0 || value.token.length > 2048 || /[^\x21-\x7e]/.test(value.token))) {
    throw new Error('HTTP local : « token » doit être une chaîne ASCII imprimable sans espace.');
  }
  return { url: url.origin, ...(value.token === undefined ? {} : { token: value.token }) };
}

function reading(value: unknown, min: number, max: number, integer = false): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) {
    throw new Error('HTTP local : valeur de télémétrie invalide.');
  }
  return value;
}

function text(value: unknown, token: string | undefined): string {
  if (typeof value !== 'string' || value.length > 512) throw new Error('HTTP local : texte de réponse invalide.');
  return (token === undefined ? value : value.replaceAll(token, '[masqué]')).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, 512);
}

function telemetry(value: unknown, now: number, token: string | undefined): Telemetry {
  if (!isRecord(value) || typeof value.connected !== 'boolean' || typeof value.running !== 'boolean'
      || typeof value.measuredAtMs !== 'number' || !Number.isSafeInteger(value.measuredAtMs) || value.measuredAtMs < 0 || value.measuredAtMs > now) {
    throw new Error('HTTP local : télémétrie ou heure de mesure invalide.');
  }
  const result: Telemetry = {
    connected: value.connected, running: value.running, measuredAtMs: value.measuredAtMs,
    speedKmh: reading(value.speedKmh, 0, MAX_SPEED_KMH),
    distanceKm: reading(value.distanceKm, 0, Number.MAX_SAFE_INTEGER),
  };
  if (value.durationSec !== undefined) result.durationSec = reading(value.durationSec, 0, Number.MAX_SAFE_INTEGER);
  if (value.steps !== undefined) result.steps = reading(value.steps, 0, Number.MAX_SAFE_INTEGER, true);
  if (value.inclinePercent !== undefined) result.inclinePercent = reading(value.inclinePercent, -100, 100);
  if (value.maxSpeedKmh !== undefined) result.maxSpeedKmh = reading(value.maxSpeedKmh, 0, MAX_SPEED_KMH);
  if (value.mode !== undefined) result.mode = text(value.mode, token);
  if (value.beltState !== undefined) result.beltState = text(value.beltState, token);
  if (value.error !== undefined) result.error = value.error === null ? null : text(value.error, token);
  const source = value.measurementSource;
  if (source !== undefined) {
    if (source !== 'treadmill' && source !== 'rsc' && source !== 'declared' && source !== 'simulated') {
      throw new Error('HTTP local : source de mesure invalide.');
    }
    result.measurementSource = source;
  }
  if (value.virtual !== undefined && typeof value.virtual !== 'boolean') throw new Error('HTTP local : marque virtuelle invalide.');
  if (source === 'simulated' || value.virtual === true) result.virtual = true;
  return result;
}

export function createHttpLocalConnector(settings: unknown) {
  const { url, token } = readHttpLocalSettings(settings);
  const headers = token === undefined ? undefined : { authorization: `Bearer ${token}` };
  const stop = `${url}/stop`;
  return defineConnector({
    name: 'HTTP local',
    stopTargets: [stop],
    async read(io) {
      let payload: unknown;
      try {
        const answer = await io.http.get(`${url}/telemetry`, headers);
        if (!answer.ok) throw new Error();
        payload = await answer.json();
      } catch {
        throw new Error('HTTP local : lecture de la télémétrie impossible.');
      }
      return telemetry(payload, io.now(), token);
    },
    async stop(io) {
      try {
        const answer = await io.http.post(stop, {}, headers);
        if (!answer.ok) return { ok: false, message: `HTTP local : Stop refusé (HTTP ${answer.status}).` };
        const payload = await answer.json();
        if (!isRecord(payload) || typeof payload.ok !== 'boolean') throw new Error();
        return { ok: payload.ok, message: text(payload.message, token) };
      } catch {
        return { ok: false, message: 'HTTP local : Stop non confirmé.' };
      }
    },
  });
}
