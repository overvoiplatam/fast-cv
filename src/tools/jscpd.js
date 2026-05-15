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
    const outDir = _tmpDir;
    _tmpDir = null; // reset for next invocation

    if (!outDir) {
      if (exitCode > 1) {
        throw new Error(`jscpd error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      }
      return [];
    }

    let report;
    try {
      const raw = readFileSync(join(outDir, 'jscpd-report.json'), 'utf-8');
      report = JSON.parse(raw);
    } catch {
      // Clean up and return empty if no report file
      try { rmSync(outDir, { recursive: true, force: true }); } catch { /* noop */ }
      if (exitCode > 1) {
        throw new Error(`jscpd error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      }
      return [];
    }

    // Clean up temp dir
    try { rmSync(outDir, { recursive: true, force: true }); } catch { /* noop */ }

    const duplicates = report.duplicates || [];
    const findings = [];

    for (const dup of duplicates) {
      const firstFile = dup.firstFile || {};
      const secondFile = dup.secondFile || {};
      const lines = dup.lines || 0;
      const tokens = dup.tokens || 0;
      const format = dup.format || 'unknown';

      // Emit two findings — one per file in the clone pair
      findings.push({
        file: firstFile.name || 'unknown',
        line: firstFile.startLoc?.line || firstFile.start || 0,
        col: firstFile.startLoc?.column || undefined,
        tag: 'DUPLICATION',
        rule: `jscpd/${format}`,
        severity: 'warning',
        message: `Duplicated block (${lines} lines, ${tokens} tokens) — also in ${secondFile.name || 'unknown'}:${secondFile.startLoc?.line || secondFile.start || '?'}`,
        otherFile: secondFile.name || undefined,
      });

      findings.push({
        file: secondFile.name || 'unknown',
        line: secondFile.startLoc?.line || secondFile.start || 0,
        col: secondFile.startLoc?.column || undefined,
        tag: 'DUPLICATION',
        rule: `jscpd/${format}`,
        severity: 'warning',
        message: `Duplicated block (${lines} lines, ${tokens} tokens) — also in ${firstFile.name || 'unknown'}:${firstFile.startLoc?.line || firstFile.start || '?'}`,
        otherFile: firstFile.name || undefined,
      });
    }

    return findings;
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
