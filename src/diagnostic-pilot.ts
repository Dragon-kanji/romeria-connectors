// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Device, Inspection } from './diagnostic.ts';

/** Client séparé : il ne sait envoyer que scan et inspect, le pilote refuse aussi toute commande. */
export function diagnosticPilot(command: readonly string[]) {
  if (!command[0]) throw new Error('Pilote manquant.');
  const child = spawn(command[0], [...command.slice(1), '--lecture-seule'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 1;
  const pending = new Map<number, { message: (m: Record<string, unknown>) => void; fail: (e: Error) => void }>();
  let failure: Error | null = null;
  function fail(error: Error) { failure = error; for (const task of [...pending.values()]) task.fail(error); }
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('exit', () => fail(new Error('Pilote arrêté.')));
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (line.length > 128_000) return fail(new Error('Réponse du pilote trop longue.'));
    try { const m = JSON.parse(line); pending.get(Number(m.id))?.message(m); } catch { fail(new Error('Réponse du pilote illisible.')); }
  });
  function request<T>(cmd: 'scan' | 'inspect', body: Record<string, unknown>, receive: (m: Record<string, unknown>) => T | undefined, timeout: number): Promise<T> {
    if (failure) return Promise.reject(failure);
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      const finish = (error: Error | null, value?: T) => { clearTimeout(timer); pending.delete(id); error ? reject(error) : resolve(value!); };
      const timer = setTimeout(() => finish(new Error('Délai du diagnostic dépassé.')), timeout);
      pending.set(id, { fail: (error) => finish(error), message: (m) => {
        if (m.event === 'error') return finish(new Error(String(m.message)));
        const result = receive(m); if (result !== undefined) finish(null, result);
      } });
      child.stdin.write(JSON.stringify({ cmd, id, ...body }) + '\n');
    });
  }
  return {
    scan(seconds = 5) {
      const devices = new Map<string, Device>();
      return request('scan', { all: true, seconds }, (m) => {
        if (m.event === 'device' && typeof m.address === 'string') {
          const previous = devices.get(m.address);
          devices.set(m.address, { address: m.address, name: String(m.name || previous?.name || ''), rssi: Number(m.rssi),
            services: [...new Set([...(previous?.services ?? []), ...(Array.isArray(m.services) ? m.services.filter((v): v is string => typeof v === 'string') : [])])] });
        }
        return m.event === 'scan-done' ? [...devices.values()].sort((a, b) => b.rssi - a.rssi) : undefined;
      }, (seconds + 5) * 1000);
    },
    inspect(address: string, seconds = 5) {
      return request<Inspection>('inspect', { address, seconds }, (m) => m.event === 'inspection' ? m as unknown as Inspection : undefined, 30_000);
    },
    close() { lines.close(); child.stdin.end(); child.kill(); },
  };
}
