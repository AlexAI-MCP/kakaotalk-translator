# KakaoTalk Translator

A local, read-only KakaoTalk conversation viewer with optional Korean–English translation. English interface, Swiss-inspired typography and grid, and Light, Dark and System themes. The settings and status panels stay fixed; only the conversation pane scrolls. Small screens use a Settings drawer.

This is an unofficial project, not affiliated with Kakao. Use only conversations you are authorized to access. Respect participant privacy and the applicable service terms.

## Does sharing this link automatically connect an LLM?

No. This repository provides code, not a hosted service or an AI account. Each user must run it on their own Mac, sign in to their own KakaoTalk, and install/sign in to a supported Claude Code or Codex CLI themselves. The viewer detects compatible installed CLIs, but translation stays off until the user selects an engine. A ChatGPT/Claude browser login alone is not a CLI login.

If using a coding assistant, paste the repository link together with this setup request:

> Read the README and help me set up KakaoTalk Translator on my own Mac. Use my local KakaoTalk account and let me choose a room. Use only my existing, already-authenticated Claude Code or Codex CLI; if none is available, pause and tell me what I need to install or sign in to myself. Never send KakaoTalk messages or use KakaoTalk UI automation. Never print or copy messages, credentials or database files. Leave translation off until I choose the engine. Pause for any administrator password or permission approval so I can complete it myself.

## Try the demo

Requires Node.js 18 or later. There are no runtime dependencies and no npm install step.

~~~sh
npm run demo
~~~

Open http://127.0.0.1:8777/. Click Start reading. All demo messages and translations are fictional, prewritten samples; no KakaoTalk database or AI provider is used.

## Set up your own Mac

Live reading is macOS-only. Each person runs this app on their own Mac with their own KakaoTalk login and permissions. Sending someone your localhost URL does not give them access.

1. Install and sign in to KakaoTalk for Mac, and leave it running.
2. Install Homebrew yourself using the instructions at https://brew.sh if it is missing. Enter any administrator password yourself.
3. Have Command Line Tools with Swift 6 or later available. The setup path uses SwiftPM and does not install the Xcode application.
4. Build the read-only CLI integration:

~~~sh
npm run setup:kakaocli
~~~

The script installs sqlcipher and pkg-config through Homebrew, builds a pinned revision of [kakaocli](https://github.com/silver-flight-group/kakaocli), and links it under your own ~/.local/bin. An existing kakaocli command is left alone. If required, add that directory to your shell PATH as instructed. The script does not ask for or store passwords.

5. If database access is denied, enable your terminal application under System Settings → Privacy & Security → Full Disk Access, then restart that application. Permission approval is a manual step. Accessibility automation is not used.
6. Check your environment and start:

~~~sh
npm run doctor
npm start
~~~

The doctor reports checks without printing room names, messages or credentials. In the browser, choose Browse rooms, select a room, and click Start reading. Selection preserves the exact room identifier. Typing part of a name is also supported, but a unique room selection is preferable.

Live reading has been checked on macOS 26.5 with Node 22.22.3 and Command Line Tools / Swift 6.3.2. The upstream Swift package targets macOS 14 or later; other Mac versions and database revisions still need their own verification. Non-Mac systems can use the demo, not live database reading.

## Translation

Translation is off by default. Choose an installed, already-authenticated Claude Code or Codex CLI, then choose English or Korean. CLI installation and sign-in are your responsibility; this app does not switch accounts or copy authentication.

- English translates messages containing Korean characters.
- Korean translates letter-containing messages without Korean characters.
- Batches contain up to 12 messages. Each source is limited to 2,000 characters for translation; the UI labels truncated inputs.
- Existing messages can be queued when the language or engine changes. Turning translation off does not erase completed translations.
- Claude uses safe mode, disabled tools/hooks, strict MCP configuration and non-persistent sessions. Codex uses ephemeral sessions, disabled hooks and a read-only sandbox. Incompatible CLI versions are disabled.

Enabling translation sends selected message text to the provider authenticated in your CLI and can consume subscription usage. Provider-side retention policies still apply. Claude translation has been exercised on the development Mac. Codex CLI flag support has been checked, but its provider translation has not been end-to-end verified here.

## Privacy and local configuration

The server binds only to 127.0.0.1. Mutating requests require the X-Kakao-Live header; host and origin checks reject foreign browser origins. Do not expose this service through tunnels or public proxies.

Up to 500 messages and room-specific nickname mappings are kept in memory, not written to chat logs. Room selection and non-secret preferences are saved in ignored settings.local.json. The theme is saved in browser local storage. Restarting clears message memory.

The integration uses database read commands only. It does not send messages, change KakaoTalk settings, or run the CLI's status, harvest or UI automation commands. A nickname that cannot be resolved is shown as Name unavailable, not a numeric user ID.

settings.example.json is a non-personal template. Local settings, environment files, databases, logs and exports must never be published. See [SECURITY.md](SECURITY.md).

| Environment variable | Default | Purpose |
|---|---|---|
| KAKAO_LIVE_PORT | 8777 | Local HTTP port |
| KAKAO_LIVE_CHAT | Empty | Initial room name or unique substring |
| KAKAO_LIVE_AGENT | none | none, claude or codex |
| KAKAO_LIVE_TARGET | en | en or ko |
| KAKAOCLI | kakaocli | Executable name or path |
| KAKAO_LIVE_CLAUDE_MODEL | Unset | Optional, explicitly selected Claude model |
| KAKAO_LIVE_SETTINGS_PATH | settings.local.json | Local preference file |

~~~sh
KAKAO_LIVE_CHAT="Your room name" node server.mjs
~~~

Use --no-open to prevent automatic browser opening. Stop reading pauses polling; terminating the server also stops its active child commands.

## Troubleshooting

The server writes structured diagnostics to its terminal: operation, duration, exit status and timeout or failure category. It never logs command output, message text, room names or credentials. To keep these diagnostics in an ignored local file, run `npm start >> app.local.log 2>&1`; inspect them with `tail -f app.local.log`.

- Connection refused: start the server in the project directory and open the matching port.
- No messages after restarting the server: room preferences are preserved, but reading starts stopped. Select your room and click Start reading to resume polling. Enable a translation engine separately if needed.
- Address already in use: stop the previous instance you own or choose another port.
- Room missing: the selected CLI/database may not expose that room. This is not proof of universal open-chat support.
- Read error: check KakaoTalk login and manual Full Disk Access approval, then run the doctor.
- Chat browsing times out or reports “file is not a database”: the pinned reader can time out while detecting newer account IDs. After installing the reader, run `npm run repair:kakaocli`, then restart the viewer. This builds a separate reader with parallel account discovery and a validated local cache, adapted from [upstream PR #20](https://github.com/silver-flight-group/kakaocli/pull/20). The first discovery can take longer; subsequent reads use the cache. The cache lives in `~/.kakaocli/userid.json` with owner-only permissions and contains account metadata, not passwords or message text.
- Translation unavailable: install/sign in to a compatible provider CLI yourself. No credentials belong in this repository.
- Unknown room names: run `npm run repair:kakaocli`, then restart the viewer and browse your chats again. The repaired reader uses the stored room title, open-chat link title, direct-contact name, then up to three participant names from the room's local member list. Participant names are scoped to the room and may differ from a custom title shown in KakaoTalk. If none are available, it displays "Unnamed chat". This is separate from an unknown chat-type classification. Do not run harvest or UI automation to populate names.
- English room labels: choose your translation engine and browse your chats. Korean names appear immediately; English translations load beside them as `한국어 이름 (English Name)`, including in the selected room heading. Room names are sent to the selected provider and labels are cached in memory until restart. Original names and room IDs remain the selection values. Translation off keeps the original names only; failed translations do not prevent reading.
- Name unavailable: room-scoped nicknames may be missing from the local database. Do not use UI automation to populate them.

## Development and public-repository preparation

~~~sh
npm run check
npm test
npm run test:reader # macOS, Swift 6+, and SQLCipher required
npm run release:check
~~~

Reader tests apply both production patches to the pinned kakaocli revision in a disposable checkout and use synthetic databases. They do not read your KakaoTalk data or replace your installed reader. Set `KAKAOCLI_TEST_SOURCE` to an existing kakaocli source checkout to clone locally.

Tests use fictional fixtures only. The release check is a heuristic privacy audit, not a guarantee: review every staged file before publication. Never include real conversation screenshots, invite links, personal room defaults, account details, credentials or database files.

A GitHub Actions workflow is supplied for checks on macOS and Linux with Node 22 and 24; hosted CI is not considered verified until it actually runs. See [CONTRIBUTING.md](CONTRIBUTING.md). Preparing files locally does not create or publish a GitHub repository.

## License and attribution

MIT; see [LICENSE](LICENSE). The separately built kakaocli integration is maintained upstream by silver-flight-group under its own license. It is not bundled here.
