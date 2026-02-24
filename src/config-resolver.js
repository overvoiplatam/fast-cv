import { access, constants } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DEFAULTS_DIR = join(__dirname, '..', 'defaults');
const USER_DEFAULTS_DIR = join(homedir(), '.config', 'fast-cv', 'defaults');

// Map of tool name → array of config filenames to look for (in priority order)
const TOOL_CONFIG_FILES = {
  ruff: ['ruff.toml', '.ruff.toml', 'pyproject.toml'],
  eslint: [
    'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
    '.eslintrc.json', '.eslintrc.js', '.eslintrc.yml', '.eslintrc.yaml', '.eslintrc',
  ],
  semgrep: ['.semgrep.yml', '.semgrep.yaml', '.semgrep/'],
  bearer: ['.bearer.yml', 'bearer.yml'],
  'golangci-lint': ['.golangci.yml', '.golangci.yaml', '.golangci.toml', '.golangci.json'],
  jscpd: ['.jscpd.json'],
  trivy: ['trivy.yaml', '.trivy.yaml'],
  mypy: ['mypy.ini', '.mypy.ini', 'setup.cfg', 'pyproject.toml'],
  typos: ['typos.toml', '.typos.toml', '_typos.toml'],
};

// Map of tool name → default config filename shipped with fast-cv
const PACKAGE_DEFAULT_FILES = {
  ruff: 'ruff.toml',
  eslint: 'eslint.config.mjs',
  semgrep: 'semgrep',  // directory — semgrep reads all YAML files inside
  mypy: 'mypy.ini',
};

async function fileExists(filePath) {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveConfig(toolName, targetDir) {
  const localCandidates = TOOL_CONFIG_FILES[toolName] || [];

  // 1. Check local directory
  for (const filename of localCandidates) {
    const localPath = join(targetDir, filename);
    if (await fileExists(localPath)) {
      return { path: localPath, source: 'local' };
    }
  }

  // 2. Check user global defaults
  const defaultFile = PACKAGE_DEFAULT_FILES[toolName];
  if (defaultFile) {
    const userPath = join(USER_DEFAULTS_DIR, defaultFile);
    if (await fileExists(userPath)) {
      return { path: userPath, source: 'user-default' };
    }
  }

  // 3. Check package defaults
  if (defaultFile) {
    const packagePath = join(PACKAGE_DEFAULTS_DIR, defaultFile);
    if (await fileExists(packagePath)) {
      return { path: packagePath, source: 'package-default' };
    }
  }

  // 4. No config found
  return { path: null, source: 'none' };
}
