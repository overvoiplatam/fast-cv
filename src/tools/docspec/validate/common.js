import { offsetToLineCol } from '../offset-to-linecol.js';

export function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function isStringArray(v) {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

function locateJsonKey(source, lineIndex, key) {
  if (typeof key !== 'string') return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`"${escaped}"\\s*:`);
  const m = re.exec(source);
  if (!m) return null;
  return offsetToLineCol(lineIndex, m.index);
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
    if (ctx.isYaml && ctx.doc && typeof ctx.doc.getIn === 'function') {
      const keyNode = getPairKeyNode(ctx.doc, path);
      if (keyNode && Array.isArray(keyNode.range)) {
        return offsetToLineCol(ctx.lineIndex, keyNode.range[0]);
      }
      const node = ctx.doc.getIn(path, true);
      if (node && Array.isArray(node.range)) {
        return offsetToLineCol(ctx.lineIndex, node.range[0]);
      }
      if (path.length > 0) {
        const parent = ctx.doc.getIn(path.slice(0, -1), true);
        if (parent && Array.isArray(parent.range)) {
          return offsetToLineCol(ctx.lineIndex, parent.range[0]);
        }
      }
      return { line: 1, col: 1 };
    }
    if (path.length > 0) {
      const last = path[path.length - 1];
      const loc = locateJsonKey(ctx.source, ctx.lineIndex, last);
      if (loc) return loc;
    }
    return { line: 1, col: 1 };
  };
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
      for (let i = 0; i < node.length; i++) walk(node[i], [...path, i]);
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
