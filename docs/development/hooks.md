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
Repository-managed child-process Git/GitHub calls use the same mechanical
guard before execution; this protects that boundary without moving workflow
semantics into Hooks.

The Hook intentionally allows read-only inspection, ordinary validation,
pushes of the already-resolved canonical Issue branch, and non-force
repository-managed worktree commands. It does not decide which Issue or
worktree is canonical and must not be expanded into a generic policy engine.

Project-local Hooks are loaded only when the project is trusted by Codex. A
human must review and trust the repository Hook definition when Codex asks for
that activation; this Issue does not install or modify user-global or
system-wide configuration. A Hook denial is final for the command class it
owns and must not be retried through an obvious equivalent command.

The Hook runtime is Node 24 only; it has no Python dependency. The checker
recursively inspects command strings used by `bash`, `sh`, and `zsh` wrappers
for the supported short-option forms. Dynamic or otherwise statically
unresolved push destinations fail closed, including leading shell assignment
prefixes such as `FOO=bar`. Ordinary variable expansion and literal braces
outside protected command boundaries are allowed; executable substitutions
and dynamic protected destinations are not. Newline-separated commands are
treated like other command separators. Unsupported shell control structures
that contain Git/GitHub operations fail closed, while harmless brace or
variable text remains allowed outside those protected boundaries. The deterministic
`tests/hooks-policy.test.ts` harness invokes the guard directly with
representative JSON Hook inputs; it does not use network or live services.
