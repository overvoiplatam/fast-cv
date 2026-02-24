import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export default {
  name: 'eslint',
  extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
  installHint: 'npm install -g eslint eslint-plugin-security',

  buildCommand(targetDir, configPath) {
    const args = ['--format', 'json'];
    if (configPath) {
      args.push('--config', configPath);
    }
    args.push(targetDir);
    return { bin: 'eslint', args };
  },

  parseOutput(stdout, stderr, exitCode) {
    // eslint exits: 0 = clean, 1 = findings, 2 = fatal error
    if (exitCode === 2 && !stdout.trim()) {
      throw new Error(`eslint error: ${stderr.slice(0, 500)}`);
    }

    if (!stdout.trim()) return [];

    let results;
    try {
      results = JSON.parse(stdout);
    } catch {
      throw new Error(`eslint: failed to parse JSON output: ${stdout.slice(0, 200)}`);
    }

    const findings = [];
    for (const fileResult of results) {
      if (!fileResult.messages || fileResult.messages.length === 0) continue;

      for (const msg of fileResult.messages) {
        findings.push({
          file: fileResult.filePath,
          line: msg.line || 0,
          col: msg.column || undefined,
          tag: 'LINTER',
          rule: msg.ruleId || 'parse-error',
          severity: msg.severity === 2 ? 'error' : 'warning',
          message: msg.message,
        });
      }
    }

    return findings;
  },

  async checkInstalled() {
    try {
      await execFileAsync('eslint', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
