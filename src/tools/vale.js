import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function mapSeverity(s) {
  if (s === 'error') return 'error';
  return 'warning';
}

export default {
  name: 'vale',
  extensions: ['.md', '.markdown', '.rst', '.adoc', '.txt'],
  installHint: 'brew install vale  (or: go install github.com/errata-ai/vale/v3@latest)',

  buildCommand(targetDir, configPath, { files = [] } = {}) {
    const args = ['--output=JSON'];
    if (configPath) args.push('--config', configPath);
    const relevant = files.filter(f => /\.(md|markdown|rst|adoc|txt)$/i.test(f));
    if (relevant.length > 0) args.push(...relevant);
    else args.push(targetDir);
    return { bin: 'vale', args, cwd: targetDir };
  },

  // eslint-disable-next-line complexity, sonarjs/cognitive-complexity -- vale's JSON output is keyed by file; we walk every alert and classify by rule prefix
  parseOutput(stdout, stderr, exitCode) {
    const raw = stdout.trim() || stderr.trim();
    if (!raw) return [];

    // Vale emits config/style errors as a single non-array JSON object (usually on stderr).
    // Parse those into an actionable tool error rather than dumping the JSON blob.
    if (raw.startsWith('{')) {
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && typeof obj.Code === 'string' && obj.Code.startsWith('E')) {
          const hint = obj.Code === 'E201'
            ? 'run `vale sync` in your Vale config directory to populate styles'
            : 'check your .vale.ini configuration';
          throw new Error(`vale ${obj.Code}: ${obj.Text || 'config error'} — ${hint}`);
        }
      } catch (err) {
        if (err.message.startsWith('vale ')) throw err;
      }
    }

    if (!stdout.trim()) {
      if (exitCode > 1 && stderr.trim()) {
        throw new Error(`vale error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      }
      return [];
    }

    let doc;
    try {
      doc = JSON.parse(stdout);
    } catch {
      throw new Error(`vale: failed to parse JSON output: ${stdout.slice(0, 200)}`);
    }
    if (!doc || typeof doc !== 'object') return [];
    const findings = [];
    for (const [file, items] of Object.entries(doc)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const span = Array.isArray(item.Span) ? item.Span : [];
        findings.push({
          file,
          line: Number.isFinite(item.Line) ? item.Line : 1,
          col: Number.isFinite(span[0]) ? span[0] : undefined,
          tag: 'DOCS',
          rule: `vale/${item.Check || 'unknown'}`,
          severity: mapSeverity(item.Severity),
          message: item.Message || '',
        });
      }
    }
    return findings;
  },

  async checkInstalled() {
    try {
      await execFileAsync('vale', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
