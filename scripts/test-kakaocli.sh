#!/usr/bin/env bash
set -euo pipefail

# Test the exact pinned reader and production patches in a disposable checkout.
task_script_dir="$(cd "$(dirname "$0")" && pwd)"
task_revision='8b6ffcfdaebc592a735dc1a8bd5e50037e626406'
if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'Reader tests require macOS, Swift 6+, and SQLCipher.'
  exit 1
fi
task_root="$(mktemp -d -t kakao-reader-tests)"
trap 'rm -rf "$task_root"' EXIT
git clone --quiet --no-hardlinks "${KAKAOCLI_TEST_SOURCE:-https://github.com/silver-flight-group/kakaocli.git}" "$task_root/reader"
git -C "$task_root/reader" checkout --quiet --detach "$task_revision"
git -C "$task_root/reader" apply "$task_script_dir/kakaocli-account-detection.patch"
git -C "$task_root/reader" diff --binary > "$task_root/actual.patch"
cmp "$task_root/actual.patch" "$task_script_dir/kakaocli-account-detection.patch"
# Verify the upgrade from PR1 matches the exact diff accepted by repair:kakaocli.
git -C "$task_root/reader" apply "$task_script_dir/kakaocli-chat-names.patch"
cat "$task_script_dir/kakaocli-chat-names.patch" "$task_script_dir/kakaocli-account-detection.patch" > "$task_root/expected.patch"
git -C "$task_root/reader" diff --binary > "$task_root/actual.patch"
cmp "$task_root/actual.patch" "$task_root/expected.patch"
# The same combined patch must also apply to a fresh pinned installation.
git -C "$task_root/reader" apply --reverse "$task_root/expected.patch"
git -C "$task_root/reader" apply "$task_root/expected.patch"
cp "$task_script_dir/../test/reader/ChatNamesTests.swift" "$task_root/reader/Tests/KakaoCoreTests/"
PKG_CONFIG_PATH="$(brew --prefix sqlcipher)/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}" \
  swift test --package-path "$task_root/reader" --disable-sandbox
