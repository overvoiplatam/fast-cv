import { readFileSync, writeFileSync } from 'node:fs';
import { isOpenApiVersion } from './version.js';

export function applyFixes(filename, source, isYaml, data) {
  const edits = [];

  if (isYaml && data.swagger === 2 && typeof data.info === 'object' && data.info !== null) {
    const edit = locateSwaggerNumericEdit(source);
    if (edit) edits.push(edit);
  }

  if (isYaml && typeof data.openapi === 'string' && isOpenApiVersion(data.openapi) && data.paths && typeof data.paths === 'object' && !Array.isArray(data.paths)) {
    for (const pathKey of Object.keys(data.paths)) {
      if (pathKey.startsWith('/') || pathKey.startsWith('x-')) continue;
      const edit = locateYamlKeyPrependEdit(source, pathKey);
      if (edit) edits.push(edit);
    }
  }

  if (edits.length === 0) return { changed: false };

  edits.sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  if (out === source) return { changed: false };
  writeFileSync(filename, out, 'utf-8');
  return { changed: true, count: edits.length };
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
  let i = lineStart;
  while (i < lineEnd && isYamlSpace(source.charCodeAt(i))) i++;
  if (!source.startsWith('swagger', i)) return null;
  i += 'swagger'.length;
  while (i < lineEnd && isYamlSpace(source.charCodeAt(i))) i++;
  if (source.charCodeAt(i) !== 58 /* ':' */) return null;
  i++;
  while (i < lineEnd && isYamlSpace(source.charCodeAt(i))) i++;
  const numStart = i;
  // Match `2` optionally followed by `.0`
  if (source.charCodeAt(i) !== 50 /* '2' */) return null;
  i++;
  if (source.startsWith('.0', i)) i += 2;
  const numEnd = i;
  // Trailing must be end-of-line or whitespace before optional `# comment`
  if (i < lineEnd) {
    while (i < lineEnd && isYamlSpace(source.charCodeAt(i))) i++;
    if (i < lineEnd && source.charCodeAt(i) !== 35 /* '#' */) return null;
  }
  return { start: numStart, end: numEnd, replacement: '"2.0"' };
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
