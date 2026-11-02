# Messenger

A desktop application wrapper for Facebook Messenger built with Tauri.

## Description

Messenger is a native desktop application that wraps the Messenger web interface (messenger.com) in a standalone window. It provides a desktop experience for Facebook Messenger with native features like notifications and clipboard management.

## Features

- Native desktop application for Windows, macOS, and Linux
- System notifications support
- Clipboard manager integration
- Window positioning and management

## Desktop controls

- **Photo viewer:** Ctrl + mouse wheel (trackpad pinch in WebView2) to zoom, double-click a photo to toggle zoom, then scroll or drag the enlarged photo. Zoom resets when the viewer/photo changes.
- **Chats:** Ctrl+K focuses Messenger search; Ctrl+Shift+N opens Messenger's new-message control if present; Ctrl+Alt+Up/Down moves between chats when not editing text. On macOS, use Command in place of Ctrl.
- **Account:** use **Account menu** or **Sign out** from the native tray menu. These actions use Messenger's own controls and may be unavailable when Messenger changes its page layout.
- **Window:** closing the main window hides it to the system tray when available. Double-click the tray icon, or select **Show Messenger**, to restore it. Select **Quit** to exit the process. If the tray is unavailable, closing the window exits normally.
- **Navigation:** the tray menu provides Back, Forward, Reload and photo zoom controls. External links open in the default browser without Facebook fbclid tracking.

Desktop DOM enhancements run only on HTTPS messenger.com or www.messenger.com, not on Facebook login pages or other origins.

## Notifications and unread badges

- Messenger's browser notifications remain the primary source. If WebView2 rejects a notification that Messenger already has permission to display, the app attempts to show it through the native OS notification service. It does not override a denied browser permission.
- The fallback uses Messenger's supplied title and text. Group, sender and avatar details are only available when the website supplies them; no private Messenger API is queried.
- Where the chat list contains explicit unread markers, the app counts distinct conversations and shows their count as a Windows taskbar overlay (or a system badge on supported platforms). It does not guess from the number shown in the page title.
- Duplicate fallback notifications are suppressed for ten minutes when Messenger supplies a notification tag, or fifteen seconds when only text is available; at most twelve can be sent per minute. No message content or session tokens are persisted or logged.
- The native notification plugin does not expose removal of individual Windows toast history entries or thread-specific click activation. The app removes local notification mappings when reading chats, but previously displayed Windows toasts may remain in the notification center. Clicking a native toast is not guaranteed to open its source conversation.
- Delivery depends on Messenger's notification APIs and the app process being open. Notifications are not guaranteed after quitting the app or when Messenger sends them exclusively through a Service Worker that the page cannot observe.

## Prerequisites

- Node.js (LTS version)
- pnpm (package manager)
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
│   └── main.ts            # Main TypeScript entry point
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

### Running in Development Mode

The development server runs on port 1420 and loads messenger.com directly:

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
