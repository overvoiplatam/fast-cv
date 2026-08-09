import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SCANNABLE_EXTENSIONS } from '../constants.js';
import { HARDCODED_IGNORES, parseIgnorePatterns } from '../pruner.js';

const PROJECT_IGNORE_FILES = ['.gitignore', '.fcvignore'];

/** Reads .gitignore/.fcvignore and converts them to jscpd-style globs. */
function readProjectIgnorePatterns(targetDir) {
  const globs = [];
  for (const name of PROJECT_IGNORE_FILES) {
    let content;
    try {
      content = readFileSync(join(targetDir, name), 'utf-8');
    } catch {
      continue;
    }
    for (const pattern of parseIgnorePatterns(content)) globs.push(...gitignoreToGlobs(pattern));
  }
  return globs;
}

// jscpd's `ignore` takes plain globs, not gitignore syntax, so anchoring and
// directory semantics have to be spelled out. Negations are dropped: jscpd has
// no way to express them, and over-ignoring is safer than crashing the config.
function gitignoreToGlobs(pattern) {
  if (pattern.startsWith('!')) return [];

  const anchored = pattern.startsWith('/');
  let body = anchored ? pattern.slice(1) : pattern;
  const dirOnly = body.endsWith('/');
  if (dirOnly) body = body.slice(0, -1);
  if (!body) return [];

  // A pattern containing a slash is relative to the ignore file; otherwise it
  // matches at any depth.
  const prefix = anchored || body.includes('/') ? '' : '**/';
  if (dirOnly) return [`${prefix}${body}/**`];
  // Bare names match both a file and a directory's contents.
  return [`${prefix}${body}`, `${prefix}${body}/**`];
}

const execFileAsync = promisify(execFile);

let _tmpDir = null;

function getTmpDir() {
  if (!_tmpDir) {
    _tmpDir = join(tmpdir(), `fcv-jscpd-${process.pid}-${Date.now()}`);
    mkdirSync(_tmpDir, { recursive: true });
  }
  return _tmpDir;
}

function consumeJscpdOutDir() {
  const outDir = _tmpDir;
  _tmpDir = null;
  return outDir;
}

function throwIfJscpdError(returnValue, stderr, exitCode) {
  if (exitCode > 1) {
    throw new Error(`jscpd error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
  }
  return returnValue;
}

function loadJscpdReport(outDir, stderr, exitCode) {
  try {
    const raw = readFileSync(join(outDir, 'jscpd-report.json'), 'utf-8');
    cleanupOutDir(outDir);
    return JSON.parse(raw);
  } catch {
    cleanupOutDir(outDir);
    throwIfJscpdError(null, stderr, exitCode);
    return null;
  }
}

function cleanupOutDir(outDir) {
  try { rmSync(outDir, { recursive: true, force: true }); } catch { /* noop */ }
}

// A block reported against its own position isn't duplication. jscpd 5 emits
// these self-matches; jscpd 4 does not.
function isSelfMatch(first, second) {
  if (!first.name || first.name !== second.name) return false;
  const firstStart = first.start ?? 0;
  const firstEnd = first.end ?? firstStart;
  const secondStart = second.start ?? 0;
  const secondEnd = second.end ?? secondStart;
  return firstStart <= secondEnd && secondStart <= firstEnd;
}

function makeDuplicatePair(dup) {
  const first = dup.firstFile || {};
  const second = dup.secondFile || {};
  if (isSelfMatch(first, second)) return [];
  const lines = dup.lines || 0;
  const tokens = dup.tokens || 0;
  const format = dup.format || 'unknown';
  return [
    duplicateFinding(first, second, lines, tokens, format),
    duplicateFinding(second, first, lines, tokens, format),
  ];
}

// jscpd 5 (the Rust rewrite) suffixes report paths with the detected format —
// "CLAUDE.md:markdown" — while jscpd 4 emits a bare path. Strip it so findings
// carry a real path that survives the post-filter and SARIF location mapping.
function stripFormatSuffix(name, format) {
  if (!name || !format) return name;
  const suffix = `:${format}`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

function duplicateFinding(selfFile, pairFile, lines, tokens, format) {
  const pairLine = pairFile.startLoc?.line || pairFile.start || '?';
  const pairName = stripFormatSuffix(pairFile.name, format) || 'unknown';
  return {
    file: stripFormatSuffix(selfFile.name, format) || 'unknown',
    line: selfFile.startLoc?.line || selfFile.start || 0,
    col: selfFile.startLoc?.column || undefined,
    tag: 'DUPLICATION',
    rule: `jscpd/${format}`,
    severity: 'warning',
    message: `Duplicated block (${lines} lines, ${tokens} tokens) — also in ${pairName}:${pairLine}`,
    otherFile: stripFormatSuffix(pairFile.name, format) || undefined,
  };
}

export default {
  name: 'jscpd',
  // Cross-language: runs on all scannable extensions
  extensions: [...SCANNABLE_EXTENSIONS],
  installHint: 'npm install -g jscpd',

  buildCommand(targetDir, configPath, { files: _files = [], exclude = [] } = {}) {
    const outDir = getTmpDir();

    // Generate temp config with ignore patterns (jscpd's --ignore CLI flag
    // only accepts a single pattern; config file handles arrays properly)
    if (!configPath) {
      const ignorePatterns = HARDCODED_IGNORES.map(d => `**/${d}/**`);
      // jscpd walks the tree itself rather than taking our pruned file list, so
      // the project's own ignore files have to be handed to it explicitly. This
      // replaces the `--gitignore` flag, which jscpd 5 (the Rust rewrite) dropped.
      for (const pattern of readProjectIgnorePatterns(targetDir)) ignorePatterns.push(pattern);
      for (const pattern of exclude) ignorePatterns.push(pattern);
      const tmpConfig = join(outDir, '.jscpd.json');
      writeFileSync(tmpConfig, JSON.stringify({
        minTokens: 50,
        minLines: 5,
        ignore: ignorePatterns,
      }));
      configPath = tmpConfig;
    }

    const args = [
      '--reporters', 'json',
      '--output', outDir,
      '--silent',
      '--config', configPath,
    ];

    // jscpd is cross-file — always scan whole directory regardless of files
    args.push(targetDir);
    return { bin: 'jscpd', args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode) {
    const outDir = consumeJscpdOutDir();
    if (!outDir) return throwIfJscpdError([], stderr, exitCode);

    const report = loadJscpdReport(outDir, stderr, exitCode);
    if (!report) return [];

    return (report.duplicates || []).flatMap(makeDuplicatePair);
  },

  async checkInstalled() {
    try {
      await execFileAsync('jscpd', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
