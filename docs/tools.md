# Tools

This is the **canonical source of truth** for fast-cv tool adapters and tags. Other docs reference here.

## Adapter Interface

Every tool adapter in `src/tools/*.js` exports this shape:

```javascript
export default {
  name: string,            // unique identifier
  extensions: string[],    // file extensions this tool handles (e.g. ['.py', '.pyi'])
  installHint: string,     // shell command to install the tool
  optIn: boolean,          // if true, only runs when explicitly listed in --tools

  async checkInstalled(): boolean,
  buildCommand(targetDir, configPath, options?): { bin, args, cwd? },
  parseOutput(stdout, stderr, exitCode): Finding[],

  // Optional
  preFixCommands?(targetDir, configPath, options?): { bin, args, cwd }[],
}
```

### buildCommand Options

| Option | Type | Used By |
|--------|------|---------|
| `files` | `string[]` | ruff, eslint, semgrep, bearer, mypy, typos, vulture, stylelint, sqlfluff |
| `fix` | `boolean` | ruff, eslint, golangci-lint, clippy, stylelint, sqlfluff |
| `licenses` | `boolean` | trivy |

## All Tools (15)

| # | Name | File | Extensions | Tags | Opt-In | Fix | Config |
|---|------|------|------------|------|--------|-----|--------|
| 1 | ruff | `src/tools/ruff.js` | `.py .pyi` | LINTER REFACTOR FORMAT DOCS BUG SECURITY | no | yes | ruff.toml |
| 2 | eslint | `src/tools/eslint.js` | `.js .jsx .ts .tsx .mjs .cjs .mts .cts .svelte .vue .json .jsonc` | LINTER SECURITY REFACTOR BUG | no | yes | eslint.config.mjs |
| 3 | semgrep | `src/tools/semgrep.js` | `.py .js .jsx .ts .tsx .go .java .rb .php .rs .c .h .cpp .hpp .cs .kt .kts .swift .scala` | SECURITY BUG | no | no | semgrep/ (dir) |
| 4 | bearer | `src/tools/bearer.js` | `.py .js .jsx .ts .tsx .go .java .rb .php` | PRIVACY | no | no | .bearer.yml |
| 5 | golangci-lint | `src/tools/golangci-lint.js` | `.go` | LINTER REFACTOR BUG SECURITY | no | yes | .golangci.yml |
| 6 | jscpd | `src/tools/jscpd.js` | all scannable | DUPLICATION | no | no | .jscpd.json |
| 7 | trivy | `src/tools/trivy.js` | `.py .js .ts .go .java .rb .php .tf .yaml .yml .rs .kt .kts .cs .c .cpp .swift .sql` | DEPENDENCY INFRA SECRET LICENSE | no | no | trivy.yaml |
| 8 | mypy | `src/tools/mypy.js` | `.py .pyi` | TYPE_ERROR | no | no | mypy.ini |
| 9 | typos | `src/tools/typos.js` | `.py .pyi .js .jsx .ts .tsx .go .java .rb .php .rs .c .cpp .h .cs .swift .kt .kts .sql .mts .cts .scala .sh .bash` | TYPO | **yes** | no | typos.toml |
| 10 | vulture | `src/tools/vulture.js` | `.py .pyi` | DEAD_CODE | no | no | — |
| 11 | knip | `src/tools/knip.js` | `.js .jsx .ts .tsx .mjs .cjs` | DEAD_CODE | no | no | — |
| 12 | tsc | `src/tools/tsc.js` | `.ts .tsx .mts .cts` | TYPE_ERROR | no | no | tsconfig.json |
| 13 | clippy | `src/tools/clippy.js` | `.rs` | LINTER BUG REFACTOR | no | yes | clippy.toml |
| 14 | stylelint | `src/tools/stylelint.js` | `.css .scss .sass .less` | LINTER FORMAT | no | yes | .stylelintrc.json |
| 15 | sqlfluff | `src/tools/sqlfluff.js` | `.sql` | LINTER FORMAT BUG | no | yes | — |

## Tag Reference

Tags categorize findings by type. Each tag maps to a SARIF severity level.

| Tag | SARIF Level | Meaning |
|-----|-------------|---------|
| SECURITY | error | Security vulnerabilities (SAST findings) |
| BUG | error | Likely bugs, correctness issues |
| PRIVACY | error | PII/data privacy violations |
| SECRET | error | Exposed secrets, API keys, tokens |
| LICENSE | error | License compliance violations |
| DEPENDENCY | warning | Vulnerable dependencies (CVEs) |
| INFRA | warning | Infrastructure misconfigurations |
| TYPE_ERROR | warning | Static type errors |
| LINTER | warning | Code quality / style violations |
| REFACTOR | warning | Complexity, cognitive load, maintainability |
| DOCS | warning | Missing or incomplete documentation |
| TYPO | warning | Spelling mistakes in identifiers/strings |
| DEAD_CODE | warning | Unused code, exports, dependencies |
| FORMAT | note | Formatting / whitespace issues |
| DUPLICATION | note | Copy-paste / code duplication |

Tag-to-level mapping is defined in `src/sarif.js` (L3-19).

## Adding a New Tool

1. **Create adapter** — `src/tools/<name>.js` exporting the interface above
2. **Register** — Add import + entry in `src/tools/index.js`
3. **Write tests** — `test/tools/<name>.test.js` (see [docs/testing.md](testing.md))
4. **Ship config** (optional) — Add default config to `defaults/` and register in `src/config-resolver.js` (`TOOL_CONFIG_FILES` + `PACKAGE_DEFAULT_FILES`)
5. **Update docs** — Add row to the tools table above
6. **Verify** — `npm test` + `node bin/fast-cv.js --tools=<name> <test-project>`
