import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ruff from '../../src/tools/ruff.js';
import { testBuildCommandWithFiles } from '../helpers.js';

describe('ruff adapter', () => {
  it('has correct metadata', () => {
    assert.equal(ruff.name, 'ruff');
    assert.deepEqual(ruff.extensions, ['.py', '.pyi']);
    assert.ok(ruff.installHint.includes('ruff'));
  });

  it('builds correct command without config', () => {
    const { bin, args } = ruff.buildCommand('/tmp/project', null);
    assert.equal(bin, 'ruff');
    assert.ok(args.includes('check'));
    assert.ok(args.includes('--output-format'));
    assert.ok(args.includes('json'));
    assert.ok(args.includes('/tmp/project'));
    assert.ok(!args.includes('--config'));
    assert.ok(args.includes('--no-fix'));
  });

  it('builds correct command with config', () => {
    const { bin, args } = ruff.buildCommand('/tmp/project', '/etc/ruff.toml');
    assert.equal(bin, 'ruff');
    assert.ok(args.includes('--config'));
    assert.ok(args.includes('/etc/ruff.toml'));
  });

  it('builds command with --fix flag', () => {
    const { args } = ruff.buildCommand('/tmp/project', null, { fix: true });
    assert.ok(args.includes('--fix'));
    assert.ok(!args.includes('--no-fix'));
  });

  it('builds command with files list', () => {
    testBuildCommandWithFiles(ruff);
  });

  it('returns preFixCommands for ruff format', () => {
    const cmds = ruff.preFixCommands('/tmp/project', null, { files: [] });
    assert.equal(cmds.length, 1);
    assert.equal(cmds[0].bin, 'ruff');
    assert.ok(cmds[0].args.includes('format'));
    assert.ok(cmds[0].args.includes('/tmp/project'));
  });

  it('preFixCommands uses files when provided', () => {
    const cmds = ruff.preFixCommands('/tmp/project', '/etc/ruff.toml', { files: ['a.py'] });
    assert.ok(cmds[0].args.includes('a.py'));
    assert.ok(!cmds[0].args.includes('/tmp/project'));
    assert.ok(cmds[0].args.includes('--config'));
  });

  it('parses valid JSON output', () => {
    const stdout = JSON.stringify([
      {
        code: 'F401',
        message: '`os` imported but unused',
        filename: 'src/app.py',
        location: { row: 1, column: 1 },
        type: 'E',
      },
      {
        code: 'E302',
        message: 'Expected 2 blank lines, found 1',
        filename: 'src/app.py',
        location: { row: 15, column: 1 },
        type: 'W',
      },
      {
        code: 'S105',
        message: 'Possible hardcoded password',
        filename: 'src/auth.py',
        location: { row: 42, column: 5 },
        type: 'E',
      },
    ]);

    const findings = ruff.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 3);

    assert.equal(findings[0].file, 'src/app.py');
    assert.equal(findings[0].line, 1);
    assert.equal(findings[0].rule, 'F401');
    assert.equal(findings[0].tag, 'LINTER');
    assert.equal(findings[0].message, '`os` imported but unused');

    assert.equal(findings[1].tag, 'FORMAT');
    assert.equal(findings[2].tag, 'SECURITY');
  });

  it('returns empty array for clean output', () => {
    const findings = ruff.parseOutput('', '', 0);
    assert.deepEqual(findings, []);
  });

  it('throws on ruff error (exit code 2 with no stdout)', () => {
    assert.throws(
      () => ruff.parseOutput('', 'error: invalid config', 2),
      /ruff error/
    );
  });

  it('throws on unparseable output', () => {
    assert.throws(
      () => ruff.parseOutput('not json at all', '', 1),
      /failed to parse JSON/
    );
  });

  it('classifies rule codes correctly', () => {
    const make = (code) => JSON.stringify([{
      code, message: 'test', filename: 'f.py',
      location: { row: 1, column: 1 }, type: 'E',
    }]);

    assert.equal(ruff.parseOutput(make('S101'), '', 1)[0].tag, 'SECURITY');
    assert.equal(ruff.parseOutput(make('E501'), '', 1)[0].tag, 'FORMAT');
    assert.equal(ruff.parseOutput(make('W291'), '', 1)[0].tag, 'FORMAT');
    assert.equal(ruff.parseOutput(make('I001'), '', 1)[0].tag, 'FORMAT');
    assert.equal(ruff.parseOutput(make('SIM110'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(ruff.parseOutput(make('UP035'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(ruff.parseOutput(make('PERF401'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(ruff.parseOutput(make('C901'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(ruff.parseOutput(make('PLR0915'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(ruff.parseOutput(make('PLR0913'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(ruff.parseOutput(make('B006'), '', 1)[0].tag, 'BUG');
    assert.equal(ruff.parseOutput(make('F401'), '', 1)[0].tag, 'LINTER');

    // New rule families
    assert.equal(ruff.parseOutput(make('BLE001'), '', 1)[0].tag, 'BUG');
    assert.equal(ruff.parseOutput(make('A001'), '', 1)[0].tag, 'BUG');
    assert.equal(ruff.parseOutput(make('A003'), '', 1)[0].tag, 'BUG');
    assert.equal(ruff.parseOutput(make('RUF001'), '', 1)[0].tag, 'BUG');
    assert.equal(ruff.parseOutput(make('RUF012'), '', 1)[0].tag, 'BUG');
    assert.equal(ruff.parseOutput(make('ERA001'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(ruff.parseOutput(make('ARG001'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(ruff.parseOutput(make('ARG005'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(ruff.parseOutput(make('PTH100'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(ruff.parseOutput(make('PTH118'), '', 1)[0].tag, 'REFACTOR');

    // Documentation rules (pydocstyle)
    assert.equal(ruff.parseOutput(make('D101'), '', 1)[0].tag, 'DOCS');
    assert.equal(ruff.parseOutput(make('D103'), '', 1)[0].tag, 'DOCS');
    assert.equal(ruff.parseOutput(make('D205'), '', 1)[0].tag, 'DOCS');
  });

  it('checkInstalled returns boolean', async () => {
    const result = await ruff.checkInstalled();
    assert.equal(typeof result, 'boolean');
  });
});
