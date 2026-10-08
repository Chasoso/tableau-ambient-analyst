# Project-local Codex Hooks

Issue #55 adds a small repository-local `PreToolUse` Hook at
`.codex/hooks.json`. It invokes the Node-based fail-closed wrapper
`.codex/hooks/run_pre_tool_use_policy.mjs` for Bash commands, which runs the
policy checker and denies only the mechanical safety classes owned by this
Issue:

- force push;
- `git reset --hard`;
- direct push to `main`;
- `--no-verify`;
- pull request merge commands;
- force deletion of local branches;
- force removal of worktrees.

The Hook is a command guard, not a workflow engine. `AGENTS.md` owns policy,
authority, semantic decisions, and Human Decisions. The Issue-to-PR Skill owns
the procedure. The #59 workspace resolver owns canonical branch/worktree
selection, `NEW` / `REUSE` / `BLOCKED`, duplicate detection, and semantic
removal safety. Validation and CI verify the resulting repository state.

The Hook intentionally allows read-only inspection, ordinary validation,
pushes of the already-resolved canonical Issue branch, and non-force
repository-managed worktree commands. It does not decide which Issue or
worktree is canonical and must not be expanded into a generic policy engine.

Project-local Hooks are loaded only when the project is trusted by Codex. A
human must review and trust the repository Hook definition when Codex asks for
that activation; this Issue does not install or modify user-global or
system-wide configuration. A Hook denial is final for the command class it
owns and must not be retried through an obvious equivalent command.

The deterministic `tests/hooks-policy.test.ts` harness invokes the guard
directly with representative JSON Hook inputs; it does not use network or
live services. The repository requires Node 24 or newer; the wrapper also
fails closed if its Python policy runtime is unavailable or fails.
