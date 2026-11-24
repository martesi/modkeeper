### Codebase Overview
- **Language**: Go (Wails app), TypeScript (frontend)
- **Build**: Go for the app
- **Frontend**: Bun
- **Project**: Game mod management and development

### Development shell
- With Nix, `nix develop -c ...` is also valid.
- Run frontend commands with `bun run ...`.
- For browser E2E on WSL, when `/dev/dxg` and the WSL GPU driver mounts are available, use `nix develop .#e2e-wsl-gpu -c xvfb-run -a ...`. Check GPU access with `bun scripts/check-wsl-gpu.mjs` inside that profile. Otherwise, use the normal `e2e` profile.
- For agent-driven Linux native desktop GUI verification, use `nix develop .#e2e` and run `task dev` to start the Wails desktop app. When no usable display is available, run the app and the agent's GUI interactions on the same Xvfb display; `xvfb-run -a` can manage the display for a single command or shell. The `e2e` profile provides `xdpyinfo`, `xdotool`, and ImageMagick `import` for display checks, input, and screenshots. See `.agents/skills/e2e/references/driving.md` for display readiness and cleanup. Verify the app has painted before assessing screenshots. Browser E2E and `test:agent` do not verify native window behavior.

### Development Guidelines
- **Testing**: Add tests for new features, refactor existing tests after changes
- **Code Duplication**: Check for existing logic before adding new code, prefer extraction
- **Gates**: `bun run check` is the frontend gate (typecheck, scoped lint, Prettier, tests, token guardrail). `go test ./...` is the app gate. Wails bindings in `frontend/bindings` are generated, not committed; `bun run bindings:wails` regenerates them.

### Local gates and CI
- Local changes run only the gates the change touches: the formatter for each edited language (`gofmt`, `bun run format:check`) plus the focused tests for the packages you changed. Do not run the full suite locally.
- Push the branch to run the full suite. `.github/workflows/test.yml` triggers on every branch push and on pull requests into `main`; CI is the source of truth for full tests.
- CI runs one job, `linux`. It generates the Wails bindings, runs the frontend gates and tests, then Go formatting, vet and tests. It builds both artifacts and smoke-tests server mode.
- CI builds both artifacts from one source: `modkeeper` (desktop) and `modkeeper-server` (headless, `-tags server`). Server mode is a Wails build tag, not a runtime switch, so one binary cannot serve both roles. CI leaves them in `build/ci/` and uploads them as one archive.
- Keep a green CI run as the merge condition. A local pass is not evidence for gates you did not run.

### Work isolation
- Use one branch per task and one worktree per branch: `git worktree add ../modkeeper-<task> -b <task>`.
- Prefer Git worktrees over `jj workspace add`. A jj workspace only works here with `--colocate`: without a Git working tree Nix cannot evaluate the flake, because it reads repository state through Git.
- Do not mix unrelated work in one branch or commit. Commit on the branch and let CI run before merging.

### Frontend Specifics
- Bun is used as the package manager and dev runtime
- Use Bun commands (e.g., `bun run dev`) for frontend development
- `bun run bindings:wails` generates the Wails TypeScript bindings in `frontend/bindings`.

<!-- Problem Decomposition Specification -->
Identify the underlying core critical question that remains unstated, and articulate it clearly.
When decomposing problems, prioritize clarifying causal mechanisms instead of building excessive hierarchical structures. Do not stack empty abstract layers merely to feign profound analysis.
<!-- Problem Decomposition Specification -->
