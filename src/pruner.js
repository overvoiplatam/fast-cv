import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import ignore from 'ignore';

const HARDCODED_IGNORES = [
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'coverage',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  'vendor',
  '.terraform',
  '.egg-info',
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

export async function pruneDirectory(targetDir) {
  const ig = ignore();

  // Add hardcoded directory ignores
  ig.add(HARDCODED_IGNORES.map(d => `${d}/`));
  ig.add(IGNORED_FILES);

  // Load .gitignore
  const gitignorePatterns = await loadIgnoreFile(join(targetDir, '.gitignore'));
  if (gitignorePatterns.length > 0) ig.add(gitignorePatterns);

  // Load .fcvignore
  const fcvignorePatterns = await loadIgnoreFile(join(targetDir, '.fcvignore'));
  if (fcvignorePatterns.length > 0) ig.add(fcvignorePatterns);

  // Walk directory
  const entries = await readdir(targetDir, { recursive: true, withFileTypes: true });
  const files = [];
  const languages = new Set();

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const fullPath = join(entry.parentPath || entry.path, entry.name);
    const relPath = relative(targetDir, fullPath);

    // Apply ignore rules
    if (ig.ignores(relPath)) continue;

    const ext = extname(entry.name).toLowerCase();
    if (!SCANNABLE_EXTENSIONS.has(ext)) continue;

    files.push(relPath);
    languages.add(ext);
  }

  files.sort();
  return { files, languages };
}
