# DevStack Local

<p align="center">
  <strong>Modern Local Development Server Management for Windows</strong>
</p>

<p align="center">
  A sleek, Electron-based alternative to WAMP/XAMPP/Laragon with a modern dark UI, real-time log streaming, and one-click service management.
</p>

---

## 🚀 Features

### Phase 1 — Dashboard
- **Dashboard** — Real-time overview of Apache & MySQL service status
- **Service Control** — Start/stop services with visual loading states
- **System Logs** — Terminal-style log viewer with color-coded severity levels
- **Dark Theme** — Beautiful, modern dark UI with blue and orange accents
- **Sidebar Navigation** — 8 navigation items with route-aware highlighting

### Phase 2 — PHP Manager
- **Version Management** — Install, activate, and remove PHP versions (5.6.9 – 8.5.1)
- **php.ini Editor** — Monaco Editor with syntax highlighting, save/reset, unsaved indicator
- **Extension Manager** — Toggle 10 common extensions with required/optional grouping
- **Download System** — Simulated download with progress bar and auto-install
- **Toast Notifications** — Dark-themed success/error notifications via Sonner

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 28 |
| Frontend | React 18 + TypeScript 5 |
| Styling | TailwindCSS 3 |
| State | Zustand 4 |
| Code Editor | Monaco Editor (lazy-loaded) |
| Notifications | Sonner |
| Icons | Lucide React |
| Build | Vite 5 |
| Packaging | electron-builder |

## 🛠️ Installation

```bash
# Clone the repository
git clone https://github.com/NovWyatt/devstack-local.git
cd devstack-local

# Install dependencies
npm install
```

### Local binary setup (required for real Electron mode)

Ensure the bundled service binaries exist under `resources/binaries/`:

```text
resources/binaries/
  apache/
    bin/httpd.exe
  mysql/
    bin/mysqld.exe
    bin/mysql.exe
    bin/mysqldump.exe
  php/
    <version>/php.exe
    <version>/php-cgi.exe
```

Notes:
- Runtime mutable files are not kept in git under `resources/binaries`.
- On first run, writable runtime data is created under Electron `userData` (`runtime/apache`, `runtime/mysql`, `runtime/php`).

## 💻 Development

```bash
# Start the Vite dev server (browser-only, no Electron)
npm run dev

# Start in Electron mode
npm run electron:dev
```

The app runs at `http://localhost:3000` in browser mode. In browser mode, services use mock behavior (simulated start/stop with delays). Electron-specific features like exit confirmation dialogs are no-ops in the browser.

## 📜 Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server (browser mode) |
| `npm run build` | TypeScript check + production build |
| `npm run preview` | Preview production build |
| `npm run electron:dev` | Start with Electron integration |
| `npm run electron:build` | Build production Electron app |
| `npm run verify` | Full build + real phase validation checks |
| `npm run release:checks` | Phase 4.5 release contract checks |
| `npm run smoke:packaged` | Build unpacked package + packaged startup smoke |

## Verification and packaging gates

```bash
# Required release gate
npm run verify

# Required packaged smoke gate
npm run smoke:packaged
```

## Packaging toolchain constraints

- Use a local Node LTS toolchain for verification and packaging. Node 22 LTS is the safest baseline for this repo.
- Packaged builds intentionally disable `electron-builder` native dependency rebuilds (`npmRebuild=false`).
- `npm run build` now loads `vite.config.ts` through the Vite JavaScript API with `configFile=false` and builds in `electron` mode, so the packaging gates rebuild `dist-electron` without depending on the CLI TypeScript config-loader path.
- The only native rebuild currently implicated in packaging is the optional chain `ssh2-sftp-client -> ssh2 -> cpu-features@0.0.10`.
- `cpu-features` is not required for app runtime. `ssh2` wraps that import in a `try/catch` and only uses it for crypto/cipher optimization.
- Electron main/preload builds now externalize normalized `.node` IDs and resolved `node_modules/...` paths so Rollup never tries to bundle native addons such as `cpu-features`.
- If you deliberately force native rebuilds back on, install Python 3 plus Visual Studio Build Tools 2022 with Desktop C++ support for `node-gyp`.
- `npm run smoke:packaged` now deletes `release/` before it starts and stops immediately if build or packaging fails, so stale `win-unpacked` output cannot produce a false pass.

## Packaged installer notes

- Default Windows installer target is NSIS (`release/DevStack Local Setup <version>.exe`).
- Installer is configured to preserve app data on uninstall (`deleteAppDataOnUninstall=false`).
- Writable runtime data (Apache/MySQL/PHP runtime files, logs, generated config) stays in Electron `userData`, not inside the install directory.
- Bundled binaries in packaged builds are read-only resources copied from `resources/binaries` via `extraResources`.

## 📂 Project Structure

```
devstack-local/
├── electron/                        # Electron main process
│   ├── main.ts                      # Window creation, IPC handlers
│   ├── preload.ts                   # Secure IPC bridge (contextBridge)
│   └── services/
│       ├── apache.service.ts        # Apache mock manager
│       ├── mysql.service.ts         # MySQL mock manager
│       ├── process.manager.ts       # Central service controller
│       └── php.service.ts           # PHP version manager (semi-mock)
├── src/                             # React renderer process
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Layout.tsx           # App shell (sidebar + header + content)
│   │   │   ├── Sidebar.tsx          # Navigation sidebar
│   │   │   └── Header.tsx           # Top bar with page title & user badge
│   │   ├── dashboard/
│   │   │   ├── Dashboard.tsx        # Dashboard page
│   │   │   ├── ServiceCard.tsx      # Service control card (shows PHP version)
│   │   │   └── SystemLogs.tsx       # Terminal-style log viewer
│   │   ├── php-manager/
│   │   │   ├── PhpManager.tsx       # PHP Manager page (tabbed)
│   │   │   ├── VersionList.tsx      # PHP version grid with cards
│   │   │   ├── VersionDownloader.tsx # Download progress modal
│   │   │   ├── PhpIniEditor.tsx     # Monaco-based php.ini editor
│   │   │   └── ExtensionManager.tsx # Extension toggle list
│   │   └── shared/
│   │       └── ComingSoon.tsx       # Placeholder for future pages
│   ├── stores/
│   │   ├── useAppStore.ts           # App-level state (services, logs)
│   │   └── usePhpStore.ts           # PHP state (versions, ini, extensions)
│   ├── lib/
│   │   └── utils.ts                 # Utility functions
│   ├── types/
│   │   ├── index.ts                 # Core TypeScript types
│   │   └── php.types.ts             # PHP-related types
│   ├── App.tsx                      # Root component with routing
│   ├── main.tsx                     # React entry point + Toaster
│   └── index.css                    # Global styles & design tokens
├── docs/screenshots/                # UI screenshots
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
└── electron-builder.json
```

## 🎨 Design System

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-primary` | `#0a0e1a` | Main background |
| `--bg-secondary` | `#131829` | Sidebar, header |
| `--bg-card` | `#1a2035` | Card backgrounds |
| `--accent-blue` | `#3b82f6` | Primary accent |
| `--accent-orange` | `#ff8c42` | Secondary accent |
| `--status-running` | `#10b981` | Service running |
| `--status-stopped` | `#ef4444` | Service stopped |
| `--status-warning` | `#f59e0b` | Transitioning |

### Typography

- **UI Font:** Inter (Google Fonts)
- **Mono Font:** JetBrains Mono (logs, code)

## 🗺️ Roadmap

- **Phase 1** ✅ Core Foundation & Dashboard
- **Phase 2** ✅ PHP Manager (versions, php.ini editor, extensions)
- **Phase 3** — Domain Configuration
- **Phase 4** — Real Apache/MySQL/PHP Integration
- **Phase 5** — Database Management UI
- **Phase 6** — SSH/FTP & Tunnel
- **Phase 7** — Settings & Auto-Update
- **Phase 8** — Polish, Testing & Release

## 📄 License

MIT © NovWyatt
