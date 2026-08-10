import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanToolError, inferToolErrorHint } from '../src/tool-errors.js';

describe('cleanToolError', () => {
  it('drops stack frames and collapses the message to one line', () => {
    const raw = 'stylelint error (exit 78): ConfigurationError: Could not find "stylelint-config-standard".\n'
      + '    at getModulePath (file:///usr/local/lib/node_modules/stylelint/lib/utils/getModulePath.mjs:38:9)\n'
      + '    at loadExtendedConfig (file:///usr/local/lib/node_modules/stylelint/lib/augmentConfig.mjs:285:21)\n';

    const cleaned = cleanToolError(raw);

    assert.ok(!cleaned.includes('at getModulePath'));
    assert.ok(!cleaned.includes('\n'));
    assert.ok(cleaned.includes('Could not find "stylelint-config-standard"'));
  });

  it('describes an empty message instead of rendering nothing', () => {
    // vulture used to fail with a blank stderr, producing "vulture error (exit 3): "
    assert.equal(cleanToolError(''), 'failed with no diagnostic output');
    assert.equal(cleanToolError('   \n\n  '), 'failed with no diagnostic output');
    assert.equal(cleanToolError(null), 'failed with no diagnostic output');
  });

  it('caps very long output', () => {
    const cleaned = cleanToolError('x'.repeat(5000));
    assert.ok(cleaned.length < 400);
    assert.ok(cleaned.endsWith('…'));
  });
});

describe('inferToolErrorHint', () => {
  it('points a missing config package at install.sh --repair', () => {
    const hint = inferToolErrorHint('ConfigurationError: Could not find "stylelint-config-standard".');
    assert.match(hint, /--repair/);
  });

  it('recognizes a missing node module', () => {
    const hint = inferToolErrorHint("Error: Cannot find module 'eslint-plugin-sonarjs'");
    assert.match(hint, /--repair/);
  });

  it('uses the tool install hint when the binary is absent', () => {
    const hint = inferToolErrorHint('spawn ruff ENOENT', 'pipx install ruff');
    assert.match(hint, /pipx install ruff/);
  });

  it('returns null when the binary is absent but no install hint exists', () => {
    assert.equal(inferToolErrorHint('spawn ruff ENOENT', undefined), null);
  });

  it('suggests --update-db for stale vulnerability databases', () => {
    const hint = inferToolErrorHint('failed to download vulnerability DB');
    assert.match(hint, /--update-db/);
  });

  it('stays silent on unrecognized failures rather than guessing', () => {
    assert.equal(inferToolErrorHint('some entirely novel failure', 'pipx install x'), null);
    assert.equal(inferToolErrorHint(''), null);
  });
});
