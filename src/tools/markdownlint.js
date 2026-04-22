import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FINDING_RE = /^(.+?):(\d+)(?::(\d+))?\s+(MD\d+(?:\/[\w-]+)*)\s+(.*)$/;

export default {
  name: 'markdownlint',
  extensions: ['.md', '.markdown'],
  supportsFix: true,
  installHint: 'npm install -g markdownlint-cli2',

  buildCommand(targetDir, configPath, { files = [], fix = false } = {}) {
    const args = [];
    if (configPath) args.push('--config', configPath);
    if (fix) args.push('--fix');
    const relevant = files.filter(f => /\.(md|markdown)$/i.test(f));
    if (relevant.length > 0) args.push(...relevant);
    else args.push('**/*.{md,markdown}');
    return { bin: 'markdownlint-cli2', args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode) {
    if (exitCode > 1 && !stderr.trim() && !stdout.trim()) {
      throw new Error(`markdownlint error (exit ${exitCode})`);
    }
    const findings = [];
    const blob = `${stderr}\n${stdout}`;
    for (const rawLine of blob.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('Finding:') || line.startsWith('Linting:') || line.startsWith('Summary:') || line.startsWith('markdownlint-cli2')) continue;
      const m = FINDING_RE.exec(line);
      if (!m) continue;
      const [, file, lineNum, col, rule, message] = m;
      findings.push({
        file,
        line: parseInt(lineNum, 10) || 1,
        col: col ? parseInt(col, 10) : undefined,
        tag: 'DOCS',
        rule: `md/${rule}`,
        severity: 'warning',
        message,
      });
    }
    return findings;
  },

  async checkInstalled() {
    try {
      await execFileAsync('markdownlint-cli2', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
