#!/usr/bin/env bash
set -euo pipefail

APP="ant"
REPO="sapirrior/ant"

# ant Brand Color Palette (from src/output/color.ts)
# Primary: Clean light blue-purple (#b1b9f9)
PRIMARY='\033[38;2;177;185;249m'
# Secondary: Medium soft blue (#93a5ff)
SECONDARY='\033[38;2;147;165;255m'
# Accent: Electric violet (#af87ff)
ACCENT='\033[38;2;175;135;255m'
# Success: Bright green (#4eba65)
SUCCESS='\033[38;2;78;186;101m'
# Error: Bright red (#ff6b80)
ERROR='\033[38;2;255;107;128m'
# Warning: Bright amber (#ffc107)
WARNING='\033[38;2;255;193;7m'
# Muted: Inactive gray (#999999)
MUTED='\033[38;2;153;153;153m'
WHITE='\033[1;37m'
NC='\033[0m' # Reset

# Fallback for terminals with basic ANSI color support
if [ "${COLORTERM:-}" != "truecolor" ] && [ "${COLORTERM:-}" != "24bit" ]; then
    PRIMARY='\033[38;5;147m'
    SECONDARY='\033[38;5;111m'
    ACCENT='\033[38;5;141m'
    SUCCESS='\033[38;5;71m'
    ERROR='\033[38;5;204m'
    WARNING='\033[38;5;214m'
    MUTED='\033[38;5;245m'
fi

usage() {
    cat <<EOF
ant installer

Usage: install.sh [options]

Options:
    -h, --help              Display this help message
    -v, --version <version> Install a specific version (e.g. 0.1.1)
    -b, --binary <path>     Install from a local file instead of downloading
        --no-modify-path    Don't modify shell config files (.zshrc, .bashrc, etc.)

Examples:
    curl -fsSL https://raw.githubusercontent.com/${REPO}/main/installer/install.sh | bash
    curl -fsSL https://raw.githubusercontent.com/${REPO}/main/installer/install.sh | bash -s -- --version 0.1.1
    ./installer/install.sh --binary /path/to/ant
EOF
}

requested_version=${VERSION:-}
no_modify_path=false
binary_path=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -v|--version)
            if [[ -n "${2:-}" ]]; then
                requested_version="$2"
                shift 2
            else
                echo -e "${ERROR}Error: --version requires a version argument${NC}"
                exit 1
            fi
            ;;
        -b|--binary)
            if [[ -n "${2:-}" ]]; then
                binary_path="$2"
                shift 2
            else
                echo -e "${ERROR}Error: --binary requires a path argument${NC}"
                exit 1
            fi
            ;;
        --no-modify-path)
            no_modify_path=true
            shift
            ;;
        *)
            echo -e "${WARNING}Warning: Unknown option '$1'${NC}" >&2
            shift
            ;;
    esac
done

# Standard target path: ~/.ant/bin/ant
INSTALL_DIR="$HOME/.ant/bin"
mkdir -p "$INSTALL_DIR"

# Detect Termux environment
is_termux=false
if [ -n "${PREFIX:-}" ] && [ -d "${PREFIX}/bin" ]; then
    is_termux=true
fi

# Detect OS and architecture
if [ -n "$binary_path" ]; then
    if [ ! -f "$binary_path" ]; then
        echo -e "${ERROR}Error: File not found at ${binary_path}${NC}"
        exit 1
    fi
    specific_version="local"
else
    raw_os=$(uname -s)
    os=$(echo "$raw_os" | tr '[:upper:]' '[:lower:]')
    case "$raw_os" in
      Darwin*) os="darwin" ;;
      Linux*) os="linux" ;;
      MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    esac

    arch=$(uname -m)
    if [[ "$arch" == "aarch64" ]]; then
      arch="arm64"
    elif [[ "$arch" == "x86_64" ]]; then
      arch="x64"
    fi

    # Check for Rosetta on macOS
    if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
      rosetta_flag=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)
      if [ "$rosetta_flag" = "1" ]; then
        arch="arm64"
      fi
    fi

    if [ "$is_termux" = "true" ]; then
      # Termux on Android runs bundled JS via bun
      asset_name="ant.js"
    else
      combo="$os-$arch"
      case "$combo" in
        linux-x64)    asset_name="ant-linux-x64" ;;
        linux-arm64)  asset_name="ant-linux-arm64" ;;
        darwin-x64)   asset_name="ant-darwin-x64" ;;
        darwin-arm64) asset_name="ant-darwin-arm64" ;;
        windows-x64)  asset_name="ant-windows-x64.exe" ;;
        *)
          echo -e "${ERROR}Error: Unsupported platform ${combo}${NC}"
          exit 1
          ;;
      esac
    fi

    # Resolve latest version if not explicitly passed
    if [ -z "$requested_version" ]; then
        latest_tag=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" | sed -n 's/.*"tag_name": *"v\?\([^"]*\)".*/\1/p' | head -n 1)
        if [ -z "$latest_tag" ]; then
            specific_version="latest"
            download_url="https://github.com/${REPO}/releases/latest/download/${asset_name}"
        else
            specific_version="$latest_tag"
            download_url="https://github.com/${REPO}/releases/download/v${specific_version}/${asset_name}"
        fi
    else
        specific_version="${requested_version#v}"
        download_url="https://github.com/${REPO}/releases/download/v${specific_version}/${asset_name}"

        # Verify release exists
        http_code=$(curl -sI -o /dev/null -w "%{http_code}" "https://github.com/${REPO}/releases/tag/v${specific_version}")
        if [ "$http_code" = "404" ]; then
            echo -e "${ERROR}Error: Release v${specific_version} not found.${NC}"
            echo -e "${MUTED}See available releases at: https://github.com/${REPO}/releases${NC}"
            exit 1
        fi
    fi
fi

print_logo_and_footer() {
    echo -e ""
    echo -e "${PRIMARY}   ___        __   ${NC}"
    echo -e "${PRIMARY}  / _ | ___  / /_  ${NC}${MUTED}🐜 autonomous terminal companion${NC}"
    echo -e "${PRIMARY} / __ |/ _ \/ __/  ${NC}"
    echo -e "${PRIMARY}/_/ |_/_//_/\__/   ${NC}"
    echo -e ""
    echo -e "${SECONDARY}Quickstart:${NC}"
    echo -e "  ant --help               ${MUTED}# View commands and capabilities${NC}"
    echo -e "  ant \"<your instruction>\" ${MUTED}# Execute a task${NC}"
    echo -e ""
    echo -e "${MUTED}Documentation & issues: ${NC}https://github.com/${REPO}"
    echo -e ""
}

print_progress() {
    local bytes="$1"
    local length="$2"
    [ "$length" -gt 0 ] || return 0

    local width=40
    local percent=$(( bytes * 100 / length ))
    [ "$percent" -gt 100 ] && percent=100
    local on=$(( percent * width / 100 ))
    local off=$(( width - on ))

    local filled=$(printf "%*s" "$on" "")
    filled=${filled// /■}
    local empty=$(printf "%*s" "$off" "")
    empty=${empty// / }

    local mb_down=$(awk "BEGIN {printf \"%.1f\", $bytes / 1048576}")
    local mb_total=$(awk "BEGIN {printf \"%.1f\", $length / 1048576}")

    printf "\r${MUTED}Fetching: [${PRIMARY}%s${MUTED}%s] %d%% (%s/%s MB)${NC}" \
        "$filled" "$empty" "$percent" "$mb_down" "$mb_total"
}

unbuffered_sed() {
    if echo | sed -u -e "" >/dev/null 2>&1; then
        sed -nu "$@"
    elif echo | sed -l -e "" >/dev/null 2>&1; then
        sed -nl "$@"
    else
        local pad="$(printf "\n%512s" "")"
        sed -ne "s/$/\\${pad}/" "$@"
    fi
}

download_file_with_progress() {
    local url="$1"
    local target_file="$2"

    local total_size
    total_size=$(curl -sI -L "$url" | tr -d '\r' | awk 'BEGIN{IGNORECASE=1} /^Content-Length:/ {print $2}' | tail -n 1)
    total_size=${total_size:-0}

    touch "$target_file"

    if [ "$total_size" -gt 0 ]; then
        curl -fL --progress-bar "$url" -o "$target_file" 2>&1 | \
        unbuffered_sed '
            s/^[ \t]*//
            s/[ \t]*$//
            /^$/d
            s/^#* *//
            s/%//
            /^[0-9]/ {
                p
            }
        ' | while read -r percent; do
            if [[ "$percent" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
                local current_bytes=$(awk "BEGIN {printf \"%.0f\", ($percent * $total_size) / 100}")
                print_progress "$current_bytes" "$total_size"
            fi
        done
        echo ""
    else
        echo -e "${MUTED}Downloading ant...${NC}"
        curl -fL "$url" -o "$target_file"
    fi
}

check_existing_version() {
    local target_bin="${INSTALL_DIR}/ant"
    if [ -x "$target_bin" ]; then
        local current
        current=$("$target_bin" --version 2>/dev/null || echo "")
        current=$(echo "$current" | tr -d 'v' | awk '{print $1}')
        local target_clean=$(echo "$specific_version" | tr -d 'v')

        if [ "$specific_version" != "latest" ] && [ -n "$current" ] && [ "$current" = "$target_clean" ]; then
            echo -e "${SUCCESS}ant version ${specific_version} is already installed at ${target_bin}.${NC}"
            print_logo_and_footer
            exit 0
        fi
    fi
}

install_ant() {
    local target_bin="${INSTALL_DIR}/ant"

    if [ -n "$binary_path" ]; then
        echo -e "${MUTED}Installing ant from local file: ${NC}${binary_path}"
        cp "$binary_path" "$target_bin"
    else
        echo -e "${MUTED}Installing ant ${SECONDARY}${specific_version}${MUTED} into ${WHITE}${INSTALL_DIR}/ant${NC}"
        local tmp_file
        tmp_file=$(mktemp)
        download_file_with_progress "$download_url" "$tmp_file"

        mv "$tmp_file" "$target_bin"
    fi

    chmod 755 "$target_bin"

    # Termux post-install adjustments for JS bundle and native compilation
    if [ "$is_termux" = "true" ]; then
        # Ensure shebang uses termux env
        if command -v termux-fix-shebang >/dev/null 2>&1; then
            termux-fix-shebang "$target_bin" 2>/dev/null || true
        fi

        # Check if bun runtime is present
        if command -v bun >/dev/null 2>&1; then
            echo -e "${MUTED}Compiling native standalone binary for Termux...${NC}"
            local ant_js="${INSTALL_DIR}/ant.js"
            cp "$target_bin" "$ant_js"
            if bun build --compile --no-env-file "$ant_js" --outfile "${target_bin}.tmp" >/dev/null 2>&1; then
                mv "${target_bin}.tmp" "$target_bin"
                chmod 755 "$target_bin"
                echo -e "${SUCCESS}Compiled native ant binary successfully.${NC}"
            else
                rm -f "${target_bin}.tmp"
            fi
        else
            echo -e "\n${WARNING}Notice: 'bun' was not found in your PATH.${NC}"
            echo -e "${MUTED}Termux requires Bun to run ant.js. Install it via:${NC}"
            echo -e "  ${WHITE}pkg install bun${NC}\n"
        fi
    fi

    echo "$specific_version" > "${INSTALL_DIR}/.version"

    echo -e "${SUCCESS}Successfully installed ant to ${WHITE}${target_bin}${NC}"
}

add_to_path() {
    local config_file="$1"
    local export_line="export PATH=\"${INSTALL_DIR}:\$PATH\""

    if [ -f "$config_file" ] && grep -Fq "${INSTALL_DIR}" "$config_file" 2>/dev/null; then
        return 0
    fi

    if [ -w "$config_file" ] || [ ! -e "$config_file" ]; then
        echo -e "\n# ant" >> "$config_file"
        echo "$export_line" >> "$config_file"
        echo -e "${MUTED}Added ${PRIMARY}~/.ant/bin${MUTED} to PATH in ${WHITE}${config_file}${NC}"
    else
        echo -e "${WARNING}Unable to write to ${config_file}. Add this line manually:${NC}"
        echo -e "  ${export_line}"
    fi
}

configure_shell_path() {
    if [ "$no_modify_path" = "true" ]; then
        return 0
    fi

    if [[ ":$PATH:" == *":$INSTALL_DIR:"* ]]; then
        return 0
    fi

    local current_shell
    current_shell=$(basename "${SHELL:-bash}")
    local XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}

    case "$current_shell" in
        fish)
            local fish_conf="$HOME/.config/fish/config.fish"
            if [ -w "$fish_conf" ] || [ ! -e "$fish_conf" ]; then
                mkdir -p "$(dirname "$fish_conf")"
                if ! grep -Fq "${INSTALL_DIR}" "$fish_conf" 2>/dev/null; then
                    echo -e "\n# ant" >> "$fish_conf"
                    echo "fish_add_path ${INSTALL_DIR}" >> "$fish_conf"
                    echo -e "${MUTED}Added ${PRIMARY}~/.ant/bin${MUTED} to PATH in ${WHITE}${fish_conf}${NC}"
                fi
            fi
            ;;
        zsh)
            for f in "${ZDOTDIR:-$HOME}/.zshrc" "$HOME/.zshrc" "$HOME/.profile"; do
                if [ -f "$f" ]; then
                    add_to_path "$f"
                    return 0
                fi
            done
            add_to_path "$HOME/.zshrc"
            ;;
        bash|*)
            for f in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
                if [ -f "$f" ]; then
                    add_to_path "$f"
                    return 0
                fi
            done
            add_to_path "$HOME/.bashrc"
            ;;
    esac
}

# Run execution steps
check_existing_version
install_ant
configure_shell_path

if [ -n "${GITHUB_ACTIONS:-}" ] && [ "${GITHUB_ACTIONS}" = "true" ]; then
    echo "$INSTALL_DIR" >> "$GITHUB_PATH"
fi

print_logo_and_footer
