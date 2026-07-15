import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractJiraKeys } from './jira-detector.js';

void describe('extractJiraKeys', () => {
  void it('finds a key in the title', () => {
    const result = extractJiraKeys({
      title: 'Fix KAIRA-123 bug',
      description: '',
      sourceBranch: '',
      commitMessages: [],
    });
    assert.deepStrictEqual(result, ['KAIRA-123']);
  });

  void it('finds a key in the branch name', () => {
    const result = extractJiraKeys({
      title: '',
      description: '',
      sourceBranch: 'feature/KAIRA-456',
      commitMessages: [],
    });
    assert.deepStrictEqual(result, ['KAIRA-456']);
  });

  void it('deduplicates multiple occurrences of the same key across fields', () => {
    const result = extractJiraKeys({
      title: 'KAIRA-999 Fix',
      description: 'Related to KAIRA-999',
      sourceBranch: 'bugfix/KAIRA-999',
      commitMessages: ['wip KAIRA-999', 'KAIRA-999 done'],
    });
    assert.deepStrictEqual(result, ['KAIRA-999']);
  });

  void it('returns an empty array when no Jira keys are present', () => {
    const result = extractJiraKeys({
      title: 'General cleanup',
      description: 'No tickets here',
      sourceBranch: 'main',
      commitMessages: ['chore: tidy up'],
    });
    assert.deepStrictEqual(result, []);
  });

  void it('matches case-insensitive keys and normalizes to uppercase', () => {
    const result = extractJiraKeys({
      title: 'fix kaira-789 issue',
      description: '',
      sourceBranch: '',
      commitMessages: [],
    });
    assert.deepStrictEqual(result, ['KAIRA-789']);
  });
});
