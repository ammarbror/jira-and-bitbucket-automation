import type { PRMetadata } from './types.js';

export const JIRA_KEY_PATTERN = /KAIRA-\d+/gi;

export function extractJiraKeys(metadata: PRMetadata): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  const sources = [
    metadata.title,
    metadata.description,
    metadata.sourceBranch,
    ...metadata.commitMessages,
  ];

  for (const source of sources) {
    if (typeof source !== 'string') continue;
    const matches = source.matchAll(JIRA_KEY_PATTERN);
    for (const match of matches) {
      const key = match[0].toUpperCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(key);
      }
    }
  }

  return result;
}
