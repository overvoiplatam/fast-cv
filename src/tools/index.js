// Tool registry — exports all tool adapters
import ruff from './ruff.js';
import eslint from './eslint.js';
import semgrep from './semgrep.js';
import bearer from './bearer.js';
import golangciLint from './golangci-lint.js';
import jscpd from './jscpd.js';
import trivy from './trivy.js';
import mypy from './mypy.js';
import typos from './typos.js';
import vulture from './vulture.js';
import knip from './knip.js';

export const tools = [ruff, eslint, semgrep, bearer, golangciLint, jscpd, trivy, mypy, typos, vulture, knip];
