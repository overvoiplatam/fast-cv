import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export default {
  name: 'spectral',
  extensions: ['.yaml', '.yml', '.json'],
  supportsFix: true,
  installHint: 'npm install -g @stoplight/spectral-cli @redocly/cli',

  buildCommand(targetDir, configPath, { files = [] } = {}) {
    const args = ['lint', '--format', 'json', '--ignore-unknown-format'];
    if (configPath) args.push('--ruleset', configPath);
    const relevant = files.filter(f => /\.(ya?ml|json)$/i.test(f));
    if (relevant.length > 0) args.push(...relevant);
    else args.push(`${targetDir}/**/*.{yaml,yml,json}`);
    return { bin: 'spectral', args, cwd: targetDir };
  },

  preFixCommands(targetDir, configPath, { files = [] } = {}) {
    if (!files || files.length === 0) return [];
    const cmds = [];
    for (const f of files) {
      const lower = f.toLowerCase();
      if (!lower.endsWith('.yaml') && !lower.endsWith('.yml') && !lower.endsWith('.json')) continue;
      cmds.push({ bin: 'redocly', args: ['bundle', f, '--output', f, '--ext', lower.endsWith('.json') ? 'json' : 'yaml'], cwd: targetDir });
    }
    return cmds;
  },

  parseOutput(stdout, stderr, exitCode) {
    if (!stdout.trim()) {
      if (exitCode !== 0 && stderr.trim()) {
        throw new Error(`spectral error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      }
      return [];
    }
    // spectral --format json may append a status line ("No results...") after the array
    const start = stdout.indexOf('[');
    const end = stdout.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) return [];
    let items;
    try {
      items = JSON.parse(stdout.slice(start, end + 1));
    } catch {
      throw new Error(`spectral: failed to parse JSON output: ${stdout.slice(0, 200)}`);
    }
    if (!Array.isArray(items)) return [];
    return items.map(item => {
      const start = item.range?.start || {};
      const sev = typeof item.severity === 'number' ? item.severity : 1;
      return {
        file: item.source || 'unknown',
        line: Number.isFinite(start.line) ? start.line + 1 : 1,
        col: Number.isFinite(start.character) ? start.character + 1 : undefined,
        tag: 'DOCS',
        rule: `spectral/${item.code || 'unknown'}`,
        severity: sev <= 1 ? 'error' : 'warning',
        message: item.message || '',
      };
    });
  },

  async checkInstalled() {
    try {
      await execFileAsync('spectral', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
