# Repository Guidelines

## Project Structure & Module Organization

MyLogger is a Rust workspace with docs, skills, and an Android Studio plugin.

- `crates/mylogger-cli/`: CLI entry point and command dispatch.
- `crates/mylogger-core/`: log parsing, routing, workflows, analysis, and report logic.
- `crates/mylogger-tools/`: external tool integrations such as `adb` log capture.
- `crates/mylogger-tui/`: interactive terminal UI.
- `crates/mylogger-llm/`: LLM integration boundary.
- `docs/`: product and architecture design notes.
- `skills/`: local agent skills, including `skills/my-logger/`.
- `asplugin/`: Android Studio plugin for exporting breakpoint metadata.

Do not commit generated files: `target/`, `asplugin/build/`, logs, or `.txt` captures.

## Build, Test, and Development Commands

Run from the repository root unless noted:

```bash
cargo build --workspace        # Build all crates
cargo test --workspace         # Run tests
cargo fmt --all                # Format code
cargo run -p mylogger          # Start TUI
cargo run -p mylogger -- --help
```

Build the Android Studio plugin separately:

```bash
cd asplugin
gradle buildPlugin
```

The plugin zip appears under `asplugin/build/distributions/`.

## Coding Style & Naming Conventions

Rust code should follow `rustfmt` and existing module boundaries. Keep TUI behavior in `mylogger-tui`, routing in `mylogger-core`, and process handling in `mylogger-tools`.

Use snake_case for Rust functions, modules, and variables. Use PascalCase for Rust types and enum variants. Keep commands short, such as `/capture`.

Kotlin plugin code under `asplugin/` should use PascalCase classes and camelCase functions.

## Testing Guidelines

Run `cargo test --workspace` before submitting Rust changes. Add focused tests near the changed crate when altering routing, parsing, workflows, or analysis. For TUI or process changes, manually verify the flow.

For plugin changes, run `gradle buildPlugin` in `asplugin/` and verify installation in Android Studio when needed.

## Commit & Pull Request Guidelines

Existing commits use short, imperative English messages, for example:

- `Add Android Studio breakpoint export plugin`
- `Open yazi for interactive analyze`
- `Add TUI device picker for capture`

Follow that style: describe the main behavior change in one line. Pull requests should include a summary, verification commands, and screenshots or terminal notes for TUI/plugin changes.

## Agent-Specific Instructions

Do not overwrite generated logs or user-created analysis files unless requested. Keep `skills/` concise: core workflow in `SKILL.md`, detailed patterns in `references/`.

Use `https://github.com/anthropics/skills` as the reference project for skills. Follow its self-contained folder pattern: required `SKILL.md`, YAML `name` and `description`, and optional `references/`, `scripts/`, or `assets/` only when reusable.
