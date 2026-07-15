import type { PRInfo, ReviewFinding, BitbucketConfig, JiraConfig } from './types.ts';
import { parsePRURL } from './url-parser.ts';
import { extractJiraKeys } from './jira-detector.ts';
import { buildReviewPrompt } from './prompts.ts';
import { fetchPRInfo, fetchPRDiff, postGeneralComment, postInlineComment } from './bitbucket-client.ts';
import { addIssueCommentADF, getTransitions, transitionIssue } from './jira-client.ts';

// ---------------------------------------------------------------------------
// Config loaders
// ---------------------------------------------------------------------------

/**
 * Load Bitbucket configuration from environment variables.
 * Requires BITBUCKET_EMAIL and BITBUCKET_API_TOKEN.
 * Throws if any required variable is missing or empty.
 */
export function loadBitbucketConfig(): BitbucketConfig {
  const email = process.env.BITBUCKET_EMAIL;
  const apiToken = process.env.BITBUCKET_API_TOKEN;

  if (!email) {
    throw new Error(
      'Missing BITBUCKET_EMAIL environment variable. Set BITBUCKET_EMAIL in .env or export it.',
    );
  }
  if (!apiToken) {
    throw new Error(
      'Missing BITBUCKET_API_TOKEN environment variable. Set BITBUCKET_API_TOKEN in .env or export it.',
    );
  }

  return { email, apiToken };
}

/**
 * Load Jira configuration from environment variables.
 * Requires JIRA_EMAIL, JIRA_API_TOKEN, JIRA_URL, and JIRA_PROJECT_KEY.
 * Throws if any required variable is missing or empty.
 */
export function loadJiraConfig(): JiraConfig {
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const baseUrl = process.env.JIRA_URL;
  const projectKey = process.env.JIRA_PROJECT_KEY;

  if (!email) {
    throw new Error(
      'Missing JIRA_EMAIL environment variable. Set JIRA_EMAIL in .env or export it.',
    );
  }
  if (!apiToken) {
    throw new Error(
      'Missing JIRA_API_TOKEN environment variable. Set JIRA_API_TOKEN in .env or export it.',
    );
  }
  if (!baseUrl) {
    throw new Error(
      'Missing JIRA_URL environment variable. Set JIRA_URL in .env or export it.',
    );
  }
  if (!projectKey) {
    throw new Error(
      'Missing JIRA_PROJECT_KEY environment variable. Set JIRA_PROJECT_KEY in .env or export it.',
    );
  }

  return { email, apiToken, baseUrl, projectKey };
}

// ---------------------------------------------------------------------------
// Review data fetch
// ---------------------------------------------------------------------------

/**
 * Fetch all data needed to review a pull request.
 *
 * 1. Parses the Bitbucket PR URL into PRInfo
 * 2. Loads both Bitbucket and Jira configs from env
 * 3. Fetches PR metadata and diff in parallel
 * 4. Extracts Jira issue keys from PR metadata
 * 5. Builds the review prompt string
 *
 * Returns a complete data bundle ready for the LLM to consume.
 */
export async function fetchReviewData(
  prUrl: string,
): Promise<{
  prInfo: PRInfo;
  prUrl: string;
  metadata: import('./types.ts').PRMetadata;
  diff: string;
  jiraKeys: string[];
  bbConfig: BitbucketConfig;
  jiraConfig: JiraConfig;
  reviewPrompt: string;
}> {
  const prInfo = parsePRURL(prUrl);
  const bbConfig = loadBitbucketConfig();
  const jiraConfig = loadJiraConfig();

  const [metadata, diff] = await Promise.all([
    fetchPRInfo(prInfo, bbConfig),
    fetchPRDiff(prInfo, bbConfig),
  ]);

  const jiraKeys = extractJiraKeys(metadata);
  const reviewPrompt = buildReviewPrompt(diff, metadata.title, metadata.description);

  return { prInfo, prUrl, metadata, diff, jiraKeys, bbConfig, jiraConfig, reviewPrompt };
}

// ---------------------------------------------------------------------------
// Bitbucket comment posting
// ---------------------------------------------------------------------------

/**
 * Post review findings as comments on a Bitbucket pull request.
 *
 * - If there are no findings, posts a single "NO ISSUES FOUND" comment.
 * - Otherwise posts a grouped general comment (CRITICAL > HIGH > BUG) with
 *   each finding formatted as `\`file:line\` — message`.
 * - Also posts inline comments on the affected lines with a `[SEVERITY]` prefix.
 * - Inline comments that fail (e.g. line not present in diff) are silently skipped.
 */
export async function postBitbucketComments(
  prInfo: PRInfo,
  bbConfig: BitbucketConfig,
  findings: ReviewFinding[],
): Promise<void> {
  if (findings.length === 0) {
    await postGeneralComment(
      prInfo,
      bbConfig,
      '**NO ISSUES FOUND** – The pull request looks good with no CRITICAL, HIGH, or BUG findings.',
    );
    return;
  }

  // Build grouped general comment
  const groups: Record<string, ReviewFinding[]> = { CRITICAL: [], HIGH: [], BUG: [] };
  for (const f of findings) {
    if (groups[f.severity]) {
      groups[f.severity].push(f);
    }
  }

  const lines: string[] = [];
  for (const severity of ['CRITICAL', 'HIGH', 'BUG'] as const) {
    const group = groups[severity];
    if (!group || group.length === 0) continue;

    lines.push(`### ${severity}`);
    lines.push('');
    for (const f of group) {
      const location = f.line != null ? `\`${f.file}:${f.line}\`` : `\`${f.file}\``;
      lines.push(`- ${location} — ${f.message}`);
    }
    lines.push('');
  }

  const generalComment = lines.join('\n');
  await postGeneralComment(prInfo, bbConfig, generalComment);

  // Post inline comments for findings with a line number
  for (const f of findings) {
    if (f.line == null) continue;

    try {
      await postInlineComment(prInfo, bbConfig, `[${f.severity}] ${f.message}`, f.file, f.line);
    } catch {
      // Line doesn't exist in the diff or API error — skip silently
    }
  }
}

// ---------------------------------------------------------------------------
// Jira comment posting
// ---------------------------------------------------------------------------

/**
 * Post cross-reference and findings-summary comments to Jira issues.
 *
 * For each Jira key:
 * - Always posts a cross-reference comment with the PR title/URL.
 * - If findings exist, also posts a summary with severity counts.
 *
 * Errors for individual keys are caught so a single failure doesn't
 * block the remaining keys. Returns a results array indicating which
 * keys succeeded and which failed.
 */
export async function postJiraComments(
  prUrl: string,
  prTitle: string,
  jiraKeys: string[],
  jiraConfig: JiraConfig,
  findings: ReviewFinding[],
): Promise<{ key: string; success: boolean }[]> {
  const results: { key: string; success: boolean }[] = [];

  // Count findings by severity
  const severityCounts = { CRITICAL: 0, HIGH: 0, BUG: 0 };
  for (const f of findings) {
    if (f.severity in severityCounts) {
      severityCounts[f.severity as keyof typeof severityCounts]++;
    }
  }

  for (const key of jiraKeys) {
    try {
      // Build one combined ADF comment with a clickable PR link + review summary.
      const paragraphs: Array<Record<string, unknown>> = [];

      // Paragraph 1: cross-reference with clickable PR title link
      paragraphs.push({
        type: 'paragraph',
        content: [
          { type: 'text', text: 'A pull request was reviewed: ' },
          {
            type: 'text',
            text: prTitle,
            marks: [{ type: 'link', attrs: { href: prUrl } }],
          },
        ],
      });

      // Paragraph 2: review summary heading
      paragraphs.push({
        type: 'paragraph',
        content: [{ type: 'text', text: 'Review summary:' }],
      });

      if (findings.length === 0) {
        paragraphs.push({
          type: 'paragraph',
          content: [{ type: 'text', text: '- NO ISSUES FOUND' }],
        });
      } else {
        paragraphs.push({
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text:
                `- ${findings.length} issue(s) found: ` +
                `${severityCounts.CRITICAL} Critical, ${severityCounts.HIGH} High, ${severityCounts.BUG} Bug`,
            },
          ],
        });

        // One paragraph per finding (plain severity prefix, no [SEVERITY] brackets)
        for (const f of findings) {
          const location = f.line != null ? `${f.file}:${f.line}` : f.file;
          paragraphs.push({
            type: 'paragraph',
            content: [
              { type: 'text', text: `- ${f.severity} ${location} — ${f.message}` },
            ],
          });
        }
      }

      // Closing paragraph
      paragraphs.push({
        type: 'paragraph',
        content: [{ type: 'text', text: 'See PR comments for details.' }],
      });

      await addIssueCommentADF(key, jiraConfig, {
        type: 'doc',
        version: 1,
        content: paragraphs,
      });

      // Best-effort transition to Request Change status when findings exist
      if (findings.length > 0) {
        try {
          const targetStatus = process.env.JIRA_REQUEST_CHANGE_STATUS ?? 'Request Change';
          const transitions = await getTransitions(key, jiraConfig);
          const matched = transitions.find(
            (t) => t.name.toLowerCase() === targetStatus.toLowerCase(),
          );
          if (matched) {
            await transitionIssue(key, jiraConfig, matched.id);
          }
        } catch {
          // transition is best-effort, ignore failures
        }
      }

      results.push({ key, success: true });
    } catch {
      results.push({ key, success: false });
    }
  }

  return results;
}
