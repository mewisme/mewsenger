# Messenger

A desktop application wrapper for Facebook Messenger built with Tauri.

## Description

Messenger is a native desktop application that wraps the Messenger web interface (messenger.com) in a standalone window. It provides a desktop experience for Facebook Messenger with native features like notifications and clipboard management.

## Local desktop shell

The main native window contains three separate WebViews: a **custom 40px title bar at the top** with drag and Minimize / Maximize / Restore / Close controls, Messenger at `https://www.messenger.com` in the center, and a **36px status bar at the bottom**. The title bar and status bar load local React/shadcn components from separate app URLs. Messenger is not embedded in an iframe or proxied through the local frontend. Only the main window is frameless; call popups and Credits keep native window chrome. If the title bar fails, native decorations are restored; if the optional footer fails, Messenger uses the remaining space.

The footer displays the installed application version, local network status and unread count from native state. Unverified values remain unknown until synchronized. **Credits** opens a separate native local window to avoid clipping inside the narrow footer; it shows the bundled Messenger icon, actual version, and an explicit Close button. The custom title bar also uses the icon from `src-tauri/icons/`. The app follows the system light/dark appearance.

The unread badge is updated only from recognized Messenger unread markers; missing markers remain unknown rather than being reported as zero. The footer displays **Offline** when the local browser reports no network and **Status unavailable** otherwise: an online network does not prove the Messenger session is connected. The disabled update control is a placeholder because no signed update provider is configured.

Clicking a visible native fallback toast brings Messenger to the foreground and opens its conversation only when the notification plugin supplies a still-valid matching ID and Messenger supplied a safely routable conversation ID. Unrecognized, expired, or already-read notifications only reveal Messenger. The plugin cannot guarantee activation from Windows Action Center or remove delivered Windows toast history.

Tauri's native multi-WebView support requires the Rust `unstable` feature on desktop. WebViews are mounted on a worker thread to avoid Windows WebView2 deadlocks. The local `titlebar` WebView has narrowly scoped native window-control permissions; `status` has only the local status/credits APIs; the remote `messenger` WebView can invoke only the bounded notification command from approved Messenger HTTPS URLs. The local `credits` window can read the app version only.

## Features

- Native desktop application for Windows, macOS, and Linux
- System notifications support
- Clipboard manager integration
- Window positioning and management

## Desktop controls

- **Photo viewer:** Ctrl + mouse wheel (trackpad pinch in WebView2) to zoom, double-click a photo to toggle zoom, then scroll or drag the enlarged photo. Zoom resets when the viewer/photo changes.
- **Chats:** Ctrl+K focuses Messenger search; Ctrl+Shift+N opens Messenger's new-message control if present; Ctrl+Alt+Up/Down moves between chats when not editing text. On macOS, use Command in place of Ctrl.
- **Account:** use **Account menu** or **Sign out** from the native tray menu. These actions use Messenger's own controls and may be unavailable when Messenger changes its page layout.
- **Window:** drag the custom top bar to move the main window, or double-click it to maximize/restore. The window buttons minimize, maximize/restore, and close. Closing the main window hides it to the system tray when available. Double-click the tray icon, or select **Show Messenger**, to restore it. Select **Quit** to exit the process. If the tray is unavailable, closing the window exits normally.
- **Navigation:** the tray menu provides Back, Forward, Reload and photo zoom controls. External links open in the default browser without Facebook fbclid tracking.

Desktop DOM enhancements run only on HTTPS messenger.com or www.messenger.com, not on Facebook login pages or other origins.

## Notifications and unread badges

- Messenger's browser notifications remain the primary source. If WebView2 rejects a notification that Messenger already has permission to display, the app attempts to show it through the native OS notification service. It does not override a denied browser permission.
- The fallback uses Messenger's supplied title and text. Group, sender and avatar details are only available when the website supplies them; no private Messenger API is queried.
- Where the chat list contains explicit unread markers, the app counts distinct conversations and shows their count as a Windows taskbar overlay (or a system badge on supported platforms). It does not guess from the number shown in the page title.
- Duplicate fallback notifications are suppressed for ten minutes when Messenger supplies a notification tag, or fifteen seconds when only text is available; at most twelve can be sent per minute. No message content or session tokens are persisted or logged.
- The native notification plugin can identify a clicked fallback toast while it is still visible. The app associates each such toast with a bounded conversation ID, focuses Messenger and navigates to that conversation only while the mapping is valid. A mapping expires after ten minutes, is used once, and is removed when an earlier recognized unread marker disappears from the focused conversation. Fallbacks without reliable IDs only focus Messenger.
- Windows Action Center notifications are **not** individually removable using the installed plugin. Reading a conversation cancels its local click routing but does not remove previously delivered Windows toasts or unrelated conversation notifications. Clicking an old Action Center entry may not activate the app at all; background delivery only works while the application process and Messenger's notification infrastructure are running.
- Delivery depends on Messenger's notification APIs and the app process being open. Notifications are not guaranteed after quitting the app or when Messenger sends them exclusively through a Service Worker that the page cannot observe.

## Prerequisites

- Node.js 24 or newer
- pnpm 12.16.1 (pinned in package.json)
- Rust (stable toolchain)
- Platform-specific build tools:
  - Windows: Microsoft Visual Studio C++ Build Tools
  - macOS: Xcode Command Line Tools
  
## Installation

### Development Setup

1. Clone the repository:
```
git clone https://github.com/mewisme/messenger.git
cd messenger
```

2. Install dependencies:
```
pnpm install
```

3. Run in development mode:
```
pnpm tauri dev
```

### Building

Build the application:
```
pnpm tauri build
```

The built application will be in `src-tauri/target/release/` (or `src-tauri/target/debug/` for debug builds).

## Project Structure

```
messenger/
├── src/                    # Frontend source files
│   └── main.tsx            # Main TypeScript entry point
├── src-tauri/             # Tauri backend (Rust)
│   ├── src/
│   │   ├── main.rs        # Application entry point
│   │   └── lib.rs         # Main application logic
│   ├── Cargo.toml         # Rust dependencies
│   └── tauri.conf.json    # Tauri configuration
├── package.json           # Node.js dependencies
└── vite.config.ts         # Vite configuration
```

## Configuration

The application configuration is located in `src-tauri/tauri.conf.json`. Key settings include:

- Window size and minimum dimensions
- Application identifier
- Security policies

## Development

### Testing

```shell
pnpm test
pnpm test:watch
pnpm test:coverage
pnpm version:check
pnpm run build
```

Rust unit tests can be run with `cargo test --locked --lib` inside `src-tauri`. Vitest runs the desktop WebView simulation tests under Node and the local React UI component tests in jsdom. V8 coverage reports only imported local UI components; the desktop scripts use `node:vm` and are tested for behavior but cannot be measured by the Vitest V8 instrumentation. The local title and status bars run as separate children of the main native window.

On Windows, build a debug executable and verify the real UI Automation controls in an interactive desktop:

```powershell
pnpm tauri build --debug --no-bundle
pwsh -NoProfile -File ./scripts/verify-windows-shell.ps1
```

The Windows check launches an isolated Messenger process, verifies the custom title controls and bottom status controls, resizes the window, opens About and tests both its in-app Close button and native X, then tests maximize, restore, minimize and close-to-tray. It terminates only the process it launched. For inspection without clicking the buttons, pass `-InspectOnly`. Logged-in chat, media calls, notifications and macOS behavior still require platform-specific interactive verification.

To test unsigned Windows installers without uploading or publishing them, use `pnpm tauri build --debug`. MSI and NSIS packages are written under `src-tauri/target/debug/bundle/` and must not be treated as signed production releases.

GitHub Actions verifies changes on Windows Server 2025 and macOS 15 (Apple Silicon target) for pushes, pull requests, and manual runs. The workflow uses pinned pnpm and a frozen lockfile, runs JS/Rust tests, and builds without bundling or publishing. Creating a tag or release must be performed separately and deliberately; pushing to `main` no longer creates a draft release.

### Running in Development Mode

The local shell development server runs on port 14871 with `strictPort` enabled, avoiding conflicts with other Tauri projects using port 1420; the separate Messenger WebView always loads `https://www.messenger.com` directly. Start the server through `pnpm tauri dev`, not by launching a debug executable against an unrelated server:

```
pnpm tauri dev
```

### Building for Production

Build for all platforms:
```
pnpm tauri build
```

Build for a specific platform:
```
pnpm tauri build --target x86_64-pc-windows-msvc    # Windows
pnpm tauri build --target x86_64-apple-darwin       # macOS Intel
pnpm tauri build --target aarch64-apple-darwin      # macOS Apple Silicon
pnpm tauri build --target x86_64-unknown-linux-gnu # Linux
```

## Technologies

- Tauri 2: Framework for building desktop applications
- Rust: Backend language
- TypeScript: Frontend language
- Vite: Build tool and development server
- pnpm: Package manager

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

Mew
