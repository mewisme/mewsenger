# The page script

One script runs in every Messenger page, before the page's own scripts.
`build.rs` joins every `*.js` file here, in file-name order, into a single
function (`OUT_DIR/inject.js`, included as `INJECT_SCRIPT` in `lib.rs`). The
parts share that function's scope, so a part can use what an earlier one
declares, and a top-level `return` ends the whole script. The numbers set the
order and leave room to slot a part in between.

`src/tests/inject-source.mjs` joins the parts the same way for the tests; keep
its wrapper identical to the one in `build.rs`. A part is plain statements, not
a module: do not declare a name an earlier part already uses.

| Part | What it does |
|---|---|
| 00-guard | Runs in every frame: nothing outside the Messenger origin of `site.json` |
| 10-links | Opens links that leave the app in the default browser (all frames) |
| 20-top-frame | From here on: the top frame only, installed once |
| 22-ipc | `send`, the one way to the app (`notification_event`); ids, thread ids |
| 24-dom | Small DOM helpers (`visible`, `composer`, `until`, `withRoot`, ...) |
| 26-prefs | The user's choices from Settings (`mewPrefs.get` / `onChange`) |
| 28-marks | `data-mew-ui` marks (chat-header, info, details, composer), kept only while a feature wants them |
| 30-fb-modules | Hooks Facebook's module loader (`__d`): `patch`, `rewrite`, `require`, `load`, `state` |
| 32-fb-data | Reads Messenger's local database: unread chats, message details, old news |
| 34-fb-notification-hooks | Makes Messenger raise its own notifications while the window is away |
| 40-notifications | Delivers those notifications (and the browser fallback) through the app |
| 50-unread | Which chats are unread: database first, row text as the fallback |
| 52-quick-reply | Types a reply into Messenger's composer |
| 54-unread-sync | Reports unread, read and session to the app |
| 56-account-name | Reports whose Messenger account the page is, for the tab title |
| 60-composer-focus | Cursor in the message box when a chat opens |
| 62-image-viewer | Zoom and pan in the photo viewer |
| 64-chat-actions | The named actions the shell and shortcuts can run |
| 66-shortcuts | Keyboard shortcuts for those actions |
| 68-tab-shortcuts | Forwards tab shortcuts to the shell's tab strip |
| 70-desktop-sync | Keeps the viewer and composer focus in step with the page |
| 80-privacy-typing | Hide that you are typing (edits Messenger's outgoing typing requests) |
| 82-privacy-avatars | Pictures as initials |
| 84-privacy-redact | Names, messages and photos covered |
| 86-theme | Sets Messenger's own appearance (light, dark, system) from the theme choice |
| 90-recover | Reloads a page that woke from sleep, lost its connection or is stuck |
| 92-read-ahead | Loads the newest messages of the top chats before they are opened |
| 94-downloads | Saves photo and video downloads from Facebook's CDN from the page |
| 96-panes | Resizable chat list and details |
| 97-wide | Lifts Facebook's page width cap so wide screens are filled |
| 98-selection | Spell check switch, double-click to reply |
| 99-context-menu | Right-click on a chat or message opens Messenger's own menu |

Parts that act on a Settings choice read it with `mewPrefs` and follow changes
at once; the keys are in `26-prefs.js` and `prefs.rs`.

## Hooking a Facebook module

`fbModules` (30) is the only place that touches `window.__d`. Everything that
adjusts a module registers at load time (before Facebook defines it):

- `fbModules.patch(name, (exports) => boolean)` changes a module's exports; return
  `false` when it does not look as expected and it is left alone.
- `fbModules.rewrite(name, [[regex, text], ...])` changes a module's source;
  every regex must match exactly once, otherwise the original runs.
- `fbModules.state(name)` reports `patched`, `rewritten`, `shape-mismatch`,
  `no-match`, `blocked` or `loading`; `window.__mewModules()` returns all of them.

Reading needs no hook: `fbModules.require(name)` and `fbModules.load(names)`
(a module Facebook has not loaded yet). Module names are source file names, far
more stable than minified code, but every use must still check what it finds and
have a fallback, as `50-unread` has.
