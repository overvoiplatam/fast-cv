# Third-Party Notices

fast-cv is MIT-licensed. The following third-party material ships inside this
distribution; each item keeps its license terms intact. npm-installed
dependencies (commander, ignore, yaml) carry their own license files in
`node_modules` and are MIT/ISC — not repeated here.

## `defaults/vale-styles/proselint/`

Vale-compatible port of the [proselint](https://github.com/amperser/proselint)
prose linter rules, packaged by [errata-ai](https://github.com/errata-ai/proselint).

- License: **BSD-3-Clause** (full text in `defaults/vale-styles/proselint/README.md`)
- Copyright © 2014–2015, Jordan Suchow, Michael Pacer, and Lara A. Ross

## `defaults/vale-styles/write-good/`

Vale-compatible port of the [write-good](https://github.com/btford/write-good)
prose linter rules, packaged by [vale-cli](https://github.com/vale-cli/write-good).

- License: **MIT** (full text in `defaults/vale-styles/write-good/README.md`)
- Copyright © 2014 Brian Ford

## Optional ESLint extras (installed by install.sh `CONFIG_PEERS`, run as-is)

These are downloaded to the user's environment via npm and never redistributed
inside the fast-cv package or its tarball:

- `eslint-plugin-sonarjs` — [SonarSource](https://github.com/SonarSource/eslint-plugin-sonarjs) — **LGPL-3.0-only**
- `eslint-plugin-security` — [eslint-community](https://github.com/eslint-community/eslint-plugin-security) — **Apache-2.0**

Everything else fast-cv invokes (ruff, trivy, semgrep, golangci-lint, shellcheck,
vale, and the other toolchain binaries) is installed at runtime from upstream —
none of it is bundled, compiled into, or redistributed by fast-cv.
