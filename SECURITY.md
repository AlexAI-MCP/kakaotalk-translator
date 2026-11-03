# Security and privacy

This app is a local, read-only viewer, not a hosted messaging service.

- The server listens on `127.0.0.1` only. Do not expose it with a tunnel or reverse proxy.
- The viewer uses only kakaocli's `chats`, `messages`, and read-only `query` commands. It does not invoke messaging, login, harvest, or UI automation commands.
- Chat text and translations stay in memory, limited to the most recent 500 messages. Local preferences contain only the chosen room, room ID, engine, language, and polling interval.
- Chat text is sent to your selected AI provider **only when you enable translation**. Your provider's processing/retention policies still apply.
- Photo attachment links stay in memory and are exposed to the browser only as opaque local IDs. Images are fetched from `https://talk.kakaocdn.net` through the local server, without following redirects, and checked for supported raster signatures and a 20 MiB limit. Photos are not sent to translation providers or saved by the app.
- Claude uses safe mode, disabled tools/hooks/MCP, and disabled session persistence. Codex uses ephemeral sessions, disabled hooks, stdin input, and a read-only sandbox. Provider CLIs and operating-system policies can change; use compatible, trusted releases.
- Do not add credentials, `.env` files, local preferences, database files, logs, chat exports, or screenshots of real chats to Git.
- Themes are saved in your browser's local storage. No messages are saved there.
- A public source repository does not publish your local chat stream or share your KakaoTalk login.

Report a suspected issue privately to the repository owner. Do not include chat text, account identifiers, keys, tokens, or passwords in a public issue. Run `npm run release:check` before publishing or pushing changes.
