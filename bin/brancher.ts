// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { connectInstalled } from '../src/installed.ts';

const { values } = parseArgs({ options: { profil: { type: 'string' }, url: { type: 'string', default: 'http://127.0.0.1:8800' }, aide: { type: 'boolean' } } });
if (values.aide) console.log('node bin/brancher.ts [--profil dossier-des-donnees] [--url http://127.0.0.1:8800]');
else {
  try {
    const profile = values.profil ?? (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Romeria') : undefined);
    if (!profile) throw new Error('--profil requis.');
    await connectInstalled(profile, values.url);
    console.log('Pont sélectionné dans Romeria / Bridge selected in Romeria.');
  } catch (error) { console.error(error instanceof Error ? error.message : 'Branchement impossible.'); process.exitCode = 1; }
}
