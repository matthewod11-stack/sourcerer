/**
 * Notion output adapter — creates/updates a Notion database with candidate pages.
 */

import { Client, isNotionClientError, APIErrorCode } from '@notionhq/client';
import type {
  OutputAdapter,
  OutputConfig,
  PushResult,
  UpsertResult,
  ScoredCandidate,
} from '@sourcerer/core';
import { getDatabaseProperties } from './database-schema.js';
import { buildPageProperties, buildPageBlocks } from './page-builder.js';
import { RateLimiter } from './rate-limiter.js';

const DEFAULT_DB_TITLE = 'Sourcerer Candidates';

export interface NotionAdapterConfig {
  token: string;
  parentPageId: string;
}

export class NotionOutputAdapter implements OutputAdapter {
  readonly name = 'notion';
  readonly requiresAuth = true;

  private client: Client;
  private rateLimiter: RateLimiter;
  private parentPageId: string;

  constructor(private config: NotionAdapterConfig) {
    this.client = new Client({ auth: config.token });
    this.rateLimiter = new RateLimiter();
    this.parentPageId = config.parentPageId;
  }

  async push(
    candidates: ScoredCandidate[],
    config: OutputConfig,
  ): Promise<PushResult> {
    const dbTitle = resolveDatabaseTitle(config);
    const databaseId = await this.findOrCreateDatabase(dbTitle);

    for (const candidate of candidates) {
      await this.createCandidatePage(databaseId, candidate);
    }

    return {
      adapter: this.name,
      candidatesPushed: candidates.length,
      outputLocation: `https://notion.so/${databaseId.replace(/-/g, '')}`,
      pushedAt: new Date().toISOString(),
    };
  }

  async upsert(
    candidates: ScoredCandidate[],
    config: OutputConfig,
  ): Promise<UpsertResult> {
    const dbTitle = resolveDatabaseTitle(config);
    const databaseId = await this.findOrCreateDatabase(dbTitle);

    const created: string[] = [];
    const updated: string[] = [];
    const failed: { candidateId: string; error: Error }[] = [];

    for (const candidate of candidates) {
      try {
        const existingPageId = await this.findPageByCandidateId(
          databaseId,
          candidate.id,
        );

        if (existingPageId) {
          await this.updateCandidatePage(existingPageId, candidate);
          updated.push(candidate.id);
        } else {
          await this.createCandidatePage(databaseId, candidate);
          created.push(candidate.id);
        }
      } catch (err) {
        failed.push({
          candidateId: candidate.id,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }

    return { created, updated, unchanged: [], failed };
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.rateLimitedCall(() => this.client.users.me({}));
      return true;
    } catch {
      return false;
    }
  }

  // ---- Private: Database Operations ----

  private async findOrCreateDatabase(title: string): Promise<string> {
    // Search for an existing database with matching title, scoped to parent page
    const response = await this.rateLimitedCall(() =>
      this.client.search({
        query: title,
        filter: { property: 'object', value: 'database' },
        page_size: 10,
      }),
    );

    for (const result of response.results) {
      if (
        result.object === 'database' &&
        'title' in result &&
        Array.isArray(result.title) &&
        'parent' in result
      ) {
        // Verify the database is under our target parent page
        const parent = result.parent as { type: string; page_id?: string };
        if (parent.type !== 'page_id' || parent.page_id !== this.parentPageId) {
          continue;
        }
        const dbTitle = result.title
          .map((t: { plain_text?: string }) => t.plain_text ?? '')
          .join('');
        if (dbTitle === title) {
          return result.id;
        }
      }
    }

    // Not found — create a new database
    const db = await this.rateLimitedCall(() =>
      this.client.databases.create({
        parent: { type: 'page_id', page_id: this.parentPageId },
        title: [{ type: 'text', text: { content: title } }],
        properties: getDatabaseProperties() as unknown as Record<string, never>,
      }),
    );

    return db.id;
  }

  // ---- Private: Page Operations ----

  private async createCandidatePage(
    databaseId: string,
    candidate: ScoredCandidate,
  ): Promise<string> {
    const properties = buildPageProperties(candidate);
    const children = buildPageBlocks(candidate);

    const page = await this.rateLimitedCall(() =>
      this.client.pages.create({
        parent: { database_id: databaseId },
        properties: properties as unknown as Record<string, never>,
        children: children as unknown as never[],
      }),
    );

    return page.id;
  }

  private async findPageByCandidateId(
    databaseId: string,
    candidateId: string,
  ): Promise<string | null> {
    const response = await this.rateLimitedCall(() =>
      this.client.databases.query({
        database_id: databaseId,
        filter: {
          property: 'CandidateId',
          rich_text: { equals: candidateId },
        },
        page_size: 1,
      }),
    );

    return response.results.length > 0 ? response.results[0].id : null;
  }

  private async updateCandidatePage(
    pageId: string,
    candidate: ScoredCandidate,
  ): Promise<void> {
    const properties = buildPageProperties(candidate);

    // Update page properties
    await this.rateLimitedCall(() =>
      this.client.pages.update({
        page_id: pageId,
        properties: properties as unknown as Record<string, never>,
      }),
    );

    // Archive old block children
    const existingBlocks = await this.rateLimitedCall(() =>
      this.client.blocks.children.list({ block_id: pageId }),
    );

    for (const block of existingBlocks.results) {
      await this.rateLimitedCall(() =>
        this.client.blocks.delete({ block_id: block.id }),
      );
    }

    // Append new block children
    const children = buildPageBlocks(candidate);
    await this.rateLimitedCall(() =>
      this.client.blocks.children.append({
        block_id: pageId,
        children: children as unknown as never[],
      }),
    );
  }

  // ---- Private: Rate-limited API wrapper ----

  private async rateLimitedCall<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await this.rateLimiter.acquire();
      try {
        const result = await fn();
        this.rateLimiter.notifySuccess();
        return result;
      } catch (err) {
        if (
          isNotionClientError(err) &&
          err.code === APIErrorCode.RateLimited &&
          attempt < maxRetries
        ) {
          this.rateLimiter.notifyRateLimit();
          continue;
        }
        throw err;
      }
    }
    // Unreachable, but satisfies TypeScript
    throw new Error('Rate limit retries exhausted');
  }
}

// ---- Helpers ----

function resolveDatabaseTitle(config: OutputConfig): string {
  if (typeof config.metadata?.databaseTitle === 'string') {
    return config.metadata.databaseTitle;
  }
  if (typeof config.metadata?.roleName === 'string') {
    return config.metadata.roleName;
  }
  return DEFAULT_DB_TITLE;
}
