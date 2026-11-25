// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
/**
 * La radio Bluetooth du kit : un petit programme, le pilote FTMS, qui parle la radio du système et répond
 * par lignes JSON sur sa sortie standard (sous Windows, `ashiato-ftms.exe` de Romeria ; le contrat est
 * décrit dans docs/pilote-ftms.md, n'importe quel pilote qui le parle convient). Le kit le lance, le garde
 * pour lui, et ne prête au connecteur qu'une radio gardée (`io.radio`).
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { RadioEvent, RawRadio } from '../kit.ts';

export type PilotOptions = {
  /** Le programme du pilote et ses arguments (par exemple `["ashiato-ftms.exe"]`, ou `["node", "faux-pilote.ts"]`). */
  command: readonly string[];
  log?: (line: string) => void;
  profile?: 'ftms' | 'rsc';
};

export function createPilotRadio(options: PilotOptions): RawRadio {
  const [program, ...args] = options.command;
  if (!program) throw new Error('pilote FTMS : programme manquant');
  const child = spawn(program, options.profile === 'rsc' ? [...args, '--lecture-seule'] : args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const listeners: ((event: RadioEvent) => void)[] = [];
  const emit = (event: RadioEvent): void => {
    for (const listener of [...listeners]) listener(event);
  };
  const pending = new Map<number, (result: { ok: boolean; error: string | null }) => void>();
  let nextId = 1;
  const send = (message: Record<string, unknown>): void => {
    if (!child.stdin.writable) return;
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      options.log?.(`pilote : ligne illisible (${line.slice(0, 120)})`);
      return;
    }
    switch (message.event) {
      case 'connected':
        emit({ type: 'connected', name: String(message.name ?? '') });
        break;
      case 'notify':
        if (typeof message.char === 'string' && typeof message.hex === 'string') emit({ type: 'notify', characteristic: message.char.toLowerCase(), hex: message.hex.toLowerCase() });
        break;
      case 'disconnected':
        emit({ type: 'disconnected', reason: String(message.reason ?? '') });
        break;
      case 'error':
        emit({ type: 'error', message: String(message.message ?? 'erreur du pilote') });
        break;
      case 'written': {
        const resolve = pending.get(Number(message.id));
        pending.delete(Number(message.id));
        resolve?.({ ok: message.ok === true, error: typeof message.error === 'string' ? message.error : null });
        break;
      }
      default:
        break;
    }
  });
  createInterface({ input: child.stderr }).on('line', (line) => options.log?.(`pilote : ${line.slice(0, 300)}`));
  child.on('exit', (code) => {
    emit({ type: 'disconnected', reason: `pilote arrêté (${code ?? 'signal'})` });
    for (const resolve of pending.values()) resolve({ ok: false, error: 'pilote arrêté' });
    pending.clear();
  });
  child.on('error', () => emit({ type: 'error', message: 'Impossible de lancer le pilote Bluetooth.' }));
  child.stdin.on('error', () => emit({ type: 'error', message: 'Entrée du pilote fermée.' }));
  return {
    connect: (address) => send(options.profile === 'rsc' ? { cmd: 'read-connect', profile: 'rsc', address } : { cmd: 'connect', address }),
    onEvent: (listener) => {
      listeners.push(listener);
    },
    writeControl(hex) {
      if (options.profile === 'rsc') return Promise.resolve({ ok: false, error: 'RSC : aucune écriture matérielle.' });
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        send({ cmd: 'write', id, hex });
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          resolve({ ok: false, error: 'pas d’accusé du pilote' });
        }, 4000);
      });
    },
    disconnect: () => send({ cmd: 'disconnect' }),
    close: () => {
      child.stdin.end();
      child.kill();
    },
  };
}
