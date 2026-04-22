import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import spectral from '../../src/tools/spectral.js';

describe('spectral adapter', () => {
  it('has correct metadata', () => {
    assert.equal(spectral.name, 'spectral');
    assert.ok(spectral.extensions.includes('.yaml'));
    assert.ok(spectral.extensions.includes('.json'));
    assert.equal(spectral.supportsFix, true);
    assert.ok(spectral.installHint.includes('spectral'));
  });

  it('buildCommand without files uses glob', () => {
    const { bin, args } = spectral.buildCommand('/p', null);
    assert.equal(bin, 'spectral');
    assert.ok(args.includes('lint'));
    assert.ok(args.includes('--format'));
    assert.ok(args.includes('json'));
    assert.ok(args.some(a => a.includes('**/*.{yaml,yml,json}')));
  });

  it('buildCommand with files', () => {
    const { args } = spectral.buildCommand('/p', null, { files: ['a.yaml'] });
    assert.ok(args.includes('a.yaml'));
    assert.ok(!args.some(a => a.includes('**/*')));
  });

  it('buildCommand with config', () => {
    const { args } = spectral.buildCommand('/p', '/etc/.spectral.yaml');
    assert.ok(args.includes('--ruleset'));
    assert.ok(args.includes('/etc/.spectral.yaml'));
  });

  it('preFixCommands returns redocly bundle commands', () => {
    const cmds = spectral.preFixCommands('/p', null, { files: ['api.yaml', 'README.md'] });
    assert.equal(cmds.length, 1);
    assert.equal(cmds[0].bin, 'redocly');
    assert.ok(cmds[0].args.includes('bundle'));
    assert.ok(cmds[0].args.includes('api.yaml'));
  });

  it('preFixCommands empty when no files', () => {
    assert.deepEqual(spectral.preFixCommands('/p', null, {}), []);
  });

  it('parseOutput maps spectral JSON to findings', () => {
    const stdout = JSON.stringify([
      {
        source: '/p/api.yaml',
        code: 'oas3-valid-media-example',
        message: 'Bad example',
        severity: 0,
        range: { start: { line: 9, character: 4 } },
      },
      {
        source: '/p/api.yaml',
        code: 'operation-tags',
        message: 'Missing tags',
        severity: 2,
        range: { start: { line: 5, character: 0 } },
      },
    ]);
    const f = spectral.parseOutput(stdout, '', 0);
    assert.equal(f.length, 2);
    assert.equal(f[0].rule, 'spectral/oas3-valid-media-example');
    assert.equal(f[0].severity, 'error');
    assert.equal(f[0].line, 10);
    assert.equal(f[0].col, 5);
    assert.equal(f[1].severity, 'warning');
    assert.equal(f[0].tag, 'DOCS');
  });

  it('parseOutput returns empty for no findings', () => {
    assert.deepEqual(spectral.parseOutput('', '', 0), []);
    assert.deepEqual(spectral.parseOutput('[]', '', 0), []);
  });

  it('parseOutput throws on fatal stderr', () => {
    assert.throws(() => spectral.parseOutput('', 'spectral fatal: bad ruleset', 1));
  });

  it('checkInstalled returns boolean', async () => {
    const v = await spectral.checkInstalled();
    assert.equal(typeof v, 'boolean');
  });
});
