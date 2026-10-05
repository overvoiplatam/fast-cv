import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import knip from '../../src/tools/knip.js';

describe('knip adapter', () => {
  it('has correct metadata', () => {
    assert.equal(knip.name, 'knip');
    assert.ok(knip.extensions.includes('.js'));
    assert.ok(knip.extensions.includes('.ts'));
    assert.ok(knip.extensions.includes('.tsx'));
    assert.ok(knip.extensions.includes('.mjs'));
    assert.ok(knip.installHint.includes('npm install -g knip'));
  });

  it('is not opt-in', () => {
    assert.ok(!knip.optIn);
  });

  it('skips non-JS targets with a reported note (no package.json)', () => {
    assert.equal(
      knip.skip({ targetDir: '/definitely/not/here' }),
      'knip: not a JS project (no package.json in target) — skipped',
    );
  });

  it('does not skip targets with a package.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fcv-knip-'));
    writeFileSync(join(dir, 'package.json'), '{"name":"fixture"}');
    assert.equal(knip.skip({ targetDir: dir }), null);
  });

  it('builds correct command with cwd', () => {
    const { bin, args, cwd } = knip.buildCommand('/tmp/project');
    assert.equal(bin, 'knip');
    assert.ok(args.includes('--reporter'));
    assert.ok(args.includes('json'));
    assert.ok(args.includes('--no-progress'));
    assert.equal(cwd, '/tmp/project');
  });

  it('supports fix and adds --fix when requested', () => {
    assert.equal(knip.supportsFix, true);
    const { args } = knip.buildCommand('/tmp/project', null, { fix: true });
    assert.ok(args.includes('--fix'));
  });

  it('omits --fix by default', () => {
    const { args } = knip.buildCommand('/tmp/project');
    assert.ok(!args.includes('--fix'));
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

  it('emits a bootstrap-failure finding when stderr contains Unable to find', () => {
    const findings = knip.parseOutput('', 'Unable to find package.json', 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].tag, 'LINTER');
    assert.equal(findings[0].rule, 'bootstrap-failure');
    assert.equal(findings[0].severity, 'error');
    assert.ok(findings[0].message.includes('Unable to find package.json'));
  });

  it('emits a bootstrap-failure finding when stderr contains Error loading <path>', () => {
    const stderr = "ERROR: Error loading /home/u/proj/vitest.config.js\nReason: Cannot find module 'vitest/config'\nRequire stack:\n- /home/u/proj/vitest.config.js\n";
    const stdout = 'Module load error? Visit https://knip.dev/reference/known-issues\nConfiguration file load error? Visit https://knip.dev/reference/known-issues\n';
    const findings = knip.parseOutput(stdout, stderr, 2);
    assert.equal(findings.length, 1);
    const f = findings[0];
    assert.equal(f.file, '/home/u/proj/vitest.config.js');
    assert.equal(f.tag, 'LINTER');
    assert.equal(f.rule, 'bootstrap-failure');
    assert.equal(f.severity, 'error');
    assert.ok(f.message.includes("Cannot find module 'vitest/config'"));
  });

  it('emits a bootstrap-failure finding when stderr Error loading + empty stdout', () => {
    const stderr = "ERROR: Error loading /home/u/proj/knip.config.ts\nReason: Cannot find module 'tsx/esm'\n";
    const findings = knip.parseOutput('', stderr, 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, '/home/u/proj/knip.config.ts');
    assert.equal(findings[0].rule, 'bootstrap-failure');
  });

  it('still throws when Error loading points inside node_modules/knip/ (knip-internal)', () => {
    const stderr = "ERROR: Error loading /home/u/proj/node_modules/knip/dist/plugin.js\nReason: Cannot find module 'whatever'\n";
    assert.throws(
      () => knip.parseOutput('Module load error?', stderr, 2),
      /failed to parse JSON/
    );
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

  it('includes stderr in the error when JSON parse fails', () => {
    let caught;
    try {
      knip.parseOutput('Module load error?', 'TypeError: Cannot read property foo of undefined\n  at /home/u/knip.config.ts:3', 1);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, 'expected parseOutput to throw');
    assert.match(caught.message, /failed to parse JSON/);
    assert.match(caught.message, /stderr:/);
    assert.match(caught.message, /TypeError: Cannot read property foo of undefined/);
    assert.match(caught.message, /knip\.config\.ts/);
    assert.match(caught.message, /stdout:/);
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
