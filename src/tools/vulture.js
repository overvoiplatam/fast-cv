import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const LINE_RE = /^(.+?):(\d+):\s+(.+)\s+\((\d+)% confidence\)\s*$/;

export default {
  name: 'vulture',
  extensions: ['.py', '.pyi'],
  installHint: 'pipx install vulture  (or: pip3 install --user vulture)',

  buildCommand(targetDir, configPath, { files = [] } = {}) {
    const args = ['--min-confidence', '80'];
    if (files.length > 0) {
      args.push(...files);
    } else {
      args.push(targetDir);
    }
    return { bin: 'vulture', args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode) {
    // vulture exits: 0 = clean, 1 = findings, 2+ = error
    if (exitCode >= 2) {
      throw new Error(`vulture error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
    }

    if (!stdout.trim()) return [];

    return stdout.trim().split('\n')
      .map(line => {
        const m = line.match(LINE_RE);
        if (!m) return null;
        return {
          file: m[1],
          line: parseInt(m[2], 10),
          col: undefined,
          tag: 'DEAD_CODE',
          rule: 'vulture/unused',
          severity: 'warning',
          message: `${m[3]} (${m[4]}% confidence)`,
        };
      })
      .filter(Boolean);
  },

  async checkInstalled() {
    try {
      await execFileAsync('vulture', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
