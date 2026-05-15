import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SCANNABLE_EXTENSIONS } from '../constants.js';
import { HARDCODED_IGNORES } from '../pruner.js';

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

function makeDuplicatePair(dup) {
  const first = dup.firstFile || {};
  const second = dup.secondFile || {};
  const lines = dup.lines || 0;
  const tokens = dup.tokens || 0;
  const format = dup.format || 'unknown';
  return [
    duplicateFinding(first, second, lines, tokens, format),
    duplicateFinding(second, first, lines, tokens, format),
  ];
}

function duplicateFinding(selfFile, pairFile, lines, tokens, format) {
  const pairLine = pairFile.startLoc?.line || pairFile.start || '?';
  const pairName = pairFile.name || 'unknown';
  return {
    file: selfFile.name || 'unknown',
    line: selfFile.startLoc?.line || selfFile.start || 0,
    col: selfFile.startLoc?.column || undefined,
    tag: 'DUPLICATION',
    rule: `jscpd/${format}`,
    severity: 'warning',
    message: `Duplicated block (${lines} lines, ${tokens} tokens) — also in ${pairName}:${pairLine}`,
    otherFile: pairFile.name || undefined,
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
      '--gitignore',
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
