// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
/**
 * Exemple : un tapis KingSmith (WalkingPad) vu par Home Assistant. Home Assistant parle déjà au tapis (par
 * son intégration) ; ce connecteur lit ses entités par l'API REST de Home Assistant et, pour Stop, appelle
 * le seul service d'arrêt déclaré. Rien d'autre ne part : le kit refuserait toute autre écriture.
 *
 * Réglages (un fichier JSON, voir `reglages.exemple.json`) :
 * - `url` : l'adresse de Home Assistant (`http://homeassistant.local:8123`) ;
 * - `token` : un jeton d'accès longue durée de Home Assistant (Profil, Sécurité) ;
 * - `speedEntity`, `distanceEntity` : les capteurs de la vitesse (km/h) et de la distance (km) ;
 * - `runningEntity` (facultatif) : un capteur ou binaire qui dit si la bande tourne ;
 * - `stop` : le service d'arrêt, `{ "domain": "button", "service": "press", "entityId": "button.walkingpad_stop" }`.
 *
 * Les noms des entités dépendent de l'intégration : les lire dans Outils de développement, États.
 */
import { defineConnector, type ConnectorIO, type Telemetry } from '../../src/kit.ts';

export type HomeAssistantConfig = {
  url: string;
  token: string;
  speedEntity: string;
  distanceEntity: string;
  runningEntity?: string;
  stop: { domain: string; service: string; entityId: string };
};

type EntityState = { state: string; last_updated?: string; last_reported?: string; attributes?: Record<string, unknown> };

export function createHomeAssistantConnector(config: HomeAssistantConfig) {
  const base = config.url.replace(/\/+$/, '');
  const headers = { authorization: `Bearer ${config.token}`, accept: 'application/json' };
  const stopUrl = `${base}/api/services/${encodeURIComponent(config.stop.domain)}/${encodeURIComponent(config.stop.service)}`;

  async function entity(io: ConnectorIO, id: string): Promise<EntityState | null> {
    const answer = await io.http.get(`${base}/api/states/${encodeURIComponent(id)}`, headers);
    if (!answer.ok) return null;
    return (await answer.json()) as EntityState;
  }
  const number = (state: EntityState | null): number | null => {
    if (!state || state.state === 'unavailable' || state.state === 'unknown') return null;
    const value = Number(state.state);
    return Number.isFinite(value) ? value : null;
  };

  return defineConnector({
    name: 'KingSmith par Home Assistant',
    stopTargets: [stopUrl],
    async read(io): Promise<Telemetry> {
      const [speed, distance, running] = await Promise.all([
        entity(io, config.speedEntity),
        entity(io, config.distanceEntity),
        config.runningEntity ? entity(io, config.runningEntity) : Promise.resolve(null),
      ]);
      const speedKmh = number(speed);
      // La mesure date du dernier rapport de Home Assistant sur la vitesse : vieille, elle est périmée.
      const reported = speed?.last_reported ?? speed?.last_updated;
      const measuredAtMs = reported ? Date.parse(reported) : 0;
      const isRunning = running ? ['on', 'true', 'running', 'started'].includes(running.state.toLowerCase()) : (speedKmh ?? 0) > 0;
      return { connected: speedKmh !== null, running: isRunning, speedKmh, distanceKm: number(distance), measuredAtMs, mode: 'manual' };
    },
    async stop(io) {
      const answer = await io.http.post(stopUrl, { entity_id: config.stop.entityId }, headers);
      return answer.ok ? { ok: true, message: 'Arrêt transmis à Home Assistant.' } : { ok: false, message: `Home Assistant refuse l'arrêt (HTTP ${answer.status}).` };
    },
  });
}

/** Le connecteur chargé par le pont (`--connecteur exemples/kingsmith-home-assistant/connecteur.ts --reglages …`). */
export default function create(config: HomeAssistantConfig) {
  return createHomeAssistantConnector(config);
}
