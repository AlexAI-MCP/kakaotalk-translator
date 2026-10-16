#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'Apple on-device translation requires macOS 26 or later.'
  exit 1
fi
macos_major="$(sw_vers -productVersion | cut -d. -f1)"
if (( macos_major < 26 )); then
  printf '%s\n' 'Apple on-device translation requires macOS 26 or later. Use another translation engine instead.'
  exit 1
fi
if ! command -v swift >/dev/null 2>&1 || ! xcode-select -p >/dev/null 2>&1; then
  printf '%s\n' 'Install Apple Command Line Tools yourself (xcode-select --install), then rerun.' 'Swift 6.2+ is required. Full Xcode is not installed by this script.'
  exit 1
fi
swift_version="$(swift --version 2>/dev/null | sed -n 's/.*Swift version \([0-9]*\.[0-9]*\).*/\1/p' | head -1)"
swift_major="${swift_version%%.*}"
swift_minor="${swift_version#*.}"
if [[ -z "$swift_version" ]] || (( swift_major < 6 || (swift_major == 6 && swift_minor < 2) )); then
  printf '%s\n' 'Swift 6.2+ is required. Update Command Line Tools yourself before continuing.'
  exit 1
fi

repo="$(cd "$(dirname "$0")/.." && pwd)"
package_dir="$repo/tools/apple-translate"
build_log="$(mktemp -t kakao-apple-translate-build)"
if ! swift build -c release --package-path "$package_dir" >"$build_log" 2>&1; then
  printf '%s\n' 'Build failed. Last 20 compiler output lines:'
  tail -n 20 "$build_log"
  exit 1
fi
binary="$package_dir/.build/release/kakao-apple-translate"

mkdir -p "$HOME/.local/bin"
link="$HOME/.local/bin/kakao-apple-translate"
if [[ -e "$link" && ! -L "$link" ]]; then
  printf '%s\n' 'An existing ~/.local/bin/kakao-apple-translate is not a symlink and was left unchanged.' "Use the built binary directly: $binary"
  exit 1
fi
ln -sfn "$binary" "$link"
printf '%s\n' "Built and linked ~/.local/bin/kakao-apple-translate to $binary"

check="$("$binary" --check)"
printf 'Language packs: %s\n' "$check"
if [[ "$check" == *'"ko-en":"installed"'* && "$check" == *'"en-ko":"installed"'* ]]; then
  printf '%s\n' 'Korean and English translation packs are installed.'
else
  printf '%s\n' 'Korean and English translation packs are not fully installed.' 'Open System Settings > General > Language & Region > Translation Languages and download Korean.'
fi
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) printf '%s\n' 'If needed, add ~/.local/bin to your shell PATH:' 'export PATH="$HOME/.local/bin:$PATH"' ;;
esac
