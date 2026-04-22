import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import docspec from '../../src/tools/docspec.js';
import { classify } from '../../src/tools/docspec/classify.js';
import { offsetToLineCol, buildLineIndex } from '../../src/tools/docspec/offset-to-linecol.js';

describe('docspec adapter', () => {
  it('has correct metadata', () => {
    assert.equal(docspec.name, 'docspec');
    assert.deepEqual(docspec.extensions, ['.yaml', '.yml', '.json']);
    assert.equal(docspec.supportsFix, true);
    assert.ok(docspec.installHint.includes('Node'));
  });

  it('checkInstalled returns true', async () => {
    assert.equal(await docspec.checkInstalled(), true);
  });

  it('buildCommand with files', () => {
    const { bin, args, cwd } = docspec.buildCommand('/p', null, { files: ['a.yaml', 'b.json'] });
    assert.equal(bin, process.execPath);
    assert.ok(args[0].endsWith('runner.js'));
    assert.ok(args.includes('--files'));
    assert.ok(args.includes('a.yaml'));
    assert.ok(args.includes('b.json'));
    assert.equal(cwd, '/p');
  });

  it('buildCommand without files falls back to --target', () => {
    const { args } = docspec.buildCommand('/p', null, { files: [] });
    assert.ok(args.includes('--target'));
    assert.ok(args.includes('/p'));
  });

  it('buildCommand with config', () => {
    const { args } = docspec.buildCommand('/p', '/etc/docspec.json', { files: ['x.yaml'] });
    assert.ok(args.includes('--config'));
    assert.ok(args.includes('/etc/docspec.json'));
  });

  it('buildCommand with fix', () => {
    const { args } = docspec.buildCommand('/p', null, { files: ['x.yaml'], fix: true });
    assert.ok(args.includes('--fix'));
  });

  it('parseOutput parses JSON Lines', () => {
    const stdout = JSON.stringify({ file: 'a.yaml', line: 5, col: 3, tag: 'DOCS', rule: 'openapi/path-prefix', severity: 'error', message: 'x' }) + '\n';
    const findings = docspec.parseOutput(stdout, '', 0);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'openapi/path-prefix');
  });

  it('parseOutput throws on fatal exit with no stdout', () => {
    assert.throws(() => docspec.parseOutput('', 'boom', 2));
  });

  it('parseOutput returns empty on clean exit', () => {
    assert.deepEqual(docspec.parseOutput('', '', 0), []);
  });
});

describe('docspec classifier', () => {
  it('identifies OpenAPI 3.x', () => {
    assert.equal(classify({ openapi: '3.0.3', info: { title: 't', version: '1' } }, 'x.yaml'), 'openapi');
    assert.equal(classify({ openapi: '3.1.0', info: { title: 't', version: '1' } }, 'x.yaml'), 'openapi');
  });

  it('rejects bad OpenAPI version', () => {
    assert.equal(classify({ openapi: '2.0', info: {} }, 'x.yaml'), null);
    assert.equal(classify({ openapi: 3, info: {} }, 'x.yaml'), null);
  });

  it('identifies Swagger 2.0 (quoted or unquoted)', () => {
    assert.equal(classify({ swagger: '2.0', info: { title: 't', version: '1' } }, 'x.yaml'), 'swagger');
    assert.equal(classify({ swagger: 2, info: { title: 't', version: '1' } }, 'x.yaml'), 'swagger');
  });

  it('identifies AsyncAPI', () => {
    assert.equal(classify({ asyncapi: '2.6.0', info: {} }, 'x.yaml'), 'asyncapi');
    assert.equal(classify({ asyncapi: '3.0.0', info: {} }, 'x.yaml'), 'asyncapi');
  });

  it('identifies JSON Schema via $schema', () => {
    assert.equal(classify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' }, 'x.json'), 'jsonschema');
  });

  it('identifies JSON Schema via filename', () => {
    assert.equal(classify({ type: 'object', properties: {} }, '/p/user.schema.json'), 'jsonschema');
  });

  it('ignores plain objects that have none of the signals', () => {
    assert.equal(classify({ name: 'CI', on: ['push'] }, '.github/workflows/ci.yml'), null);
    assert.equal(classify({ dependencies: {} }, 'package.json'), null);
    assert.equal(classify({ version: '3.8', services: {} }, 'docker-compose.yml'), null);
  });

  it('rejects null, arrays, primitives', () => {
    assert.equal(classify(null, 'x.yaml'), null);
    assert.equal(classify([], 'x.yaml'), null);
    assert.equal(classify('hi', 'x.yaml'), null);
  });
});

describe('offsetToLineCol', () => {
  it('maps offsets to line/col', () => {
    const src = 'abc\ndef\nghi';
    const idx = buildLineIndex(src);
    assert.deepEqual(offsetToLineCol(idx, 0), { line: 1, col: 1 });
    assert.deepEqual(offsetToLineCol(idx, 2), { line: 1, col: 3 });
    assert.deepEqual(offsetToLineCol(idx, 4), { line: 2, col: 1 });
    assert.deepEqual(offsetToLineCol(idx, 8), { line: 3, col: 1 });
    assert.deepEqual(offsetToLineCol(idx, 10), { line: 3, col: 3 });
  });

  it('handles negative offsets safely', () => {
    const idx = buildLineIndex('abc');
    assert.deepEqual(offsetToLineCol(idx, -1), { line: 1, col: 1 });
  });
});
