import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { it } from 'node:test';
import { connectInstalled, loopbackUrl } from '../src/installed.ts';

it('branchement au jeu installé : boucle locale vérifiée, jeton privé et seul le tapis change', async () => {
  const base = resolve('.test-output'); mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'profil-'));
  try {
    writeFileSync(join(dir, 'serveur.json'), JSON.stringify({ mode: 'local', name: 'ashiato-server', url: 'http://127.0.0.1:9876' }));
    writeFileSync(join(dir, 'command-token'), 'jeton-factice-test');
    const calls: { url: string; init?: RequestInit }[] = [];
    const request: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/health')) return Response.json({ name: 'ashiato-server', mode: 'local' });
      if (init?.method === 'PUT') { assert.equal((init.headers as Record<string, string>).authorization, 'Bearer jeton-factice-test'); assert.deepEqual(JSON.parse(String(init.body)), { tapis: { kind: 'pont', url: 'http://127.0.0.1:8800' } }); return Response.json({ ok: true }); }
      return Response.json({ active: { tapis: { kind: 'pont', url: 'http://127.0.0.1:8800' } } });
    };
    assert.equal((await connectInstalled(dir, 'http://127.0.0.1:8800', request)).ok, true);
    assert.equal(calls.length, 3); assert.ok(calls.every((c) => c.init?.redirect === 'error'));
    assert.ok(calls.every((c) => !c.url.includes('jeton')));
    const refused: typeof fetch = async (url) => String(url).endsWith('/health') ? Response.json({ mode: 'local', name: 'ashiato-server' }) : Response.json({}, { status: 409 });
    await assert.rejects(connectInstalled(dir, 'http://127.0.0.1:8800', refused), /409/);
  } finally { assert.ok(dir.startsWith(base)); rmSync(dir, { recursive: true }); }
});

it('aucun accès distant, redirection, jeton en URL ou chemin caché au branchement', () => {
  for (const url of ['http://192.168.1.1:8800', 'http://100.64.0.10:8796', 'http://127.0.0.1:8800/api', 'http://secret@localhost:8800', 'http://localhost:8800/?token=x', 'https://localhost:8800']) assert.throws(() => loopbackUrl(url));
  assert.equal(loopbackUrl('http://localhost:8800'), 'http://localhost:8800');
});
