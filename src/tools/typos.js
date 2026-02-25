import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseJsonLines } from '../constants.js';

const execFileAsync = promisify(execFile);

export default {
  name: 'typos',
  extensions: ['.py', '.pyi', '.js', '.jsx', '.ts', '.tsx', '.go', '.java', '.rb', '.php', '.rs', '.c', '.cpp', '.h', '.cs', '.swift', '.kt', '.kts', '.sql', '.mts', '.cts', '.scala', '.sh', '.bash'],
  optIn: true,  // noisy — only runs when explicitly requested via --tools=typos
  installHint: 'cargo install typos-cli  (or: brew install typos-cli)',

  buildCommand(targetDir, configPath, { files = [] } = {}) {
    const args = ['--format', 'json'];
    if (configPath) args.push('--config', configPath);
    if (files.length > 0) {
      args.push(...files);
    } else {
      args.push(targetDir);
    }
    return { bin: 'typos', args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode) {
    if (!stdout.trim()) {
      if (exitCode > 1 && stderr.trim()) {
        throw new Error(`typos error: ${stderr.slice(0, 500)}`);
      }
      return [];
    }

    return parseJsonLines(stdout)
      .filter(item => item.typo)
      .map(item => ({
        file: item.path,
        line: item.line_num || 0,
        col: undefined,
        tag: 'TYPO',
        rule: 'typo',
        severity: 'warning',
        message: `"${item.typo}" → ${(item.corrections || []).join(', ') || '?'}`,
      }));
  },

  async checkInstalled() {
    try {
      await execFileAsync('typos', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
