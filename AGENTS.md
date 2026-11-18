### Codebase Overview
- **Language**: Rust (primary), TypeScript (frontend)
- **Build**: Cargo for Rust
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
- **Gates**: `bun run check` is the full frontend gate (typecheck, scoped lint, Prettier, tests, token guardrail). `bun run test:rust` is the backend gate and `bun run rust:fmt:check` checks Rust formatting. `bun run bindings:check` fails when `src/gen/bindings.ts` drifts from the Rust declarations; `bun run bindings:write` regenerates it.

### Frontend Specifics
- Bun is used as the package manager and dev runtime
- Use Bun commands (e.g., `bun run dev`) for frontend development
- `export_types` binary updates TypeScript bindings

<!-- Problem Decomposition Specification -->
Identify the underlying core critical question that remains unstated, and articulate it clearly.
When decomposing problems, prioritize clarifying causal mechanisms instead of building excessive hierarchical structures. Do not stack empty abstract layers merely to feign profound analysis.
<!-- Problem Decomposition Specification -->
