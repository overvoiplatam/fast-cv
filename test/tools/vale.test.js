import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vale from '../../src/tools/vale.js';

describe('vale adapter', () => {
  it('has correct metadata', () => {
    assert.equal(vale.name, 'vale');
    assert.ok(vale.extensions.includes('.md'));
    assert.ok(vale.extensions.includes('.rst'));
    assert.ok(vale.extensions.includes('.adoc'));
    assert.ok(vale.installHint.includes('vale'));
  });

  it('buildCommand emits --output=JSON and target', () => {
    const { bin, args } = vale.buildCommand('/p', null);
    assert.equal(bin, 'vale');
    assert.ok(args.includes('--output=JSON'));
    assert.ok(args.includes('/p'));
  });

  it('buildCommand with config and files', () => {
    const { args } = vale.buildCommand('/p', '/etc/.vale.ini', { files: ['doc.md', 'guide.rst'] });
    assert.ok(args.includes('--config'));
    assert.ok(args.includes('/etc/.vale.ini'));
    assert.ok(args.includes('doc.md'));
    assert.ok(args.includes('guide.rst'));
  });

  it('parseOutput maps vale JSON to findings', () => {
    const stdout = JSON.stringify({
      'docs/intro.md': [
        { Check: 'write-good.Weasel', Line: 3, Span: [5, 12], Message: "'somewhat' is weasel", Severity: 'warning' },
        { Check: 'proselint.Typography', Line: 10, Span: [1, 1], Message: 'Bad quotes', Severity: 'error' },
      ],
      'docs/api.md': [
        { Check: 'write-good.Passive', Line: 1, Span: [1, 5], Message: "Passive voice", Severity: 'suggestion' },
      ],
    });
    const f = vale.parseOutput(stdout, '', 0);
    assert.equal(f.length, 3);
    const intro = f.filter(x => x.file === 'docs/intro.md');
    assert.equal(intro.length, 2);
    assert.equal(intro[0].rule, 'vale/write-good.Weasel');
    assert.equal(intro[0].tag, 'DOCS');
    assert.equal(intro[0].severity, 'warning');
    assert.equal(intro[0].line, 3);
    assert.equal(intro[0].col, 5);
    assert.equal(intro[1].severity, 'error');
    const api = f.find(x => x.file === 'docs/api.md');
    assert.equal(api.severity, 'warning'); // suggestion → warning
  });

  it('parseOutput returns empty on clean stdout', () => {
    assert.deepEqual(vale.parseOutput('', '', 0), []);
    assert.deepEqual(vale.parseOutput('{}', '', 0), []);
  });

  it('parseOutput throws on bad JSON', () => {
    assert.throws(() => vale.parseOutput('not json {', '', 0));
  });

  it('parseOutput throws actionable error on vale config error (E201) from stderr', () => {
    const stderr = JSON.stringify({
      Line: 1,
      Path: '/etc/.vale.ini',
      Text: "The path '/etc/vale-styles' does not exist.",
      Code: 'E201',
      Span: 14,
    });
    assert.throws(() => vale.parseOutput('', stderr, 2), /E201.*vale sync/);
  });

  it('checkInstalled returns boolean', async () => {
    const v = await vale.checkInstalled();
    assert.equal(typeof v, 'boolean');
  });
});
