import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('install.sh tool provisioning', () => {
  async function installScript() {
    return readFile(join(process.cwd(), 'install.sh'), 'utf-8');
  }

  it('attempts to provision every supported tool in --mode all', async () => {
    const script = await installScript();
    for (const expected of [
      'install_python_tool ruff',
      'install_python_tool semgrep',
      'install_npm_global eslint',
      'install_npm_global jscpd',
      'install_npm_global knip',
      'install_npm_global typescript',
      'command -v bearer',
      'command -v golangci-lint',
      'command -v trivy',
      'trivy fs --download-db-only',
      'trivy fs --download-java-db-only',
      'install_python_tool mypy',
      'install_python_tool vulture',
      'install_npm_global stylelint',
      'install_python_tool sqlfluff',
      'cargo install typos-cli',
      'rustup component add clippy',
    ]) {
      assert.ok(script.includes(expected), `install.sh should include: ${expected}`);
    }
  });
});
