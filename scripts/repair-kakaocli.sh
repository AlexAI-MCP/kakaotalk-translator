#!/usr/bin/env bash
set -euo pipefail

# DeviceInfo fix adapted from upstream PR #20 (66fee27bf1f1e872765cf6ac3ab3753afdd2d6c4).
# Keeps the pinned source intact; fixes account discovery and local room names in a separate build.
task_script_dir="$(cd "$(dirname "$0")" && pwd)"
task_revision='8b6ffcfdaebc592a735dc1a8bd5e50037e626406'
task_root="${XDG_DATA_HOME:-$HOME/.local/share}/kakaotalk-live"
task_source="$task_root/kakaocli-reader-fix"
task_patch="$task_script_dir/kakaocli-account-detection.patch"
task_names_patch="$task_script_dir/kakaocli-chat-names.patch"
if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'The reader requires macOS.'
  exit 1
fi
for task_command in brew swift git; do
  command -v "$task_command" >/dev/null || { printf '%s\n' "Missing prerequisite: $task_command"; exit 1; }
done
if [[ ! -e "$task_source" ]]; then
  mkdir -p "$task_root"
  git clone https://github.com/silver-flight-group/kakaocli.git "$task_source"
  git -C "$task_source" checkout --detach "$task_revision"
fi
if [[ "$(git -C "$task_source" rev-parse HEAD)" != "$task_revision" ]]; then
  printf '%s\n' 'Repair source has an unexpected revision; left unchanged.'
  exit 1
fi
task_diff="$(mktemp -t kakao-reader-diff)"
task_expected="$(mktemp -t kakao-reader-expected)"
trap 'rm -f "$task_diff" "$task_expected"' EXIT
# Match git diff's source-file order, so only these reviewed patches are accepted.
cat "$task_names_patch" "$task_patch" > "$task_expected"
git -C "$task_source" diff --binary > "$task_diff"
if [[ ! -s "$task_diff" ]]; then
  git -C "$task_source" apply --check "$task_expected"
  git -C "$task_source" apply "$task_expected"
elif cmp -s "$task_diff" "$task_patch"; then
  git -C "$task_source" apply --check "$task_names_patch"
  git -C "$task_source" apply "$task_names_patch"
elif ! cmp -s "$task_diff" "$task_expected"; then
  printf '%s\n' 'Repair source contains unexpected changes; left unchanged.'
  exit 1
fi
PKG_CONFIG_PATH="$(brew --prefix sqlcipher)/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}" \
  swift build --package-path "$task_source" --disable-sandbox -c release
mkdir -p "$HOME/.local/bin"
task_link="$HOME/.local/bin/kakaocli"
task_original="$task_root/kakaocli-$task_revision/.build/release/kakaocli"
task_binary="$task_source/.build/release/kakaocli"
if [[ -e "$task_link" || -L "$task_link" ]]; then
  if [[ ! -L "$task_link" ]] || { [[ "$(readlink "$task_link")" != "$task_original" ]] && [[ "$(readlink "$task_link")" != "$task_binary" ]]; }; then
    printf '%s\n' 'An unrelated kakaocli installation was left unchanged.'
    printf '%s\n' "Use KAKAOCLI=$task_binary to select this build."
    exit 1
  fi
fi
ln -sfn "$task_binary" "$task_link"
printf '%s\n' 'Checking database access and warming the account cache. Initial discovery can take a few minutes.'
if ! "$task_binary" chats --limit 1 --json >/dev/null 2>/dev/null; then
  printf '%s\n' 'The repaired reader still cannot read the database. Check permissions and database compatibility.'
  exit 1
fi
printf '%s\n' 'Account detection and room-name repairs installed. Restart the viewer.'
