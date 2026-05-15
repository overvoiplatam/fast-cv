import { offsetToLineCol } from '../offset-to-linecol.js';

export function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function isStringArray(v) {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

// Find `"<key>"` followed by optional whitespace and `:` in `source`,
// using indexOf instead of constructing a regex from a runtime string.
// This is structurally simpler than escaping every regex metacharacter
// and avoids the eslint-plugin-security non-literal-regexp warning.
function locateJsonKey(source, lineIndex, key) {
  if (typeof key !== 'string') return null;
  const needle = `"${key}"`;
  let from = 0;
  while (from <= source.length) {
    const at = source.indexOf(needle, from);
    if (at < 0) return null;
    let after = at + needle.length;
    while (after < source.length) {
      const code = source.charCodeAt(after);
      if (code === 58 /* ':' */) return offsetToLineCol(lineIndex, at);
      if (!isJsonWhitespace(code)) break;
      after++;
    }
    from = at + needle.length;
  }
  return null;
}

function isJsonWhitespace(code) {
  return code === 32 /* space */
    || code === 9 /* tab */
    || code === 10 /* LF */
    || code === 13 /* CR */;
}

function getPairKeyNode(doc, path) {
  if (path.length === 0) return null;
  const parent = doc.getIn(path.slice(0, -1), true);
  if (!parent || !Array.isArray(parent.items)) return null;
  const last = path[path.length - 1];
  for (const pair of parent.items) {
    const k = pair && pair.key;
    if (!k) continue;
    const v = (typeof k === 'object' && k !== null && 'value' in k) ? k.value : k;
    if (v === last) return k;
  }
  return null;
}

export function makeLocate(ctx) {
  return function locate(path) {
    if (canUseYamlDoc(ctx)) {
      return locateInYamlDoc(ctx, path) || { line: 1, col: 1 };
    }
    return locateInJsonSource(ctx, path);
  };
}

function canUseYamlDoc(ctx) {
  return ctx.isYaml && ctx.doc && typeof ctx.doc.getIn === 'function';
}

function locateInYamlDoc(ctx, path) {
  const keyNode = getPairKeyNode(ctx.doc, path);
  if (hasRange(keyNode)) return offsetToLineCol(ctx.lineIndex, keyNode.range.at(0));

  const node = ctx.doc.getIn(path, true);
  if (hasRange(node)) return offsetToLineCol(ctx.lineIndex, node.range.at(0));

  if (path.length > 0) {
    const parent = ctx.doc.getIn(path.slice(0, -1), true);
    if (hasRange(parent)) return offsetToLineCol(ctx.lineIndex, parent.range.at(0));
  }
  return null;
}

function hasRange(node) {
  return node && Array.isArray(node.range);
}

function locateInJsonSource(ctx, path) {
  if (path.length > 0) {
    const last = path.at(-1);
    const loc = locateJsonKey(ctx.source, ctx.lineIndex, last);
    if (loc) return loc;
  }
  return { line: 1, col: 1 };
}

export function finding(ctx, path, rule, severity, message) {
  const { line, col } = ctx.locate(path);
  return {
    file: ctx.filename,
    line,
    col,
    tag: 'DOCS',
    rule,
    severity,
    message,
  };
}

export function walkRefs(data, visit, depthCap = 64) {
  const seen = new WeakSet();
  function walk(node, path) {
    if (path.length > depthCap) return;
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      // forEach gives us the index as a callback param, so we never do
      // a computed-property access on the array.
      node.forEach((item, i) => walk(item, [...path, i]));
      return;
    }
    if (typeof node.$ref === 'string') visit(node.$ref, path);
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref') continue;
      walk(v, [...path, k]);
    }
  }
  walk(data, []);
}

export function emitRemoteRefFindings(ctx, rulePrefix) {
  const findings = [];
  walkRefs(ctx.data, (ref, path) => {
    if (!ref.startsWith('http://') && !ref.startsWith('https://')) return;
    const r = ctx.refResults;
    if (!r) return;
    const refPath = [...path, '$ref'];
    if (r.unreachable.has(ref)) {
      findings.push(finding(ctx, refPath, `${rulePrefix}/remote-ref-unreachable`, 'warning',
        `Remote $ref ${ref} could not be resolved`));
    } else if (r.blocked.has(ref)) {
      findings.push(finding(ctx, refPath, `${rulePrefix}/remote-ref-blocked`, 'warning',
        `Remote $ref ${ref} blocked by allowlist`));
    } else if (r.disabled.has(ref)) {
      findings.push(finding(ctx, refPath, `${rulePrefix}/remote-ref-disabled`, 'warning',
        `Remote $ref ${ref} present but remoteRefs.enabled is false`));
    }
  });
  return findings;
}
