import { readFileSync, writeFileSync } from 'node:fs';

// eslint-disable-next-line complexity -- applies the safe-fix whitelist for OpenAPI/Swagger/AsyncAPI; each branch is one fix kind
export function applyFixes(filename, source, isYaml, data) {
  const edits = [];

  if (isYaml && data.swagger === 2 && typeof data.info === 'object' && data.info !== null) {
    const re = /(^|\n)(\s*swagger\s*:\s*)(2(?:\.0)?)(\s*(?:#.*)?)(?=\n|$)/;
    const m = re.exec(source);
    if (m) {
      const numericPart = m[3];
      if (numericPart === '2' || numericPart === '2.0') {
        edits.push({ start: m.index + m[1].length + m[2].length, end: m.index + m[1].length + m[2].length + numericPart.length, replacement: '"2.0"' });
      }
    }
  }

  if (isYaml && typeof data.openapi === 'string' && /^3\.\d+(\.\d+)?$/.test(data.openapi) && data.paths && typeof data.paths === 'object' && !Array.isArray(data.paths)) {
    for (const pathKey of Object.keys(data.paths)) {
      if (pathKey.startsWith('/') || pathKey.startsWith('x-')) continue;
      const escaped = pathKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const keyRe = new RegExp(`(^|\\n)(\\s*)(${escaped})(\\s*:)`, 'g');
      let m;
      while ((m = keyRe.exec(source)) !== null) {
        const keyStart = m.index + m[1].length + m[2].length;
        edits.push({ start: keyStart, end: keyStart + pathKey.length, replacement: `/${pathKey}` });
        break;
      }
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

export function loadSource(filename) {
  return readFileSync(filename, 'utf-8');
}
