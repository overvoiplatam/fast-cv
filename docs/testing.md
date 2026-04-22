# Testing

## Quick Reference

```bash
npm test                                        # run all tests
node --test test/tools/eslint.test.js           # single file
node --test --test-name-pattern="ruff" test/tools/ruff.test.js  # single tool
```

## Test Files

### Core Framework

| File | Covers |
|------|--------|
| `test/config-resolver.test.js` | Config resolution chain: local → user → package → none |
| `test/pruner.test.js` | File discovery, language detection, ignore/only filtering |
| `test/normalizer.test.js` | Markdown report formatting, finding filtering, tool errors |
| `test/sarif.test.js` | SARIF 2.1.0 output, tag→level mapping, schema compliance |
| `test/precheck.test.js` | Tool installation checks, skip/warn behavior |
| `test/runner.test.js` | Sequential execution, optional timeout, spawn errors, verbose logging |
| `test/line-check.test.js` | Built-in file length checking, omit patterns |
| `test/git-changes.test.js` | Git-changed file detection, scope modes |
| `test/index.test.js` | Scan exit-code precedence |
| `test/install-script.test.js` | Full installer tool provisioning coverage |

### Tool Adapters

| File | Covers |
|------|--------|
| `test/tools/ruff.test.js` | Metadata, command building, JSON parsing, tag classification |
| `test/tools/eslint.test.js` | Metadata, command building, JSON parsing, security/sonarjs/jsdoc rules |
| `test/tools/semgrep.test.js` | Metadata, command building, JSON parsing, category mapping |
| `test/tools/bearer.test.js` | Metadata, JSON parsing, privacy tag |
| `test/tools/golangci-lint.test.js` | Metadata, command building, JSON parsing, linter/DOCS classification |
| `test/tools/jscpd.test.js` | Metadata, command building, JSON report parsing, temp dir |
| `test/tools/trivy.test.js` | Vuln/misconfig/secret/license parsing, severity mapping, cached/update DB command modes |
| `test/tools/mypy.test.js` | Metadata, JSONL parsing, error-only filter |
| `test/tools/typos.test.js` | Metadata, opt-in flag, JSONL parsing, corrections |
| `test/tools/vulture.test.js` | Metadata, line-based text parsing, confidence threshold |
| `test/tools/knip.test.js` | Metadata, direct command building, JSON parsing (files/exports/deps) |
| `test/tools/tsc.test.js` | Metadata, TypeScript error parsing |
| `test/tools/clippy.test.js` | Metadata, JSON Lines parsing, DOCS/BUG/REFACTOR classification |
| `test/tools/stylelint.test.js` | Metadata, CSS/SCSS linting, JSON parsing |
| `test/tools/sqlfluff.test.js` | Metadata, SQL linting, JSON parsing |
| `test/tools/docspec.test.js` | Adapter metadata, classifier, offset→line/col helper |
| `test/tools/docspec-runner.test.js` | End-to-end: parse → classify → validate → JSON Lines findings across fixtures |
| `test/tools/docspec-fix.test.js` | `--fix` whitelist: path-prefix and swagger-version quoting |
| `test/tools/docspec-refs.test.js` | Remote `$ref` resolver: timeout, size cap, allowlist, disabled, cache |
| `test/tools/spectral.test.js` | buildCommand, preFixCommands (redocly bundle), JSON parse |
| `test/tools/markdownlint.test.js` | buildCommand, stderr parse into findings, fix flag |
| `test/tools/vale.test.js` | buildCommand, JSON parse, severity mapping (suggestion → warning) |

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
