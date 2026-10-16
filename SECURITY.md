# Security and privacy

This app is a local, read-only viewer, not a hosted messaging service.

- The server listens on `127.0.0.1` only. Do not expose it with a tunnel or reverse proxy.
- The viewer uses only kakaocli's `chats`, `messages`, and read-only `query` commands. It does not invoke messaging, login, harvest, or UI automation commands.
- Chat text and translations stay in memory, limited to the most recent 500 messages. Local preferences contain only the chosen room, room ID, engine, language, and polling interval.
- Chat text is sent to your selected AI provider **only when you enable Claude or Codex translation**. Your provider's processing/retention policies still apply.
- The Apple (on-device) engine passes text over stdin to a local helper that uses the macOS Translation framework with downloaded languages. Message text does not leave the Mac, and the helper output is never logged or echoed in errors. The Download Korean button only asks the helper to show Apple's own language download prompt (or opens Language & Region settings); no message text is involved.
- Claude uses safe mode, disabled tools/hooks/MCP, and disabled session persistence. Codex uses ephemeral sessions, disabled hooks, stdin input, and a read-only sandbox. Provider CLIs and operating-system policies can change; use compatible, trusted releases.
- Do not add credentials, `.env` files, local preferences, database files, logs, chat exports, or screenshots of real chats to Git.
- Themes are saved in your browser's local storage. No messages are saved there.
- A public source repository does not publish your local chat stream or share your KakaoTalk login.

Report a suspected issue privately to the repository owner. Do not include chat text, account identifiers, keys, tokens, or passwords in a public issue. Run `npm run release:check` before publishing or pushing changes.
