import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function classifyRule(code) {
  if (!code) return 'LINTER';
  if (code.startsWith('PRS')) return 'BUG';
  if (code.startsWith('LT') || code.startsWith('CP')) return 'FORMAT';
  return 'LINTER';
}

export default {
  name: 'sqlfluff',
  extensions: ['.sql'],
  installHint: 'pipx install sqlfluff  (or: pip3 install --user sqlfluff)',

  buildCommand(targetDir, _configPath, { files = [], fix = false } = {}) {
    const sub = fix ? 'fix' : 'lint';
    const args = [sub, '--format', 'json', '--disable-progress-bar', '--processes', '1'];
    if (fix) args.push('--force');
    if (files.length > 0) {
      args.push(...files);
    } else {
      args.push(targetDir);
    }
    return { bin: 'sqlfluff', args };
  },

  parseOutput(stdout, stderr, exitCode) {
    if (exitCode >= 3 && !stdout.trim()) {
      throw new Error(`sqlfluff error (exit ${exitCode}): ${(stderr || '').slice(0, 500)}`);
    }

    const trimmed = stdout.trim();
    if (!trimmed) return [];

    let results;
    try { results = JSON.parse(trimmed); }
    catch { throw new Error(`sqlfluff: failed to parse JSON output: ${trimmed.slice(0, 200)}`); }

    const findings = [];
    for (const fileResult of results) {
      const filepath = fileResult.filepath || fileResult.file;
      const violations = fileResult.violations || [];

      for (const v of violations) {
        const code = v.code || '';
        // Handle both sqlfluff 2.x (line_no, line_pos) and 3.x (start_line_no, start_line_pos)
        const line = v.start_line_no || v.line_no || 0;
        const col = v.start_line_pos || v.line_pos || undefined;
        findings.push({
          file: filepath,
          line,
          col,
          tag: classifyRule(code),
          rule: code || 'unknown',
          severity: code.startsWith('PRS') ? 'error' : 'warning',
          message: v.description || v.name || 'SQL lint issue',
        });
      }
    }

    return findings;
  },

  async checkInstalled() {
    try {
      await execFileAsync('sqlfluff', ['version']);
      return true;
    } catch {
      return false;
    }
  },
};
