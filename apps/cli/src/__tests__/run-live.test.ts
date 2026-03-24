// Live API smoke test — only runs when SOURCERER_LIVE_TEST=1
// Requires: ~/.sourcerer/config.yaml with valid Exa API key

import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import {
  PipelineRunner,
  createDedupHandler,
  type SearchConfig,
  type TalentProfile,
} from '@sourcerer/core';
import { ExaAdapter } from '@sourcerer/adapter-exa';
import { GitHubAdapter } from '@sourcerer/adapter-github';
import { JsonOutputAdapter } from '@sourcerer/output-json';
import { MarkdownOutputAdapter } from '@sourcerer/output-markdown';
import { loadConfigFromDisk } from '../config-io.js';
import {
  createDiscoverHandler,
  createEnrichHandler,
  createStubScoreHandler,
  createOutputHandler,
} from '../handlers.js';

const LIVE = process.env.SOURCERER_LIVE_TEST === '1';

describe.skipIf(!LIVE)('Live pipeline smoke test', () => {
  it(
    'runs discovery with real Exa API and produces output',
    async () => {
      const config = await loadConfigFromDisk();
      const searchConfigContent = await readFile(
        join(process.cwd(), 'test-fixtures', 'smoke-test-search-config.yaml'),
        'utf-8',
      );
      const searchConfig = yaml.load(searchConfigContent) as SearchConfig;

      const profileContent = await readFile(
        join(process.cwd(), 'test-fixtures', 'smoke-test-talent-profile.json'),
        'utf-8',
      );
      const talentProfile = JSON.parse(profileContent) as TalentProfile;

      const exa = new ExaAdapter(config.adapters.exa.apiKey);
      const github = new GitHubAdapter(process.env.GITHUB_TOKEN);

      const testDir = await mkdtemp(join(tmpdir(), 'sourcerer-live-'));

      try {
        const runner = new PipelineRunner({
          discover: createDiscoverHandler(exa),
          dedup: createDedupHandler(),
          enrich: createEnrichHandler({ github }),
          score: createStubScoreHandler(searchConfig),
          output: createOutputHandler([
            new JsonOutputAdapter(),
            new MarkdownOutputAdapter(),
          ]),
        });

        const meta = await runner.run({
          roleName: searchConfig.roleName,
          runsBaseDir: testDir,
          searchConfig,
          talentProfile,
          maxCostUsd: searchConfig.maxCostUsd,
        });

        expect(meta.status).toBe('completed');
        expect(meta.candidateCount).toBeGreaterThan(0);
        expect(meta.cost.totalCost).toBeLessThan(2.0);

        // Verify output files
        const jsonContent = await readFile(
          join(meta.runDir, 'candidates.json'),
          'utf-8',
        );
        const parsed = JSON.parse(jsonContent);
        expect(parsed.candidateCount).toBeGreaterThan(0);

        const mdContent = await readFile(
          join(meta.runDir, 'report.md'),
          'utf-8',
        );
        expect(mdContent).toContain('# Sourcerer Report');

        console.log(`Live test complete: ${meta.candidateCount} candidates, $${meta.cost.totalCost.toFixed(4)}`);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
