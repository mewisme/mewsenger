# Changelog

Generated from the commit history when a release is published.

## [0.2.0](https://github.com/mewisme/mewsenger/compare/v0.1.14...v0.2.0) - 2026-11-22

### Features

- **updater:** configure the update signing key ([a8a7913](https://github.com/mewisme/mewsenger/commit/a8a7913))
- **migrate:** keep user data after the identifier change ([97761aa](https://github.com/mewisme/mewsenger/commit/97761aa))
- **chat:** resizable panes, spell check switch and context menus ([baea976](https://github.com/mewisme/mewsenger/commit/baea976))
- **chat:** load the top chats ahead of time ([da772ec](https://github.com/mewisme/mewsenger/commit/da772ec))
- **recover:** reload a Messenger page that is stuck or woke from sleep ([c79887b](https://github.com/mewisme/mewsenger/commit/c79887b))
- **accounts:** show the Messenger name and picture on tabs ([990ebcd](https://github.com/mewisme/mewsenger/commit/990ebcd))
- **privacy:** hide typing, profile pictures and message content ([e920e17](https://github.com/mewisme/mewsenger/commit/e920e17))
- **settings:** add page preferences and a theme choice ([aa1ad64](https://github.com/mewisme/mewsenger/commit/aa1ad64))
- **notifications:** raise toasts from Messenger's own notifications ([9af361e](https://github.com/mewisme/mewsenger/commit/9af361e))
- **ui:** reorder tabs by dragging and add tab shortcuts ([a43780e](https://github.com/mewisme/mewsenger/commit/a43780e))
- **ui:** replace layouts with account tabs in the title bar ([58ec8b7](https://github.com/mewisme/mewsenger/commit/58ec8b7))
- **accounts:** add single-window layout and overlay settings ([99bdf11](https://github.com/mewisme/mewsenger/commit/99bdf11))
- **accounts:** line account windows up side by side ([e53d2bb](https://github.com/mewisme/mewsenger/commit/e53d2bb))
- **notifications:** report page focus for the active account ([81df532](https://github.com/mewisme/mewsenger/commit/81df532))
- **ui:** account segments, accounts settings and split view ([2e48488](https://github.com/mewisme/mewsenger/commit/2e48488))
- **accounts:** grant account and split commands by label pattern ([e7068eb](https://github.com/mewisme/mewsenger/commit/e7068eb))
- **accounts:** per-account notification state, shell and capabilities ([2f34ccc](https://github.com/mewisme/mewsenger/commit/2f34ccc))
- **accounts:** add account model, labels and persistence ([25c3013](https://github.com/mewisme/mewsenger/commit/25c3013))
- **toast:** add WinRT toasts with per-conversation removal ([af40da2](https://github.com/mewisme/mewsenger/commit/af40da2))
- **status:** session state, downloads, update state and diagnostics ([21ba709](https://github.com/mewisme/mewsenger/commit/21ba709))
- **shortcuts:** switch chats with Ctrl+number and brackets ([e7726db](https://github.com/mewisme/mewsenger/commit/e7726db))
- **settings:** settings window, launch at login, single instance ([9aa0277](https://github.com/mewisme/mewsenger/commit/9aa0277))
- **ui:** status bar and desktop docs updates ([2b8a7fb](https://github.com/mewisme/mewsenger/commit/2b8a7fb))
- **desktop:** add site profile, toast identity and preview pref ([0178fa7](https://github.com/mewisme/mewsenger/commit/0178fa7))
- **notifications:** route valid toast clicks to conversations ([df402bc](https://github.com/mewisme/mewsenger/commit/df402bc))
- **desktop:** replace main window chrome with custom title bar ([6062764](https://github.com/mewisme/mewsenger/commit/6062764))
- **desktop:** synchronize unread status and handle live toast clicks ([fb79438](https://github.com/mewisme/mewsenger/commit/fb79438))
- **desktop:** mount isolated Messenger and local footer views ([aad4be7](https://github.com/mewisme/mewsenger/commit/aad4be7))
- **desktop:** scaffold shadcn status shell and credits ([def7d52](https://github.com/mewisme/mewsenger/commit/def7d52))
- **messenger:** native notification fallback and unread badges ([da5ba28](https://github.com/mewisme/mewsenger/commit/da5ba28))
- **messenger:** desktop controls and tray ([95d6fbd](https://github.com/mewisme/mewsenger/commit/95d6fbd))
- **messenger:** secure link navigation ([e42335a](https://github.com/mewisme/mewsenger/commit/e42335a))

### Bug fixes

- **downloads:** save photos and videos from Facebook's CDN ([e7c345e](https://github.com/mewisme/mewsenger/commit/e7c345e))
- **ui:** red hover background on the close button in dark mode ([97b01b7](https://github.com/mewisme/mewsenger/commit/97b01b7))
- **ui:** keep status bar tooltips inside the footer view ([1fb7710](https://github.com/mewisme/mewsenger/commit/1fb7710))
- **notifications:** restrict toast navigation to trusted app events ([035bf89](https://github.com/mewisme/mewsenger/commit/035bf89))
- **desktop:** restore responsive About window and bundled icons ([0e90be4](https://github.com/mewisme/mewsenger/commit/0e90be4))
- **build:** align app versions and validate package metadata ([810d1b2](https://github.com/mewisme/mewsenger/commit/810d1b2))
- **ui:** follow system light and dark appearance ([6fc3410](https://github.com/mewisme/mewsenger/commit/6fc3410))

### Refactoring

- rename the app to Mewsenger ([5226c13](https://github.com/mewisme/mewsenger/commit/5226c13))
- **inject:** split the page script into ordered parts ([8c0c58b](https://github.com/mewisme/mewsenger/commit/8c0c58b))
- **ui:** fold the status bar into the title bar ([37ae539](https://github.com/mewisme/mewsenger/commit/37ae539))
- **ui:** slim the status bar and fold About into Settings ([b7edc36](https://github.com/mewisme/mewsenger/commit/b7edc36))

### Documentation

- keep native chrome on the settings window ([85fa027](https://github.com/mewisme/mewsenger/commit/85fa027))
- settings, startup, updates, portable build and recorded evidence ([c1001ef](https://github.com/mewisme/mewsenger/commit/c1001ef))

### Maintenance

- ignore local docs and drop links to them ([b25d570](https://github.com/mewisme/mewsenger/commit/b25d570))
- **ui:** add the shadcn resizable component ([6033a10](https://github.com/mewisme/mewsenger/commit/6033a10))
- **release:** add draft-only release workflow and portable build ([3be3e42](https://github.com/mewisme/mewsenger/commit/3be3e42))
- **desktop:** add repeatable Windows shell verification ([bc212db](https://github.com/mewisme/mewsenger/commit/bc212db))
- validate desktop builds without automatic releases ([3b9df17](https://github.com/mewisme/mewsenger/commit/3b9df17))
- **messenger:** migrate suites to Vitest and add status bar checks ([8fe2fac](https://github.com/mewisme/mewsenger/commit/8fe2fac))
- **toolchain:** upgrade Tauri and pnpm dependencies ([3f29c24](https://github.com/mewisme/mewsenger/commit/3f29c24))

## [0.1.14](https://github.com/mewisme/mewsenger/compare/v0.1.1...v0.1.14) - 2026-03-15

### Bug fixes

- update GITHUB_TOKEN in build.yml to use the correct secret ([3bc8f34](https://github.com/mewisme/mewsenger/commit/3bc8f34))

### Maintenance

- update version to 0.1.14 in package.json and tauri configuration ([85d93f8](https://github.com/mewisme/mewsenger/commit/85d93f8))
- update version to 0.1.12 in package.json and tauri configuration, and update CHANGELOG.md ([18709d5](https://github.com/mewisme/mewsenger/commit/18709d5))
- update dependencies in package.json and pnpm-lock.yaml, add new Rust packages in Cargo.toml and Cargo.lock, implement opener plugin functionality in lib.rs, and clean up tauri configuration ([26e8416](https://github.com/mewisme/mewsenger/commit/26e8416))

## [0.1.1](https://github.com/mewisme/mewsenger/compare/v0.1.0...v0.1.1) - 2025-12-04

### Maintenance

- update version to 0.1.1 and reflect changes in tauri configuration and CHANGELOG.md ([235848a](https://github.com/mewisme/mewsenger/commit/235848a))
- remove update functionality and related files from the project ([416e83f](https://github.com/mewisme/mewsenger/commit/416e83f))
- update product name in tauri configuration to "Messenger" ([86a4a9d](https://github.com/mewisme/mewsenger/commit/86a4a9d))

## [0.1.0](https://github.com/mewisme/mewsenger/releases/tag/v0.1.0) - 2025-12-04

### Features

- init commit ([0c3ffe3](https://github.com/mewisme/mewsenger/commit/0c3ffe3))

### Maintenance

- add createUpdaterArtifacts option in tauri configuration ([97ca98c](https://github.com/mewisme/mewsenger/commit/97ca98c))
- update CHANGELOG.md, clean up README.md, and refactor version-upgrade.js script ([58286d9](https://github.com/mewisme/mewsenger/commit/58286d9))
- update public key in tauri configuration ([02fbbd0](https://github.com/mewisme/mewsenger/commit/02fbbd0))
- simplify build.yml by removing unnecessary target arguments for Windows and Ubuntu ([4ba1cfc](https://github.com/mewisme/mewsenger/commit/4ba1cfc))
- add CHANGELOG.md to document recent changes ([e91e4d3](https://github.com/mewisme/mewsenger/commit/e91e4d3))
- remove unused Tauri dependencies from pnpm-lock.yaml ([2de1842](https://github.com/mewisme/mewsenger/commit/2de1842))
- update version to 0.1.0 and enhance package scripts; remove app icon ([12674fe](https://github.com/mewisme/mewsenger/commit/12674fe))
- add license ([b2789bf](https://github.com/mewisme/mewsenger/commit/b2789bf))
