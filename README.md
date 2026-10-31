# Modkeeper

A modern desktop mod manager for **SPT (Single Player Tarkov)**, built with Tauri, React, and TypeScript. Modkeeper provides an intuitive interface for managing mods, handling deployment through file system links, and maintaining multiple mod library instances.

## Purpose

Modkeeper is designed to solve common problems when managing mods for SPT:

- **Non-destructive mod management**: Uses preflighted file-system links where available and safe recorded copies as a fallback
- **Multiple library instances**: Manage different mod configurations for different playthroughs or server setups
- **Safe operations**: Automatic backup system before mod updates, with restore functionality
- **Clean separation**: Mods are stored in a separate repository directory and linked to the game directory only when active
- **Type-aware deployment**: Supports Client mods, Server mods, and mods that work for both, with proper path management for each type
- **Collision detection**: Prevents file conflicts between mods during deployment

## Current Status

Modkeeper is still in early development and is **not recommended for daily or production use**.

### Implemented Features

- ✅ Library creation and management (multiple instances)
- ✅ Mod installation from ZIP archives
- ✅ Mod activation/deactivation (toggle system)
- ✅ Safe deployment via links or recorded copies
- ✅ Automatic backup system with restore capability
- ✅ Mod metadata display (manifest parsing)
- ✅ Mod documentation viewer (Markdown support)
- ✅ Mod type detection (Client/Server/Both)
- ✅ File collision detection
- ✅ Process checking (prevents sync while game/server is running)
- ✅ Internationalization support (English currently)
- ✅ Modern UI with shadcn/ui components

### Known Limitations

- Windows-focused (uses Windows junctions; Unix support exists but may have limitations)
- SPT version validation reads the installed server metadata or its registry file
- Single library instance active at a time (by design; may change if a strong use case emerges)
- Link methods are selected per platform and volume; copies are used when links are unavailable

## Tech Stack

### Frontend
- **React 19** with TypeScript
- **Vite** for build tooling
- **TanStack Router** for routing
- **Tailwind CSS** for styling
- **shadcn/ui** for component library
- **Lingui** for internationalization
- **Bun** as package manager and task runner

### Backend
- **Rust** with Tauri 2.0
- **Specta** for TypeScript bindings generation
- Platform-specific deployment operations (symlinks, Windows junctions, hardlinks, or copies)

### Architecture

- **Library System**: Each library instance manages its own mod repository and deployment state
- **Deployment Model**: Mods are stored in repository (`repo_root/mods/`) and linked to game directory when active
- **Backup System**: Automatic backups stored in `repo_root/backups/{mod_id}/{timestamp}/`
- **Cache System**: File system metadata cached for performance
- **State Management**: Jotai for global state, React hooks for component state

## Development Setup

### Prerequisites

- **Rust** (latest stable) - [Install Rust](https://www.rust-lang.org/tools/install)
- **Bun** (latest) - [Install Bun](https://bun.sh)
- **Tauri CLI** - Will be installed automatically via Bun

### Initial Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd modkeeper
   ```

2. **Install frontend dependencies**
   ```bash
   bun install
   ```

3. **Install Rust dependencies** (first time only)
   ```bash
   cd src-tauri
   cargo build
   cd ..
   ```

### Development Commands

- **Start development server** (frontend + backend):
  ```bash
  bun run dev:app
  ```
  This runs the Tauri dev server with hot reload for both frontend and backend.

- **Frontend only** (web mode, for UI development):
  ```bash
  bun run dev
  ```
  Runs Vite dev server on `http://localhost:1420`

- **Extract translation strings**:
  ```bash
  bun run extract
  ```
  Generates translation files from source code.

- **Build for production**:
  ```bash
  bun run build
  ```
  Builds the frontend bundle.

- **Run Tauri commands**:
  ```bash
  bun run tauri <command>
  ```
  Access Tauri CLI directly (e.g., `bun run tauri build`)

### Running Tests

**Rust backend tests**:
```bash
cd src-tauri
cargo test
```

Tests cover:
- Library creation and management
- Mod file system operations
- Link creation (junctions/symlinks)
- Deployment and cleanup logic
- Backup/restore functionality

### Development Workflow

1. **Backend changes**: Edit Rust files in `src-tauri/src/`. TypeScript bindings are auto-generated on dev builds.

2. **Frontend changes**: Edit React/TypeScript files in `src/`. Hot reload is enabled in dev mode.

3. **Type bindings**: TypeScript bindings from Rust are generated automatically in debug builds and stored in `src/gen/bindings.ts`. Do not edit this file manually.

4. **Component structure**:
   - UI components: `src/components/ui/`
   - Feature components: `src/components/mod/`, `src/components/`
   - Routes: `src/routes/`
   - Utilities: `src/utils/`, `src/lib/`
   - Hooks: `src/hooks/`

5. **Backend structure**:
   - Core logic: `src-tauri/src/core/`
   - Commands (Tauri endpoints): `src-tauri/src/commands/`
   - Models: `src-tauri/src/models/`
   - Utilities: `src-tauri/src/utils/`

### Code Style

- **Rust**: Follow standard Rust conventions. Use `cargo fmt` for formatting.
- **TypeScript/React**:
  - Prefer functional programming style when performance allows
  - Avoid deep nesting with Option/Result wrappers
  - Prefer early exits to reduce nesting
  - Use Bun as package manager (not npm/yarn)
  - Extract reusable logic to utility files

## For Mod Developers

Modkeeper accepts the [SPT Mod Manifest Proposal](https://github.com/martesi/spt-mod-manifest-proposal) for mod metadata. To enable proper mod management:

1. **Create a manifest file**: Place your mod's manifest at `manifest/manifest.json` in your mod's root directory
2. **Manifest folder behavior**: The entire `manifest/` folder is treated as part of the mod's self-description and will **not** be deployed to the game directory
3. **Manifest format**: Follow the specification defined in the [Mod Manifest Proposal](https://github.com/martesi/spt-mod-manifest-proposal)

This allows Modkeeper to:
- Display mod metadata (name, author, version, description)
- Show mod documentation
- Handle dependencies between mods
- Display compatibility information
- Show mod links (source code, Discord, website, etc.)

## Contributing

Contributions are welcome! Please ensure:

1. Code follows the project's style guidelines
2. Tests are added/updated for new features
3. TypeScript bindings are regenerated (happens automatically in dev)
4. Translations are considered for UI changes (use `<Trans>` components)
