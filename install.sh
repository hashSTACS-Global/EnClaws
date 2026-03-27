#!/bin/bash
set -euo pipefail

# Enclaws Installer for macOS and Linux
# Usage: curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/hashSTACS-Global/EnClaws/main/install.sh | bash

BOLD='\033[1m'
ACCENT='\033[38;2;100;149;237m'       # cornflower-blue #6495ED
# shellcheck disable=SC2034
ACCENT_BRIGHT='\033[38;2;130;170;255m' # lighter blue
INFO='\033[38;2;136;146;176m'          # text-secondary #8892b0
SUCCESS='\033[38;2;0;229;204m'         # cyan-bright   #00e5cc
WARN='\033[38;2;255;176;32m'           # amber
ERROR='\033[38;2;230;57;70m'           # coral-mid     #e63946
MUTED='\033[38;2;90;100;128m'          # text-muted    #5a6480
NC='\033[0m' # No Color

DEFAULT_TAGLINE="下一代企业的操作系统内核"

ORIGINAL_PATH="${PATH:-}"

TMPFILES=()
cleanup_tmpfiles() {
    local f
    for f in "${TMPFILES[@]:-}"; do
        rm -rf "$f" 2>/dev/null || true
    done
}
trap cleanup_tmpfiles EXIT

mktempfile() {
    local f
    f="$(mktemp)"
    TMPFILES+=("$f")
    echo "$f"
}

DOWNLOADER=""
detect_downloader() {
    if command -v curl &> /dev/null; then
        DOWNLOADER="curl"
        return 0
    fi
    if command -v wget &> /dev/null; then
        DOWNLOADER="wget"
        return 0
    fi
    ui_error "Missing downloader (curl or wget required)"
    exit 1
}

download_file() {
    local url="$1"
    local output="$2"
    if [[ -z "$DOWNLOADER" ]]; then
        detect_downloader
    fi
    if [[ "$DOWNLOADER" == "curl" ]]; then
        curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 1 --retry-connrefused -o "$output" "$url"
        return
    fi
    wget -q --https-only --secure-protocol=TLSv1_2 --tries=3 --timeout=20 -O "$output" "$url"
}

run_remote_bash() {
    local url="$1"
    local tmp
    tmp="$(mktempfile)"
    download_file "$url" "$tmp"
    /bin/bash "$tmp"
}

GUM_VERSION="${ENCLAWS_GUM_VERSION:-0.17.0}"
GUM=""
GUM_STATUS="skipped"
GUM_REASON=""

is_non_interactive_shell() {
    if [[ "${NO_PROMPT:-0}" == "1" ]]; then
        return 0
    fi
    if [[ ! -t 0 || ! -t 1 ]]; then
        return 0
    fi
    return 1
}

gum_is_tty() {
    if [[ -n "${NO_COLOR:-}" ]]; then
        return 1
    fi
    if [[ "${TERM:-dumb}" == "dumb" ]]; then
        return 1
    fi
    if [[ -t 2 || -t 1 ]]; then
        return 0
    fi
    if [[ -r /dev/tty && -w /dev/tty ]]; then
        return 0
    fi
    return 1
}

gum_detect_os() {
    case "$(uname -s 2>/dev/null || true)" in
        Darwin) echo "Darwin" ;;
        Linux) echo "Linux" ;;
        *) echo "unsupported" ;;
    esac
}

gum_detect_arch() {
    case "$(uname -m 2>/dev/null || true)" in
        x86_64|amd64) echo "x86_64" ;;
        arm64|aarch64) echo "arm64" ;;
        i386|i686) echo "i386" ;;
        armv7l|armv7) echo "armv7" ;;
        armv6l|armv6) echo "armv6" ;;
        *) echo "unknown" ;;
    esac
}

verify_sha256sum_file() {
    local checksums="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum --ignore-missing -c "$checksums" >/dev/null 2>&1
        return $?
    fi
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 --ignore-missing -c "$checksums" >/dev/null 2>&1
        return $?
    fi
    return 1
}

bootstrap_gum_temp() {
    GUM=""
    GUM_STATUS="skipped"
    GUM_REASON=""

    if is_non_interactive_shell; then
        GUM_REASON="non-interactive shell (auto-disabled)"
        return 1
    fi

    if ! gum_is_tty; then
        GUM_REASON="terminal does not support gum UI"
        return 1
    fi

    if command -v gum >/dev/null 2>&1; then
        GUM="gum"
        GUM_STATUS="found"
        GUM_REASON="already installed"
        return 0
    fi

    if ! command -v tar >/dev/null 2>&1; then
        GUM_REASON="tar not found"
        return 1
    fi

    local os arch asset base gum_tmpdir gum_path
    os="$(gum_detect_os)"
    arch="$(gum_detect_arch)"
    if [[ "$os" == "unsupported" || "$arch" == "unknown" ]]; then
        GUM_REASON="unsupported os/arch ($os/$arch)"
        return 1
    fi

    asset="gum_${GUM_VERSION}_${os}_${arch}.tar.gz"
    base="https://github.com/charmbracelet/gum/releases/download/v${GUM_VERSION}"

    gum_tmpdir="$(mktemp -d)"
    TMPFILES+=("$gum_tmpdir")

    if ! download_file "${base}/${asset}" "$gum_tmpdir/$asset"; then
        GUM_REASON="download failed"
        return 1
    fi

    if ! download_file "${base}/checksums.txt" "$gum_tmpdir/checksums.txt"; then
        GUM_REASON="checksum unavailable or failed"
        return 1
    fi

    if ! (cd "$gum_tmpdir" && verify_sha256sum_file "checksums.txt"); then
        GUM_REASON="checksum unavailable or failed"
        return 1
    fi

    if ! tar -xzf "$gum_tmpdir/$asset" -C "$gum_tmpdir" >/dev/null 2>&1; then
        GUM_REASON="extract failed"
        return 1
    fi

    gum_path="$(find "$gum_tmpdir" -type f -name gum 2>/dev/null | head -n1 || true)"
    if [[ -z "$gum_path" ]]; then
        GUM_REASON="gum binary missing after extract"
        return 1
    fi

    chmod +x "$gum_path" >/dev/null 2>&1 || true
    if [[ ! -x "$gum_path" ]]; then
        GUM_REASON="gum binary is not executable"
        return 1
    fi

    GUM="$gum_path"
    GUM_STATUS="installed"
    GUM_REASON="temp, verified"
    return 0
}

print_gum_status() {
    case "$GUM_STATUS" in
        found)
            ui_success "gum available (${GUM_REASON})"
            ;;
        installed)
            ui_success "gum bootstrapped (${GUM_REASON}, v${GUM_VERSION})"
            ;;
        *)
            if [[ -n "$GUM_REASON" && "$GUM_REASON" != "non-interactive shell (auto-disabled)" ]]; then
                ui_info "gum skipped (${GUM_REASON})"
            fi
            ;;
    esac
}

print_installer_banner() {
    if [[ -n "$GUM" ]]; then
        local title tagline hint card
        title="$("$GUM" style --foreground "#6495ED" --bold "⚡ Enclaws Installer")"
        tagline="$("$GUM" style --foreground "#8892b0" "$TAGLINE")"
        hint="$("$GUM" style --foreground "#5a6480" "modern installer mode")"
        card="$(printf '%s\n%s\n%s' "$title" "$tagline" "$hint")"
        "$GUM" style --border rounded --border-foreground "#6495ED" --padding "1 2" "$card"
        echo ""
        return
    fi

    echo -e "${ACCENT}${BOLD}"
    echo "  ⚡ Enclaws Installer"
    echo -e "${NC}${INFO}  ${TAGLINE}${NC}"
    echo ""
}

detect_os_or_die() {
    OS="unknown"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]] || [[ -n "${WSL_DISTRO_NAME:-}" ]]; then
        OS="linux"
    fi

    if [[ "$OS" == "unknown" ]]; then
        ui_error "Unsupported operating system"
        echo "This installer supports macOS and Linux (including WSL)."
        exit 1
    fi

    ui_success "Detected: $OS"
}

ui_info() {
    local msg="$*"
    if [[ -n "$GUM" ]]; then
        "$GUM" log --level info "$msg"
    else
        echo -e "${MUTED}·${NC} ${msg}"
    fi
}

ui_warn() {
    local msg="$*"
    if [[ -n "$GUM" ]]; then
        "$GUM" log --level warn "$msg"
    else
        echo -e "${WARN}!${NC} ${msg}"
    fi
}

ui_success() {
    local msg="$*"
    if [[ -n "$GUM" ]]; then
        local mark
        mark="$("$GUM" style --foreground "#00e5cc" --bold "✓")"
        echo "${mark} ${msg}"
    else
        echo -e "${SUCCESS}✓${NC} ${msg}"
    fi
}

ui_error() {
    local msg="$*"
    if [[ -n "$GUM" ]]; then
        "$GUM" log --level error "$msg"
    else
        echo -e "${ERROR}✗${NC} ${msg}"
    fi
}

INSTALL_STAGE_TOTAL=3
INSTALL_STAGE_CURRENT=0

ui_section() {
    local title="$1"
    if [[ -n "$GUM" ]]; then
        "$GUM" style --bold --foreground "#6495ED" --padding "1 0" "$title"
    else
        echo ""
        echo -e "${ACCENT}${BOLD}${title}${NC}"
    fi
}

ui_stage() {
    local title="$1"
    INSTALL_STAGE_CURRENT=$((INSTALL_STAGE_CURRENT + 1))
    ui_section "[${INSTALL_STAGE_CURRENT}/${INSTALL_STAGE_TOTAL}] ${title}"
}

ui_kv() {
    local key="$1"
    local value="$2"
    if [[ -n "$GUM" ]]; then
        local key_part value_part
        key_part="$("$GUM" style --foreground "#5a6480" --width 20 "$key")"
        value_part="$("$GUM" style --bold "$value")"
        "$GUM" join --horizontal "$key_part" "$value_part"
    else
        echo -e "${MUTED}${key}:${NC} ${value}"
    fi
}

ui_panel() {
    local content="$1"
    if [[ -n "$GUM" ]]; then
        "$GUM" style --border rounded --border-foreground "#5a6480" --padding "0 1" "$content"
    else
        echo "$content"
    fi
}

show_install_plan() {
    local detected_checkout="$1"

    ui_section "Install plan"
    ui_kv "OS" "$OS"
    ui_kv "Install method" "git"
    ui_kv "Repository" "$ENCLAWS_REPO_URL"
    ui_kv "Branch" "$ENCLAWS_REPO_BRANCH"
    ui_kv "Git directory" "$GIT_DIR"
    ui_kv "Git update" "$GIT_UPDATE"
    ui_kv "Database" "SQLite (default)"
    if [[ -n "$detected_checkout" ]]; then
        ui_kv "Detected checkout" "$detected_checkout"
    fi
    if [[ "$DRY_RUN" == "1" ]]; then
        ui_kv "Dry run" "yes"
    fi
    if [[ "$NO_ONBOARD" == "1" ]]; then
        ui_kv "Onboarding" "skipped"
    fi
}

show_footer_links() {
    local repo_url="https://github.com/hashSTACS-Global/EnClaws"
    if [[ -n "$GUM" ]]; then
        local content
        content="$(printf '%s\n%s' "Need help?" "Docs: ${repo_url}")"
        ui_panel "$content"
    else
        echo ""
        echo -e "Docs: ${INFO}${repo_url}${NC}"
    fi
}

ui_celebrate() {
    local msg="$1"
    if [[ -n "$GUM" ]]; then
        "$GUM" style --bold --foreground "#00e5cc" "$msg"
    else
        echo -e "${SUCCESS}${BOLD}${msg}${NC}"
    fi
}

is_shell_function() {
    local name="${1:-}"
    [[ -n "$name" ]] && declare -F "$name" >/dev/null 2>&1
}

is_gum_raw_mode_failure() {
    local err_log="$1"
    [[ -s "$err_log" ]] || return 1
    grep -Eiq 'setrawmode' "$err_log"
}

run_with_spinner() {
    local title="$1"
    shift

    if [[ -n "$GUM" ]] && gum_is_tty && ! is_shell_function "${1:-}"; then
        local gum_err
        gum_err="$(mktempfile)"
        if "$GUM" spin --spinner dot --title "$title" -- "$@" 2>"$gum_err"; then
            return 0
        fi
        local gum_status=$?
        if is_gum_raw_mode_failure "$gum_err"; then
            GUM=""
            GUM_STATUS="skipped"
            GUM_REASON="gum raw mode unavailable"
            ui_warn "Spinner unavailable in this terminal; continuing without spinner"
            "$@"
            return $?
        fi
        if [[ -s "$gum_err" ]]; then
            cat "$gum_err" >&2
        fi
        return "$gum_status"
    fi

    "$@"
}

run_quiet_step() {
    local title="$1"
    shift

    if [[ "$VERBOSE" == "1" ]]; then
        run_with_spinner "$title" "$@"
        return $?
    fi

    local log
    log="$(mktempfile)"

    if [[ -n "$GUM" ]] && gum_is_tty && ! is_shell_function "${1:-}"; then
        local cmd_quoted=""
        local log_quoted=""
        printf -v cmd_quoted '%q ' "$@"
        printf -v log_quoted '%q' "$log"
        if run_with_spinner "$title" bash -c "${cmd_quoted}>${log_quoted} 2>&1"; then
            return 0
        fi
    else
        if "$@" >"$log" 2>&1; then
            return 0
        fi
    fi

    ui_error "${title} failed — re-run with --verbose for details"
    if [[ -s "$log" ]]; then
        tail -n 80 "$log" >&2 || true
    fi
    return 1
}

install_build_tools_linux() {
    require_sudo

    if command -v apt-get &> /dev/null; then
        if is_root; then
            run_quiet_step "Updating package index" apt-get update -qq
            run_quiet_step "Installing build tools" apt-get install -y -qq build-essential python3 make g++ cmake
        else
            run_quiet_step "Updating package index" sudo apt-get update -qq
            run_quiet_step "Installing build tools" sudo apt-get install -y -qq build-essential python3 make g++ cmake
        fi
        return 0
    fi

    if command -v dnf &> /dev/null; then
        if is_root; then
            run_quiet_step "Installing build tools" dnf install -y -q gcc gcc-c++ make cmake python3
        else
            run_quiet_step "Installing build tools" sudo dnf install -y -q gcc gcc-c++ make cmake python3
        fi
        return 0
    fi

    if command -v yum &> /dev/null; then
        if is_root; then
            run_quiet_step "Installing build tools" yum install -y -q gcc gcc-c++ make cmake python3
        else
            run_quiet_step "Installing build tools" sudo yum install -y -q gcc gcc-c++ make cmake python3
        fi
        return 0
    fi

    if command -v apk &> /dev/null; then
        if is_root; then
            run_quiet_step "Installing build tools" apk add --no-cache build-base python3 cmake
        else
            run_quiet_step "Installing build tools" sudo apk add --no-cache build-base python3 cmake
        fi
        return 0
    fi

    ui_warn "Could not detect package manager for auto-installing build tools"
    return 1
}

install_build_tools_macos() {
    local ok=true

    if ! xcode-select -p >/dev/null 2>&1; then
        ui_info "Installing Xcode Command Line Tools (required for make/clang)"
        xcode-select --install >/dev/null 2>&1 || true
        if ! xcode-select -p >/dev/null 2>&1; then
            ui_warn "Xcode Command Line Tools are not ready yet"
            ui_info "Complete the installer dialog, then re-run this installer"
            ok=false
        fi
    fi

    if ! command -v cmake >/dev/null 2>&1; then
        if command -v brew >/dev/null 2>&1; then
            run_quiet_step "Installing cmake" brew install cmake
        else
            ui_warn "Homebrew not available; cannot auto-install cmake"
            ok=false
        fi
    fi

    if ! command -v make >/dev/null 2>&1; then
        ui_warn "make is still unavailable"
        ok=false
    fi
    if ! command -v cmake >/dev/null 2>&1; then
        ui_warn "cmake is still unavailable"
        ok=false
    fi

    [[ "$ok" == "true" ]]
}

# ─── Taglines ────────────────────────────────────────────────────────────────

TAGLINES=()
TAGLINES+=("Your terminal just got enchanted — welcome to Enclaws.")
TAGLINES+=("终端的利爪已就位，准备撕碎一切繁琐工作。")
TAGLINES+=("Enclaws: where conversations become automation.")
TAGLINES+=("一行命令，万千对话。Enclaws 在线。")
TAGLINES+=("I speak fluent bash, mild sarcasm, and aggressive tab-completion energy.")
TAGLINES+=("Enclaws — the next-gen OS kernel for enterprises.")
TAGLINES+=("Enclaws — 下一代企业的操作系统内核。")
TAGLINES+=("Shell yeah — let's ship something mildly responsible.")
TAGLINES+=("多模型网关已上线，请系好安全带。")
TAGLINES+=("Gateway online — please keep hands inside the shell at all times.")
TAGLINES+=("如果能描述它，我大概就能自动化它。")
TAGLINES+=("If it works, it's automation; if it breaks, it's a learning opportunity.")
TAGLINES+=("配置有效，但你的假设无效。")
TAGLINES+=("Less clicking, more shipping, fewer 'where did that file go' moments.")
TAGLINES+=("Hot reload for config, cold sweat for deploys.")
TAGLINES+=("SQLite 轻量启动，PostgreSQL 随时升级。")
TAGLINES+=("I'll do the boring stuff while you dramatically stare at the logs.")
TAGLINES+=("开源的力量，私有的部署。Enclaws 两者兼得。")
TAGLINES+=("Your .env is showing; don't worry, I'll pretend I didn't see it.")
TAGLINES+=("内网外网自由切换，一个安装脚本搞定一切。")
TAGLINES+=("curl for conversations, grep for insights.")
TAGLINES+=("I'm basically a Swiss Army knife, but with more opinions and fewer sharp edges.")
TAGLINES+=("If you're lost, run doctor; if you're brave, run prod; if you're wise, run tests.")
TAGLINES+=("I can't fix your code taste, but I can fix your build and your backlog.")
TAGLINES+=("Say 'stop' and I'll stop — say 'ship' and we'll both learn a lesson.")
TAGLINES+=("一键安装，开箱即用。Enclaws 就是这么简单。")

HOLIDAY_NEW_YEAR="New Year's Day: 新年新配置 — 同样的 EADDRINUSE，但这次我们像成年人一样解决它。"
HOLIDAY_LUNAR_NEW_YEAR="Lunar New Year: 愿你的构建顺利，分支繁荣，merge conflict 统统被烟花吓跑。"
HOLIDAY_CHRISTMAS="Christmas: 圣诞快乐 — Enclaws 小助手来送欢乐、回滚混乱、安全保管密钥。"
HOLIDAY_EID="Eid al-Fitr: 庆祝模式：队列已清空，任务已完成，好心情已提交到 main。"
HOLIDAY_DIWALI="Diwali: 让日志闪闪发光，让 bug 四散奔逃 — 今天我们点亮终端，骄傲地发版。"
HOLIDAY_EASTER="Easter: 找到了你丢失的环境变量 — 就当是一场小小的 CLI 彩蛋寻宝吧。"
HOLIDAY_HANUKKAH="Hanukkah: 八夜，八次重试，零次羞耻 — 愿你的网关常亮，部署平安。"
HOLIDAY_HALLOWEEN="Halloween: 注意闹鬼的依赖、被诅咒的缓存，以及 node_modules 的幽灵。"
HOLIDAY_THANKSGIVING="Thanksgiving: 感恩稳定的端口、能用的 DNS，以及一个会读日志的机器人。"
HOLIDAY_VALENTINES="Valentine's Day: 玫瑰是 typed 的，紫罗兰是 piped 的 — 我来自动化杂务，你去陪人类吧。"

append_holiday_taglines() {
    local today
    local month_day
    today="$(date -u +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d)"
    month_day="$(date -u +%m-%d 2>/dev/null || date +%m-%d)"

    case "$month_day" in
        "01-01") TAGLINES+=("$HOLIDAY_NEW_YEAR") ;;
        "02-14") TAGLINES+=("$HOLIDAY_VALENTINES") ;;
        "10-31") TAGLINES+=("$HOLIDAY_HALLOWEEN") ;;
        "12-25") TAGLINES+=("$HOLIDAY_CHRISTMAS") ;;
    esac

    case "$today" in
        "2025-01-29"|"2026-02-17"|"2027-02-06") TAGLINES+=("$HOLIDAY_LUNAR_NEW_YEAR") ;;
        "2025-03-30"|"2025-03-31"|"2026-03-20"|"2027-03-10") TAGLINES+=("$HOLIDAY_EID") ;;
        "2025-10-20"|"2026-11-08"|"2027-10-28") TAGLINES+=("$HOLIDAY_DIWALI") ;;
        "2025-04-20"|"2026-04-05"|"2027-03-28") TAGLINES+=("$HOLIDAY_EASTER") ;;
        "2025-11-27"|"2026-11-26"|"2027-11-25") TAGLINES+=("$HOLIDAY_THANKSGIVING") ;;
        "2025-12-15"|"2025-12-16"|"2025-12-17"|"2025-12-18"|"2025-12-19"|"2025-12-20"|"2025-12-21"|"2025-12-22"|"2026-12-05"|"2026-12-06"|"2026-12-07"|"2026-12-08"|"2026-12-09"|"2026-12-10"|"2026-12-11"|"2026-12-12"|"2027-12-25"|"2027-12-26"|"2027-12-27"|"2027-12-28"|"2027-12-29"|"2027-12-30"|"2027-12-31"|"2028-01-01") TAGLINES+=("$HOLIDAY_HANUKKAH") ;;
    esac
}

pick_tagline() {
    append_holiday_taglines
    local count=${#TAGLINES[@]}
    if [[ "$count" -eq 0 ]]; then
        echo "$DEFAULT_TAGLINE"
        return
    fi
    if [[ -n "${ENCLAWS_TAGLINE_INDEX:-}" ]]; then
        if [[ "${ENCLAWS_TAGLINE_INDEX}" =~ ^[0-9]+$ ]]; then
            local idx=$((ENCLAWS_TAGLINE_INDEX % count))
            echo "${TAGLINES[$idx]}"
            return
        fi
    fi
    local idx=$((RANDOM % count))
    echo "${TAGLINES[$idx]}"
}

TAGLINE=$(pick_tagline)

# ─── Configuration variables ─────────────────────────────────────────────────

NO_ONBOARD=${ENCLAWS_NO_ONBOARD:-0}
NO_PROMPT=${ENCLAWS_NO_PROMPT:-0}
DRY_RUN=${ENCLAWS_DRY_RUN:-0}
ENCLAWS_REPO_URL="${ENCLAWS_REPO_URL:-https://github.com/hashSTACS-Global/EnClaws.git}"
ENCLAWS_REPO_BRANCH="${ENCLAWS_REPO_BRANCH:-main}"
GIT_DIR_DEFAULT="${HOME}/enclaws"
GIT_DIR=${ENCLAWS_GIT_DIR:-$GIT_DIR_DEFAULT}
GIT_UPDATE=${ENCLAWS_GIT_UPDATE:-1}
SHARP_IGNORE_GLOBAL_LIBVIPS="${SHARP_IGNORE_GLOBAL_LIBVIPS:-1}"
VERBOSE="${ENCLAWS_VERBOSE:-0}"
ENCLAWS_BIN=""
PNPM_CMD=()
HELP=0

print_usage() {
    cat <<EOF
Enclaws installer (macOS + Linux)

Usage:
  curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/hashSTACS-Global/EnClaws/main/install.sh | bash -s -- [options]

Options:
  --git-dir, --dir <path>             Checkout directory (default: ~/enclaws)
  --no-git-update                      Skip git pull for existing checkout
  --no-onboard                          Skip onboarding (non-interactive)
  --no-prompt                           Disable prompts (required in CI/automation)
  --dry-run                             Print what would happen (no changes)
  --verbose                             Print debug output (set -x)
  --help, -h                            Show this help

Environment variables:
  ENCLAWS_REPO_URL=...                Git repository URL (default: https://github.com/hashSTACS-Global/EnClaws.git)
  ENCLAWS_REPO_BRANCH=...            Git branch (default: main)
  ENCLAWS_GIT_DIR=...                Checkout directory (default: ~/enclaws)
  ENCLAWS_GIT_UPDATE=0|1             Pull latest changes (default: 1)
  ENCLAWS_NO_PROMPT=1                Disable interactive prompts
  ENCLAWS_DRY_RUN=1                  Dry run mode
  ENCLAWS_NO_ONBOARD=1               Skip onboarding
  ENCLAWS_VERBOSE=1                  Verbose output
  ENCLAWS_USE_CHINA_MIRROR=0|1       Force China npm mirror on (1) or off (0); auto-detect if unset
  SHARP_IGNORE_GLOBAL_LIBVIPS=0|1    Default: 1 (avoid sharp building against global libvips)

Examples:
  curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/hashSTACS-Global/EnClaws/main/install.sh | bash
  curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/hashSTACS-Global/EnClaws/main/install.sh | bash -s -- --no-onboard
  ENCLAWS_REPO_URL=https://gitlab.internal/team/enclaws.git bash install.sh
EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --no-onboard)
                NO_ONBOARD=1
                shift
                ;;
            --onboard)
                NO_ONBOARD=0
                shift
                ;;
            --dry-run)
                DRY_RUN=1
                shift
                ;;
            --verbose)
                VERBOSE=1
                shift
                ;;
            --no-prompt)
                NO_PROMPT=1
                shift
                ;;
            --help|-h)
                HELP=1
                shift
                ;;
            --git-dir|--dir)
                GIT_DIR="$2"
                shift 2
                ;;
            --no-git-update)
                GIT_UPDATE=0
                shift
                ;;
            *)
                shift
                ;;
        esac
    done
}

configure_verbose() {
    if [[ "$VERBOSE" != "1" ]]; then
        return 0
    fi
    set -x
}

is_promptable() {
    if [[ "$NO_PROMPT" == "1" ]]; then
        return 1
    fi
    if [[ -r /dev/tty && -w /dev/tty ]]; then
        return 0
    fi
    return 1
}

prompt_choice() {
    local prompt="$1"
    local answer=""
    if ! is_promptable; then
        return 1
    fi
    echo -e "$prompt" > /dev/tty
    read -r answer < /dev/tty || true
    echo "$answer"
}

detect_enclaws_checkout() {
    local dir="$1"
    if [[ ! -f "$dir/package.json" ]]; then
        return 1
    fi
    if [[ ! -f "$dir/pnpm-workspace.yaml" ]]; then
        return 1
    fi
    # Detect both "enclaws" and "openclaw" (for migration scenarios)
    if grep -q '"name"[[:space:]]*:[[:space:]]*"enclaws"' "$dir/package.json" 2>/dev/null; then
        echo "$dir"
        return 0
    fi
    if grep -q '"name"[[:space:]]*:[[:space:]]*"openclaw"' "$dir/package.json" 2>/dev/null; then
        echo "$dir"
        return 0
    fi
    return 1
}

# Check for Homebrew on macOS
is_macos_admin_user() {
    if [[ "$OS" != "macos" ]]; then
        return 0
    fi
    if is_root; then
        return 0
    fi
    id -Gn "$(id -un)" 2>/dev/null | grep -qw "admin"
}

print_homebrew_admin_fix() {
    local current_user
    current_user="$(id -un 2>/dev/null || echo "${USER:-current user}")"
    ui_error "Homebrew installation requires a macOS Administrator account"
    echo "Current user (${current_user}) is not in the admin group."
    echo "Fix options:"
    echo "  1) Use an Administrator account and re-run the installer."
    echo "  2) Ask an Administrator to grant admin rights, then sign out/in:"
    echo "     sudo dseditgroup -o edit -a ${current_user} -t user admin"
    echo "Then retry:"
    echo "  curl -fsSL https://raw.githubusercontent.com/hashSTACS-Global/EnClaws/main/install.sh | bash"
}

install_homebrew() {
    if [[ "$OS" == "macos" ]]; then
        if ! command -v brew &> /dev/null; then
            if ! is_macos_admin_user; then
                print_homebrew_admin_fix
                exit 1
            fi
            ui_info "Homebrew not found, installing"
            run_quiet_step "Installing Homebrew" run_remote_bash "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh"

            # Add Homebrew to PATH for this session
            if [[ -f "/opt/homebrew/bin/brew" ]]; then
                eval "$(/opt/homebrew/bin/brew shellenv)"
            elif [[ -f "/usr/local/bin/brew" ]]; then
                eval "$(/usr/local/bin/brew shellenv)"
            fi
            ui_success "Homebrew installed"
        else
            ui_success "Homebrew already installed"
        fi
    fi
}

# Check Node.js version
node_major_version() {
    if ! command -v node &> /dev/null; then
        return 1
    fi
    local version major
    version="$(node -v 2>/dev/null || true)"
    major="${version#v}"
    major="${major%%.*}"
    if [[ "$major" =~ ^[0-9]+$ ]]; then
        echo "$major"
        return 0
    fi
    return 1
}

print_active_node_paths() {
    if ! command -v node &> /dev/null; then
        return 1
    fi
    local node_path node_version npm_path npm_version
    node_path="$(command -v node 2>/dev/null || true)"
    node_version="$(node -v 2>/dev/null || true)"
    ui_info "Active Node.js: ${node_version:-unknown} (${node_path:-unknown})"

    if command -v npm &> /dev/null; then
        npm_path="$(command -v npm 2>/dev/null || true)"
        npm_version="$(npm -v 2>/dev/null || true)"
        ui_info "Active npm: ${npm_version:-unknown} (${npm_path:-unknown})"
    fi
    return 0
}

ensure_macos_node22_active() {
    if [[ "$OS" != "macos" ]]; then
        return 0
    fi

    local brew_node_prefix=""
    if command -v brew &> /dev/null; then
        brew_node_prefix="$(brew --prefix node@22 2>/dev/null || true)"
        if [[ -n "$brew_node_prefix" && -x "${brew_node_prefix}/bin/node" ]]; then
            export PATH="${brew_node_prefix}/bin:$PATH"
            refresh_shell_command_cache
        fi
    fi

    local major=""
    major="$(node_major_version || true)"
    if [[ -n "$major" && "$major" -ge 22 ]]; then
        return 0
    fi

    local active_path active_version
    active_path="$(command -v node 2>/dev/null || echo "not found")"
    active_version="$(node -v 2>/dev/null || echo "missing")"

    ui_error "Node.js v22 was installed but this shell is using ${active_version} (${active_path})"
    if [[ -n "$brew_node_prefix" ]]; then
        echo "Add this to your shell profile and restart shell:"
        echo "  export PATH=\"${brew_node_prefix}/bin:\$PATH\""
    else
        echo "Ensure Homebrew node@22 is first on PATH, then rerun installer."
    fi
    return 1
}

check_node() {
    if command -v node &> /dev/null; then
        NODE_VERSION="$(node_major_version || true)"
        if [[ -n "$NODE_VERSION" && "$NODE_VERSION" -ge 22 ]]; then
            ui_success "Node.js v$(node -v | cut -d'v' -f2) found"
            print_active_node_paths || true
            return 0
        else
            if [[ -n "$NODE_VERSION" ]]; then
                ui_info "Node.js $(node -v) found, upgrading to v22+"
            else
                ui_info "Node.js found but version could not be parsed; reinstalling v22+"
            fi
            return 1
        fi
    else
        ui_info "Node.js not found, installing it now"
        return 1
    fi
}

# Install Node.js
install_node() {
    if [[ "$OS" == "macos" ]]; then
        ui_info "Installing Node.js via Homebrew"
        run_quiet_step "Installing node@22" brew install node@22
        brew link node@22 --overwrite --force 2>/dev/null || true
        if ! ensure_macos_node22_active; then
            exit 1
        fi
        ui_success "Node.js installed"
        print_active_node_paths || true
    elif [[ "$OS" == "linux" ]]; then
        ui_info "Installing Node.js via NodeSource"
        require_sudo

        ui_info "Installing Linux build tools (make/g++/cmake/python3)"
        if install_build_tools_linux; then
            ui_success "Build tools installed"
        else
            ui_warn "Continuing without auto-installing build tools"
        fi

        if command -v apt-get &> /dev/null; then
            local tmp
            tmp="$(mktempfile)"
            download_file "https://deb.nodesource.com/setup_22.x" "$tmp"
            if is_root; then
                run_quiet_step "Configuring NodeSource repository" bash "$tmp"
                run_quiet_step "Installing Node.js" apt-get install -y -qq nodejs
            else
                run_quiet_step "Configuring NodeSource repository" sudo -E bash "$tmp"
                run_quiet_step "Installing Node.js" sudo apt-get install -y -qq nodejs
            fi
        elif command -v dnf &> /dev/null; then
            local tmp
            tmp="$(mktempfile)"
            download_file "https://rpm.nodesource.com/setup_22.x" "$tmp"
            if is_root; then
                run_quiet_step "Configuring NodeSource repository" bash "$tmp"
                run_quiet_step "Installing Node.js" dnf install -y -q nodejs
            else
                run_quiet_step "Configuring NodeSource repository" sudo bash "$tmp"
                run_quiet_step "Installing Node.js" sudo dnf install -y -q nodejs
            fi
        elif command -v yum &> /dev/null; then
            local tmp
            tmp="$(mktempfile)"
            download_file "https://rpm.nodesource.com/setup_22.x" "$tmp"
            if is_root; then
                run_quiet_step "Configuring NodeSource repository" bash "$tmp"
                run_quiet_step "Installing Node.js" yum install -y -q nodejs
            else
                run_quiet_step "Configuring NodeSource repository" sudo bash "$tmp"
                run_quiet_step "Installing Node.js" sudo yum install -y -q nodejs
            fi
        else
            ui_error "Could not detect package manager"
            echo "Please install Node.js 22+ manually: https://nodejs.org"
            exit 1
        fi

        ui_success "Node.js v22 installed"
        print_active_node_paths || true
    fi
}

# Check Git
check_git() {
    if command -v git &> /dev/null; then
        ui_success "Git already installed"
        return 0
    fi
    ui_info "Git not found, installing it now"
    return 1
}

is_root() {
    [[ "$(id -u)" -eq 0 ]]
}

# Run a command with sudo only if not already root
maybe_sudo() {
    if is_root; then
        if [[ "${1:-}" == "-E" ]]; then
            shift
        fi
        "$@"
    else
        sudo "$@"
    fi
}

require_sudo() {
    if [[ "$OS" != "linux" ]]; then
        return 0
    fi
    if is_root; then
        return 0
    fi
    if command -v sudo &> /dev/null; then
        if ! sudo -n true >/dev/null 2>&1; then
            ui_info "Administrator privileges required; enter your password"
            sudo -v
        fi
        return 0
    fi
    ui_error "sudo is required for system installs on Linux"
    echo "  Install sudo or re-run as root."
    exit 1
}

install_git() {
    if [[ "$OS" == "macos" ]]; then
        run_quiet_step "Installing Git" brew install git
    elif [[ "$OS" == "linux" ]]; then
        require_sudo
        if command -v apt-get &> /dev/null; then
            if is_root; then
                run_quiet_step "Updating package index" apt-get update -qq
                run_quiet_step "Installing Git" apt-get install -y -qq git
            else
                run_quiet_step "Updating package index" sudo apt-get update -qq
                run_quiet_step "Installing Git" sudo apt-get install -y -qq git
            fi
        elif command -v dnf &> /dev/null; then
            if is_root; then
                run_quiet_step "Installing Git" dnf install -y -q git
            else
                run_quiet_step "Installing Git" sudo dnf install -y -q git
            fi
        elif command -v yum &> /dev/null; then
            if is_root; then
                run_quiet_step "Installing Git" yum install -y -q git
            else
                run_quiet_step "Installing Git" sudo yum install -y -q git
            fi
        else
            ui_error "Could not detect package manager for Git"
            exit 1
        fi
    fi
    ui_success "Git installed"
}

# ─── China mirror detection ───────────────────────────────────────────────────

NPM_REGISTRY=""
CHINA_MIRROR="https://registry.npmmirror.com"

is_china_network() {
    # User can force mirror with ENCLAWS_USE_CHINA_MIRROR=1
    if [[ "${ENCLAWS_USE_CHINA_MIRROR:-}" == "1" ]]; then
        return 0
    fi
    # Skip detection if user explicitly disabled
    if [[ "${ENCLAWS_USE_CHINA_MIRROR:-}" == "0" ]]; then
        return 1
    fi
    # Probe npmjs.org with a 5-second timeout
    if command -v curl &>/dev/null; then
        if ! curl -fsS --connect-timeout 5 --max-time 8 "https://registry.npmjs.org/pnpm/latest" >/dev/null 2>&1; then
            return 0
        fi
    elif command -v wget &>/dev/null; then
        if ! wget -q --timeout=5 -O /dev/null "https://registry.npmjs.org/pnpm/latest" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

configure_npm_mirror() {
    if is_china_network; then
        NPM_REGISTRY="$CHINA_MIRROR"
        ui_info "npm registry unreachable; switching to China mirror (npmmirror.com)"
        npm config set registry "$CHINA_MIRROR" 2>/dev/null || true
        # Also configure corepack to use mirror
        export COREPACK_NPM_REGISTRY="$CHINA_MIRROR"
        ui_success "China mirror configured"
    else
        ui_success "npm registry reachable"
    fi
}

# ─── pnpm management ─────────────────────────────────────────────────────────

set_pnpm_cmd() {
    PNPM_CMD=("$@")
}

pnpm_cmd_pretty() {
    if [[ ${#PNPM_CMD[@]} -eq 0 ]]; then
        echo ""
        return 1
    fi
    printf '%s' "${PNPM_CMD[*]}"
    return 0
}

pnpm_cmd_is_ready() {
    if [[ ${#PNPM_CMD[@]} -eq 0 ]]; then
        return 1
    fi
    "${PNPM_CMD[@]}" --version >/dev/null 2>&1
}

detect_pnpm_cmd() {
    if command -v pnpm &> /dev/null; then
        set_pnpm_cmd pnpm
        return 0
    fi
    if command -v corepack &> /dev/null; then
        if corepack pnpm --version >/dev/null 2>&1; then
            set_pnpm_cmd corepack pnpm
            return 0
        fi
    fi
    return 1
}

ensure_pnpm() {
    if detect_pnpm_cmd && pnpm_cmd_is_ready; then
        ui_success "pnpm ready ($(pnpm_cmd_pretty))"
        return 0
    fi

    if command -v corepack &> /dev/null; then
        ui_info "Configuring pnpm via Corepack"
        corepack enable >/dev/null 2>&1 || true
        if ! run_quiet_step "Activating pnpm" corepack prepare pnpm@10 --activate; then
            ui_warn "Corepack pnpm activation failed; falling back"
        fi
        refresh_shell_command_cache
        if detect_pnpm_cmd && pnpm_cmd_is_ready; then
            if [[ "${PNPM_CMD[*]}" == "corepack pnpm" ]]; then
                ui_warn "pnpm shim not on PATH; using corepack pnpm fallback"
            fi
            ui_success "pnpm ready ($(pnpm_cmd_pretty))"
            return 0
        fi
    fi

    ui_info "Installing pnpm via npm"
    if [[ -n "$NPM_REGISTRY" ]]; then
        run_quiet_step "Installing pnpm" npm install -g pnpm@10 --registry "$NPM_REGISTRY"
    else
        run_quiet_step "Installing pnpm" npm install -g pnpm@10
    fi
    refresh_shell_command_cache
    if detect_pnpm_cmd && pnpm_cmd_is_ready; then
        ui_success "pnpm ready ($(pnpm_cmd_pretty))"
        return 0
    fi

    ui_error "pnpm installation failed"
    return 1
}

ensure_pnpm_binary_for_scripts() {
    if command -v pnpm >/dev/null 2>&1; then
        return 0
    fi

    if command -v corepack >/dev/null 2>&1; then
        ui_info "Ensuring pnpm command is available"
        corepack enable >/dev/null 2>&1 || true
        corepack prepare pnpm@10 --activate >/dev/null 2>&1 || true
        refresh_shell_command_cache
        if command -v pnpm >/dev/null 2>&1; then
            ui_success "pnpm command enabled via Corepack"
            return 0
        fi
    fi

    if [[ "${PNPM_CMD[*]}" == "corepack pnpm" ]] && command -v corepack >/dev/null 2>&1; then
        ensure_user_local_bin_on_path
        local user_pnpm="${HOME}/.local/bin/pnpm"
        cat >"${user_pnpm}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec corepack pnpm "$@"
EOF
        chmod +x "${user_pnpm}"
        refresh_shell_command_cache

        if command -v pnpm >/dev/null 2>&1; then
            ui_warn "pnpm shim not on PATH; installed user-local wrapper at ${user_pnpm}"
            return 0
        fi
    fi

    ui_error "pnpm command not available on PATH"
    ui_info "Install pnpm globally (npm install -g pnpm@10) and retry"
    return 1
}

run_pnpm() {
    if ! pnpm_cmd_is_ready; then
        ensure_pnpm
    fi
    "${PNPM_CMD[@]}" "$@"
}

ensure_user_local_bin_on_path() {
    local target="$HOME/.local/bin"
    mkdir -p "$target"

    export PATH="$target:$PATH"

    # shellcheck disable=SC2016
    local path_line='export PATH="$HOME/.local/bin:$PATH"'
    for rc in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.zshrc" "$HOME/.zprofile"; do
        touch "$rc"
        if ! grep -q ".local/bin" "$rc"; then
            echo "$path_line" >> "$rc"
        fi
    done
}

refresh_shell_command_cache() {
    hash -r 2>/dev/null || true
}

path_has_dir() {
    local path="$1"
    local dir="${2%/}"
    if [[ -z "$dir" ]]; then
        return 1
    fi
    case ":${path}:" in
        *":${dir}:"*) return 0 ;;
        *) return 1 ;;
    esac
}

warn_shell_path_missing_dir() {
    local dir="${1%/}"
    local label="$2"
    if [[ -z "$dir" ]]; then
        return 0
    fi
    if path_has_dir "$ORIGINAL_PATH" "$dir"; then
        return 0
    fi

    echo ""
    ui_warn "PATH missing ${label}: ${dir}"
    echo "  This can make enclaws show as \"command not found\" in new terminals."
    echo "  Fix (zsh: ~/.zshrc, bash: ~/.bashrc):"
    echo "    export PATH=\"${dir}:\$PATH\""
}

ensure_enclaws_bin_on_path() {
    local bin_dir="$HOME/.enclaws/bin"
    if [[ -d "$bin_dir" ]]; then
        export PATH="${bin_dir}:$PATH"
    fi
}

maybe_nodenv_rehash() {
    if command -v nodenv &> /dev/null; then
        nodenv rehash >/dev/null 2>&1 || true
    fi
}

warn_enclaws_not_found() {
    ui_warn "Installed, but enclaws is not discoverable on PATH in this shell"
    echo "  Try: hash -r (bash) or rehash (zsh), then retry."
    local t=""
    t="$(type -t enclaws 2>/dev/null || true)"
    if [[ "$t" == "alias" || "$t" == "function" ]]; then
        ui_warn "Found a shell ${t} named enclaws; it may shadow the real binary"
    fi
    local enclaws_bin="$HOME/.enclaws/bin"
    echo -e "If needed: ${INFO}export PATH=\"${enclaws_bin}:\$PATH\"${NC}"
}

resolve_enclaws_bin() {
    refresh_shell_command_cache
    local resolved=""
    resolved="$(type -P enclaws 2>/dev/null || true)"
    if [[ -n "$resolved" && -x "$resolved" ]]; then
        echo "$resolved"
        return 0
    fi

    ensure_enclaws_bin_on_path
    refresh_shell_command_cache
    resolved="$(type -P enclaws 2>/dev/null || true)"
    if [[ -n "$resolved" && -x "$resolved" ]]; then
        echo "$resolved"
        return 0
    fi

    local bin_dir="$HOME/.enclaws/bin"
    if [[ -x "${bin_dir}/enclaws" ]]; then
        echo "${bin_dir}/enclaws"
        return 0
    fi

    maybe_nodenv_rehash
    refresh_shell_command_cache
    resolved="$(type -P enclaws 2>/dev/null || true)"
    if [[ -n "$resolved" && -x "$resolved" ]]; then
        echo "$resolved"
        return 0
    fi

    echo ""
    return 1
}

# ─── Enclaws git installation ────────────────────────────────────────────────

install_enclaws_from_git() {
    local repo_dir="$1"
    local repo_url="$ENCLAWS_REPO_URL"
    local repo_branch="$ENCLAWS_REPO_BRANCH"

    if [[ -d "$repo_dir/.git" ]]; then
        ui_info "Installing Enclaws from git checkout: ${repo_dir}"
    else
        ui_info "Installing Enclaws from repository (${repo_url})"
    fi

    if ! check_git; then
        install_git
    fi

    ensure_pnpm
    ensure_pnpm_binary_for_scripts

    if [[ ! -d "$repo_dir" ]]; then
        run_quiet_step "Cloning Enclaws" git clone -b "$repo_branch" "$repo_url" "$repo_dir"
    fi

    if [[ "$GIT_UPDATE" == "1" ]]; then
        if [[ -z "$(git -C "$repo_dir" status --porcelain 2>/dev/null || true)" ]]; then
            run_quiet_step "Updating repository" git -C "$repo_dir" pull --rebase || true
        else
            ui_info "Repo has local changes; skipping git pull"
        fi
    fi

    ui_info "Installing dependencies (this may take a few minutes)..."
    SHARP_IGNORE_GLOBAL_LIBVIPS="$SHARP_IGNORE_GLOBAL_LIBVIPS" run_pnpm -C "$repo_dir" install || {
        ui_error "pnpm install failed"
        return 1
    }
    ui_success "Dependencies installed"

    ui_info "Building Enclaws..."
    run_pnpm -C "$repo_dir" build || {
        ui_error "Build failed"
        return 1
    }
    ui_success "Build complete"

    ui_info "Building UI..."
    if run_pnpm -C "$repo_dir" ui:build; then
        ui_success "UI build complete"
    else
        ui_warn "UI build failed; continuing (CLI may still work)"
    fi

    local bin_dir="${HOME}/.enclaws/bin"
    mkdir -p "$bin_dir"

    cat > "$bin_dir/enclaws" <<WRAPPER
#!/usr/bin/env bash
set -euo pipefail
exec node "${repo_dir}/dist/entry.js" "\$@"
WRAPPER
    chmod +x "$bin_dir/enclaws"

    # Ensure ~/.enclaws/bin is on PATH
    ensure_enclaws_bin_on_path
    ensure_user_local_bin_on_path

    # Add ~/.enclaws/bin to shell profile if not already there
    # shellcheck disable=SC2016
    local path_line='export PATH="$HOME/.enclaws/bin:$PATH"'
    for rc in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.zshrc" "$HOME/.zprofile"; do
        touch "$rc"
        if ! grep -q ".enclaws/bin" "$rc"; then
            echo "$path_line" >> "$rc"
        fi
    done

    ui_success "Enclaws wrapper installed to $bin_dir/enclaws"
    ui_success "PATH configured in shell profiles (bashrc/bash_profile/profile/zshrc/zprofile)"
    ui_info "Start gateway: enclaws gateway"
}

# ─── SQLite default configuration ────────────────────────────────────────────

setup_sqlite_db() {
    local repo_dir="$1"
    local data_dir="$HOME/.enclaws"
    local db_path="$data_dir/data.db"
    local env_file="$repo_dir/.env"

    mkdir -p "$data_dir"

    # Don't overwrite existing database config
    if [[ -f "$env_file" ]] && grep -q "OPENCLAW_DB_URL" "$env_file" 2>/dev/null; then
        ui_info "Database config already present; skipping"
        return 0
    fi

    # Append SQLite config to project .env (gateway reads --env-file=.env from repo dir)
    echo "OPENCLAW_DB_URL=sqlite://${db_path}" >> "$env_file"

    ui_success "SQLite database configured: ${db_path}"
}

# ─── Check / uninstall existing installation ─────────────────────────────────

check_existing_enclaws() {
    if [[ -n "$(type -P enclaws 2>/dev/null || true)" ]]; then
        ui_info "Existing Enclaws installation detected"
        return 0
    fi
    # Also check for old openclaw installation
    if [[ -n "$(type -P openclaw 2>/dev/null || true)" ]]; then
        ui_info "Existing OpenClaw installation detected (will migrate)"
        return 0
    fi
    return 1
}

uninstall_existing_enclaws() {
    ui_info "Cleaning up existing installation before upgrade..."

    # Try removing old openclaw
    if command -v openclaw >/dev/null 2>&1; then
        openclaw gateway uninstall --force >/dev/null 2>&1 || true
        npm uninstall -g openclaw >/dev/null 2>&1 || true
    fi

    # Try removing old enclaws
    if command -v enclaws >/dev/null 2>&1; then
        enclaws gateway uninstall --force >/dev/null 2>&1 || true
    fi

    ui_success "Old installation cleaned up"
}

# ─── Post-install ─────────────────────────────────────────────────────────────

resolve_enclaws_version() {
    local version=""
    local claw="${ENCLAWS_BIN:-}"
    if [[ -z "$claw" ]] && command -v enclaws &> /dev/null; then
        claw="$(command -v enclaws)"
    fi
    if [[ -n "$claw" ]]; then
        version=$("$claw" --version 2>/dev/null | head -n 1 | tr -d '\r')
    fi
    echo "$version"
}

# ─── Install summary ─────────────────────────────────────────────────────────

print_install_summary() {
    local installed_version="$1"
    local repo_dir="$2"

    ui_section "Install summary"
    if [[ -n "$installed_version" ]]; then
        ui_kv "Version" "$installed_version"
    fi
    ui_kv "Checkout" "$repo_dir"
    ui_kv "Config" "$repo_dir/.env"
    ui_kv "Database" "SQLite ($HOME/.enclaws/data.db)"
    ui_kv "Start gateway" "enclaws gateway"
    ui_kv "Custom start" "enclaws gateway --bind lan --token YOUR_TOKEN"
    ui_kv "Update" "cd $repo_dir && git pull && pnpm install && pnpm build"
}

open_browser() {
    local url="$1"
    if [[ "$OS" == "macos" ]]; then
        open "$url" 2>/dev/null || true
    elif [[ "$OS" == "linux" ]]; then
        # Skip browser opening on headless servers (no DISPLAY / WAYLAND)
        if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
            ui_info "No display detected (headless server). Open manually:"
            echo ""
            echo "    $url"
            echo ""
            return 0
        fi
        if command -v xdg-open &>/dev/null; then
            xdg-open "$url" 2>/dev/null || true
        elif command -v sensible-browser &>/dev/null; then
            sensible-browser "$url" 2>/dev/null || true
        fi
    fi
}

start_gateway_after_install() {
    local repo_dir="$1"
    local entry="${repo_dir}/dist/index.js"

    if [[ ! -f "$entry" ]]; then
        ui_warn "Gateway entry not found; skipping auto-start"
        ui_info "Build first: cd $repo_dir && pnpm build"
        ui_info "Then start: enclaws gateway"
        return 0
    fi

    local gateway_url="http://localhost:18789"

    echo ""
    ui_section "Starting Enclaws Gateway"
    ui_info "URL: ${gateway_url}"
    ui_info "Press Ctrl+C to stop"
    echo ""
    ui_success "以后启动只需运行: enclaws gateway"
    echo ""

    # Wait for the gateway to be ready, then open browser (background)
    (
        local max_wait=60
        local elapsed=0
        while [[ $elapsed -lt $max_wait ]]; do
            sleep 1
            elapsed=$((elapsed + 1))
            if curl -sf -o /dev/null "http://localhost:18789" 2>/dev/null || \
               wget -q -O /dev/null "http://localhost:18789" 2>/dev/null; then
                open_browser "$gateway_url"
                exit 0
            fi
        done
        ui_warn "Gateway did not respond within ${max_wait}s — open manually: ${gateway_url}"
    ) &

    cd "$repo_dir"
    exec node --env-file=.env dist/index.js gateway --port 18789 --allow-unconfigured
}

# ─── Main installation flow ──────────────────────────────────────────────────

main() {
    if [[ "$HELP" == "1" ]]; then
        print_usage
        return 0
    fi

    bootstrap_gum_temp || true
    print_installer_banner
    print_gum_status
    detect_os_or_die

    local detected_checkout=""
    detected_checkout="$(detect_enclaws_checkout "$PWD" || true)"

    show_install_plan "$detected_checkout"

    if [[ "$DRY_RUN" == "1" ]]; then
        ui_success "Dry run complete (no changes made)"
        return 0
    fi

    # Check for existing installation
    local is_upgrade=false
    if check_existing_enclaws; then
        is_upgrade=true
        uninstall_existing_enclaws
    fi

    # ── Stage 1: Preparing environment ──

    ui_stage "Preparing environment"

    install_homebrew
    if ! check_node; then
        install_node
    fi

    configure_npm_mirror

    # ── Stage 2: Installing Enclaws ──

    ui_stage "Installing Enclaws"

    local repo_dir="$GIT_DIR"
    if [[ -n "$detected_checkout" ]]; then
        repo_dir="$detected_checkout"
    fi

    install_enclaws_from_git "$repo_dir"

    # ── Stage 3: Finalizing setup ──

    ui_stage "Finalizing setup"

    ENCLAWS_BIN="$(resolve_enclaws_bin || true)"

    # PATH warning
    warn_shell_path_missing_dir "$HOME/.enclaws/bin" "Enclaws bin dir (~/.enclaws/bin)"

    # Configure SQLite as default database
    setup_sqlite_db "$repo_dir"

    local installed_version
    installed_version=$(resolve_enclaws_version)

    echo ""
    if [[ -n "$installed_version" ]]; then
        ui_celebrate "⚡ Enclaws installed successfully (${installed_version})!"
    else
        ui_celebrate "⚡ Enclaws installed successfully!"
    fi

    local completion_messages=(
        "安装完毕。你的生产力即将变得不一样。"
        "⚡ 好了，我们来搞点什么？"
        "一键安装完成！就是这么简单。"
        "All done! Gateway is about to start."
    )
    local completion_message
    completion_message="${completion_messages[RANDOM % ${#completion_messages[@]}]}"
    echo -e "${MUTED}${completion_message}${NC}"
    echo ""

    # Print install summary
    print_install_summary "$installed_version" "$repo_dir"

    show_footer_links

    # Auto-start gateway
    start_gateway_after_install "$repo_dir"
}

if [[ "${ENCLAWS_INSTALL_SH_NO_RUN:-0}" != "1" ]]; then
    parse_args "$@"
    configure_verbose
    main
fi
