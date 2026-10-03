import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

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
  // -z: NUL-separated records with raw (unquoted) paths, so spaces, unicode
  // and ' -> ' inside filenames parse correctly. Record layout: `XY <path>`,
  // plus a second record with the original path when XY contains R/C.
  const porcelain = await exec('git', ['status', '--porcelain=v1', '-z', '-uall'], repoRoot);
  const records = porcelain.split('\0');
  for (let i = 0; i < records.length; i++) {
    // `.at(i)` instead of `records[i]` to avoid detect-object-injection.
    const entry = records.at(i);
    if (entry.length < 4) continue; // trailing NUL / empty record
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    const isRenameOrCopy = xy.includes('R') || xy.includes('C');
    if (isRenameOrCopy) i++; // skip the original-path record that follows
    if (isDeletedStatus(xy)) continue;
    files.add(path);
  }
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
    // Out-of-target check is separator-aware: path.relative yields '..\\a.js'
    // on Windows and '../a.js' on POSIX, but '..foo.js' is a legitimate
    // in-target name that must not be discarded.
    if (rel === '..' || rel.startsWith(`..${sep}`)) continue;
    result.push(rel);
  }
  result.sort();
  return result;
}
