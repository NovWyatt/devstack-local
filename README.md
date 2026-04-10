# DevStack Local

<p align="center">
  <strong>Modern Local Development Server Management for Windows</strong>
</p>

<p align="center">
  A sleek, Electron-based alternative to WAMP/XAMPP/Laragon with a modern dark UI, real-time log streaming, and one-click service management.
</p>

---

## 🚀 Features (Phase 1)

- **Dashboard** — Real-time overview of Apache & MySQL service status
- **Service Control** — Start/stop services with visual loading states
- **System Logs** — Terminal-style log viewer with color-coded severity levels
- **Dark Theme** — Beautiful, modern dark UI with blue and orange accents
- **Sidebar Navigation** — 8 navigation items (Dashboard active, others coming soon)
- **Mock Services** — Simulated Apache & MySQL for UI development

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 28 |
| Frontend | React 18 + TypeScript 5 |
| Styling | TailwindCSS 3 |
| State | Zustand 4 |
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
├── electron/                    # Electron main process
│   ├── main.ts                  # Window creation, IPC handlers
│   ├── preload.ts               # Secure IPC bridge (contextBridge)
│   └── services/
│       ├── apache.service.ts    # Apache mock manager
│       ├── mysql.service.ts     # MySQL mock manager
│       └── process.manager.ts   # Central service controller
├── src/                         # React renderer process
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Layout.tsx       # App shell (sidebar + header + content)
│   │   │   ├── Sidebar.tsx      # Navigation sidebar
│   │   │   └── Header.tsx       # Top bar with page title & user badge
│   │   ├── dashboard/
│   │   │   ├── Dashboard.tsx    # Dashboard page
│   │   │   ├── ServiceCard.tsx  # Service control card component
│   │   │   └── SystemLogs.tsx   # Terminal-style log viewer
│   │   └── shared/
│   │       └── ComingSoon.tsx   # Placeholder for future pages
│   ├── stores/
│   │   └── useAppStore.ts       # Zustand global state store
│   ├── lib/
│   │   └── utils.ts             # Utility functions (cn, generateId, formatTime)
│   ├── types/
│   │   └── index.ts             # Shared TypeScript type definitions
│   ├── App.tsx                  # Root component with routing
│   ├── main.tsx                 # React entry point
│   └── index.css                # Global styles & design tokens
├── public/                      # Static assets
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
- **Phase 2** — PHP Manager & Domain Configuration
- **Phase 3** — Real Apache/MySQL Integration
- **Phase 4** — Database Management UI
- **Phase 5** — SSH/FTP Client
- **Phase 6** — Tunnel / Port Forwarding
- **Phase 7** — Settings & Auto-Update
- **Phase 8** — Polish, Testing & Release

## 📄 License

MIT © NovWyatt
