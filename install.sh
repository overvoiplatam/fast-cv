#!/usr/bin/env bash
set -euo pipefail

# fast-cv installer — idempotent, supports both git clone and curl pipe
# Usage:
#   From repo:  ./install.sh [--mode all|app|configs]
#   One-liner:  curl -sfL https://raw.githubusercontent.com/overvoiplatam/fast-cv/main/install.sh | bash

REPO_URL="https://github.com/overvoiplatam/fast-cv.git"
INSTALL_DIR="${HOME}/.local/share/fast-cv"
CONFIG_DIR="${HOME}/.config/fast-cv/defaults"
LOCAL_BIN="${HOME}/.local/bin"

# Colors (disabled if NO_COLOR is set)
if [[ -z "${NO_COLOR:-}" ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' BOLD='' NC=''
fi

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

# ─── Helper: install a global npm package (user → sudo fallback) ───
install_npm_global() {
  local pkg="$*"
  if npm install -g ${pkg} 2>/dev/null; then
    return 0
  fi
  warn "npm install -g failed (permissions?) — retrying with sudo..."
  if sudo npm install -g ${pkg} 2>/dev/null; then
    return 0
  fi
  return 1
}

# ─── Helper: install a Python CLI tool (pip → pipx → uv fallback) ───
install_python_tool() {
  local tool="$1"
  # Try pipx first (PEP 668 compliant, isolated venvs)
  if command -v pipx &>/dev/null; then
    info "Installing ${tool} via pipx..."
    pipx install "${tool}" && return 0
  fi
  # Try uv tool install (fast, isolated)
  if command -v uv &>/dev/null; then
    info "Installing ${tool} via uv..."
    uv tool install "${tool}" && return 0
  fi
  # Try pip with --user
  info "Installing ${tool} via pip3 --user..."
  pip3 install --user "${tool}" 2>/dev/null && return 0
  # Try pip with --break-system-packages as last resort
  info "Retrying ${tool} with --break-system-packages..."
  pip3 install --user --break-system-packages "${tool}" 2>/dev/null && return 0
  return 1
}

# ─── Parse arguments ────────────────────────────────────────────────
INSTALL_MODE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      INSTALL_MODE="$2"
      shift 2
      ;;
    --mode=*)
      INSTALL_MODE="${1#*=}"
      shift
      ;;
    -h|--help)
      echo "fast-cv installer"
      echo ""
      echo "Usage: ./install.sh [--mode MODE]"
      echo ""
      echo "Modes:"
      echo "  all       Full install: app + tools + configs (default for fresh install)"
      echo "  app       Reinstall application only (npm deps + global link)"
      echo "  configs   Reinstall default configurations only (overwrites existing)"
      echo ""
      echo "On reinstall, if no --mode is given, you will be prompted to choose."
      exit 0
      ;;
    *)
      warn "Unknown argument: $1"
      shift
      ;;
  esac
done

# ─── Step 1: Determine if inside repo or standalone ──────────────────
SCRIPT_DIR=""
if [[ -f "./package.json" ]] && grep -q '"fast-cv"' "./package.json" 2>/dev/null; then
  SCRIPT_DIR="$(pwd)"
  info "Running from inside fast-cv repo: ${SCRIPT_DIR}"
elif [[ -n "${BASH_SOURCE[0]:-}" ]] && [[ -f "$(dirname "${BASH_SOURCE[0]}")/package.json" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  info "Running from repo directory: ${SCRIPT_DIR}"
else
  # Standalone mode (curl pipe) — clone the repo
  info "Standalone mode — cloning fast-cv to ${INSTALL_DIR}"
  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    info "Existing installation found, pulling latest..."
    git -C "${INSTALL_DIR}" pull --ff-only || warn "Pull failed, using existing version"
  else
    mkdir -p "$(dirname "${INSTALL_DIR}")"
    git clone "${REPO_URL}" "${INSTALL_DIR}"
  fi
  SCRIPT_DIR="${INSTALL_DIR}"
fi

# ─── Step 1b: Detect previous installation and prompt if needed ──────
PREV_VERSION=""
if command -v fast-cv &>/dev/null; then
  PREV_VERSION="$(fast-cv --version 2>/dev/null || echo 'unknown')"
fi

CURRENT_VERSION="$(node -e "import('${SCRIPT_DIR}/package.json', {with:{type:'json'}}).then(m=>console.log(m.default.version))" 2>/dev/null || echo 'unknown')"

if [[ -n "${PREV_VERSION}" ]] && [[ -z "${INSTALL_MODE}" ]]; then
  echo ""
  echo -e "${BOLD}Previous installation detected:${NC} fast-cv v${PREV_VERSION}"
  echo -e "${BOLD}New version:${NC} v${CURRENT_VERSION}"
  echo ""
  echo "What would you like to do?"
  echo ""
  echo "  1) Reinstall everything (app + tools + configs)"
  echo "  2) Reinstall application only (npm deps + global link)"
  echo "  3) Reinstall default configs only (overwrites existing)"
  echo "  4) Cancel"
  echo ""
  read -rp "Choose [1-4] (default: 1): " choice
  case "${choice}" in
    1|"") INSTALL_MODE="all" ;;
    2)    INSTALL_MODE="app" ;;
    3)    INSTALL_MODE="configs" ;;
    4)    info "Installation cancelled."; exit 0 ;;
    *)    fail "Invalid choice: ${choice}" ;;
  esac
  echo ""
fi

# Default to full install for fresh installations
if [[ -z "${INSTALL_MODE}" ]]; then
  INSTALL_MODE="all"
fi

info "Install mode: ${INSTALL_MODE}"

# ─── Step 2: Detect OS ──────────────────────────────────────────────
OS="$(uname -s)"
case "${OS}" in
  Linux)  info "Detected OS: Linux" ;;
  Darwin) info "Detected OS: macOS" ;;
  *)      fail "Unsupported OS: ${OS}. Only Linux and macOS are supported." ;;
esac

# ─── Step 3: Check core prerequisites ───────────────────────────────
check_cmd() {
  if command -v "$1" &>/dev/null; then
    ok "$1 found: $(command -v "$1")"
    return 0
  else
    return 1
  fi
}

MISSING_CORE=()

info "Checking core prerequisites..."
check_cmd "node" || MISSING_CORE+=("node (>= 20) — install via https://nodejs.org or nvm")
check_cmd "npm" || MISSING_CORE+=("npm — comes with Node.js")
check_cmd "git" || MISSING_CORE+=("git — install via your package manager")

# Only check python/curl for full installs
if [[ "${INSTALL_MODE}" == "all" ]]; then
  check_cmd "python3" || MISSING_CORE+=("python3 — install via your package manager")
  check_cmd "curl" || MISSING_CORE+=("curl — install via your package manager")
fi

if [[ ${#MISSING_CORE[@]} -gt 0 ]]; then
  echo ""
  fail "Missing core prerequisites:\n$(printf '  - %s\n' "${MISSING_CORE[@]}")\n\nPlease install them and re-run this script."
fi

# Check Node version >= 20
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "${NODE_VERSION}" -lt 20 ]]; then
  fail "Node.js >= 20 required, found v$(node -v). Please upgrade."
fi
ok "Node.js v$(node -v) meets minimum requirement (>= 20)"

# ─── Step 4: Install tool dependencies (only in 'all' mode) ─────────
if [[ "${INSTALL_MODE}" == "all" ]]; then
  mkdir -p "${LOCAL_BIN}"
  info "Installing tool dependencies..."

  # ruff (Python)
  if command -v ruff &>/dev/null; then
    ok "ruff already installed: $(ruff --version)"
  else
    install_python_tool ruff && ok "ruff installed" || warn "Failed to install ruff"
  fi

  # semgrep (Python)
  if command -v semgrep &>/dev/null; then
    ok "semgrep already installed: $(semgrep --version 2>/dev/null || echo 'version unknown')"
  else
    install_python_tool semgrep && ok "semgrep installed" || warn "Failed to install semgrep"
  fi

  # eslint + plugins (Node — global install with sudo fallback)
  if command -v eslint &>/dev/null; then
    ok "eslint already installed: $(eslint --version)"
  else
    info "Installing eslint..."
    install_npm_global eslint \
      && ok "eslint installed" \
      || warn "Failed to install eslint"
  fi

  # eslint plugins — always ensure they're installed (even if eslint was already present)
  ESLINT_PLUGINS="eslint-plugin-sonarjs eslint-plugin-security typescript-eslint eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-vue eslint-plugin-svelte eslint-plugin-jsonc"
  info "Ensuring eslint plugins are installed..."
  install_npm_global ${ESLINT_PLUGINS} \
    && ok "eslint plugins installed" \
    || warn "Failed to install some eslint plugins (eslint will degrade gracefully)"

  # jscpd (Node — code duplication detector)
  if command -v jscpd &>/dev/null; then
    ok "jscpd already installed: $(jscpd --version 2>/dev/null || echo 'version unknown')"
  else
    info "Installing jscpd..."
    install_npm_global jscpd \
      && ok "jscpd installed" \
      || warn "Failed to install jscpd"
  fi

  # bearer (binary)
  if command -v bearer &>/dev/null; then
    ok "bearer already installed"
  else
    info "Installing bearer..."
    if curl -sfL https://raw.githubusercontent.com/Bearer/bearer/main/contrib/install.sh | sh -s -- -b "${LOCAL_BIN}" 2>/dev/null; then
      ok "bearer installed to ${LOCAL_BIN}"
    else
      warn "Failed to install bearer — you can install it manually later"
    fi
  fi

  # golangci-lint (binary)
  if command -v golangci-lint &>/dev/null; then
    ok "golangci-lint already installed: $(golangci-lint --version 2>/dev/null | head -1)"
  else
    info "Installing golangci-lint..."
    if curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b "${LOCAL_BIN}" 2>/dev/null; then
      ok "golangci-lint installed to ${LOCAL_BIN}"
    else
      warn "Failed to install golangci-lint — you can install it manually later"
    fi
  fi

  # trivy (binary)
  if command -v trivy &>/dev/null; then
    ok "trivy already installed: $(trivy --version 2>/dev/null | head -1)"
  else
    info "Installing trivy..."
    if curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b "${LOCAL_BIN}" 2>/dev/null; then
      ok "trivy installed to ${LOCAL_BIN}"
    else
      warn "Failed to install trivy — you can install it manually later"
    fi
  fi

  # mypy (Python)
  if command -v mypy &>/dev/null; then
    ok "mypy already installed: $(mypy --version)"
  else
    install_python_tool mypy && ok "mypy installed" || warn "Failed to install mypy"
  fi

  # vulture (Python dead code detector)
  if command -v vulture &>/dev/null; then
    ok "vulture already installed: $(vulture --version 2>/dev/null || echo 'version unknown')"
  else
    install_python_tool vulture && ok "vulture installed" || warn "Failed to install vulture"
  fi

  # stylelint (Node — CSS linter)
  if command -v stylelint &>/dev/null; then
    ok "stylelint already installed: $(stylelint --version 2>/dev/null || echo 'version unknown')"
  else
    info "Installing stylelint + stylelint-config-standard..."
    install_npm_global stylelint stylelint-config-standard \
      && ok "stylelint installed" \
      || warn "Failed to install stylelint"
  fi

  # sqlfluff (Python — SQL linter)
  if command -v sqlfluff &>/dev/null; then
    ok "sqlfluff already installed: $(sqlfluff version 2>/dev/null || echo 'version unknown')"
  else
    install_python_tool sqlfluff && ok "sqlfluff installed" || warn "Failed to install sqlfluff"
  fi

  # typos (Rust binary — try cargo, then pre-built binary)
  if command -v typos &>/dev/null; then
    ok "typos already installed: $(typos --version 2>/dev/null)"
  else
    info "Installing typos-cli..."
    TYPOS_INSTALLED=false
    # Try cargo first
    if command -v cargo &>/dev/null; then
      cargo install typos-cli 2>/dev/null && TYPOS_INSTALLED=true
    fi
    # Fallback: download pre-built binary from GitHub
    if [[ "${TYPOS_INSTALLED}" == "false" ]]; then
      info "Downloading typos pre-built binary..."
      TYPOS_ARCH="$(uname -m)"
      case "${OS}" in
        Linux)  TYPOS_TARGET="${TYPOS_ARCH}-unknown-linux-musl" ;;
        Darwin) TYPOS_TARGET="${TYPOS_ARCH}-apple-darwin" ;;
      esac
      TYPOS_URL="$(curl -sfL https://api.github.com/repos/crate-ci/typos/releases/latest \
        | grep "browser_download_url.*${TYPOS_TARGET}.*tar.gz\"" \
        | head -1 | cut -d '"' -f 4)"
      if [[ -n "${TYPOS_URL}" ]]; then
        curl -sfL "${TYPOS_URL}" | tar xz -C "${LOCAL_BIN}" --strip-components=0 ./typos 2>/dev/null && TYPOS_INSTALLED=true
      fi
    fi
    if [[ "${TYPOS_INSTALLED}" == "true" ]]; then
      ok "typos installed"
    else
      warn "Failed to install typos — install manually: cargo install typos-cli"
    fi
  fi
else
  info "Skipping tool dependencies (mode: ${INSTALL_MODE})"
fi

# ─── Step 5: Copy default configs ───────────────────────────────────
if [[ "${INSTALL_MODE}" == "all" || "${INSTALL_MODE}" == "configs" ]]; then
  info "Setting up default configs..."
  mkdir -p "${CONFIG_DIR}"

  OVERWRITE="false"
  if [[ "${INSTALL_MODE}" == "configs" ]]; then
    OVERWRITE="true"
    info "Overwriting existing config files (configs mode)"
  fi

  for f in "${SCRIPT_DIR}"/defaults/*; do
    fname="$(basename "$f")"
    dest="${CONFIG_DIR}/${fname}"
    if [[ -d "$f" ]]; then
      # Directory (e.g. semgrep/) — recursive copy
      if [[ -d "${dest}" ]] && [[ "${OVERWRITE}" == "false" ]]; then
        ok "Config dir ${fname}/ already exists, skipping"
      else
        cp -r "$f" "${dest}"
        ok "Copied ${fname}/ to ${CONFIG_DIR}/"
      fi
    elif [[ -f "${dest}" ]] && [[ "${OVERWRITE}" == "false" ]]; then
      ok "Config ${fname} already exists, skipping"
    else
      cp "$f" "${dest}"
      ok "Copied ${fname} to ${CONFIG_DIR}/"
    fi
  done

  # Download OWASP Top 10 semgrep rules for offline scanning
  SEMGREP_DIR="${CONFIG_DIR}/semgrep"
  mkdir -p "${SEMGREP_DIR}"
  OWASP_DEST="${SEMGREP_DIR}/owasp-top-ten.yaml"
  if [[ -f "${OWASP_DEST}" ]] && [[ "${OVERWRITE}" == "false" ]]; then
    ok "OWASP semgrep rules already downloaded"
  else
    info "Downloading OWASP Top 10 semgrep rules (543 rules, offline after this)..."
    if curl -sfL "https://semgrep.dev/c/p/owasp-top-ten" -o "${OWASP_DEST}" 2>/dev/null; then
      RULE_COUNT=$(grep -c '^- id:' "${OWASP_DEST}" 2>/dev/null || echo '?')
      ok "OWASP rules downloaded (${RULE_COUNT} rules) to ${SEMGREP_DIR}/"
    else
      warn "Failed to download OWASP rules — semgrep will use custom taint rules only"
    fi
  fi
else
  info "Skipping config files (mode: ${INSTALL_MODE})"
fi

# ─── Step 6: Install npm dependencies + create global command ───────
if [[ "${INSTALL_MODE}" == "all" || "${INSTALL_MODE}" == "app" ]]; then
  info "Installing npm dependencies..."
  cd "${SCRIPT_DIR}"
  npm install && ok "npm dependencies installed"

  # Create global command via symlink in ~/.local/bin (no sudo needed)
  info "Linking fast-cv to ${LOCAL_BIN}/fast-cv..."
  mkdir -p "${LOCAL_BIN}"
  ln -sf "${SCRIPT_DIR}/bin/fast-cv.js" "${LOCAL_BIN}/fast-cv"
  ok "fast-cv linked to ${LOCAL_BIN}/fast-cv"
else
  info "Skipping npm install/link (mode: ${INSTALL_MODE})"
fi

# ─── Step 7: Verify ─────────────────────────────────────────────────
echo ""
if command -v fast-cv &>/dev/null; then
  ok "Installation complete! fast-cv $(fast-cv --version) is ready."
else
  warn "fast-cv command not found in PATH. You may need to restart your shell."
fi

# PATH warning
if [[ ":${PATH}:" != *":${LOCAL_BIN}:"* ]]; then
  echo ""
  warn "${LOCAL_BIN} is not in your PATH."
  echo "  Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
  echo "    export PATH=\"\${HOME}/.local/bin:\${PATH}\""
fi

echo ""
info "Usage: fast-cv [directory]"
info "Run 'fast-cv --help' for options."
