import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { it } from 'node:test';

const pilot = process.env.ROMERIA_TEST_PILOT;
it('pilote Windows compilé : sortie de diagnostic Native AOT vérifiée sur fixture sans radio', { skip: !pilot }, () => {
  const report = JSON.parse(execFileSync(pilot!, ['--self-test'], { windowsHide: true, encoding: 'utf8' }));
  assert.equal(report.event, 'inspection'); assert.equal(report.packets[0].hex, '00000150'); assert.equal(report.errors.length, 0);
});
it('pilote Windows compilé : toutes les commandes sont refusées en lecture seule, sans ouvrir la radio', { skip: !pilot }, async () => {
  const child = spawn(pilot!, ['--lecture-seule'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (data) => { out += String(data); }); child.stderr.on('data', (data) => { err += String(data); });
  const done = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(err))); });
  for (const [i, cmd] of ['write', 'connect', 'start', 'speed', 'stop'].entries()) child.stdin.write(JSON.stringify({ cmd, id: i, hex: '0801' }) + '\n');
  child.stdin.end();
  const timer = setTimeout(() => child.kill(), 10_000);
  try { await done; const lines = out.trim().split('\n').map((line) => JSON.parse(line)); assert.equal(lines[0].event, 'ready'); assert.equal(lines.filter((m) => m.event === 'error').length, 5); assert.ok(lines.slice(1).every((m) => /lecture seule/.test(m.message))); }
  finally { clearTimeout(timer); child.kill(); }
});
