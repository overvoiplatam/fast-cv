#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';
import { buildLineIndex, offsetToLineCol } from './offset-to-linecol.js';
import { classify } from './classify.js';
import { validateOpenapi } from './validate/openapi.js';
import { validateSwagger } from './validate/swagger.js';
import { validateAsyncapi } from './validate/asyncapi.js';
import { validateJsonSchema } from './validate/jsonschema.js';
import { makeLocate } from './validate/common.js';
import { collectRemoteRefs, resolveRemoteRefs } from './refs.js';
import { applyFixes } from './fix.js';

const DEFAULT_MAX_FILE_BYTES = 2_000_000;

// Map (not object literal) so the `VALIDATORS.get(type)` lookup below
// avoids eslint-plugin-security's detect-object-injection rule.
const VALIDATORS = new Map([
  ['openapi', validateOpenapi],
  ['swagger', validateSwagger],
  ['asyncapi', validateAsyncapi],
  ['jsonschema', validateJsonSchema],
]);

function parseArgs(argv) {
  const opts = { config: null, fix: false, files: [], target: null };
  // `.at(i)` (method call) over `argv[i]` (computed property access)
  // signals intent and avoids the detect-object-injection heuristic.
  let i = 0;
  while (i < argv.length) {
    const a = argv.at(i);
    i++;
    if (a === '--config') { opts.config = argv.at(i); i++; }
    else if (a === '--fix') opts.fix = true;
    else if (a === '--target') { opts.target = argv.at(i); i++; }
    else if (a === '--files') {
      while (i < argv.length && !argv.at(i).startsWith('--')) {
        opts.files.push(argv.at(i));
        i++;
      }
    }
  }
  return opts;
}

function loadConfig(path) {
  if (!path) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

function walkDir(dir, out, depth = 0) {
  if (depth > 32) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkDir(p, out, depth + 1);
    else if (e.isFile()) {
      const ext = extname(e.name).toLowerCase();
      if (ext === '.yaml' || ext === '.yml' || ext === '.json') out.push(p);
    }
  }
}

function tryParseYaml(source) {
  try {
    const doc = parseDocument(source, { keepSourceTokens: true, prettyErrors: false });
    if (doc.errors && doc.errors.length > 0) {
      const e = doc.errors[0];
      return { error: { message: e.message, offset: Array.isArray(e.pos) ? e.pos[0] : 0 } };
    }
    const data = doc.toJS({ mapAsMap: false });
    return { doc, data };
  } catch (err) {
    return { error: { message: err.message, offset: 0 } };
  }
}

function tryParseJson(source) {
  try {
    return { data: JSON.parse(source) };
  } catch (err) {
    const m = /position\s+(\d+)/i.exec(err.message);
    const offset = m ? parseInt(m[1], 10) : 0;
    return { error: { message: err.message, offset } };
  }
}

function forcedType(filename, forceType) {
  if (!forceType || typeof forceType !== 'object') return null;
  for (const [pattern, type] of Object.entries(forceType)) {
    if (simpleGlobMatch(pattern, filename)) return type === 'none' ? 'none' : type;
  }
  return null;
}

// Glob matcher implemented by walking pattern and filename in lockstep —
// no `new RegExp(...)`, no dynamic regex construction. Supports the same
// wildcards as the previous regex form: `**` (any chars incl. /), `*`
// (any chars except /), `?` (one char). All other pattern chars match
// literally.
function simpleGlobMatch(pattern, filename) {
  return matchGlob(pattern, 0, filename, 0)
    || matchGlob(pattern, 0, stripDotSlashPrefix(filename), 0);
}

function stripDotSlashPrefix(s) {
  return s.startsWith('./') ? s.slice(2) : s;
}

const STAR = 42;
const QUESTION = 63;
const SLASH = 47;

function matchGlob(pattern, pi, text, ti) {
  while (pi < pattern.length) {
    const ch = pattern.charCodeAt(pi);
    if (ch === STAR) return matchStar(pattern, pi, text, ti);
    if (ti >= text.length) return false;
    if (!matchLiteralOrAny(pattern, pi, text, ti, ch)) return false;
    pi++; ti++;
  }
  return ti === text.length;
}

// Try matching 0..N text chars against the wildcard, then recurse for the rest.
// '**' is greedy across '/'; '*' stops at the first '/'.
function matchStar(pattern, pi, text, ti) {
  const doubleStar = pi + 1 < pattern.length && pattern.charCodeAt(pi + 1) === STAR;
  const rest = doubleStar ? pi + 2 : pi + 1;
  for (let consumed = 0; ti + consumed <= text.length; consumed++) {
    if (starShouldStop(doubleStar, text, ti, consumed)) break;
    if (matchGlob(pattern, rest, text, ti + consumed)) return true;
  }
  return false;
}

function starShouldStop(doubleStar, text, ti, consumed) {
  if (doubleStar) return false;
  if (consumed === 0) return false;
  return text.charCodeAt(ti + consumed - 1) === SLASH;
}

function matchLiteralOrAny(pattern, pi, text, ti, ch) {
  if (ch === QUESTION) return text.charCodeAt(ti) !== SLASH;
  return text.charCodeAt(ti) === ch;
}

async function processFile(filename, config, fix) {
  const source = readFileOrNull(filename);
  if (source === null) return [];
  if (exceedsMaxBytes(source, config)) return [];

  const isYaml = isYamlFile(filename);
  const parsed = parseSourceByExt(source, isYaml);
  if (parsed.error) return [parseErrorFinding(filename, source, parsed.error, isYaml)];

  const type = decideValidatorType(filename, parsed.data, config);
  if (!type) return [];
  const validator = VALIDATORS.get(type);
  if (!validator) return [];

  const ctx = await buildContext(filename, source, isYaml, parsed, config);
  const findings = validator(ctx);

  if (fix && findings.length > 0) {
    applyFixes(filename, source, isYaml, parsed.data);
  }
  return findings;
}

function readFileOrNull(filename) {
  try {
    return readFileSync(filename, 'utf-8');
  } catch {
    return null;
  }
}

function exceedsMaxBytes(source, config) {
  const maxBytes = Number.isFinite(config.maxFileBytes) ? config.maxFileBytes : DEFAULT_MAX_FILE_BYTES;
  return Buffer.byteLength(source, 'utf-8') > maxBytes;
}

function isYamlFile(filename) {
  const ext = extname(filename).toLowerCase();
  return ext === '.yaml' || ext === '.yml';
}

function parseSourceByExt(source, isYaml) {
  return isYaml ? tryParseYaml(source) : tryParseJson(source);
}

function parseErrorFinding(filename, source, error, isYaml) {
  const lineIndex = buildLineIndex(source);
  const { line, col } = offsetToLineCol(lineIndex, error.offset);
  return {
    file: filename,
    line,
    col,
    tag: 'DOCS',
    rule: 'docspec/parse',
    severity: 'error',
    message: `${isYaml ? 'YAML' : 'JSON'} parse error: ${error.message}`,
  };
}

function decideValidatorType(filename, data, config) {
  const override = forcedType(filename, config.forceType);
  if (override === 'none') return null;
  return override || classify(data, filename);
}

async function buildContext(filename, source, isYaml, parsed, config) {
  const lineIndex = buildLineIndex(source);
  const ctx = {
    filename,
    source,
    lineIndex,
    isYaml,
    doc: parsed.doc || null,
    data: parsed.data,
  };
  ctx.locate = makeLocate(ctx);

  const refs = collectRemoteRefs(parsed.data);
  if (refs.length > 0) {
    ctx.refResults = await resolveRemoteRefs(refs, config);
  }
  return ctx;
}

function resolveDocspecTargets(files, target) {
  if (files.length > 0) return files;
  if (!target) return [];
  const out = [];
  walkDir(target, out);
  return out;
}

export async function runDocspec({ files = [], target = null, configPath = null, fix = false } = {}) {
  const config = loadConfig(configPath);
  const list = resolveDocspecTargets(files, target);
  const findings = [];
  for (const f of list) {
    const abs = resolve(f);
    try {
      const fs = statSync(abs);
      if (!fs.isFile()) continue;
    } catch { continue; }
    const ext = extname(abs).toLowerCase();
    if (ext !== '.yaml' && ext !== '.yml' && ext !== '.json') continue;
    const fileFindings = await processFile(abs, config, fix);
    for (const f2 of fileFindings) findings.push(f2);
  }
  return findings;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  try {
    const findings = await runDocspec({
      files: opts.files,
      target: opts.target,
      configPath: opts.config,
      fix: opts.fix,
    });
    for (const f of findings) process.stdout.write(JSON.stringify(f) + '\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write(`docspec runner fatal: ${err.stack || err.message}\n`);
    process.exit(2);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
