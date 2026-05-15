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
      'install_python_if_missing ruff',
      'install_python_if_missing semgrep',
      'install_node_if_missing eslint',
      'install_node_if_missing jscpd',
      'install_node_if_missing knip',
      'install_node_if_missing tsc typescript',
      'install_binary_if_missing bearer',
      'install_binary_if_missing golangci-lint',
      'install_binary_if_missing trivy',
      'trivy fs --download-db-only',
      'trivy fs --download-java-db-only',
      'install_python_if_missing mypy',
      'install_python_if_missing vulture',
      'install_node_if_missing stylelint',
      'install_python_if_missing sqlfluff',
      'cargo install typos-cli',
      'rustup component add clippy',
      'install_node_if_missing spectral "@stoplight/spectral-cli"',
      'install_node_if_missing redocly "@redocly/cli"',
      'install_node_if_missing markdownlint-cli2',
      'go install github.com/errata-ai/vale/v3@latest',
    ]) {
      assert.ok(script.includes(expected), `install.sh should include: ${expected}`);
    }
  });

  it('defines the three install_*_if_missing helpers', async () => {
    const script = await installScript();
    for (const helper of [
      'install_node_if_missing()',
      'install_binary_if_missing()',
      'install_python_if_missing()',
    ]) {
      assert.ok(script.includes(helper), `install.sh should define helper: ${helper}`);
    }
  });
});
