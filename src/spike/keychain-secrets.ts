import { execFileSync } from 'node:child_process';

export function readKeychainSecret(service: string): string {
  const value = execFileSync(
    'security',
    ['find-generic-password', '-a', process.env.USER ?? '', '-s', service, '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  if (value.length === 0) throw new Error(`Keychain secret is empty for ${service}`);
  return value;
}
