import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import tsc from '../../src/tools/tsc.js';

describe('tsc adapter', () => {
  it('has correct metadata', () => {
    assert.equal(tsc.name, 'tsc');
    assert.ok(tsc.extensions.includes('.ts'));
    assert.ok(tsc.extensions.includes('.tsx'));
    assert.ok(tsc.extensions.includes('.mts'));
    assert.ok(tsc.extensions.includes('.cts'));
    assert.ok(tsc.installHint.includes('typescript'));
  });

  it('builds command without config (uses targetDir as project)', () => {
    const { bin, args } = tsc.buildCommand('/tmp/project', null);
    assert.equal(bin, 'tsc');
    assert.ok(args.includes('--noEmit'));
    assert.ok(args.includes('--pretty'));
    assert.ok(args.includes('false'));
    assert.ok(args.includes('--project'));
    assert.ok(args.includes('/tmp/project'));
  });

  it('builds command with config', () => {
    const { args } = tsc.buildCommand('/tmp/project', '/tmp/project/tsconfig.json');
    assert.ok(args.includes('--project'));
    assert.ok(args.includes('/tmp/project/tsconfig.json'));
    assert.ok(!args.includes('/tmp/project'));
  });

  it('parses tsc text output with errors', () => {
    const stdout = [
      'src/foo.ts(10,5): error TS2322: Type \'string\' is not assignable to type \'number\'.',
      'src/bar.tsx(3,12): warning TS6133: \'x\' is declared but its value is never read.',
    ].join('\n');

    const findings = tsc.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 2);

    assert.equal(findings[0].file, 'src/foo.ts');
    assert.equal(findings[0].line, 10);
    assert.equal(findings[0].col, 5);
    assert.equal(findings[0].tag, 'TYPE_ERROR');
    assert.equal(findings[0].rule, 'TS2322');
    assert.equal(findings[0].severity, 'error');

    assert.equal(findings[1].file, 'src/bar.tsx');
    assert.equal(findings[1].line, 3);
    assert.equal(findings[1].col, 12);
    assert.equal(findings[1].severity, 'warning');
    assert.equal(findings[1].rule, 'TS6133');
  });

  it('tag is always TYPE_ERROR', () => {
    const stdout = 'src/x.ts(1,1): error TS2345: Argument type mismatch';
    const findings = tsc.parseOutput(stdout, '', 1);
    assert.equal(findings[0].tag, 'TYPE_ERROR');
  });

  it('returns empty array for clean output', () => {
    assert.deepEqual(tsc.parseOutput('', '', 0), []);
  });

  it('throws on fatal exit code >= 3', () => {
    assert.throws(
      () => tsc.parseOutput('', 'Fatal error', 3),
      /tsc error/
    );
  });

  it('skips non-matching lines', () => {
    const stdout = 'Some random text\nsrc/a.ts(5,2): error TS1005: \';\' expected.\nAnother line\n';
    const findings = tsc.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'TS1005');
  });

  it('checkInstalled returns boolean', async () => {
    const result = await tsc.checkInstalled();
    assert.equal(typeof result, 'boolean');
  });
});
