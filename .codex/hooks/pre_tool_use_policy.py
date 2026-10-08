#!/usr/bin/env python3
"""Block only the mechanical Git/GitHub operations owned by Issue #55."""

import json
import shlex
import sys
from typing import Any


def deny(reason: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )


def tokens_for(command: str) -> list[str] | None:
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        return list(lexer)
    except ValueError:
        return None


def executable_name(token: str) -> str:
    return token.rsplit("/", 1)[-1]


def segments(tokens: list[str]) -> list[list[str]]:
    separators = {";", "&&", "||", "|", "&", "\n"}
    result: list[list[str]] = []
    current: list[str] = []
    for token in tokens:
        if token in separators:
            if current:
                result.append(current)
                current = []
        else:
            current.append(token)
    if current:
        result.append(current)
    return result


def git_invocations(segment: list[str]) -> list[tuple[str, list[str]]]:
    invocations: list[tuple[str, list[str]]] = []
    for index, token in enumerate(segment):
        if executable_name(token) != "git":
            continue
        cursor = index + 1
        while cursor < len(segment) and segment[cursor].startswith("-"):
            if segment[cursor] in {"-C", "--git-dir", "--work-tree"}:
                cursor += 2
            else:
                cursor += 1
        if cursor < len(segment):
            invocations.append((segment[cursor], segment[cursor + 1 :]))
    return invocations


def protected_ref(token: str) -> bool:
    for ref in token.lstrip("+").split(":"):
        if ref == "main" or ref.endswith("/main") or ref == "refs/heads/main":
            return True
    return False


def force_option(token: str) -> bool:
    return (
        token in {"-f", "--force", "--force-with-lease"}
        or token.startswith(("--force=", "--force-with-lease="))
        or (token.startswith("-") and not token.startswith("--") and "f" in token[1:])
    )


def short_option_bundle_contains(token: str, flag: str) -> bool:
    return token.startswith("-") and not token.startswith("--") and flag in token[1:]


def decision(command: str) -> str | None:
    tokens = tokens_for(command)
    if tokens is None:
        return "Hook could not parse the pending shell command; execution is blocked."

    for segment in segments(tokens):
        for index, token in enumerate(segment[:-2]):
            if executable_name(token) in {"bash", "sh", "zsh"} and segment[index + 1] == "-c":
                nested_reason = decision(segment[index + 2])
                if nested_reason:
                    return nested_reason

        for verb, args in git_invocations(segment):
            if "--no-verify" in args:
                return "Git verification bypass (--no-verify) is blocked by the repository Hook."

            if verb == "push":
                if any(force_option(option) for option in args):
                    return "Force push is blocked by the repository Hook."
                if any(protected_ref(token) for token in args):
                    return "Direct push to protected branch main is blocked by the repository Hook."

            if verb == "reset" and "--hard" in args:
                return "Destructive hard reset is blocked by the repository Hook."

            if verb == "branch":
                delete = "-d" in args or "--delete" in args or any(
                    short_option_bundle_contains(option, "d") for option in args
                )
                force_delete = "-D" in args or any(
                    short_option_bundle_contains(option, "D") for option in args
                ) or (
                    delete and any(force_option(option) for option in args)
                )
                if force_delete:
                    return "Force deletion of local branches is blocked by the repository Hook."

            if verb == "worktree" and len(args) >= 2 and args[0] == "remove":
                if any(
                    force_option(option)
                    for option in args[1:]
                ):
                    return "Force removal of worktrees is blocked by the repository Hook."

        for index, token in enumerate(segment):
            if (
                executable_name(token) == "gh"
                and "pr" in segment[index + 1 :]
                and "merge" in segment[index + 1 :]
            ):
                return "Pull request merge operations are blocked by the repository Hook."

    return None


def main() -> int:
    try:
        payload: Any = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        deny("Hook input was malformed; execution is blocked.")
        return 0
    if not isinstance(payload, dict):
        deny("Hook input was malformed; execution is blocked.")
        return 0
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        deny("Hook tool input was malformed; execution is blocked.")
        return 0
    command = tool_input.get("command")
    if not isinstance(command, str):
        deny("Hook command input was malformed; execution is blocked.")
        return 0
    reason = decision(command)
    if reason:
        deny(reason)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
