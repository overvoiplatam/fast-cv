import assert from 'node:assert/strict';

/**
 * Shared test: adapter builds command using files list instead of target dir.
 * Eliminates cross-file duplication across mypy, vulture, ruff tests.
 */
export function testBuildCommandWithFiles(adapter) {
  const { args } = adapter.buildCommand('/tmp/project', null, { files: ['src/a.py', 'src/b.py'] });
  assert.ok(args.includes('src/a.py'));
  assert.ok(args.includes('src/b.py'));
  assert.ok(!args.includes('/tmp/project'));
}

/**
 * Shared test: adapter builds command without config, using --format json.
 * Eliminates cross-file duplication across eslint, typos tests.
 */
export function testBuildCommandNoConfig(adapter, expectedBin) {
  const { bin, args } = adapter.buildCommand('/tmp/project', null);
  assert.equal(bin, expectedBin);
  assert.ok(args.includes('--format'));
  assert.ok(args.includes('json'));
  assert.ok(args.includes('/tmp/project'));
  assert.ok(!args.includes('--config'));
}
