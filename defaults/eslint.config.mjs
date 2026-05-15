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
      "sonarjs/cognitive-complexity": ["warn", 20],
      // sonarjs v4 schema: { threshold } object, not a bare number
      "sonarjs/no-duplicate-string": ["warn", { threshold: 5 }],
      "sonarjs/max-switch-cases": ["warn", 10],
      "sonarjs/no-identical-functions": "warn",
      // Disabled: high false-positive rate, low signal.
      //   publicly-writable-directories flags every /tmp literal.
      "sonarjs/publicly-writable-directories": "off",
      //   no-os-command-from-path: bare PATH lookup is the correct way
      //   to invoke external CLIs (eslint, git, ruff, …).
      "sonarjs/no-os-command-from-path": "off",
      //   slow-regex / unsafe-regex: we own the regex patterns (matching
      //   our own tool output, not user input). DoS isn't in the threat
      //   model. Projects scanning user input should re-enable locally.
      "sonarjs/slow-regex": "off",
      "sonarjs/single-character-alternation": "off",
      "sonarjs/no-nested-template-literals": "off",
      "sonarjs/no-nested-conditional": "off",
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
      // Thresholds tuned to industry-common values (eslint's defaults are
      // quite tight); projects that want stricter checks can override.
      "complexity": ["warn", { "max": 20 }],
      "max-depth": ["warn", 4],
      "max-lines-per-function": ["warn", { "max": 150, "skipBlankLines": true, "skipComments": true }],
      "max-nested-callbacks": ["warn", 4],
    },
  },

  // ─── eslint-plugin-security ────────────────────────────────────────
  // Spread the recommended ruleset, then disable the rules that produce
  // mostly false positives in code-scanning and file-handling projects.
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
      // Off: fires on every fs call with a variable path. Any tool that
      // reads user-supplied files trips this on every line. No signal.
      "security/detect-non-literal-fs-filename": "off",
      // Off: false-positive heavy on legitimate object property access.
      "security/detect-object-injection": "off",
      // Off: fires when RegExp is built from a non-literal — fine for
      // configs and patterns loaded from disk.
      "security/detect-non-literal-regexp": "off",
      // Off: irrelevant for ESM; we don't use require() at all.
      "security/detect-non-literal-require": "off",
      // Off: ReDoS risk only matters when regex is applied to attacker-
      // controlled input. fast-cv-style tools regex their own output;
      // re-enable locally if scanning user-supplied strings.
      "security/detect-unsafe-regex": "off",
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
