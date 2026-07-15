import type { JiraConfig } from './types.ts';

function buildAuthHeader(config: JiraConfig): string {
  const encoded = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  return `Basic ${encoded}`;
}

async function jiraFetch<T>(
  url: string,
  config: JiraConfig,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(config),
    Accept: 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (options.method === 'POST' && options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Jira API error: ${response.status}${text ? ` — ${text}` : ''}`,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  return undefined as T;
}

export async function fetchIssueSummary(
  issueKey: string,
  config: JiraConfig,
): Promise<{ key: string; summary: string; status: string }> {
  const url = `${config.baseUrl}/rest/api/3/issue/${issueKey}`;
  const data = await jiraFetch<{
    key: string;
    fields: { summary: string; status: { name: string } };
  }>(url, config);

  return {
    key: data.key,
    summary: data.fields.summary,
    status: data.fields.status.name,
  };
}

export async function transitionIssue(
  issueKey: string,
  config: JiraConfig,
  transitionId: string,
): Promise<void> {
  const url = `${config.baseUrl}/rest/api/3/issue/${issueKey}/transitions`;
  await jiraFetch(url, config, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: transitionId } }),
  });
}

export async function getTransitions(
  issueKey: string,
  config: JiraConfig,
): Promise<{ id: string; name: string }[]> {
  const url = `${config.baseUrl}/rest/api/3/issue/${issueKey}/transitions`;
  const data = await jiraFetch<{ transitions: { id: string; name: string }[] }>(
    url,
    config,
  );
  return data.transitions.map((t) => ({ id: t.id, name: t.name }));
}

export async function addIssueComment(
  issueKey: string,
  config: JiraConfig,
  comment: string,
): Promise<void> {
  const url = `${config.baseUrl}/rest/api/3/issue/${issueKey}/comment`;
  await jiraFetch(url, config, {
    method: 'POST',
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: comment,
              },
            ],
          },
        ],
      },
    }),
  });
}

/**
 * Post a pre-built Atlassian Document Format (ADF) comment to a Jira issue.
 *
 * Unlike `addIssueComment` (which sends a single literal text node), this
 * accepts a full ADF `doc` so the caller can embed rich content such as
 * clickable links (via `link` marks) and structured paragraphs.
 */
export async function addIssueCommentADF(
  issueKey: string,
  config: JiraConfig,
  doc: Record<string, unknown>,
): Promise<void> {
  const url = `${config.baseUrl}/rest/api/3/issue/${issueKey}/comment`;
  await jiraFetch(url, config, {
    method: 'POST',
    body: JSON.stringify({ body: doc }),
  });
}

// ---------------------------------------------------------------------------
// Issue creation
// ---------------------------------------------------------------------------

/**
 * Convert a plain text string into Atlassian Document Format (ADF).
 * Handles newlines as paragraph breaks.
 */
export function textToADF(text: string): {
  type: 'doc';
  version: 1;
  content: { type: 'paragraph'; content: { type: 'text'; text: string }[] }[];
} {
  const paragraphs = text.split('\n').filter((p) => p.trim().length > 0);
  const content = paragraphs.map((p) => ({
    type: 'paragraph' as const,
    content: [{ type: 'text' as const, text: p }],
  }));
  // If no non-empty lines, at least render an empty paragraph
  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: '' }] });
  }
  return { type: 'doc', version: 1, content };
}

export interface CreateIssueParams {
  summary: string;
  description?: string;
  issueType?: string; // default: 'Task'
  /** Atlassian account ID of the assignee, e.g. '557058:abc123' */
  assigneeAccountId?: string;
  /** Additional custom fields to include, e.g. { customfield_10032: 1 } for Story Points */
  customFields?: Record<string, unknown>;
}

export interface CreateIssueResult {
  key: string;
  self: string;
}

/**
 * Create a Jira issue in the configured project.
 *
 * Uses Jira Cloud REST API v3 – POST /rest/api/3/issue
 * https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-post
 */
export async function createIssue(
  config: JiraConfig,
  params: CreateIssueParams,
): Promise<CreateIssueResult> {
  const url = `${config.baseUrl}/rest/api/3/issue`;

  const fields: Record<string, unknown> = {
    project: { key: config.projectKey },
    summary: params.summary,
    issuetype: { name: params.issueType ?? 'Task' },
  };

  if (params.description) {
    fields.description = textToADF(params.description);
  }

  if (params.assigneeAccountId) {
    fields.assignee = { id: params.assigneeAccountId };
  }

  if (params.customFields) {
    Object.assign(fields, params.customFields);
  }

  const body = { fields };

  const data = await jiraFetch<{ key: string; self: string }>(url, config, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return data;
}

// ---------------------------------------------------------------------------
// Sprint / Board (Jira Agile API)
// ---------------------------------------------------------------------------

export interface JiraBoard {
  id: number;
  name: string;
  type: string;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: 'active' | 'future' | 'closed';
  startDate?: string;
  endDate?: string;
}

/**
 * Find boards for a project using the Jira Agile API.
 *
 * GET /rest/agile/1.0/board?projectKeyOrId={projectKey}
 */
export async function findBoards(
  config: JiraConfig,
  projectKey?: string,
): Promise<JiraBoard[]> {
  const key = projectKey ?? config.projectKey;
  const url = `${config.baseUrl}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(key)}`;
  const data = await jiraFetch<{ values: JiraBoard[] }>(url, config);
  return data.values;
}

/**
 * Get sprints for a board filtered by state.
 *
 * GET /rest/agile/1.0/board/{boardId}/sprint?state={state}
 */
export async function getSprints(
  config: JiraConfig,
  boardId: number,
  state: 'active' | 'future' | 'closed',
): Promise<JiraSprint[]> {
  const url = `${config.baseUrl}/rest/agile/1.0/board/${boardId}/sprint?state=${state}`;
  const data = await jiraFetch<{ values: JiraSprint[] }>(url, config);
  return data.values;
}

/**
 * Find the active sprint for a board, or the first future sprint if none active.
 * Returns null if no active or future sprint exists.
 */
export async function findTargetSprint(
  config: JiraConfig,
  boardId: number,
): Promise<JiraSprint | null> {
  // Try active first (current sprint)
  const activeSprints = await getSprints(config, boardId, 'active');
  if (activeSprints.length > 0) {
    return activeSprints[0];
  }

  // Fall back to future (open sprint)
  const futureSprints = await getSprints(config, boardId, 'future');
  if (futureSprints.length > 0) {
    return futureSprints[0];
  }

  return null;
}

/**
 * Add an issue to a sprint.
 *
 * POST /rest/agile/1.0/sprint/{sprintId}/issue
 */
export async function addIssueToSprint(
  config: JiraConfig,
  sprintId: number,
  issueKey: string,
): Promise<void> {
  const url = `${config.baseUrl}/rest/agile/1.0/sprint/${sprintId}/issue`;
  await jiraFetch(url, config, {
    method: 'POST',
    body: JSON.stringify({ issues: [issueKey] }),
  });
}

// ---------------------------------------------------------------------------
// User search
// ---------------------------------------------------------------------------

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

/** Search Jira users by query string (display name or email).
 *
 * GET /rest/api/3/user/search?query={query}
 */
export async function searchUsers(
  config: JiraConfig,
  query: string,
): Promise<JiraUser[]> {
  const url = `${config.baseUrl}/rest/api/3/user/search?query=${encodeURIComponent(query)}`;
  const data = await jiraFetch<JiraUser[]>(url, config);
  return data;
}
