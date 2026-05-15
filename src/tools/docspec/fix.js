import { readFileSync, writeFileSync } from 'node:fs';
import { isOpenApiVersion } from './version.js';

export function applyFixes(filename, source, isYaml, data) {
  const edits = [
    ...collectSwaggerEdits(source, isYaml, data),
    ...collectOpenapiPathKeyEdits(source, isYaml, data),
  ];
  if (edits.length === 0) return { changed: false };

  const out = applyEditsToSource(source, edits);
  if (out === source) return { changed: false };
  writeFileSync(filename, out, 'utf-8');
  return { changed: true, count: edits.length };
}

function collectSwaggerEdits(source, isYaml, data) {
  if (!isYaml || data.swagger !== 2) return [];
  if (typeof data.info !== 'object' || data.info === null) return [];
  const edit = locateSwaggerNumericEdit(source);
  return edit ? [edit] : [];
}

function collectOpenapiPathKeyEdits(source, isYaml, data) {
  if (!isYaml || typeof data.openapi !== 'string') return [];
  if (!isOpenApiVersion(data.openapi)) return [];
  if (!data.paths || typeof data.paths !== 'object' || Array.isArray(data.paths)) return [];

  const edits = [];
  for (const pathKey of Object.keys(data.paths)) {
    if (pathKey.startsWith('/') || pathKey.startsWith('x-')) continue;
    const edit = locateYamlKeyPrependEdit(source, pathKey);
    if (edit) edits.push(edit);
  }
  return edits;
}

function applyEditsToSource(source, edits) {
  const sorted = edits.slice().sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return out;
}

// Line-by-line scan replaces the original `\s*swagger\s*:\s*…` regex.
// Walks source one line at a time (bounded work per line) and returns the
// edit that quotes the numeric `swagger: 2[.0]` into `swagger: "2.0"`.
function locateSwaggerNumericEdit(source) {
  let lineStart = 0;
  while (lineStart <= source.length) {
    const newlineAt = source.indexOf('\n', lineStart);
    const lineEnd = newlineAt === -1 ? source.length : newlineAt;
    const edit = swaggerEditFromLine(source, lineStart, lineEnd);
    if (edit) return edit;
    if (newlineAt === -1) break;
    lineStart = newlineAt + 1;
  }
  return null;
}

function swaggerEditFromLine(source, lineStart, lineEnd) {
  let i = skipYamlSpace(source, lineStart, lineEnd);
  if (!source.startsWith('swagger', i)) return null;
  i = skipYamlSpace(source, i + 'swagger'.length, lineEnd);
  if (source.charCodeAt(i) !== 58 /* ':' */) return null;
  i = skipYamlSpace(source, i + 1, lineEnd);

  const numStart = i;
  const numEnd = consumeSwaggerVersion(source, i);
  if (numEnd === -1) return null;

  if (!isYamlEndOfValue(source, numEnd, lineEnd)) return null;
  return { start: numStart, end: numEnd, replacement: '"2.0"' };
}

function consumeSwaggerVersion(source, i) {
  if (source.charCodeAt(i) !== 50 /* '2' */) return -1;
  return source.startsWith('.0', i + 1) ? i + 3 : i + 1;
}

function isYamlEndOfValue(source, i, lineEnd) {
  if (i >= lineEnd) return true;
  const after = skipYamlSpace(source, i, lineEnd);
  return after >= lineEnd || source.charCodeAt(after) === 35 /* '#' */;
}

function skipYamlSpace(source, i, lineEnd) {
  while (i < lineEnd && isYamlSpace(source.charCodeAt(i))) i++;
  return i;
}

// Find the first occurrence of `<key>:` at the start of a YAML line
// (after arbitrary leading whitespace) and return an edit that prepends
// `/` to the key (turning `users:` into `/users:` for OpenAPI paths).
// Operates line-by-line — no regex, no RegExp constructor.
function locateYamlKeyPrependEdit(source, key) {
  let lineStart = 0;
  while (lineStart <= source.length) {
    const newlineAt = source.indexOf('\n', lineStart);
    const lineEnd = newlineAt === -1 ? source.length : newlineAt;
    const keyOffset = findBareYamlKeyOnLine(source, lineStart, lineEnd, key);
    if (keyOffset !== -1) {
      return { start: keyOffset, end: keyOffset + key.length, replacement: `/${key}` };
    }
    if (newlineAt === -1) break;
    lineStart = newlineAt + 1;
  }
  return null;
}

function findBareYamlKeyOnLine(source, lineStart, lineEnd, key) {
  let i = lineStart;
  while (i < lineEnd && isYamlSpace(source.charCodeAt(i))) i++;
  if (i + key.length > lineEnd) return -1;
  if (!source.startsWith(key, i)) return -1;
  // The character immediately after the key must be whitespace or ':'.
  // This prevents matching a key that is a prefix of another key.
  const after = i + key.length;
  while (after < lineEnd && isYamlSpace(source.charCodeAt(after))) {
    // skip
    let j = after;
    while (j < lineEnd && isYamlSpace(source.charCodeAt(j))) j++;
    if (source.charCodeAt(j) === 58 /* ':' */) return i;
    return -1;
  }
  if (source.charCodeAt(after) === 58 /* ':' */) return i;
  return -1;
}

function isYamlSpace(code) {
  return code === 32 /* space */ || code === 9 /* tab */;
}

export function loadSource(filename) {
  return readFileSync(filename, 'utf-8');
}
