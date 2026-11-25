// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
/**
 * Le pont : un petit serveur HTTP qui publie un connecteur selon le contrat `pont/v1` (docs/pont-v1.md),
 * celui que le jeu lit (source de tapis `pont`). Deux routes et rien d'autre : `GET /v1/status` (la mesure,
 * jugée par le kit) et `POST /v1/stop` (l'arrêt, avec le jeton du pont s'il en a un). Toute autre route
 * répond 404 : il n'existe aucune route pour démarrer ou régler le tapis.
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { RunningConnector } from './kit.ts';

export type PontOptions = {
  connector: RunningConnector;
  /** Le jeton exigé pour Stop (facultatif) ; la lecture reste libre. */
  token?: string | null;
  log?: (message: string) => void;
};

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

export function createPontServer(options: PontOptions): Server {
  const log = options.log ?? (() => {});
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = (request.url ?? '/').split('?')[0];
    request.resume();
    void (async () => {
      try {
        if (request.method === 'GET' && path === '/v1/status') return send(response, 200, await options.connector.status());
        if (request.method === 'POST' && path === '/v1/stop') {
          if (options.token) {
            const header = request.headers.authorization ?? '';
            const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
            if (!sameToken(given, options.token)) return send(response, 401, { ok: false, message: 'Jeton du pont manquant ou invalide.' });
          }
          const result = await options.connector.stop();
          log(`Stop : ${result.ok ? 'transmis' : 'refusé'} (${result.message})`);
          return send(response, 200, result);
        }
        // Aucune autre route : ni Démarrer, ni vitesse, ni pente.
        return send(response, 404, { error: 'Le pont ne connaît que GET /v1/status et POST /v1/stop.' });
      } catch (error) {
        return send(response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });
}
