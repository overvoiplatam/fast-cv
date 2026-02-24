import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vulture from '../../src/tools/vulture.js';

describe('vulture adapter', () => {
  it('has correct metadata', () => {
    assert.equal(vulture.name, 'vulture');
    assert.deepEqual(vulture.extensions, ['.py', '.pyi']);
    assert.ok(vulture.installHint.includes('vulture'));
  });

  it('is not opt-in (runs by default for Python)', () => {
    assert.equal(vulture.optIn, undefined);
  });

  it('builds correct command without config', () => {
    const { bin, args } = vulture.buildCommand('/tmp/project', null);
    assert.equal(bin, 'vulture');
    assert.ok(args.includes('--min-confidence'));
    assert.ok(args.includes('80'));
    assert.ok(args.includes('/tmp/project'));
  });

  it('builds command with files list', () => {
    const { args } = vulture.buildCommand('/tmp/project', null, { files: ['src/a.py', 'src/b.py'] });
    assert.ok(args.includes('src/a.py'));
    assert.ok(args.includes('src/b.py'));
    assert.ok(!args.includes('/tmp/project'));
  });

  it('parses standard vulture output', () => {
    const stdout = [
      "src/app.py:42: unused function 'parse_date' (80% confidence)",
      "src/utils.py:10: unused variable 'temp_data' (90% confidence)",
      "src/models.py:100: unused import 'os' (90% confidence)",
    ].join('\n');

    const findings = vulture.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 3);

    assert.equal(findings[0].file, 'src/app.py');
    assert.equal(findings[0].line, 42);
    assert.equal(findings[0].tag, 'DEAD_CODE');
    assert.equal(findings[0].rule, 'vulture/unused');
    assert.equal(findings[0].severity, 'warning');
    assert.ok(findings[0].message.includes("unused function 'parse_date'"));
    assert.ok(findings[0].message.includes('80% confidence'));

    assert.equal(findings[1].file, 'src/utils.py');
    assert.equal(findings[1].line, 10);

    assert.equal(findings[2].file, 'src/models.py');
    assert.equal(findings[2].line, 100);
  });

  it('returns empty array for clean output (exit 0)', () => {
    assert.deepEqual(vulture.parseOutput('', '', 0), []);
  });

  it('throws on error exit code (>= 2)', () => {
    assert.throws(
      () => vulture.parseOutput('', 'syntax error in config', 2),
      /vulture error/
    );
  });

  it('skips unparseable lines', () => {
    const stdout = "warning: some noise\nsrc/app.py:5: unused function 'foo' (85% confidence)\n";
    const findings = vulture.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, 'src/app.py');
  });

  it('checkInstalled returns boolean', async () => {
    const result = await vulture.checkInstalled();
    assert.equal(typeof result, 'boolean');
  });
});
