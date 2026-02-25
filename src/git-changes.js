import { execFile } from 'node:child_process';
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
  let repoRoot;
  try {
    repoRoot = (await exec('git', ['rev-parse', '--show-toplevel'], targetDir)).trim();
  } catch {
    throw new Error(`Not a git repository: ${targetDir}`);
  }

  const files = new Set();

  // Uncommitted: staged + modified + untracked
  const porcelain = await exec('git', ['status', '--porcelain', '-uall'], repoRoot);
  for (const line of porcelain.split('\n')) {
    if (!line) continue;
    const xy = line.slice(0, 2);
    // Skip deleted files
    if (xy[1] === 'D' || (xy[0] === 'D' && xy[1] === ' ')) continue;
    let path = line.slice(3);
    // Handle renames: "R  old -> new"
    const arrow = path.indexOf(' -> ');
    if (arrow !== -1) path = path.slice(arrow + 4);
    files.add(path);
  }

  // Unpushed commits (only for scope 'all')
  if (scope === 'all') {
    try {
      const log = await exec(
        'git', ['log', '@{upstream}..HEAD', '--name-only', '--pretty=format:'], repoRoot,
      );
      for (const line of log.split('\n')) {
        if (line.trim()) files.add(line.trim());
      }
    } catch {
      // No upstream set (new branch) — gracefully skip
    }
  }

  // Convert repo-root-relative paths to targetDir-relative paths
  const result = [];
  for (const f of files) {
    const abs = resolve(repoRoot, f);
    const rel = relative(targetDir, abs);
    // Skip files outside the target directory
    if (rel.startsWith('..')) continue;
    result.push(rel);
  }

  result.sort();
  return result;
}
