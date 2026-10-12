import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const manifest = readFileSync(join(process.cwd(), 'extensions/ambient-analyst-dev.trex'), 'utf8');

describe('Tableau development extension manifest', () => {
  it('declares a localhost dashboard extension source without data permissions', () => {
    expect(manifest).toContain('xmlns="http://www.tableau.com/xml/extension_manifest"');
    expect(manifest).toContain('<dashboard-extension');
    expect(manifest).toContain('<source-location>');
    expect(manifest).toContain('<url>http://localhost:4173/</url>');
    expect(manifest).toContain('<min-api-version>1.7</min-api-version>');
    expect(manifest).not.toContain('<permissions>');
    expect(manifest).not.toContain('<permission>full data</permission>');
  });
});
