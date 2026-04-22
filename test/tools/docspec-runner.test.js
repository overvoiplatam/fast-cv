import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDocspec } from '../../src/tools/docspec/runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, '..', 'fixtures', 'docspec');

async function scan(name) {
  return await runDocspec({ files: [join(FIX, name)] });
}

describe('docspec runner (end-to-end via import)', () => {
  it('clean OpenAPI → 0 findings', async () => {
    const f = await scan('openapi-valid.yaml');
    assert.equal(f.length, 0);
  });

  it('OpenAPI missing info.version → info-required error', async () => {
    const f = await scan('openapi-missing-info.yaml');
    const rules = f.map(x => x.rule);
    assert.ok(rules.includes('openapi/info-required'));
    assert.ok(f.find(x => x.rule === 'openapi/info-required').severity === 'error');
  });

  it('OpenAPI path without leading slash → path-prefix error with correct line', async () => {
    const f = await scan('openapi-bad-path.yaml');
    const hit = f.find(x => x.rule === 'openapi/path-prefix');
    assert.ok(hit, 'expected openapi/path-prefix finding');
    assert.equal(hit.severity, 'error');
    assert.equal(hit.line, 6);
  });

  it('OpenAPI operation without responses → warning', async () => {
    const f = await scan('openapi-missing-responses.yaml');
    const hit = f.find(x => x.rule === 'openapi/operation-shape');
    assert.ok(hit);
    assert.equal(hit.severity, 'warning');
  });

  it('Swagger 2.0 valid → 0 findings', async () => {
    const f = await scan('swagger-valid.yaml');
    assert.equal(f.length, 0);
  });

  it('Swagger wrong version → version error', async () => {
    const f = await scan('swagger-wrong-version.yaml');
    assert.ok(f.find(x => x.rule === 'swagger/version' && x.severity === 'error'));
  });

  it('Swagger unquoted 2.0 is still classified but flags version error', async () => {
    const f = await scan('swagger-unquoted-version.yaml');
    assert.ok(f.find(x => x.rule === 'swagger/version' && x.severity === 'error'),
      'expected swagger/version error for unquoted 2.0');
  });

  it('AsyncAPI valid → 0 findings', async () => {
    const f = await scan('asyncapi-valid.yaml');
    assert.equal(f.length, 0);
  });

  it('AsyncAPI missing channels → error', async () => {
    const f = await scan('asyncapi-missing-channels.yaml');
    assert.ok(f.find(x => x.rule === 'asyncapi/channels-required' && x.severity === 'error'));
  });

  it('JSON Schema valid → 0 findings', async () => {
    const f = await scan('jsonschema-valid.json');
    assert.equal(f.length, 0);
  });

  it('JSON Schema with non-string type → type-value error', async () => {
    const f = await scan('jsonschema-bad-type.json');
    assert.ok(f.find(x => x.rule === 'jsonschema/type-value' && x.severity === 'error'));
  });

  it('malformed YAML → docspec/parse error', async () => {
    const f = await scan('malformed.yaml');
    assert.equal(f.length, 1);
    assert.equal(f[0].rule, 'docspec/parse');
    assert.equal(f[0].severity, 'error');
  });

  it('non-spec YAML (CI config) → 0 findings', async () => {
    const f = await scan('not-a-spec.yaml');
    assert.equal(f.length, 0);
  });

  it('emits tag DOCS for all findings', async () => {
    const f = await scan('openapi-bad-path.yaml');
    for (const item of f) assert.equal(item.tag, 'DOCS');
  });
});
