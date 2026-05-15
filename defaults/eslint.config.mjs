// Resilient dynamic import — returns default export (with CJS interop) or null
async function tryImport(specifier) {
  try {
    const mod = await import(specifier);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

// ─── Load all plugins resiliently (graceful degradation if not installed) ───
const sonarjs = await tryImport("eslint-plugin-sonarjs");
const security = await tryImport("eslint-plugin-security");
const tseslint = await tryImport("typescript-eslint");
const react = await tryImport("eslint-plugin-react");
const reactHooks = await tryImport("eslint-plugin-react-hooks");
const vue = await tryImport("eslint-plugin-vue");
const svelte = await tryImport("eslint-plugin-svelte");
const jsonc = await tryImport("eslint-plugin-jsonc");
const jsdoc = await tryImport("eslint-plugin-jsdoc");

// When typescript-eslint isn't available, exclude TS files from patterns
// to avoid parse errors from the default JS parser
const jsFiles = ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.jsx"];
const tsFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
const codeFiles = tseslint ? [...jsFiles, ...tsFiles] : jsFiles;

const config = [
  // ─── sonarjs (recommended rules + project overrides) ───────────────
  // Register the plugin once. ESLint 10+ rejects duplicate plugin
  // declarations, so we cannot also spread sonarjs.configs.recommended
  // (which registers `plugins: { sonarjs }`) AND register the plugin in
  // the base rules block — pick one home for the registration.
  ...(sonarjs ? [{
    files: codeFiles,
    plugins: { sonarjs },
    rules: {
      ...(sonarjs.configs?.recommended?.rules ?? {}),
      "sonarjs/cognitive-complexity": ["warn", 15],
      // sonarjs v4 schema: { threshold } object, not a bare number
      "sonarjs/no-duplicate-string": ["warn", { threshold: 3 }],
      "sonarjs/max-switch-cases": ["warn", 10],
      "sonarjs/no-identical-functions": "warn",
      // Disabled with audit-grade justification:
      //   no-os-command-from-path flags every `execFile("eslint", …)` /
      //   `execFile("git", …)` call. A tool orchestrator that runs other
      //   CLIs MUST resolve them via PATH (we don't know where users
      //   installed ruff/eslint/git on their machine). Hard-coding
      //   absolute paths would break the product. The threat model
      //   (attacker controls $PATH) requires shell-level compromise,
      //   which is out of scope — the tool runs with user privileges.
      "sonarjs/no-os-command-from-path": "off",
      //   publicly-writable-directories fires on every `/tmp` literal.
      //   In src/, fast-cv uses `mkdtemp(/tmp/fast-cv-XXXXXX)` (random
      //   suffix → race-free) for transient tool I/O — the documented-
      //   safe pattern. The rule cannot distinguish mkdtemp from raw
      //   `/tmp/static-name`, so it false-positives uniformly. Disabled
      //   project-wide; if a future change adds raw /tmp paths the
      //   security-review checklist (architecture.md) must catch it.
      "sonarjs/publicly-writable-directories": "off",
    },
  }] : []),

  // ─── Base rules (JS + TS) ──────────────────────────────────────────
  {
    files: codeFiles,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "no-proto": "error",
      "no-caller": "error",
      "no-extend-native": "error",
      // Standard convention: `_`-prefixed identifiers signal "intentionally
      // unused" (function args following an interface, catch params).
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      "no-unreachable": "error",
      // Thresholds set at industry-strict levels (sonarjs/eslint defaults).
      // Our own code is expected to pass these — refactor, don't relax.
      "complexity": ["warn", { "max": 15 }],
      "max-depth": ["warn", 4],
      "max-lines-per-function": ["warn", { "max": 100, "skipBlankLines": true, "skipComments": true }],
      "max-nested-callbacks": ["warn", 3],
    },
  },

  // ─── eslint-plugin-security ────────────────────────────────────────
  // Spread the recommended ruleset. Every disable below has an
  // audit-defensible justification documented inline — we do not
  // silence rules just to make the linter quiet.
  ...(security ? [{
    files: codeFiles,
    plugins: { security },
    rules: {
      ...(security.configs?.recommended?.rules ?? {
        "security/detect-buffer-noassert": "warn",
        "security/detect-child-process": "warn",
        "security/detect-disable-mustache-escape": "warn",
        "security/detect-eval-with-expression": "warn",
        "security/detect-new-buffer": "warn",
        "security/detect-no-csrf-before-method-override": "warn",
        "security/detect-non-literal-fs-filename": "warn",
        "security/detect-non-literal-regexp": "warn",
        "security/detect-non-literal-require": "warn",
        "security/detect-object-injection": "warn",
        "security/detect-possible-timing-attacks": "warn",
        "security/detect-pseudoRandomBytes": "warn",
        "security/detect-unsafe-regex": "warn",
      }),
      // Off: ESM-only project. require() is not used; rule is unreachable.
      "security/detect-non-literal-require": "off",
      // Off with audit-grade justification:
      //   detect-non-literal-fs-filename fires when an fs.* call receives
      //   a variable path. A code-scanning tool reads paths by design —
      //   every adapter (ruff, eslint, semgrep, …) calls fs against the
      //   user-supplied target directory.
      //
      //   Trust boundary: paths originate from one of three places:
      //     (1) the user's CLI argument (target dir + --exclude/--only),
      //     (2) the pruner walking that dir (gitignore/.fcvignore filtered),
      //     (3) shipped configs in defaults/ + user defaults in
      //         ~/.config/fast-cv/.
      //   The tool runs with the user's own privileges; there is no
      //   privilege boundary to cross. Path traversal is prevented at
      //   src/pruner.js by resolving entries against the target root.
      //
      //   Keeping the rule on would require 100+ per-line suppressions
      //   citing this same justification. Disabled globally; the trust
      //   boundary is documented in docs/architecture.md → Security.
      "security/detect-non-literal-fs-filename": "off",
    },
  }] : []),

  // ─── TypeScript (typescript-eslint) ────────────────────────────────
  ...(tseslint?.configs?.recommended
    ? tseslint.configs.recommended.map(c => ({
        ...c,
        files: c.files ?? ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
      }))
    : []),

  // ─── React (eslint-plugin-react + react-hooks) ────────────────────
  ...(react ? [{
    files: ["**/*.jsx", "**/*.tsx"],
    plugins: {
      react,
      ...(reactHooks ? { "react-hooks": reactHooks } : {}),
    },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...(react.configs?.recommended?.rules ?? {}),
      ...(reactHooks?.configs?.recommended?.rules ?? {}),
      "react/react-in-jsx-scope": "off",
    },
  }] : []),

  // ─── Vue (eslint-plugin-vue) ───────────────────────────────────────
  ...(vue?.configs?.["flat/recommended"] ?? []),

  // ─── Svelte (eslint-plugin-svelte) ─────────────────────────────────
  ...(svelte?.configs?.["flat/recommended"] ?? []),

  // ─── JSON (eslint-plugin-jsonc) ────────────────────────────────────
  ...(jsonc?.configs?.["flat/recommended-with-json"] ?? []),

  // ─── JSDoc (eslint-plugin-jsdoc) ──────────────────────────────────
  // require-jsdoc is opinionated — many projects deliberately keep
  // JSDoc sparse. We validate existing JSDoc (param names, tags, types)
  // but do NOT require it on every public function. Projects that want
  // mandatory JSDoc can re-enable it in their local config.
  ...(jsdoc ? [{
    files: codeFiles,
    plugins: { jsdoc },
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-description": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/valid-types": "warn",
      "jsdoc/check-param-names": "warn",
      "jsdoc/check-tag-names": "warn",
    },
  }] : []),

  // ─── Test-file relaxations ────────────────────────────────────────
  // Test files use long describe blocks, repeated literals (mock paths
  // like "/tmp/project"), and intentional complexity (parametric cases).
  // Don't apply the same length/duplication/complexity discipline as
  // production code.
  {
    files: ["**/*.test.js", "**/*.spec.js", "test/**/*.js"],
    rules: {
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
      "complexity": "off",
      "sonarjs/no-duplicate-string": "off",
      "sonarjs/cognitive-complexity": "off",
      "sonarjs/no-identical-functions": "off",
      // Tests legitimately use Math.random for fixture data and http URLs
      // in $ref-resolution fixtures; neither is a real security issue.
      "sonarjs/pseudo-random": "off",
      "sonarjs/no-clear-text-protocols": "off",
    },
  },
];

export default config;
