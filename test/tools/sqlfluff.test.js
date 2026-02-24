import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sqlfluff from '../../src/tools/sqlfluff.js';

describe('sqlfluff adapter', () => {
  it('has correct metadata', () => {
    assert.equal(sqlfluff.name, 'sqlfluff');
    assert.deepEqual(sqlfluff.extensions, ['.sql']);
    assert.ok(sqlfluff.installHint.includes('sqlfluff'));
  });

  it('builds lint command', () => {
    const { bin, args } = sqlfluff.buildCommand('/tmp/project', null);
    assert.equal(bin, 'sqlfluff');
    assert.ok(args.includes('lint'));
    assert.ok(args.includes('--format'));
    assert.ok(args.includes('json'));
    assert.ok(args.includes('--disable-progress-bar'));
    assert.ok(args.includes('--processes'));
    assert.ok(args.includes('1'));
    assert.ok(args.includes('/tmp/project'));
  });

  it('builds fix command', () => {
    const { args } = sqlfluff.buildCommand('/tmp/project', null, { fix: true });
    assert.ok(args.includes('fix'));
    assert.ok(!args.includes('lint'));
    assert.ok(args.includes('--force'));
  });

  it('builds command with files list', () => {
    const { args } = sqlfluff.buildCommand('/tmp/project', null, { files: ['q1.sql', 'q2.sql'] });
    assert.ok(args.includes('q1.sql'));
    assert.ok(args.includes('q2.sql'));
    assert.ok(!args.includes('/tmp/project'));
  });

  it('parses sqlfluff 2.x output (line_no, line_pos)', () => {
    const stdout = JSON.stringify([
      {
        filepath: 'queries/select.sql',
        violations: [
          { code: 'LT01', line_no: 3, line_pos: 5, description: 'Expected single trailing newline' },
          { code: 'CP01', line_no: 1, line_pos: 1, description: 'Keywords must be capitalised' },
        ],
      },
    ]);

    const findings = sqlfluff.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 2);

    assert.equal(findings[0].file, 'queries/select.sql');
    assert.equal(findings[0].line, 3);
    assert.equal(findings[0].col, 5);
    assert.equal(findings[0].tag, 'FORMAT');
    assert.equal(findings[0].rule, 'LT01');
    assert.equal(findings[0].severity, 'warning');

    assert.equal(findings[1].tag, 'FORMAT'); // CP* → FORMAT
    assert.equal(findings[1].rule, 'CP01');
  });

  it('parses sqlfluff 3.x output (start_line_no, start_line_pos)', () => {
    const stdout = JSON.stringify([
      {
        filepath: 'queries/insert.sql',
        violations: [
          { code: 'AM01', start_line_no: 7, start_line_pos: 10, description: 'Ambiguous use of DISTINCT' },
        ],
      },
    ]);

    const findings = sqlfluff.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 7);
    assert.equal(findings[0].col, 10);
    assert.equal(findings[0].tag, 'LINTER');
  });

  it('classifies rule tags correctly', () => {
    const make = (code) => JSON.stringify([{
      filepath: 'f.sql',
      violations: [{ code, line_no: 1, line_pos: 1, description: 'test' }],
    }]);

    assert.equal(sqlfluff.parseOutput(make('PRS01'), '', 1)[0].tag, 'BUG');
    assert.equal(sqlfluff.parseOutput(make('LT01'), '', 1)[0].tag, 'FORMAT');
    assert.equal(sqlfluff.parseOutput(make('LT12'), '', 1)[0].tag, 'FORMAT');
    assert.equal(sqlfluff.parseOutput(make('CP01'), '', 1)[0].tag, 'FORMAT');
    assert.equal(sqlfluff.parseOutput(make('AM01'), '', 1)[0].tag, 'LINTER');
    assert.equal(sqlfluff.parseOutput(make('ST06'), '', 1)[0].tag, 'LINTER');
  });

  it('PRS rules get error severity', () => {
    const stdout = JSON.stringify([{
      filepath: 'f.sql',
      violations: [{ code: 'PRS01', line_no: 1, line_pos: 1, description: 'Parse error' }],
    }]);
    assert.equal(sqlfluff.parseOutput(stdout, '', 1)[0].severity, 'error');
  });

  it('returns empty for clean output', () => {
    assert.deepEqual(sqlfluff.parseOutput('', '', 0), []);
  });

  it('returns empty for results with no violations', () => {
    const stdout = JSON.stringify([{ filepath: 'clean.sql', violations: [] }]);
    assert.deepEqual(sqlfluff.parseOutput(stdout, '', 0), []);
  });

  it('throws on fatal exit code >= 3 with no stdout', () => {
    assert.throws(
      () => sqlfluff.parseOutput('', 'Internal error', 3),
      /sqlfluff error/
    );
  });

  it('checkInstalled returns boolean', async () => {
    const result = await sqlfluff.checkInstalled();
    assert.equal(typeof result, 'boolean');
  });
});
