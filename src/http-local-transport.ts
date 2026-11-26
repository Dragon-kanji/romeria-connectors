// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
import { request, type IncomingMessage } from 'node:http';
import { readHttpLocalSettings } from './http-local.ts';
import type { KitDeps } from './kit.ts';

const MAX_REPLY_BYTES = 16 * 1024;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

async function boundedBody(response: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response as AsyncIterable<Buffer>) {
    bytes += chunk.length;
    if (bytes > MAX_REPLY_BYTES) throw new Error('HTTP local : réponse trop longue.');
    chunks.push(chunk);
  }
  return UTF8.decode(Buffer.concat(chunks));
}

/** Transport du kit pour cette seule source. Pas de mandataire d'environnement ni de redirection. */
export const httpLocalFetch: KitDeps['fetch'] = (url, init) => new Promise((resolve, reject) => {
  const { url: origin } = readHttpLocalSettings({ url: new URL(url).origin });
  const read = init.method === 'GET' && url === `${origin}/telemetry` && init.body === undefined;
  const stop = init.method === 'POST' && url === `${origin}/stop` && init.body === '{}';
  if (!read && !stop) {
    reject(new Error('HTTP local : route ou méthode refusée.'));
    return;
  }
  const req = request(url, { agent: false, method: init.method, headers: init.headers, signal: init.signal }, response => {
    const status = response.statusCode ?? 0;
    const ok = status >= 200 && status < 300;
    if (!ok) {
      response.destroy();
      resolve({ status, ok, text: async () => '' });
      return;
    }
    void boundedBody(response).then(body => resolve({ status, ok, text: async () => body }), reject);
  });
  req.on('error', reject);
  req.end(init.body);
});
