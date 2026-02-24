import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseJsonLines } from '../constants.js';

const execFileAsync = promisify(execFile);

export default {
  name: 'mypy',
  extensions: ['.py', '.pyi'],
  installHint: 'pipx install mypy  (or: pip3 install --user mypy)',

  buildCommand(targetDir, configPath, { files = [] } = {}) {
    const args = ['--output', 'json', '--no-error-summary'];
    if (configPath) args.push('--config-file', configPath);
    if (files.length > 0) {
      args.push(...files);
    } else {
      args.push(targetDir);
    }
    return { bin: 'mypy', args };
  },

  parseOutput(stdout, stderr, exitCode) {
    if (!stdout.trim()) {
      if (exitCode === 2 && stderr.trim()) {
        throw new Error(`mypy error: ${stderr.slice(0, 500)}`);
      }
      return [];
    }

    return parseJsonLines(stdout)
      .filter(item => item.severity === 'error')
      .map(item => ({
        file: item.file,
        line: item.line || 0,
        col: item.column || undefined,
        tag: 'TYPE_ERROR',
        rule: item.code || 'type-error',
        severity: 'error',
        message: item.message,
      }));
  },

  async checkInstalled() {
    try {
      await execFileAsync('mypy', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
