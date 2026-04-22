import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDocspec } from '../../src/tools/docspec/runner.js';
import { collectRemoteRefs, resolveRemoteRefs } from '../../src/tools/docspec/refs.js';

describe('docspec remote refs', () => {
  let server;
  let port;
  let tmp;
  let configPath;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'fcv-refs-'));
    server = createServer((req, res) => {
      if (req.url === '/ok.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"type":"object"}');
      } else if (req.url === '/slow') {
        setTimeout(() => {
          res.writeHead(200);
          res.end('{}');
        }, 500);
      } else if (req.url === '/big') {
        res.writeHead(200);
        res.end('x'.repeat(2_000_000));
      } else {
        res.writeHead(404);
        res.end('nope');
      }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    configPath = join(tmp, 'docspec.json');
  });

  after(() => {
    server.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('collectRemoteRefs finds http(s) refs', () => {
    const doc = { $ref: 'http://a/x', nested: { $ref: 'https://b/y' }, items: [{ $ref: '#/local' }] };
    const refs = collectRemoteRefs(doc);
    assert.ok(refs.includes('http://a/x'));
    assert.ok(refs.includes('https://b/y'));
    assert.ok(!refs.includes('#/local'));
  });

  it('resolveRemoteRefs honors timeout', async () => {
    const results = await resolveRemoteRefs(
      [`http://127.0.0.1:${port}/slow`],
      { remoteRefs: { enabled: true, timeoutMs: 100, maxFetchesPerFile: 10, cacheDir: join(tmp, 'c1') } },
    );
    assert.ok(results.unreachable.has(`http://127.0.0.1:${port}/slow`));
  });

  it('resolveRemoteRefs honors size cap', async () => {
    const results = await resolveRemoteRefs(
      [`http://127.0.0.1:${port}/big`],
      { remoteRefs: { enabled: true, timeoutMs: 5000, maxResponseBytes: 1024, maxFetchesPerFile: 10, cacheDir: join(tmp, 'c2') } },
    );
    assert.ok(results.unreachable.has(`http://127.0.0.1:${port}/big`));
  });

  it('resolveRemoteRefs fetches 200 successfully', async () => {
    const results = await resolveRemoteRefs(
      [`http://127.0.0.1:${port}/ok.json`],
      { remoteRefs: { enabled: true, timeoutMs: 5000, maxResponseBytes: 1048576, maxFetchesPerFile: 10, cacheDir: join(tmp, 'c3') } },
    );
    assert.equal(results.resolved.get(`http://127.0.0.1:${port}/ok.json`), '{"type":"object"}');
  });

  it('resolveRemoteRefs marks blocked when not in allowlist', async () => {
    const results = await resolveRemoteRefs(
      [`http://127.0.0.1:${port}/ok.json`],
      { remoteRefs: { enabled: true, allowlist: ['https://only-this/'], timeoutMs: 5000, maxFetchesPerFile: 10, cacheDir: join(tmp, 'c4') } },
    );
    assert.ok(results.blocked.has(`http://127.0.0.1:${port}/ok.json`));
  });

  it('resolveRemoteRefs marks disabled when enabled=false', async () => {
    const results = await resolveRemoteRefs(
      [`http://127.0.0.1:${port}/ok.json`],
      { remoteRefs: { enabled: false, cacheDir: join(tmp, 'c5') } },
    );
    assert.ok(results.disabled.has(`http://127.0.0.1:${port}/ok.json`));
  });

  it('runner emits remote-ref-unreachable for failed remote ref', async () => {
    const specPath = join(tmp, 'spec.yaml');
    writeFileSync(specPath, [
      'openapi: 3.0.3',
      'info:',
      '  title: T',
      '  version: "1"',
      'paths:',
      '  /x:',
      '    get:',
      '      responses:',
      '        "200":',
      '          description: OK',
      '          content:',
      '            application/json:',
      '              schema:',
      `                $ref: "http://127.0.0.1:${port}/not-here.json"`,
      '',
    ].join('\n'));

    writeFileSync(configPath, JSON.stringify({
      remoteRefs: { enabled: true, timeoutMs: 500, maxFetchesPerFile: 5, cacheDir: join(tmp, 'c6') },
    }));

    const findings = await runDocspec({ files: [specPath], configPath });
    assert.ok(findings.find(f => f.rule === 'openapi/remote-ref-unreachable'),
      `expected openapi/remote-ref-unreachable:\n${JSON.stringify(findings, null, 2)}`);
  });
});
