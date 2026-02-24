import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const LINE_RE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

export default {
  name: 'tsc',
  extensions: ['.ts', '.tsx', '.mts', '.cts'],
  installHint: 'npm install -g typescript',

  buildCommand(targetDir, configPath) {
    const args = ['--noEmit', '--pretty', 'false'];
    args.push('--project', configPath || targetDir);
    return { bin: 'tsc', args };
  },

  parseOutput(stdout, stderr, exitCode) {
    if (exitCode >= 3) {
      throw new Error(`tsc error (exit ${exitCode}): ${(stderr || stdout).slice(0, 500)}`);
    }

    if (!stdout.trim()) return [];

    const findings = [];
    for (const line of stdout.split('\n')) {
      const m = line.match(LINE_RE);
      if (!m) continue;
      findings.push({
        file: m[1],
        line: Number(m[2]),
        col: Number(m[3]),
        tag: 'TYPE_ERROR',
        rule: m[5],
        severity: m[4],
        message: m[6],
      });
    }
    return findings;
  },

  async checkInstalled() {
    try {
      await execFileAsync('tsc', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
