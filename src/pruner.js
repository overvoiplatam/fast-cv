import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import ignore from 'ignore';
import { SCANNABLE_EXTENSIONS } from './constants.js';

// Common build outputs, caches, and dependency directories that should never be scanned.
// Sourced from GitHub's gitignore templates and major framework documentation.
export const HARDCODED_IGNORES = [
  // Package managers / dependencies
  'node_modules',
  'bower_components',
  'jspm_packages',
  'vendor',
  '.yarn',
  '.pnp',

  // Python — globs, because virtualenvs are routinely named `.venv-<project>`
  // or `venv3`. `site-packages`/`dist-packages` are the name-independent catch:
  // they match installed dependencies inside a venv, a conda env, or a system
  // interpreter, whatever the enclosing directory is called.
  '__pycache__',
  '.venv*',
  'venv*',
  'site-packages',
  'dist-packages',
  '.tox',
  '.nox',
  '.eggs',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.egg-info',
  '*.egg-info',
  '.conda',
  '.direnv',
  '.ipynb_checkpoints',

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

  // Agent sandboxes (Claude Code worktrees, agent scratch dirs)
  '.claude',

  // Build tools / caches
  '.gradle',
  '.cargo',
  'Pods',
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

const SCANNABLE_SET = new Set(SCANNABLE_EXTENSIONS);

/** Strips blanks and comments from .gitignore-style file contents. */
export function parseIgnorePatterns(content) {
  return content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
}

async function loadIgnoreFile(filePath) {
  try {
    return parseIgnorePatterns(await readFile(filePath, 'utf-8'));
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

const IGNORED_FILES_SET = new Set(IGNORED_FILES);

export async function pruneDirectory(targetDir, { exclude = [], only = [], gitFiles = null } = {}) {
  const ignoreFilter = await createIgnoreFilter(targetDir, { exclude });
  const onlyFilter = createOnlyFilter(only);
  const gitFileSet = gitFiles ? new Set(gitFiles) : null;

  const entries = await readdir(targetDir, { recursive: true, withFileTypes: true });

  // Drop virtualenvs before filtering, so a venv with an unexpected name
  // (`.venv-freqtrade`, `env-3.12`) can't slip past the name-based patterns.
  const venvDirs = findVirtualenvDirs(entries, targetDir);
  if (venvDirs.length > 0) ignoreFilter.add(venvDirs);

  const files = [];
  const languages = new Set();

  for (const entry of entries) {
    const accepted = acceptEntry(entry, targetDir, ignoreFilter, onlyFilter, gitFileSet);
    if (!accepted) continue;
    files.push(accepted.relPath);
    languages.add(accepted.ext);
  }

  files.sort();
  return { files, languages, ignoreFilter, onlyFilter, warnings: dominantDirWarnings(files) };
}

// PEP 405 marks every virtualenv root with a `pyvenv.cfg`. Nothing under one is
// project source, so the whole subtree is ignored regardless of its name. A
// marker at the scan root itself is skipped — that means the user deliberately
// pointed fast-cv at a venv, and ignoring everything would be unhelpful.
function findVirtualenvDirs(entries, targetDir) {
  const dirs = [];
  for (const entry of entries) {
    if (entry.name !== 'pyvenv.cfg' || !entry.isFile()) continue;
    const relDir = relative(targetDir, entry.parentPath || entry.path);
    if (relDir && !relDir.startsWith('..')) dirs.push(`${relDir}/`);
  }
  return dirs;
}

const DOMINANT_DIR_SHARE = 0.5;
const DOMINANT_DIR_MIN_FILES = 200;

// A single subtree supplying most of the scan is almost always vendored code
// that escaped the ignore rules. Say so, with the path to add to .fcvignore —
// a silently huge report is the failure mode we're guarding against.
function dominantDirWarnings(files) {
  if (files.length < DOMINANT_DIR_MIN_FILES) return [];

  const counts = new Map();
  for (const file of files) {
    const slash = file.indexOf('/');
    if (slash < 1) continue;
    const top = file.slice(0, slash);
    counts.set(top, (counts.get(top) || 0) + 1);
  }

  const warnings = [];
  for (const [dir, count] of counts) {
    if (count / files.length < DOMINANT_DIR_SHARE) continue;
    warnings.push(
      `\`${dir}/\` accounts for ${count} of ${files.length} scanned files. `
      + `If it is vendored or generated code, add it to .fcvignore or pass --exclude '${dir}/**'.`,
    );
  }
  return warnings;
}

function acceptEntry(entry, targetDir, ignoreFilter, onlyFilter, gitFileSet) {
  if (!entry.isFile()) return null;
  if (IGNORED_FILES_SET.has(entry.name)) return null;

  const fullPath = join(entry.parentPath || entry.path, entry.name);
  const relPath = relative(targetDir, fullPath);

  if (ignoreFilter.ignores(relPath)) return null;
  const ext = extname(entry.name).toLowerCase();
  if (!SCANNABLE_SET.has(ext)) return null;
  if (onlyFilter && !onlyFilter.includes(relPath)) return null;
  if (gitFileSet && !gitFileSet.has(relPath)) return null;

  return { relPath, ext };
}
