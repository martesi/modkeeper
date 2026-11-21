### Codebase Overview
- **Language**: Go (Wails app), Rust (legacy Tauri shell), TypeScript (frontend)
- **Build**: Go for the app, Cargo for the Tauri shell
- **Frontend**: Bun
- **Project**: Game mod management and development

### Development shell
- Run Rust commands with `sh scripts/with-rust.sh <cmd>`; it uses `nix develop` when `nix` is available and plain `cargo` otherwise.
- With Nix, `nix develop -c ...` is also valid.
- Do not use `nix-shell -p cargo`.
- Run frontend commands with `bun run ...`.

### Development Guidelines
- **Testing**: Add tests for new features, refactor existing tests after changes
- **Code Duplication**: Check for existing logic before adding new code, prefer extraction
- **Binding generation**: Use `sh scripts/with-rust.sh cargo run --bin export_types --features export-types` to update frontend bindings.
- **Gates**: `bun run check` is the full frontend gate (typecheck, scoped lint, Prettier, tests, token guardrail, test path selection). `go test ./...` is the app gate. `bun run test:rust` is the Rust gate and `bun run rust:fmt:check` checks Rust formatting. `bun run bindings:check` fails when `src/gen/bindings.ts` drifts from the Rust declarations; `bun run bindings:write` regenerates it. `bun run bindings:wails:check` does the same for the pruned Wails bindings.

### Local gates and CI
- Local changes run only the gates the change touches: the formatter for each edited language (`gofmt`, `bun run format:check`, `cargo fmt`) plus the focused tests for the packages you changed. Do not run the full suite locally.
- Push the branch to run the full suite. `.github/workflows/test.yml` triggers on every branch push and on pull requests into `main`; CI is the source of truth for full tests.
- CI runs two jobs. `test` (Windows) runs the frontend gates, frontend tests, test path selection, Rust tests, Rust formatting and the Rust bindings drift check. `linux` installs the Go version from `go.mod`, runs Go formatting, vet and tests, builds both artifacts and smoke-tests server mode.
- CI builds both artifacts from one source: `modkeeper` (desktop) and `modkeeper-server` (headless, `-tags server`). Server mode is a Wails build tag, not a runtime switch, so one binary cannot serve both roles. CI leaves them in `build/ci/` and uploads them as one archive.
- Keep a green CI run as the merge condition. A local pass is not evidence for gates you did not run.

### Work isolation
- Use one branch per task and one worktree per branch: `git worktree add ../modkeeper-<task> -b <task>`.
- Prefer Git worktrees over `jj workspace add`. A jj workspace only works here with `--colocate`: without a Git working tree Nix cannot evaluate the flake, because it reads repository state through Git.
- Do not mix unrelated work in one branch or commit. Commit on the branch and let CI run before merging.

### Frontend Specifics
- Bun is used as the package manager and dev runtime
- Use Bun commands (e.g., `bun run dev`) for frontend development
- `export_types` binary updates TypeScript bindings

<!-- Problem Decomposition Specification -->
Identify the underlying core critical question that remains unstated, and articulate it clearly.
When decomposing problems, prioritize clarifying causal mechanisms instead of building excessive hierarchical structures. Do not stack empty abstract layers merely to feign profound analysis.
<!-- Problem Decomposition Specification -->
