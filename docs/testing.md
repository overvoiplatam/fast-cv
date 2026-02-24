# Testing

## Quick Reference

```bash
npm test                                        # run all tests
node --test test/tools/eslint.test.js           # single file
node --test --test-name-pattern="ruff" test/tools/ruff.test.js  # single tool
```

## Test Files

### Core Framework (6 files, ~1136 lines)

| File | Lines | Covers |
|------|------:|--------|
| `test/config-resolver.test.js` | 70 | Config resolution chain: local → user → package → none |
| `test/pruner.test.js` | 257 | File discovery, language detection, ignore/only filtering |
| `test/normalizer.test.js` | 265 | Markdown report formatting, finding filtering |
| `test/sarif.test.js` | 241 | SARIF 2.1.0 output, tag→level mapping, schema compliance |
| `test/precheck.test.js` | 72 | Tool installation checks, skip/warn behavior |
| `test/runner.test.js` | 231 | Parallel execution, timeout, spawn errors, command building |

### Tool Adapters (11 files, ~1353 lines)

| File | Lines | Covers |
|------|------:|--------|
| `test/tools/ruff.test.js` | 156 | Metadata, command building, JSON parsing, tag classification |
| `test/tools/eslint.test.js` | 133 | Metadata, command building, JSON parsing, security/sonarjs rules |
| `test/tools/semgrep.test.js` | 89 | Metadata, command building, JSON parsing, category mapping |
| `test/tools/bearer.test.js` | 97 | Metadata, JSON parsing, privacy tag |
| `test/tools/golangci-lint.test.js` | 95 | Metadata, command building, JSON parsing, linter classification |
| `test/tools/jscpd.test.js` | 121 | Metadata, command building, JSON report parsing, temp dir |
| `test/tools/trivy.test.js` | 236 | Vuln/misconfig/secret/license parsing, severity mapping |
| `test/tools/mypy.test.js` | 101 | Metadata, JSONL parsing, error-only filter |
| `test/tools/typos.test.js` | 105 | Metadata, opt-in flag, JSONL parsing, corrections |
| `test/tools/vulture.test.js` | 78 | Metadata, line-based text parsing, confidence threshold |
| `test/tools/knip.test.js` | 142 | Metadata, opt-in flag, JSON parsing (files/exports/deps) |

## Contract Test Pattern

Standard structure for tool adapter tests:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import tool from '../../src/tools/<name>.js';

describe('<name> adapter', () => {
  // 1. Metadata
  it('has correct metadata', () => {
    assert.equal(tool.name, '<name>');
    assert.ok(tool.extensions.includes('.<ext>'));
    assert.ok(tool.installHint);
  });

  // 2. Command building
  it('builds command with defaults', () => {
    const cmd = tool.buildCommand('/project', null);
    assert.equal(cmd.bin, '<binary>');
    assert.ok(cmd.args.includes('--expected-flag'));
  });

  it('builds command with config', () => {
    const cmd = tool.buildCommand('/project', '/path/to/config');
    assert.ok(cmd.args.some(a => a.includes('/path/to/config')));
  });

  // 3. Output parsing
  it('parses findings from stdout', () => {
    const stdout = JSON.stringify(/* tool-specific output */);
    const findings = tool.parseOutput(stdout, '', 1);
    assert.ok(findings.length > 0);
    assert.equal(findings[0].tag, 'EXPECTED_TAG');
    assert.ok(findings[0].file);
    assert.ok(findings[0].line);
    assert.ok(findings[0].rule);
    assert.ok(findings[0].message);
  });

  // 4. Empty output
  it('returns empty array for clean run', () => {
    const findings = tool.parseOutput('', '', 0);
    assert.deepEqual(findings, []);
  });
});
```

## Key Conventions

- **Framework**: `node:test` (built-in) — no Jest, Mocha, or other test runners
- **Assertions**: `node:assert/strict` — `equal`, `deepEqual`, `ok`, `throws`
- **No real binaries**: Tests call `parseOutput()` and `buildCommand()` directly with mock data
- **Temp dirs**: Use `mkdtemp(join(tmpdir(), 'fcv-'))` with `after()` cleanup via `rm()`
- **No mocking library**: Direct function calls with crafted JSON strings
- **Exit codes**: `parseOutput(stdout, stderr, exitCode)` — 0/1 normal, 2+ error

## Adding a Test

1. Create `test/tools/<name>.test.js` following the contract pattern above
2. Test metadata (name, extensions, installHint, optIn if applicable)
3. Test `buildCommand()` — default args, with config, with files, with fix (if supported)
4. Test `parseOutput()` — normal output, empty output, error cases
5. Test tag classification — verify correct tag assignment for different rule types
6. Run: `node --test test/tools/<name>.test.js`
7. Run full suite: `npm test`
