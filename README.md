<div align="center">

<img src="src-tauri/icons/128x128.png" alt="Mewsenger" width="96" height="96" />

# Mewsenger

**A fast, native Windows desktop client for Messenger, with multiple accounts, native notifications and privacy tools.**

[![Release](https://img.shields.io/github/v/release/mewisme/mewsenger?label=release)](https://github.com/mewisme/mewsenger/releases/latest)
[![Verify](https://img.shields.io/github/actions/workflow/status/mewisme/mewsenger/build.yml?branch=main&label=verify)](https://github.com/mewisme/mewsenger/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6)
![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)

[Download](https://github.com/mewisme/mewsenger/releases/latest) · [Report an issue](https://github.com/mewisme/mewsenger/issues) · [Changelog](CHANGELOG.md)

</div>

Mewsenger wraps the Messenger web app (`messenger.com`) in a small native shell built with [Tauri 2](https://tauri.app). It adds what the browser tab lacks: accounts as tabs, real Windows notifications, an unread badge, keyboard shortcuts and a handful of privacy switches. It talks to Messenger only through the page itself. There is no proxy, no extra server and no private API.

## Features

**Accounts**
- As many signed-in accounts as you want, each as a browser-style tab with its own isolated login.
- Tabs show the account's Messenger name and picture. Drag to reorder, close with the x or `Ctrl+W`.
- A tab that never signed in is deleted, profile included, when you close it.
- A tab strip that shrinks to icons and never hides the **+** button.

**Notifications**
- Native Windows toasts and in-app tab alerts. The message preview can be turned off.
- Unread chat count on the taskbar icon and the tray tooltip, per account and in total.
- Clicking a toast opens that conversation. Reading it elsewhere clears the toast.

**Privacy**
- Hide that you are typing.
- Replace pictures with initials, or cover names, messages and photos for screen sharing.
- No telemetry. The optional diagnostics copy holds versions and states only, never paths, URLs or messages.

**Comfort**
- Light, dark or system theme that reaches Messenger itself, in English or Vietnamese.
- Resizable chat list and details, photo viewer zoom, spell check switch, double-click to reply, right-click menus.
- Wide screens are filled instead of centring Messenger in a 2560 px column.
- Idle tabs give memory back, and a stuck or sleeping page reloads itself.
- Photo and video downloads are saved from the page, with a reveal-in-Explorer button when done.

**Updates**
- Signed updates from GitHub Releases: check on start, on a schedule (hourly to monthly, even or odd days) and optionally install by themselves.
- Portable build with no installer.

## Install

Download the latest build from the [Releases](https://github.com/mewisme/mewsenger/releases/latest) page:

| File | Use |
|---|---|
| `Mewsenger_x.y.z_x64-setup.exe` | Installer (recommended, updates itself) |
| `Mewsenger_x.y.z_x64_en-US.msi` | MSI installer |
| `Mewsenger-windows-portable.exe` | Runs from any folder. Does not self-update |

Windows 10 or 11 with the WebView2 runtime (included in current Windows). The builds are not code-signed by a Windows certificate, so SmartScreen may warn on first launch. Update packages are signed with the project's updater key.

## Using it

**Tray menu:** Open Mewsenger, Accounts, Settings, Quit. Double-click the tray icon to open the window. Closing the window quits the app unless **Close button hides to tray** is on.

| Shortcut | Action |
|---|---|
| `Ctrl+K` | Search chats |
| `Ctrl+Shift+N` | New message |
| `Ctrl+1` ... `Ctrl+9` | Open the Nth chat |
| `Ctrl+Alt+Up` / `Down`, `Ctrl+Shift+[` / `]` | Previous or next chat |
| `Ctrl+T` / `Ctrl+W` | New account tab menu / close tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next or previous tab |
| `Ctrl` + wheel, double-click | Zoom a photo in the viewer |

**Settings** open as a tab next to your accounts, and stay open behind other tabs until you close them. They cover language and theme, window behavior, launch at login, chat and privacy switches, accounts, notifications, updates and About.

## Build from source

Requirements: Node.js 24+, pnpm 12.16.1 (pinned in `package.json`), a stable Rust toolchain and the Microsoft C++ Build Tools.

```shell
git clone https://github.com/mewisme/mewsenger.git
cd mewsenger
pnpm install
pnpm tauri dev          # development, local UI served on port 14871
pnpm tauri build        # installers in src-tauri/target/release/bundle
```

The portable executable: `pnpm tauri build --no-bundle -- --features portable`.

### Checks

```shell
pnpm test               # JS tests: page script (node:vm) and the React UI (jsdom)
pnpm tsc --noEmit
pnpm version:check      # npm, Tauri, Cargo and Cargo.lock agree
cd src-tauri && cargo test --locked --lib && cargo fmt --check
```

CI runs the same on Windows and macOS for every push and pull request. Interactive checks (logged-in chats, notifications, the title bar) still need a real desktop; `scripts/verify-windows-shell.ps1` drives the shell through UI Automation.

### Releasing

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (then `cargo metadata` refreshes `Cargo.lock`) and run `pnpm version:check`.
2. Push a tag `vX.Y.Z`. The *Release desktop* workflow builds the signed installers, `latest.json` and the portable executable into a **draft** release whose notes come from the commits since the previous tag (`scripts/changelog.mjs`), and refreshes `CHANGELOG.md` on `main`.
3. Publish the draft. Installed apps see it through `releases/latest/download/latest.json`.

The updater public key is in `src-tauri/tauri.release.conf.json`. The private key is the repository secret `TAURI_SIGNING_PRIVATE_KEY`. Rotating it means a manual reinstall for existing users.

## How it works

- **Shell (Rust, `src-tauri/`)**: one main window with separate WebViews: a local React title bar (tabs, Settings, update and download buttons) and one Messenger page per open tab. Each extra account has its own WebView2 profile.
- **Page script (`src-tauri/src/inject/`)**: plain JavaScript parts joined at build time and injected into the Messenger page. They read the page's own modules and DOM for unread state, notifications, privacy features and layout. See the [README there](src-tauri/src/inject/README.md).
- **Local UI (`src/`)**: React 19, Tailwind 4 and shadcn/ui for the title bar, tab menu and Settings, with an English and Vietnamese translation.
- **Safety**: every local view gets only the commands it needs (`src-tauri/capabilities/`), the Messenger page can call one bounded notification command, and the origin is a single compile-time profile in `src-tauri/site.json`.

## Known limitations

- Messenger changes its page often. Features that read its internals (unread counts, typing filter, theme) fail safe and leave the page alone when a hook no longer matches, but may need an update.
- No upload or download percentage: WebView2 gives no official callback for it.
- The tray menu and notification text are English only.
- Quick reply from a toast is implemented but disabled until verified against a live session.
- Windows is the supported platform. macOS builds in CI but is untested.

## Contributing

Issues and pull requests are welcome. Please run the checks above first, and use [Conventional Commits](https://www.conventionalcommits.org) (`feat(scope): subject`).

## License

[MIT](LICENSE) © Mew. Mewsenger is an independent project and is not affiliated with or endorsed by Meta. Messenger is a trademark of Meta Platforms, Inc.
