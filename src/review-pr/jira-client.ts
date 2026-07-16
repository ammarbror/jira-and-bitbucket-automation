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

  if (options.body) {
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
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
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
 * Parse a template-formatted description into Atlassian Document Format (ADF).
 *
 * Supports:
 *   `h3. Title`         → heading level 3
 *   `h4. Title`         → heading level 4
 *   `- [ ] task`        → bulletList with [ ] prefix (Jira Cloud doesn't support ADF taskList)
 *   `- [x] task`        → bulletList with [x] prefix
 *   `- item`            → bulletList item
 *   `1. item`           → orderedList item
 *   plain text          → paragraph
 *   blank lines         → skipped (separators only, no empty paragraphs)
 */
export function textToADF(text: string): Record<string, unknown> {
  const lines = text.split('\n');
  function textNode(t: string) {
    return { type: 'text' as const, text: t };
  }
  function paragraph(text: string) {
    return { type: 'paragraph' as const, content: [textNode(text)] };
  }

  const content: Record<string, unknown>[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // blank line → skip
    if (!trimmed) {
      i++;
      continue;
    }

    // heading
    const h3 = trimmed.match(/^h3\.\s+(.+)/);
    if (h3) {
      content.push({
        type: 'heading',
        attrs: { level: 3 },
        content: [textNode(h3[1])],
      });
      i++;
      continue;
    }
    const h4 = trimmed.match(/^h4\.\s+(.+)/);
    if (h4) {
      content.push({
        type: 'heading',
        attrs: { level: 4 },
        content: [textNode(h4[1])],
      });
      i++;
      continue;
    }

    // checkbox items (- [ ] / - [x]) → bulletList with [ ] or [x] prefix
    // Jira Cloud does NOT support ADF taskList, so we render as bullets
    if (/^- \[[ x]\]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const m = t.match(/^- \[([ x])\]\s+(.+)/);
        if (!m) break;
        items.push(`${m[1] === 'x' ? '[x]' : '[ ]'} ${m[2]}`);
        i++;
      }
      content.push({
        type: 'bulletList',
        content: items.map((item) => ({
          type: 'listItem',
          content: [paragraph(item)],
        })),
      });
      continue;
    }

    // bullet list: - item
    if (/^- \S/.test(trimmed) || /^\*\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const m = t.match(/^[-*]\s+(.+)/);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      content.push({
        type: 'bulletList',
        content: items.map((item) => ({
          type: 'listItem',
          content: [paragraph(item)],
        })),
      });
      continue;
    }

    // ordered list: 1. item
    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const m = t.match(/^\d+\.\s+(.+)/);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      content.push({
        type: 'orderedList',
        content: items.map((item) => ({
          type: 'listItem',
          content: [paragraph(item)],
        })),
      });
      continue;
    }

    // default → paragraph
    content.push(paragraph(trimmed));
    i++;
  }

  if (content.length === 0) {
    content.push(paragraph(''));
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
/**
 * Update fields on an existing Jira issue.
 *
 * PUT /rest/api/3/issue/{issueKey}
 * Only provided fields are updated (partial update).
 */
export async function updateIssue(
  config: JiraConfig,
  issueKey: string,
  fields: {
    summary?: string;
    description?: string;
    assigneeAccountId?: string | null;
    customFields?: Record<string, unknown>;
  },
): Promise<void> {
  const url = `${config.baseUrl}/rest/api/3/issue/${issueKey}`;

  const bodyFields: Record<string, unknown> = {};

  if (fields.summary !== undefined) {
    bodyFields.summary = fields.summary;
  }

  if (fields.description !== undefined) {
    bodyFields.description = textToADF(fields.description);
  }

  if (fields.assigneeAccountId !== undefined) {
    if (fields.assigneeAccountId === null) {
      bodyFields.assignee = null;
    } else {
      bodyFields.assignee = { id: fields.assigneeAccountId };
    }
  }

  if (fields.customFields) {
    Object.assign(bodyFields, fields.customFields);
  }

  await jiraFetch(url, config, {
    method: 'PUT',
    body: JSON.stringify({ fields: bodyFields }),
  });
}

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
