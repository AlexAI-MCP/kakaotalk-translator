# KakaoTalk Translator

A local, read-only KakaoTalk conversation viewer with optional Korean–English translation through a CLI, an OpenAI-compatible API, or on-device Apple Translation. English interface, Swiss-inspired typography and grid, and Light, Dark and System themes. The controls and status panels stay fixed; only the conversation pane scrolls. Small screens use a Controls drawer. API connections and model selection have a dedicated settings page.

This is an unofficial project, not affiliated with Kakao. Use only conversations you are authorized to access. Respect participant privacy and the applicable service terms.

## Does sharing this link automatically connect an LLM?

No. This repository provides code, not a hosted service or an AI account. Each user must run it on their own Mac and sign in to their own KakaoTalk. For translation, configure a local or hosted compatible API, install/sign in to a supported Claude Code or Codex CLI, or build the optional on-device Apple Translation helper. Translation stays off until the user selects an engine. A ChatGPT/Claude browser login alone is not a CLI login or an API key.

If using a coding assistant, paste the repository link together with this setup request:

> Read the README and help me set up KakaoTalk Translator on my own Mac. Use my local KakaoTalk account and let me choose a room. Use only my existing, already-authenticated Claude Code or Codex CLI, a configured compatible API, or the on-device Apple Translation helper on macOS 26 or later; if none is available, pause and tell me what I need to install or sign in to myself. Never send KakaoTalk messages or use KakaoTalk UI automation. Never print or copy messages, credentials or database files. Leave translation off until I choose the engine. Pause for any administrator password or permission approval so I can complete it myself.

## Try the demo

Requires Node.js 18 or later. There are no runtime dependencies and no npm install step.

~~~sh
npm run demo
~~~

Open http://127.0.0.1:8777/. Reading starts automatically. Demo messages and default translations are fictional, prewritten samples; no KakaoTalk database or AI provider is used by default. You can explicitly select an API engine to translate fictional demo messages with your model. API settings in demo mode stay in memory.

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

The doctor reports checks without printing room names, messages or credentials. On first launch the browser opens the room list; select a room and reading starts right away. The room is remembered, so later launches start reading it automatically. Use Stop reading to pause. Selection preserves the exact room identifier. Typing part of a name is also supported, but a unique room selection is preferable.

Live reading has been checked on macOS 26.5 with Node 22.22.3 and Command Line Tools / Swift 6.3.2. The upstream Swift package targets macOS 14 or later; other Mac versions and database revisions still need their own verification. Non-Mac systems can use the demo, not live database reading.

## Photos

Photo posts, including albums, show thumbnails when the local database contains valid attachment links. Click a thumbnail to open the full-size image in a new tab. The local server retrieves images from Kakao's image CDN as you view them; images are not sent to an AI provider or saved by the app. Expired or unsupported images show an unavailable notice. Try KakaoTalk if a photo no longer loads. Each image is limited to 20 MiB.

## Translation

Translation is off by default. Choose a configured API or an installed, already-authenticated Claude Code or Codex CLI, or Apple (on-device), then choose English or Korean. CLI installation and sign-in are your responsibility; this app does not switch accounts or copy authentication.

- English translates messages containing Korean characters.
- Korean translates letter-containing messages without Korean characters.
- Batches contain up to 12 messages. Each source is limited to 2,000 characters for translation; the UI labels truncated inputs.
- When reading starts automatically with an engine that sends text off your Mac (Claude Code, Codex or an API), translation is paused until you click Translate now or choose an engine or language. Apple (on-device) translates right away. Clicking Start reading yourself never pauses translation.
- Existing messages can be queued when the language or engine changes. Turning translation off does not erase completed translations.
- Claude uses safe mode, disabled tools/hooks, strict MCP configuration and non-persistent sessions. Codex uses ephemeral sessions, disabled hooks and a read-only sandbox. Incompatible CLI versions are disabled.

### Apple (on-device)

The optional Apple engine uses the macOS Translation framework through a small local helper. It requires macOS 26 or later and Swift Command Line Tools.

~~~sh
npm run setup:apple
~~~

If Korean is not downloaded yet, setup also shows the macOS download window. You can instead click "Download Korean for on-device translation" under Translation in the viewer, or add Korean under System Settings > General > Language & Region > Translation Languages. The viewer picks up the new language automatically; no restart is needed. The doctor reports whether the Korean to English and English to Korean languages are installed; a direction whose language is missing stays disabled. No message text leaves the Mac, and no account or subscription is used. It is much faster (about 0.25 s per 12-message batch here, versus about 3 s for a cloud model) but weaker with slang, tone and dropped subjects.

### Cloud CLIs

Enabling translation sends selected message text to your configured API or the provider authenticated in your CLI and can consume API or subscription usage. Provider-side retention policies still apply. Claude translation has been exercised on the development Mac. Codex CLI flag support has been checked, but its provider translation has not been end-to-end verified here.

## OpenAI-compatible API settings

Open **API settings** in the viewer, or visit http://127.0.0.1:8777/settings.

1. Enter the API base URL, including its prefix. For oMLX, use `http://127.0.0.1:8000/v1`; for OpenAI, use `https://api.openai.com/v1`. Other compatible local servers and gateways work with the same endpoints.
2. Enter an API key if the server requires one. Local servers may also require authentication.
3. Click **Load models** to query `GET /models`, then select a chat model. You can enter a model ID manually if discovery is unavailable. A server's list may include non-chat models.
4. Choose **Automatic** prompting or a manual profile. The preview shows the exact request for a fictional sample.
5. Click **Test translation** to check connectivity and the translation array format with a fictional Korean sentence. Hosted APIs can charge for this request.
6. Save, return to the conversation, and choose **OpenAI-compatible API** to enable translation. Saving settings alone does not select that engine.

The app uses non-streaming `POST /chat/completions` with standard message roles. It does not require a provider-specific JSON-schema mode, tool calls, or SDK. Results must contain one translated string per input; malformed or truncated batches are marked unavailable. Redirects are rejected. Requests time out after 90 seconds and responses are limited to 2 MiB. Stopping reading or changing translation settings cancels active API translations and discards outdated results.

API settings, including the optional key, are stored separately in ignored `api-provider.local.json` with owner-only permissions. This is a local plaintext file, not an encrypted credential store. The key is never returned to the browser or written to diagnostics. Leaving the key field blank preserves a saved key only for the same API URL; changing the URL clears the key association. Use **Remove the saved API key** to clear it.

Model profiles follow documented role and prompting differences:

- **Qwen:** separate system and user messages. Original Qwen3 hybrid IDs request non-thinking with `/no_think` and Qwen's recommended non-thinking sampling values. Other Qwen variants keep server defaults; thinking-only and later variants are not forced into hybrid mode. The soft switch depends on the serving template.
- **Gemma 1–3 / 3n:** instructions go in the user message. **Gemma 4:** uses a system message.
- **GPT / OpenAI reasoning:** concise instructions with no chain-of-thought request. Modern models use developer messages; older GPT models use system messages and legacy o1-mini/preview use a user message. Sampling parameters are omitted.
- **General chat model:** system and user messages with server defaults.

Automatic detection uses model names and is a heuristic. Overrides support aliases and custom fine-tunes. The API server applies the model's actual chat template; the app never inserts tokenizer control tokens. Profiles provide a starting point, not a guarantee of translation quality across every model or quantization.

Official guidance checked October 16, 2026:

| Profile | Source and implemented behavior |
| --- | --- |
| Qwen3 original hybrid | [Qwen quickstart](https://qwen.readthedocs.io/en/latest/getting_started/quickstart.html): `/no_think` soft switch, temperature 0.7, top_p 0.8 for non-thinking requests. |
| Qwen3 Instruct-2507 | [Qwen's model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507): temperature 0.7, top_p 0.8; no thinking switch because this variant is non-thinking. |
| Gemma 1–3 / 3n | [Google formatting guidance](https://ai.google.dev/gemma/docs/core/prompt-structure): instructions inside the user message. |
| Gemma 4 | [Google Gemma 4 formatting](https://ai.google.dev/gemma/docs/core/prompt-formatting-gemma4): system role supported; the server handles tokenizer formatting and thinking controls. |
| GPT / OpenAI reasoning | [OpenAI reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning-best-practices): concise instructions, separate data, no requested chain of thought, developer role for supported model generations. Older model roles are handled separately. |
| Claude | [Anthropic prompting guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices): translator role, clear output constraints with parser context, and XML-delimited input JSON. No assistant prefill. Native API and Claude CLI evals use this profile; the CLI receives instructions and data together through stdin. |

The translation wording is our task-specific implementation, not a vendor-provided optimal translation prompt. Vendor guidance does not establish a universally best Korean-English prompt. The generic Qwen fallback (including later generations and Thinking-2507) preserves server defaults; it is not a model-specific tuning claim. Exact aliases, fine-tunes, and quantizations need evals.

Qwen also recommends top_k=20 and min_p=0 for the two tuned profiles. These are server-specific extensions, so this portable client leaves them to server configuration rather than assuming every compatible endpoint accepts them. Output budgets and hard thinking switches likewise depend on the server. The app requests JSON using instructions and validates the result; it does not yet use provider-specific structured-output constraints. Few-shot examples and reasoning settings should be evaluated before introducing them into the translation prompt.

## Compare translation models

The simple eval uses 16 fictional Korean ↔ English chat messages covering tone, politeness, idioms, ambiguity, negation, code, URLs, details, and instructions that must be translated as text. No KakaoTalk database or real conversations are read. The runner reuses the viewer's API prompt profiles and CLI translation prompt.

For local models, it reads your API settings without changing them:

```sh
npm run eval -- --models Qwen3-4B-Instruct-2507-4bit,gemma-4-e2b-it-4bit
```

Models must already be available on the selected server. You can use any configured compatible API or choose an endpoint explicitly. Keys belong in the environment or private settings, not command arguments:

```sh
# Use an existing OPENAI_API_KEY environment variable.
npm run eval -- --base-url https://api.openai.com/v1 --api-key-env OPENAI_API_KEY --models YOUR_GPT_MODEL

# Native Anthropic API; uses an existing ANTHROPIC_API_KEY environment variable.
npm run eval -- --provider anthropic --models YOUR_CLAUDE_MODEL

# Already-authenticated CLI providers.
npm run eval -- --provider claude --models YOUR_CLAUDE_MODEL
npm run eval -- --provider codex --models YOUR_CODEX_MODEL
```

Hosted API and CLI evals can consume paid usage. Runs are sequential, with four messages per request by default. `--batch-size` supports 1–12 messages and `--repeat` supports 1–10 repetitions. Use the same dataset, batch size, repeat count, and prompt configuration when comparing models. Native Anthropic uses the Claude prompt profile with its `/messages` schema. CLI default model identity is unverified unless you explicitly pass a model.

Each run writes private JSON results and a standalone HTML review report in ignored `artifacts/evals/`. The report includes:

- Mechanical checks for complete translation arrays, nonempty output, target script, preserved identifiers/URLs/code/emoji, and line breaks. These checks are **not translation-quality scores**.
- Batch latency, prompt hashes, requested/reported models, prompt profiles, and token counts when the provider returns them. Latency includes cold model loads, network time, and CLI startup; small p50/p95 samples are noisy. Prices are not inferred.
- Blind review cards for rating meaning, naturalness, and tone from 1–5, plus an export button for saving ratings. Model identities can be revealed after review. The illustrative references are not exclusive correct answers and have not been expert-certified.

Open the HTML file printed by the runner. Ratings remain in page memory until exported; reopening the report resets them. Only fully rated outputs contribute to the displayed human average. Compare equal review coverage before choosing a model. One run is a smoke benchmark, not proof of a universal best model.

To compare results from separate providers, keep the run settings identical and merge their JSON files:

```sh
npm run eval -- --compare artifacts/evals/local.json artifacts/evals/claude.json --out artifacts/evals/comparison
```

Use `--out artifacts/evals/local` to name a run, or use the automatically generated unique prefix. Existing files at an explicitly selected prefix are replaced. A run with failed mechanical checks still writes its reports and exits with status 1 so those failures remain visible.

```sh
# Exercise the runner/report without model calls or credentials.
npm run eval -- --dry-run

npm run eval -- --help
```

Methodology: task-specific examples, mechanical checks, and human review follow [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices). No hosted eval service or LLM judge is required.

## Privacy and local configuration

The server binds only to 127.0.0.1. Mutating requests require the X-Kakao-Live header; host and origin checks reject foreign browser origins. Do not expose this service through tunnels or public proxies.

Up to 500 messages and room-specific nickname mappings are kept in memory, not written to chat logs. Room selection and non-secret preferences are saved in ignored settings.local.json. The theme is saved in browser local storage. Restarting clears message memory.

The integration uses database read commands only. It does not send messages, change KakaoTalk settings, or run the CLI's status, harvest or UI automation commands. A nickname that cannot be resolved is shown as Name unavailable, not a numeric user ID.

settings.example.json is a non-personal template. Local settings, environment files, databases, logs and exports must never be published. See [SECURITY.md](SECURITY.md).

| Environment variable | Default | Purpose |
|---|---|---|
| KAKAO_LIVE_PORT | 8777 | Local HTTP port |
| KAKAO_LIVE_CHAT | Empty | Initial room name or unique substring |
| KAKAO_LIVE_AGENT | none | none, claude, codex, apple or api |
| KAKAO_LIVE_TARGET | en | en or ko |
| KAKAOCLI | kakaocli | Executable name or path |
| KAKAO_LIVE_APPLE_TRANSLATE | kakao-apple-translate | Apple Translation helper name or path |
| KAKAO_LIVE_CLAUDE_MODEL | Unset | Optional, explicitly selected Claude model |
| KAKAO_LIVE_SETTINGS_PATH | settings.local.json | Local preference file |
| KAKAO_LIVE_API_SETTINGS_PATH | api-provider.local.json | Private API connection and key file |

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
- Apple (on-device) disabled: run npm run setup:apple, or click Download Korean in the viewer, then run the doctor. Restart the viewer only after building the helper for the first time.
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
