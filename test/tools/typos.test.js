import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import typos from '../../src/tools/typos.js';
import { testBuildCommandNoConfig } from '../helpers.js';

describe('typos adapter', () => {
  it('has correct metadata', () => {
    assert.equal(typos.name, 'typos');
    assert.ok(typos.extensions.includes('.py'));
    assert.ok(typos.extensions.includes('.js'));
    assert.ok(typos.extensions.includes('.rs'));
    assert.ok(typos.installHint.includes('typos'));
    // expanded language support
    assert.ok(typos.extensions.includes('.kt'));
    assert.ok(typos.extensions.includes('.sql'));
    assert.ok(typos.extensions.includes('.scala'));
    assert.ok(typos.extensions.includes('.sh'));
  });

  it('is opt-in only', () => {
    assert.equal(typos.optIn, true);
  });

  it('builds correct command without config', () => {
    testBuildCommandNoConfig(typos, 'typos');
  });

  it('builds correct command with config', () => {
    const { args } = typos.buildCommand('/tmp/project', '/etc/typos.toml');
    assert.ok(args.includes('--config'));
    assert.ok(args.includes('/etc/typos.toml'));
  });

  it('builds command with files list', () => {
    const { args } = typos.buildCommand('/tmp/project', null, { files: ['src/a.py'] });
    assert.ok(args.includes('src/a.py'));
    assert.ok(!args.includes('/tmp/project'));
  });

  it('parses JSON Lines output with corrections', () => {
    const lines = [
      JSON.stringify({ path: 'src/app.py', line_num: 42, byte_offset: 10, typo: 'teh', corrections: ['the'] }),
      JSON.stringify({ path: 'src/utils.js', line_num: 7, byte_offset: 5, typo: 'nto', corrections: ['not', 'into'] }),
    ];
    const stdout = lines.join('\n');

    // jscpd:ignore-start
    const findings = typos.parseOutput(stdout, '', 2);
    assert.equal(findings.length, 2);

    assert.equal(findings[0].file, 'src/app.py');
    assert.equal(findings[0].line, 42);
    assert.equal(findings[0].tag, 'TYPO');
    // jscpd:ignore-end
    assert.equal(findings[0].rule, 'typo');
    assert.equal(findings[0].severity, 'warning');
    assert.ok(findings[0].message.includes('"teh"'));
    assert.ok(findings[0].message.includes('the'));

    assert.ok(findings[1].message.includes('not, into'));
  });

  it('tag is always TYPO', () => {
    const stdout = JSON.stringify({ path: 'x.py', line_num: 1, typo: 'abc', corrections: ['def'] });
    const findings = typos.parseOutput(stdout, '', 2);
    assert.equal(findings[0].tag, 'TYPO');
  });

  it('returns empty array for clean output', () => {
    assert.deepEqual(typos.parseOutput('', '', 0), []);
  });

  it('handles entries without typo field', () => {
    const stdout = JSON.stringify({ path: 'x.py', line_num: 1, type: 'binary' });
    const findings = typos.parseOutput(stdout, '', 0);
    assert.equal(findings.length, 0);
  });

  it('handles missing corrections', () => {
    const stdout = JSON.stringify({ path: 'x.py', line_num: 1, typo: 'foo' });
    const findings = typos.parseOutput(stdout, '', 2);
    assert.equal(findings.length, 1);
    assert.ok(findings[0].message.includes('?'));
  });

  it('throws on error with stderr', () => {
    assert.throws(
      () => typos.parseOutput('', 'fatal config error', 2),
      /typos error/
    );
  });

  it('skips unparseable lines', () => {
    const stdout = 'binary file\n' + JSON.stringify({ path: 'x.py', line_num: 1, typo: 'abc', corrections: ['def'] });
    const findings = typos.parseOutput(stdout, '', 2);
    assert.equal(findings.length, 1);
  });

  it('checkInstalled returns boolean', async () => {
    const result = await typos.checkInstalled();
    assert.equal(typeof result, 'boolean');
  });
});
