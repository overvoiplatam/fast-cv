# Agents Guide

How AI agents should use and work on fast-cv.

## Using fast-cv for Validation

### Full scan

```bash
node bin/fast-cv.js .
# Exit 0 = clean, Exit 1 = findings, Exit 2 = precheck failed
```

### Scan only changed files (fastest feedback)

```bash
node bin/fast-cv.js --only "src/tools/ruff.js,src/runner.js" .
```

### Specific tools

```bash
node bin/fast-cv.js --tools=eslint .           # JS/TS only
node bin/fast-cv.js --tools=ruff,mypy .        # Python only
node bin/fast-cv.js --tools=eslint,semgrep .   # lint + SAST
```

### Auto-fix

```bash
node bin/fast-cv.js --fix .                    # fix all fixable
node bin/fast-cv.js --tools=eslint --fix .     # fix eslint only
```

### SARIF output

```bash
node bin/fast-cv.js --format sarif . > report.sarif
```

## Understanding Output

### Markdown format

```
- **[SECURITY]** `S101` Use of assert detected (line 42)
- **[LINTER]** `no-unused-vars` 'x' is defined but never used (line 10, col 5)
- **[DEPENDENCY]** `CVE-2024-1234` Vulnerable dependency: lodash@4.17.20... (line 1)
```

- **Tag** in brackets tells you the category — see [docs/tools.md](docs/tools.md)
- **Rule** in backticks is the tool-specific rule ID
- `error` severity tags: SECURITY, BUG, PRIVACY, SECRET, LICENSE
- `warning` severity tags: DEPENDENCY, INFRA, TYPE_ERROR, LINTER, REFACTOR, DOCS, TYPO, DEAD_CODE
- `note` severity tags: FORMAT, DUPLICATION

### Exit codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Clean | Continue |
| 1 | Findings | Fix issues, re-run |
| 2 | Precheck failed | Install missing tools or check directory |

## Self-Scanning This Project

fast-cv is a JS project. The relevant self-scan is:

```bash
node bin/fast-cv.js --tools=eslint .
```

This should always exit 0 on the main branch. Run it after any code changes.

## Adding a New Tool

1. **Create adapter** — `src/tools/<name>.js` (export: name, extensions, checkInstalled, buildCommand, parseOutput, installHint)
2. **Register** — Add import + entry in `src/tools/index.js`
3. **Write test** — `test/tools/<name>.test.js` following [docs/testing.md](docs/testing.md) contract pattern
4. **Ship config** (optional) — Add to `defaults/` + register in `src/config-resolver.js`
5. **Update docs** — Add row in [docs/tools.md](docs/tools.md)
6. **Verify** — `npm test` passes + self-scan clean

## Debugging

### Tool not running

1. Check extensions match: `tool.extensions` must include a detected language
2. Check opt-in: typos needs explicit `--tools=typos`
3. Check installed: `which <binary>` or `--auto-install` flag
4. Run with `-v` for verbose output: `node bin/fast-cv.js -v .`

### Parse errors

Tools log parse errors as `error` in the Tool Result. Check:
1. Tool output format matches expected (JSON, JSONL, or text)
2. `parseOutput()` handles the tool's exit code correctly
3. The tool binary version hasn't changed its output format

### Config not applied

Resolution order: local → `~/.config/fast-cv/defaults/` → `defaults/` → none.
Run with `-v` to see which config was resolved. Check:
1. Config file exists at expected path
2. File is readable (`fs.access` check)
3. Tool name matches `TOOL_CONFIG_FILES` key in `src/config-resolver.js`

### Timeout issues

Default: 120s per tool. Override with `--timeout <seconds>`.
Runner sends SIGTERM, waits 5s, then SIGKILL. If a tool consistently times out:
1. Use `--only` to reduce file count
2. Check if the tool has its own cache that needs warming
3. Increase timeout: `--timeout 300`
