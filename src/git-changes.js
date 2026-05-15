import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

function exec(cmd, args, cwd) {
  return new Promise((ok, fail) => {
    execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return fail(err);
      }
      ok(stdout);
    });
  });
}

/**
 * Returns git-changed file paths relative to targetDir.
 * @param {string} targetDir  Absolute path to the scan target
 * @param {'all'|'uncommitted'} scope
 *   - 'uncommitted': staged + modified + untracked (git status)
 *   - 'all': uncommitted + files in unpushed commits (default)
 * @returns {Promise<string[]>} Deduplicated, sorted, relative paths
 */
export async function getGitChangedFiles(targetDir, scope = 'all') {
  // Canonicalize targetDir so symlink-resolved paths match what
  // `git rev-parse --show-toplevel` returns. Critical on macOS where
  // /tmp -> /private/tmp and /var/folders/... -> /private/var/folders/...
  const canonicalTarget = await realpath(targetDir);
  const repoRoot = await resolveRepoRoot(canonicalTarget, targetDir);

  const files = new Set();
  await collectUncommittedPaths(repoRoot, files);
  if (scope === 'all') await collectUnpushedPaths(repoRoot, files);

  return relativizeToTarget(files, repoRoot, canonicalTarget);
}

async function resolveRepoRoot(canonicalTarget, originalTarget) {
  try {
    const stdout = await exec('git', ['rev-parse', '--show-toplevel'], canonicalTarget);
    return stdout.trim();
  } catch {
    throw new Error(`Not a git repository: ${originalTarget}`);
  }
}

async function collectUncommittedPaths(repoRoot, files) {
  const porcelain = await exec('git', ['status', '--porcelain', '-uall'], repoRoot);
  for (const line of porcelain.split('\n')) {
    const path = extractPorcelainPath(line);
    if (path) files.add(path);
  }
}

function extractPorcelainPath(line) {
  if (!line) return null;
  const xy = line.slice(0, 2);
  if (isDeletedStatus(xy)) return null;
  const rest = line.slice(3);
  // Handle renames: "R  old -> new"
  const arrow = rest.indexOf(' -> ');
  return arrow !== -1 ? rest.slice(arrow + 4) : rest;
}

function isDeletedStatus(xy) {
  return xy.at(1) === 'D' || (xy.at(0) === 'D' && xy.at(1) === ' ');
}

async function collectUnpushedPaths(repoRoot, files) {
  let log;
  try {
    log = await exec('git', ['log', '@{upstream}..HEAD', '--name-only', '--pretty=format:'], repoRoot);
  } catch {
    return;  // No upstream set (new branch) — gracefully skip
  }
  for (const line of log.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) files.add(trimmed);
  }
}

function relativizeToTarget(files, repoRoot, canonicalTarget) {
  const result = [];
  for (const f of files) {
    const abs = resolve(repoRoot, f);
    const rel = relative(canonicalTarget, abs);
    if (rel.startsWith('..')) continue;
    result.push(rel);
  }
  result.sort();
  return result;
}
