// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loopbackUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Adresse HTTP locale attendue, sans chemin, identifiant ni jeton.');
  return url.origin;
}

/** Le profil appartient au joueur : conserver tous ses réglages, passer par l'API authentifiée du jeu. */
export async function connectInstalled(profileDir: string, bridgeUrl: string, request: typeof fetch = fetch) {
  const bridge = loopbackUrl(bridgeUrl);
  const discovery = JSON.parse(readFileSync(join(profileDir, 'serveur.json'), 'utf8'));
  const game = loopbackUrl(discovery.url);
  if (discovery.mode !== 'local' || discovery.name !== 'ashiato-server') throw new Error('Le serveur local du jeu doit être ouvert.');
  const health = await request(`${game}/health`, { redirect: 'error', signal: AbortSignal.timeout(3000) });
  const info = await health.json() as { mode?: string; name?: string };
  if (!health.ok || info.mode !== 'local' || info.name !== 'ashiato-server') throw new Error('Ce serveur ne correspond pas au jeu local.');
  const token = readFileSync(join(profileDir, 'command-token'), 'utf8').trim();
  const response = await request(`${game}/api/v1/local/connectors`, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ tapis: { kind: 'pont', url: bridge } }) });
  if (!response.ok) throw new Error(`Branchement refusé (HTTP ${response.status}). Arrêter la bande physiquement avant de changer de source.`);
  const active = await request(`${game}/api/v1/local/connectors`, { redirect: 'error', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
  const state = await active.json() as { active?: { tapis?: { kind?: string; url?: string } } };
  if (!active.ok || state.active?.tapis?.kind !== 'pont' || state.active.tapis.url !== bridge) throw new Error('Le jeu ne confirme pas le pont demandé.');
  return { ok: true, url: bridge };
}
