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
