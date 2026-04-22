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

const VALIDATORS = {
  openapi: validateOpenapi,
  swagger: validateSwagger,
  asyncapi: validateAsyncapi,
  jsonschema: validateJsonSchema,
};

function parseArgs(argv) {
  const opts = { config: null, fix: false, files: [], target: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') opts.config = argv[++i];
    else if (a === '--fix') opts.fix = true;
    else if (a === '--target') opts.target = argv[++i];
    else if (a === '--files') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        opts.files.push(argv[++i]);
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

function simpleGlobMatch(pattern, filename) {
  const re = new RegExp('^' + pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__DOUBLESTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLESTAR__/g, '.*')
    .replace(/\?/g, '.') + '$');
  return re.test(filename) || re.test(filename.replace(/^\.\//, ''));
}

async function processFile(filename, config, fix) {
  let source;
  try { source = readFileSync(filename, 'utf-8'); }
  catch { return []; }

  const maxBytes = Number.isFinite(config.maxFileBytes) ? config.maxFileBytes : DEFAULT_MAX_FILE_BYTES;
  if (Buffer.byteLength(source, 'utf-8') > maxBytes) return [];

  const ext = extname(filename).toLowerCase();
  const isYaml = ext === '.yaml' || ext === '.yml';

  const parsed = isYaml ? tryParseYaml(source) : tryParseJson(source);
  if (parsed.error) {
    const lineIndex = buildLineIndex(source);
    const { line, col } = offsetToLineCol(lineIndex, parsed.error.offset);
    return [{
      file: filename,
      line,
      col,
      tag: 'DOCS',
      rule: 'docspec/parse',
      severity: 'error',
      message: `${isYaml ? 'YAML' : 'JSON'} parse error: ${parsed.error.message}`,
    }];
  }

  const override = forcedType(filename, config.forceType);
  if (override === 'none') return [];
  const type = override || classify(parsed.data, filename);
  if (!type) return [];

  const validator = VALIDATORS[type];
  if (!validator) return [];

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

  const findings = validator(ctx);

  if (fix && findings.length > 0) {
    applyFixes(filename, source, isYaml, parsed.data);
  }

  return findings;
}

export async function runDocspec({ files = [], target = null, configPath = null, fix = false } = {}) {
  const config = loadConfig(configPath);
  const list = files.length > 0 ? files : (target ? (() => { const out = []; walkDir(target, out); return out; })() : []);
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
