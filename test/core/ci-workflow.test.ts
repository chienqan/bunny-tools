import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateGitHubActionsWorkflow } from '../../src/core/ci-workflow.js';
import type { BunnyJson } from '../../src/config/bunny-json.js';

function config(overrides: Partial<BunnyJson['deploy']> = {}): BunnyJson {
  return {
    deploy: {
      publicDir: 'dist',
      ignore: [],
      mimeTypes: {},
      headers: [],
      edgeRules: [],
      storageZone: 'my-app',
      concurrency: 8,
      pullZones: [],
      ...overrides,
    },
  };
}

describe('generateGitHubActionsWorkflow', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'ci-workflow-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('writes .github/workflows/bunny-deploy.yml needing only the account key', async () => {
    const result = await generateGitHubActionsWorkflow(scratch, config({ storageZone: 'my-app' }));
    expect(result.wrote).toBe(true);
    if (!result.wrote) return; // type narrowing
    const yaml = await readFile(result.path, 'utf8');
    expect(yaml).toContain('BUNNY_API_KEY');
    expect(yaml).not.toContain('BUNNY_STORAGE_PASSWORD');
    expect(yaml).toContain('npm install -g bunny-tools');
    expect(yaml).toContain('bunny deploy --delete');
    expect(yaml).toContain("paths-ignore:");
    expect(yaml).toContain('docs/**');
  });

  it('asks only for the account key secret (zone password is fetched with it)', async () => {
    const result = await generateGitHubActionsWorkflow(scratch, config({ storageZone: 'site-prod' }));
    expect(result.secretsToAdd).toEqual(['BUNNY_API_KEY']);
  });

  it('skips writing when workflow file already exists', async () => {
    await mkdir(join(scratch, '.github', 'workflows'), { recursive: true });
    await writeFile(join(scratch, '.github', 'workflows', 'bunny-deploy.yml'), '# user-edited\n');

    const result = await generateGitHubActionsWorkflow(scratch, config());
    expect(result.wrote).toBe(false);
    if (result.wrote) return;
    expect(result.reason).toBe('exists');
    // Untouched.
    const yaml = await readFile(result.path, 'utf8');
    expect(yaml).toBe('# user-edited\n');
  });
});
