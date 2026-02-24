import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export default {
  name: 'knip',
  extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
  optIn: true,  // requires package.json context — only runs when explicitly requested via --tools=knip
  installHint: 'npx knip (runs via npx, no global install needed)',

  buildCommand(targetDir) {
    return {
      bin: 'npx',
      args: ['knip', '--reporter', 'json', '--no-progress'],
      cwd: targetDir,
    };
  },

  parseOutput(stdout, stderr, exitCode) {
    // knip exits: 0 = clean, 1 = findings, 2+ = error
    if (!stdout.trim()) {
      // Graceful handling for project-level issues
      if (stderr && (stderr.includes('Unable to find') || stderr.includes('no such file'))) {
        return [];
      }
      if (exitCode >= 2 && stderr.trim()) {
        throw new Error(`knip error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      }
      return [];
    }

    let data;
    try {
      data = JSON.parse(stdout);
    } catch {
      throw new Error(`knip: failed to parse JSON output: ${stdout.slice(0, 200)}`);
    }

    const findings = [];

    // Unused files
    for (const file of data.files || []) {
      findings.push({
        file,
        line: 0,
        col: undefined,
        tag: 'DEAD_CODE',
        rule: 'knip/unused-file',
        severity: 'warning',
        message: 'Unused file — not imported or referenced by any other module',
      });
    }

    // Unused exports
    for (const item of data.exports || []) {
      findings.push({
        file: item.file || item.path || 'unknown',
        line: item.line || item.row || 0,
        col: item.col || undefined,
        tag: 'DEAD_CODE',
        rule: 'knip/unused-export',
        severity: 'warning',
        message: `Unused export: ${item.name || item.symbol || 'unknown'}`,
      });
    }

    // Unused dependencies
    for (const item of data.dependencies || []) {
      findings.push({
        file: 'package.json',
        line: 0,
        col: undefined,
        tag: 'DEAD_CODE',
        rule: 'knip/unused-dependency',
        severity: 'warning',
        message: `Unused dependency: ${item.name || item}`,
      });
    }

    // Unlisted dependencies
    for (const item of data.unlisted || []) {
      findings.push({
        file: 'package.json',
        line: 0,
        col: undefined,
        tag: 'DEAD_CODE',
        rule: 'knip/unlisted-dependency',
        severity: 'warning',
        message: `Unlisted dependency: ${item.name || item}`,
      });
    }

    return findings;
  },

  async checkInstalled() {
    try {
      await execFileAsync('npx', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
