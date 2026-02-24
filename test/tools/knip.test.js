import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import knip from '../../src/tools/knip.js';

describe('knip adapter', () => {
  it('has correct metadata', () => {
    assert.equal(knip.name, 'knip');
    assert.ok(knip.extensions.includes('.js'));
    assert.ok(knip.extensions.includes('.ts'));
    assert.ok(knip.extensions.includes('.tsx'));
    assert.ok(knip.extensions.includes('.mjs'));
    assert.ok(knip.installHint.includes('npx'));
  });

  it('is opt-in only', () => {
    assert.equal(knip.optIn, true);
  });

  it('builds correct command with cwd', () => {
    const { bin, args, cwd } = knip.buildCommand('/tmp/project');
    assert.equal(bin, 'npx');
    assert.ok(args.includes('knip'));
    assert.ok(args.includes('--reporter'));
    assert.ok(args.includes('json'));
    assert.ok(args.includes('--no-progress'));
    assert.equal(cwd, '/tmp/project');
  });

  it('parses unused files', () => {
    const stdout = JSON.stringify({
      files: ['src/old-util.js', 'src/dead-module.ts'],
    });

    const findings = knip.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].file, 'src/old-util.js');
    assert.equal(findings[0].tag, 'DEAD_CODE');
    assert.equal(findings[0].rule, 'knip/unused-file');
    assert.equal(findings[0].severity, 'warning');
    assert.ok(findings[0].message.includes('Unused file'));
  });

  it('parses unused exports', () => {
    const stdout = JSON.stringify({
      exports: [
        { file: 'src/utils.ts', line: 42, name: 'formatDate' },
        { file: 'src/api.ts', line: 10, name: 'oldEndpoint' },
      ],
    });

    const findings = knip.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].tag, 'DEAD_CODE');
    assert.equal(findings[0].rule, 'knip/unused-export');
    assert.ok(findings[0].message.includes('formatDate'));
    assert.equal(findings[0].file, 'src/utils.ts');
    assert.equal(findings[0].line, 42);
  });

  it('parses unused dependencies', () => {
    const stdout = JSON.stringify({
      dependencies: [
        { name: 'lodash' },
        { name: 'moment' },
      ],
    });

    const findings = knip.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].rule, 'knip/unused-dependency');
    assert.equal(findings[0].file, 'package.json');
    assert.ok(findings[0].message.includes('lodash'));
  });

  it('parses unlisted dependencies', () => {
    const stdout = JSON.stringify({
      unlisted: [
        { name: 'chalk' },
      ],
    });

    const findings = knip.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'knip/unlisted-dependency');
    assert.ok(findings[0].message.includes('chalk'));
  });

  it('parses mixed output with all categories', () => {
    const stdout = JSON.stringify({
      files: ['dead.js'],
      exports: [{ file: 'lib.ts', line: 5, name: 'unused' }],
      dependencies: [{ name: 'lodash' }],
      unlisted: [{ name: 'chalk' }],
    });

    const findings = knip.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 4);
    assert.equal(findings[0].rule, 'knip/unused-file');
    assert.equal(findings[1].rule, 'knip/unused-export');
    assert.equal(findings[2].rule, 'knip/unused-dependency');
    assert.equal(findings[3].rule, 'knip/unlisted-dependency');
  });

  it('returns empty array for clean output', () => {
    assert.deepEqual(knip.parseOutput('', '', 0), []);
  });

  it('returns empty when stderr contains Unable to find', () => {
    const findings = knip.parseOutput('', 'Unable to find package.json', 1);
    assert.deepEqual(findings, []);
  });

  it('throws on error with stderr (exit >= 2)', () => {
    assert.throws(
      () => knip.parseOutput('', 'fatal config error', 2),
      /knip error/
    );
  });

  it('throws on unparseable JSON', () => {
    assert.throws(
      () => knip.parseOutput('not json', '', 1),
      /failed to parse JSON/
    );
  });

  it('handles string dependencies (not objects)', () => {
    const stdout = JSON.stringify({
      dependencies: ['lodash', 'moment'],
    });

    const findings = knip.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 2);
    assert.ok(findings[0].message.includes('lodash'));
    assert.ok(findings[1].message.includes('moment'));
  });

  it('checkInstalled returns boolean', async () => {
    const result = await knip.checkInstalled();
    assert.equal(typeof result, 'boolean');
  });
});
