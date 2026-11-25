// Copyright 2026 Romeria. Licence Apache 2.0 (LICENSE).
/**
 * La relecture d'un connecteur avant de le charger : un connecteur ne parle au tapis que par ce que le kit
 * lui prête (`io.http`, `io.radio`). Le pont refuse de charger un fichier qui ouvre lui-même le réseau, la
 * radio, un port série ou un autre programme, ou qui contourne la relecture (code évalué, import dynamique).
 *
 * C'est une relecture du texte, pas une prison : elle attrape l'erreur et l'oubli, et dit au créateur du
 * connecteur (ou à son IA) ce qu'il faut changer. La garde du kit (`kit.ts`) et celle du jeu (qui ne connaît
 * que `GET /v1/status` et `POST /v1/stop`) restent en place derrière elle.
 */

/** Les modules qu'un connecteur peut importer, hors des fichiers voisins (chemins relatifs). */
const ALLOWED_MODULES = new Set(['node:crypto', 'node:util', 'node:buffer']);

const FORBIDDEN_CODE: Array<[RegExp, string]> = [
  [/(^|[^.\w])fetch\s*\(/, 'appel direct à fetch : passer par io.http (le kit garde les écritures)'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest : passer par io.http'],
  [/\bWebSocket\b/, 'WebSocket : passer par io.http'],
  [/\brequire\s*\(/, 'require : importer en tête de fichier'],
  [/\bimport\s*\(/, 'import dynamique : importer en tête de fichier'],
  [/\beval\s*\(/, 'eval : aucun code évalué'],
  [/\bnew\s+Function\b/, 'new Function : aucun code évalué'],
  [/\bprocess\s*\.\s*(binding|dlopen)\b/, 'accès natif interdit'],
  [/\bglobalThis\s*\[/, 'accès indirect aux globales'],
];

export type Verdict = { ok: true } | { ok: false; reasons: string[] };

/** Relit le texte d'un connecteur ; ses raisons de refus, ou ok. */
export function verifyConnectorSource(source: string): Verdict {
  const reasons: string[] = [];
  // Les commentaires ne comptent pas (un connecteur peut parler de fetch dans ses notes).
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const imports = [...code.matchAll(/\bimport\s+(?:type\s+)?(?:[^'"]*?\bfrom\s+)?['"]([^'"]+)['"]/g), ...code.matchAll(/\bexport\s+[^'"]*?\bfrom\s+['"]([^'"]+)['"]/g)];
  for (const match of imports) {
    const specifier = match[1]!;
    if (specifier.startsWith('./') || specifier.startsWith('../')) continue;
    if (!ALLOWED_MODULES.has(specifier)) reasons.push(`import de « ${specifier} » : un connecteur ne parle au tapis que par io.http et io.radio`);
  }
  for (const [pattern, reason] of FORBIDDEN_CODE) {
    if (pattern.test(code)) reasons.push(reason);
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
