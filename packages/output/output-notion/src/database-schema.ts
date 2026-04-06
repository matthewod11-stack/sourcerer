/**
 * Notion database property definitions for the Sourcerer candidate DB.
 */

/** The property schema used when creating a new Notion database. */
export function getDatabaseProperties(): Record<string, NotionPropertySchema> {
  return {
    Name: {
      title: {},
    },
    Score: {
      number: { format: 'number' },
    },
    Tier: {
      select: {
        options: [
          { name: 'Tier 1', color: 'green' },
          { name: 'Tier 2', color: 'yellow' },
          { name: 'Tier 3', color: 'red' },
        ],
      },
    },
    Role: {
      rich_text: {},
    },
    Company: {
      rich_text: {},
    },
    Email: {
      email: {},
    },
    Status: {
      select: {
        options: [
          { name: 'New', color: 'blue' },
          { name: 'Reviewed', color: 'purple' },
          { name: 'Contacted', color: 'orange' },
          { name: 'Passed', color: 'gray' },
        ],
      },
    },
    'Low Confidence Merge': {
      checkbox: {},
    },
    CandidateId: {
      rich_text: {},
    },
    PushedAt: {
      date: {},
    },
  };
}

// ---- Type helpers for Notion property schemas ----

interface SelectOption {
  name: string;
  color: string;
}

interface NotionPropertySchema {
  title?: Record<string, never>;
  number?: { format: string };
  select?: { options: SelectOption[] };
  rich_text?: Record<string, never>;
  email?: Record<string, never>;
  date?: Record<string, never>;
  checkbox?: Record<string, never>;
}
