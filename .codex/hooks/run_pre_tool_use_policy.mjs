import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const hookDirectory = dirname(fileURLToPath(import.meta.url));
const policy = join(hookDirectory, 'pre_tool_use_policy.py');
const input = readFileSync(0, 'utf8');

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
}

try {
  const result = spawnSync('python3', [policy], {
    input,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
    deny('Repository safety Hook runtime failed closed; execution is blocked.');
  } else {
    process.stdout.write(result.stdout);
  }
} catch {
  deny('Repository safety Hook runtime failed closed; execution is blocked.');
}
