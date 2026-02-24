import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import ignore from 'ignore';

// Common build outputs, caches, and dependency directories that should never be scanned.
// Sourced from GitHub's gitignore templates and major framework documentation.
const HARDCODED_IGNORES = [
  // Package managers / dependencies
  'node_modules',
  'bower_components',
  'jspm_packages',
  'vendor',
  '.yarn',
  '.pnp',

  // Python
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.egg-info',

  // Version control
  '.git',
  '.hg',
  '.svn',

  // Generic build / dist
  'dist',
  'build',
  'out',
  'target',
  '_build',

  // JavaScript frameworks
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.angular',
  '.astro',
  '.docusaurus',
  '.vite',
  '.parcel-cache',
  '.turbo',
  '.expo',

  // Hosting / deploy
  '.vercel',
  '.netlify',
  '.serverless',

  // IDE / editors
  '.idea',
  '.vscode',

  // Build tools / caches
  '.gradle',
  '.cargo',
  '.sass-cache',
  '.cache',
  '.output',
  'coverage',

  // IaC
  '.terraform',
];

const IGNORED_FILES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Pipfile.lock',
  'poetry.lock',
  'go.sum',
  'Gemfile.lock',
  'composer.lock',
];

const SCANNABLE_EXTENSIONS = new Set([
  '.py', '.pyi',
  '.js', '.jsx', '.mjs', '.cjs',
  '.ts', '.tsx', '.mts', '.cts',
  '.go',
  '.java',
  '.rb',
  '.php',
  '.rs',
  '.c', '.h', '.cpp', '.hpp',
  '.cs',
  '.swift',
  '.kt', '.kts',
  '.scala',
  '.sh', '.bash',
  '.yaml', '.yml',
  '.json',
  '.toml',
  '.tf',
  '.sql',
]);

async function loadIgnoreFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf-8');
    return content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  } catch {
    return [];
  }
}

const GLOB_CHARS = /[*?{!]/;

export function createOnlyFilter(patterns) {
  if (!patterns || patterns.length === 0) return null;

  const ig = ignore();
  // The ignore library treats patterns as exclusion rules, but we use it
  // to test inclusion: a file "matches" if ig.ignores(relPath) === true.
  ig.add(patterns);

  return {
    /** Returns true if the file matches the --only patterns */
    includes(relPath) {
      // For literal paths (no glob chars), also check exact match
      for (const p of patterns) {
        if (!GLOB_CHARS.test(p) && relPath === p) return true;
      }
      try {
        return ig.ignores(relPath);
      } catch {
        return false;
      }
    },
  };
}

export async function createIgnoreFilter(targetDir, { exclude = [] } = {}) {
  const ig = ignore();

  // Add hardcoded directory ignores
  ig.add(HARDCODED_IGNORES.map(d => `${d}/`));
  ig.add(IGNORED_FILES);

  // Add user-supplied --exclude patterns
  if (exclude.length > 0) ig.add(exclude);

  // Load .gitignore
  const gitignorePatterns = await loadIgnoreFile(join(targetDir, '.gitignore'));
  if (gitignorePatterns.length > 0) ig.add(gitignorePatterns);

  // Load .fcvignore
  const fcvignorePatterns = await loadIgnoreFile(join(targetDir, '.fcvignore'));
  if (fcvignorePatterns.length > 0) ig.add(fcvignorePatterns);

  return ig;
}

export async function pruneDirectory(targetDir, { exclude = [], only = [] } = {}) {
  const ignoreFilter = await createIgnoreFilter(targetDir, { exclude });
  const onlyFilter = createOnlyFilter(only);

  // Walk directory
  const entries = await readdir(targetDir, { recursive: true, withFileTypes: true });
  const files = [];
  const languages = new Set();

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const fullPath = join(entry.parentPath || entry.path, entry.name);
    const relPath = relative(targetDir, fullPath);

    // Apply ignore rules
    if (ignoreFilter.ignores(relPath)) continue;

    const ext = extname(entry.name).toLowerCase();
    if (!SCANNABLE_EXTENSIONS.has(ext)) continue;

    // Apply --only inclusion filter (if set, only keep matching files)
    if (onlyFilter && !onlyFilter.includes(relPath)) continue;

    files.push(relPath);
    languages.add(ext);
  }

  files.sort();
  return { files, languages, ignoreFilter, onlyFilter };
}
