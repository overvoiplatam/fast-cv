import assert from 'node:assert/strict';

/**
 * Shared test: adapter builds command using files list instead of target dir.
 * Eliminates cross-file duplication across mypy, vulture, ruff tests.
 * Returns the built command so callers can assert on it in their own body.
 */
export function testBuildCommandWithFiles(adapter) {
  const cmd = adapter.buildCommand('/tmp/project', null, { files: ['src/a.py', 'src/b.py'] });
  assert.ok(cmd.args.includes('src/a.py'));
  assert.ok(cmd.args.includes('src/b.py'));
  assert.ok(!cmd.args.includes('/tmp/project'));
  return cmd;
}

/**
 * Shared test: adapter builds command without config, using --format json.
 * Eliminates cross-file duplication across eslint, typos tests.
 * Returns the built command so callers can assert on it in their own body.
 */
export function testBuildCommandNoConfig(adapter, expectedBin) {
  const cmd = adapter.buildCommand('/tmp/project', null);
  assert.equal(cmd.bin, expectedBin);
  assert.ok(cmd.args.includes('--format'));
  assert.ok(cmd.args.includes('json'));
  assert.ok(cmd.args.includes('/tmp/project'));
  assert.ok(!cmd.args.includes('--config'));
  return cmd;
}
