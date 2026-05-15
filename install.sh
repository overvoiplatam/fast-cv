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

# Preserve the user's original PATH so the end-of-install hint reflects their shell config,
# not the in-script mutations below.
ORIG_PATH="${PATH}"

# Ensure binaries we just installed are discoverable for the rest of this script.
# Without this, `command -v vale` fails after `go install GOBIN=${LOCAL_BIN}` on
# machines where ~/.local/bin isn't already in PATH, and downstream steps silently skip.
mkdir -p "${LOCAL_BIN}"
case ":${PATH}:" in
  *":${LOCAL_BIN}:"*) ;;
  *) export PATH="${LOCAL_BIN}:${PATH}" ;;
esac
# Also add common Go/Homebrew bin dirs so `command -v vale` finds them when newly installed.
# ${HOME}/Library/Python/*/bin covers macOS pip3 --user installs (ruff, semgrep, mypy, vulture, sqlfluff)
# — the glob is filtered by the `-d` check, so the unexpanded literal is harmless on Linux.
for extra in "${HOME}/go/bin" "/opt/homebrew/bin" "/usr/local/bin" "${HOME}"/Library/Python/*/bin; do
  if [[ -d "${extra}" ]]; then
    case ":${PATH}:" in
      *":${extra}:"*) ;;
      *) export PATH="${extra}:${PATH}" ;;
    esac
  fi
done

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
  if npm install -g "$@" 2>/dev/null; then
    return 0
  fi
  warn "npm install -g failed (permissions?) — retrying with sudo..."
  if sudo npm install -g "$@" 2>/dev/null; then
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

# ─── Helper: install a Node CLI globally if missing ───
install_node_if_missing() {
  local bin="$1" pkg="${2:-$1}"
  if command -v "${bin}" &>/dev/null; then
    ok "${bin} already installed: $("${bin}" --version 2>/dev/null || echo 'version unknown')"
    return 0
  fi
  info "Installing ${bin}..."
  if install_npm_global "${pkg}"; then
    ok "${bin} installed"
  else
    warn "Failed to install ${bin}"
  fi
}

# ─── Helper: install a binary via a curl-piped installer if missing ───
install_binary_if_missing() {
  local bin="$1" url="$2"
  if command -v "${bin}" &>/dev/null; then
    ok "${bin} already installed: $("${bin}" --version 2>/dev/null | head -1)"
    return 0
  fi
  info "Installing ${bin}..."
  if curl -sfL "${url}" | sh -s -- -b "${LOCAL_BIN}" 2>/dev/null; then
    ok "${bin} installed to ${LOCAL_BIN}"
  else
    warn "Failed to install ${bin} — you can install it manually later"
  fi
}

# ─── Helper: install a Python CLI via install_python_tool if missing ───
install_python_if_missing() {
  local bin="$1" pkg="${2:-$1}"
  if command -v "${bin}" &>/dev/null; then
    ok "${bin} already installed: $("${bin}" --version 2>/dev/null || echo 'version unknown')"
    return 0
  fi
  if install_python_tool "${pkg}"; then
    ok "${bin} installed"
  else
    warn "Failed to install ${bin}"
  fi
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

  # ruff, semgrep (Python)
  install_python_if_missing ruff
  install_python_if_missing semgrep

  # eslint (Node — global install with sudo fallback)
  install_node_if_missing eslint

  # eslint plugins — install into fast-cv's own node_modules/ so the shipped config can find them
  # (global npm packages are NOT in Node's resolution chain for the config file)
  ESLINT_PLUGINS=(
    eslint-plugin-sonarjs
    eslint-plugin-security
    typescript-eslint
    eslint-plugin-react
    eslint-plugin-react-hooks
    eslint-plugin-vue
    eslint-plugin-svelte
    eslint-plugin-jsonc
    eslint-plugin-jsdoc
  )
  info "Installing eslint plugins into fast-cv node_modules..."
  if (cd "${SCRIPT_DIR}" && npm install --no-save "${ESLINT_PLUGINS[@]}" 2>/dev/null); then
    ok "eslint plugins installed"
  else
    warn "Failed to install some eslint plugins (eslint will degrade gracefully)"
  fi

  # jscpd, knip, tsc (Node)
  install_node_if_missing jscpd
  install_node_if_missing knip
  install_node_if_missing tsc typescript

  # bearer, golangci-lint, trivy (binary installers)
  install_binary_if_missing bearer "https://raw.githubusercontent.com/Bearer/bearer/main/contrib/install.sh"
  install_binary_if_missing golangci-lint "https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh"
  install_binary_if_missing trivy "https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh"
  if command -v trivy &>/dev/null; then
    info "Updating trivy vulnerability database for cached scans..."
    if trivy fs --download-db-only --quiet --no-progress "${SCRIPT_DIR}" 2>/dev/null; then
      ok "trivy vulnerability database ready"
    else
      warn "Failed to download trivy vulnerability database — trivy scans may fail until the DB is cached"
    fi

    info "Updating trivy Java database for cached scans..."
    if trivy fs --download-java-db-only --quiet --no-progress "${SCRIPT_DIR}" 2>/dev/null; then
      ok "trivy Java database ready"
    else
      warn "Failed to download trivy Java database — Java dependency scanning may be reduced until the DB is cached"
    fi
  fi

  # mypy, vulture (Python)
  install_python_if_missing mypy
  install_python_if_missing vulture

  # stylelint (Node — CSS linter)
  install_node_if_missing stylelint
  # stylelint-config-standard — install into fast-cv's node_modules/ for config resolution
  info "Installing stylelint-config-standard into fast-cv node_modules..."
  if (cd "${SCRIPT_DIR}" && npm install --no-save stylelint-config-standard 2>/dev/null); then
    ok "stylelint-config-standard installed"
  else
    warn "Failed to install stylelint-config-standard"
  fi

  # sqlfluff (Python — SQL linter)
  install_python_if_missing sqlfluff

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

  # clippy (Rust — requires an existing Rust toolchain)
  if command -v cargo &>/dev/null && cargo clippy --version &>/dev/null; then
    ok "clippy already installed: $(cargo clippy --version 2>/dev/null)"
  elif command -v rustup &>/dev/null; then
    info "Installing clippy via rustup..."
    if rustup component add clippy 2>/dev/null && cargo clippy --version &>/dev/null; then
      ok "clippy installed"
    else
      warn "Failed to install clippy — run: rustup component add clippy"
    fi
  else
    warn "clippy not installed — install Rust/rustup, then run: rustup component add clippy"
  fi

  # spectral, redocly, markdownlint-cli2 (Node)
  install_node_if_missing spectral "@stoplight/spectral-cli"
  install_node_if_missing redocly "@redocly/cli"
  install_node_if_missing markdownlint-cli2

  # vale (Go binary — prose style linter)
  if command -v vale &>/dev/null; then
    ok "vale already installed: $(vale --version 2>/dev/null | head -1)"
  else
    info "Installing vale..."
    if [[ "${OS}" == "Darwin" ]] && ! command -v brew &>/dev/null; then
      info "Homebrew not found; falling back to go/pre-built. Install Homebrew from https://brew.sh for the fastest vale install on macOS."
    fi
    VALE_INSTALLED=false
    if command -v brew &>/dev/null; then
      brew install vale 2>/dev/null && VALE_INSTALLED=true
    fi
    if [[ "${VALE_INSTALLED}" == "false" ]] && command -v go &>/dev/null; then
      GOBIN="${LOCAL_BIN}" go install github.com/errata-ai/vale/v3@latest 2>/dev/null && VALE_INSTALLED=true
    fi
    if [[ "${VALE_INSTALLED}" == "false" ]]; then
      VALE_ARCH="$(uname -m)"
      case "${OS}-${VALE_ARCH}" in
        Linux-x86_64)   VALE_TARGET="Linux_64-bit" ;;
        Linux-aarch64)  VALE_TARGET="Linux_arm64" ;;
        Darwin-x86_64)  VALE_TARGET="macOS_64-bit" ;;
        Darwin-arm64)   VALE_TARGET="macOS_arm64" ;;
        *)              VALE_TARGET="" ;;
      esac
      if [[ -n "${VALE_TARGET}" ]]; then
        VALE_URL="$(curl -sfL https://api.github.com/repos/errata-ai/vale/releases/latest \
          | grep "browser_download_url.*${VALE_TARGET}.*tar.gz\"" \
          | head -1 | cut -d '"' -f 4)"
        if [[ -n "${VALE_URL}" ]]; then
          curl -sfL "${VALE_URL}" | tar xz -C "${LOCAL_BIN}" vale 2>/dev/null && VALE_INSTALLED=true
        fi
      fi
    fi
    if [[ "${VALE_INSTALLED}" == "true" ]]; then
      ok "vale installed"
    else
      warn "Failed to install vale — install manually: brew install vale"
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

  # Sync Vale styles into BOTH defaults dirs (user defaults + package defaults).
  # Fast-cv's config resolver may pick either path depending on whether a project has a local config,
  # so both need populated styles for vale to run without E201 errors.
  find_vale_bin() {
    if command -v vale &>/dev/null; then command -v vale; return 0; fi
    for candidate in "${LOCAL_BIN}/vale" "${HOME}/go/bin/vale" "/opt/homebrew/bin/vale" "/usr/local/bin/vale"; do
      if [[ -x "${candidate}" ]]; then echo "${candidate}"; return 0; fi
    done
    return 1
  }

  sync_vale_styles() {
    local dir="$1"
    local vale_bin="$2"
    if [[ ! -f "${dir}/.vale.ini" ]]; then return 0; fi
    if [[ -d "${dir}/vale-styles" ]] && [[ "${OVERWRITE}" == "false" ]]; then
      ok "Vale styles already synced at ${dir}/vale-styles/"
      return 0
    fi
    info "Syncing Vale styles in ${dir}..."
    local sync_out
    if sync_out=$(cd "${dir}" && "${vale_bin}" sync 2>&1); then
      ok "Vale styles synced to ${dir}/vale-styles/"
    else
      warn "Failed to sync Vale styles in ${dir}:"
      echo "${sync_out}" | head -5 | sed 's/^/    /'
      warn "Retry manually: cd ${dir} && vale sync"
    fi
  }

  if VALE_BIN=$(find_vale_bin); then
    sync_vale_styles "${CONFIG_DIR}" "${VALE_BIN}"
    sync_vale_styles "${SCRIPT_DIR}/defaults" "${VALE_BIN}"
  else
    warn "vale binary not found on PATH or common locations — skipping style sync"
    warn "  Install vale, then re-run: ./install.sh --mode configs"
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

# PATH warning — check the user's ORIGINAL shell PATH, not the in-script mutations.
if [[ ":${ORIG_PATH}:" != *":${LOCAL_BIN}:"* ]]; then
  echo ""
  warn "${LOCAL_BIN} is not in your shell's PATH."
  if [[ "${OS}" == "Darwin" ]]; then
    echo "  Add this to ~/.zshrc (macOS default shell since Catalina):"
    echo "    export PATH=\"\${HOME}/.local/bin:\${PATH}\""
    echo "  If ruff/semgrep/mypy/vulture/sqlfluff are missing after install, also add the"
    echo "  pip3 --user bin directory (replace 3.x with your Python version, e.g. 3.11):"
    echo "    export PATH=\"\${HOME}/Library/Python/3.x/bin:\${PATH}\""
    echo "  Then reload: source ~/.zshrc"
  else
    echo "  Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
    echo "    export PATH=\"\${HOME}/.local/bin:\${PATH}\""
  fi
fi

echo ""
info "Usage: fast-cv [directory]"
info "Run 'fast-cv --help' for options."
info "If any tool install showed a warning, fast-cv still works but coverage is reduced until that tool is installed."
