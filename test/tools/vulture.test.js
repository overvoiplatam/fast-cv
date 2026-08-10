import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vulture from '../../src/tools/vulture.js';
import { testBuildCommandWithFiles } from '../helpers.js';

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
    const { args } = testBuildCommandWithFiles(vulture);
    assert.ok(args.includes('src/a.py'));
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

  it('emits a LINTER parse-error finding on exit 3 with structured stderr', () => {
    const stderr = 'docs/legacy/api/conversations/operations_old.py:57: unexpected indent at "if conversation_status:"\n';
    const findings = vulture.parseOutput('', stderr, 3);
    assert.equal(findings.length, 1);
    const f = findings[0];
    assert.equal(f.file, 'docs/legacy/api/conversations/operations_old.py');
    assert.equal(f.line, 57);
    assert.equal(f.tag, 'LINTER');
    assert.equal(f.rule, 'parse-error');
    assert.equal(f.severity, 'error');
    assert.ok(f.message.includes('unexpected indent'));
  });

  it('keeps stdout dead-code findings alongside exit-3 parse errors (mixed output)', () => {
    const stdout = "src/app.py:42: unused function 'parse_date' (80% confidence)\n";
    const stderr = 'src/broken.py:5: invalid syntax at "x"\n';
    const findings = vulture.parseOutput(stdout, stderr, 3);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].file, 'src/broken.py');
    assert.equal(findings[0].tag, 'LINTER');
    assert.equal(findings[0].rule, 'parse-error');
    assert.equal(findings[1].file, 'src/app.py');
    assert.equal(findings[1].tag, 'DEAD_CODE');
  });

  // Exit 3 is vulture's DeadCode code, not a failure. Treating it as an error
  // discarded every finding of a normal run.
  it('returns dead-code findings on exit 3 with empty stderr', () => {
    const stdout = "app/config.py:22: unused variable 'model_config' (60% confidence)\n"
      + "app/main.py:15: unused import 'os' (90% confidence)\n";
    const findings = vulture.parseOutput(stdout, '', 3);
    assert.equal(findings.length, 2);
    assert.ok(findings.every(f => f.tag === 'DEAD_CODE'));
    assert.equal(findings[0].file, 'app/config.py');
    assert.equal(findings[1].file, 'app/main.py');
  });

  it('surfaces parse errors on exit 1 (InvalidInput)', () => {
    const stderr = 'broken.py:1: invalid syntax at "def f(:"\n';
    const findings = vulture.parseOutput('', stderr, 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].tag, 'LINTER');
    assert.equal(findings[0].rule, 'parse-error');
    assert.equal(findings[0].file, 'broken.py');
  });

  it('throws on exit 1 when nothing parseable was reported', () => {
    assert.throws(
      () => vulture.parseOutput('', 'totally unrecognized garbage\n', 1),
      /vulture error \(exit 1\)/
    );
  });

  it('throws on unknown exit codes', () => {
    assert.throws(
      () => vulture.parseOutput('', '', 4),
      /vulture error \(exit 4\)/
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
