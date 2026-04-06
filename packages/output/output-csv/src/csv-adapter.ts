import { mkdir, writeFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  OutputAdapter,
  OutputConfig,
  PushResult,
  UpsertResult,
  ScoredCandidate,
} from '@sourcerer/core';
import { renderCsv } from './csv-renderer.js';

const DEFAULT_FILENAME = 'candidates.csv';

export class CsvOutputAdapter implements OutputAdapter {
  readonly name = 'csv';
  readonly requiresAuth = false;

  async push(
    candidates: ScoredCandidate[],
    config: OutputConfig,
  ): Promise<PushResult> {
    await mkdir(config.outputDir, { recursive: true });
    const filename =
      typeof config.metadata?.filename === 'string'
        ? config.metadata.filename
        : DEFAULT_FILENAME;
    const filePath = join(config.outputDir, filename);
    const content = renderCsv(candidates);
    await writeFile(filePath, content, 'utf-8');
    return {
      adapter: this.name,
      candidatesPushed: candidates.length,
      outputLocation: filePath,
      pushedAt: new Date().toISOString(),
    };
  }

  async upsert(
    candidates: ScoredCandidate[],
    config: OutputConfig,
  ): Promise<UpsertResult> {
    const filename =
      typeof config.metadata?.filename === 'string'
        ? config.metadata.filename
        : DEFAULT_FILENAME;
    const filePath = join(config.outputDir, filename);

    const fileExists = await stat(filePath)
      .then(() => true)
      .catch(() => false);

    await this.push(candidates, config);

    const ids = candidates.map((c) => c.id);
    return {
      created: fileExists ? [] : ids,
      updated: fileExists ? ids : [],
      unchanged: [],
      failed: [],
    };
  }

  async testConnection(): Promise<boolean> {
    const testFile = join(tmpdir(), `.sourcerer-csv-test-${Date.now()}`);
    try {
      await writeFile(testFile, '', 'utf-8');
      await unlink(testFile);
      return true;
    } catch {
      return false;
    }
  }
}
