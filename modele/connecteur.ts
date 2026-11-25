// Copyright 2026 <ton nom>. Licence Apache 2.0.
/**
 * Modèle de connecteur : copie ce fichier, remplis les trois fonctions, essaie-le avec le pont.
 *
 *   node bin/pont.ts --connecteur mon-tapis/connecteur.ts --reglages mon-tapis/reglages.json
 *
 * Un connecteur dit ce que fait le tapis et au plus l'arrête. Il ne démarre ni n'accélère jamais le tapis :
 * le kit refuse un connecteur qui le tente (docs/securite.md). Pour parler au tapis, il n'a que ce que le
 * kit lui prête : `io.http` (lire, et écrire pendant Stop vers les cibles déclarées) et `io.radio` (FTMS).
 *
 * Guide pas à pas, avec l'aide d'une IA : docs/creer-son-connecteur.md.
 */
import { defineConnector, type Telemetry } from '../src/kit.ts';

/** Tes réglages, lus dans le fichier JSON donné au pont (`--reglages`). */
export type Reglages = {
  url: string;
};

export default function create(reglages: Reglages) {
  return defineConnector({
    name: 'Mon tapis',

    async read(io): Promise<Telemetry> {
      // TODO : lire le tapis (io.http.get ou io.radio), puis dire ce qu'il fait.
      const answer = await io.http.get(`${reglages.url}/status`);
      const body = (await answer.json()) as { connected?: boolean; speed?: number; distance?: number; measuredAtMs?: number };
      return {
        connected: answer.ok && body.connected === true,
        running: (body.speed ?? 0) > 0,
        speedKmh: body.speed ?? null, // km/h
        distanceKm: body.distance ?? null, // km, cumulée depuis le début de la séance du tapis
        // L'heure de la mesure (pas de la lecture) : si le tapis dit l'heure de sa mesure, la donner ici.
        measuredAtMs: body.measuredAtMs ?? 0,
      };
    },

    // Lecture seule au départ. Ajouter Stop seulement après vérification de son protocole.
  });
}
