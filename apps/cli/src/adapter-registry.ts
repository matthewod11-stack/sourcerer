// Shared adapter resolution — maps format names to OutputAdapter instances

import { JsonOutputAdapter } from '@sourcerer/output-json';
import { MarkdownOutputAdapter } from '@sourcerer/output-markdown';
import { CsvOutputAdapter } from '@sourcerer/output-csv';
import { NotionOutputAdapter } from '@sourcerer/output-notion';
import type { OutputAdapter } from '@sourcerer/core';

export interface NotionAdapterConfig {
  token: string;
  parentPageId: string;
}

export function resolveOutputAdapter(
  name: string,
  notionConfig?: NotionAdapterConfig,
): OutputAdapter | null {
  switch (name) {
    case 'json':
      return new JsonOutputAdapter();
    case 'markdown':
      return new MarkdownOutputAdapter();
    case 'csv':
      return new CsvOutputAdapter();
    case 'notion': {
      const token = notionConfig?.token ?? process.env.NOTION_TOKEN;
      const parentPageId = notionConfig?.parentPageId ?? process.env.NOTION_PARENT_PAGE_ID;
      if (!token || !parentPageId) {
        const missing = [
          !token ? 'NOTION_TOKEN' : null,
          !parentPageId ? 'NOTION_PARENT_PAGE_ID' : null,
        ].filter(Boolean).join(', ');
        console.warn(`Notion adapter requires ${missing} — set via environment variable or sourcerer config`);
        return null;
      }
      return new NotionOutputAdapter({ token, parentPageId });
    }
    default:
      return null;
  }
}
