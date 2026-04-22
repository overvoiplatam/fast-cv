import { fileURLToPath } from 'node:url';
import { parseJsonLines } from '../constants.js';

const RUNNER_URL = new URL('./docspec/runner.js', import.meta.url);

export default {
  name: 'docspec',
  extensions: ['.yaml', '.yml', '.json'],
  supportsFix: true,
  installHint: 'bundled — requires Node >= 20',

  buildCommand(targetDir, configPath, { files = [], fix = false } = {}) {
    const runner = fileURLToPath(RUNNER_URL);
    const args = [runner];
    if (configPath) args.push('--config', configPath);
    if (fix) args.push('--fix');
    const relevant = files.filter(f => /\.(ya?ml|json)$/i.test(f));
    if (relevant.length > 0) {
      args.push('--files', ...relevant);
    } else {
      args.push('--target', targetDir);
    }
    return { bin: process.execPath, args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode) {
    if (exitCode !== 0 && !stdout.trim()) {
      throw new Error(`docspec runner failed (exit ${exitCode}): ${(stderr || '').slice(0, 500)}`);
    }
    if (!stdout.trim()) return [];
    return parseJsonLines(stdout);
  },

  async checkInstalled() {
    return true;
  },
};
