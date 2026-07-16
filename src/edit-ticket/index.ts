import type { JiraConfig } from '../review-pr/types.ts';
import { loadJiraConfig } from '../review-pr/index.ts';
import { updateIssue, fetchIssueSummary, searchUsers, textToADF } from '../review-pr/jira-client.ts';

export type { JiraConfig };
export { loadJiraConfig, textToADF };

export interface EditTicketParams {
  issueKey: string;
  summary?: string;
  description?: string;
  assigneeName?: string;
  assigneeAccountId?: string | null;
  customFields?: Record<string, unknown>;
}

export type EditTicketResult = {
  issueKey: string;
  message: string;
};

export async function editTicketWorkflow(
  config: JiraConfig,
  params: EditTicketParams,
): Promise<EditTicketResult> {
  // Resolve assignee name to accountId if provided
  let assigneeAccountId = params.assigneeAccountId;
  if (params.assigneeName && !assigneeAccountId) {
    const users = await searchUsers(config, params.assigneeName);
    const match = users.find((u) =>
      u.displayName.toLowerCase().includes(params.assigneeName!.toLowerCase()),
    );
    if (match) {
      assigneeAccountId = match.accountId;
    } else {
      // fallback: try partial match on first result
      if (users.length > 0) {
        assigneeAccountId = users[0].accountId;
      }
    }
  }

  await updateIssue(config, params.issueKey, {
    summary: params.summary,
    description: params.description,
    assigneeAccountId,
    customFields: params.customFields,
  });

  const updated = await fetchIssueSummary(params.issueKey, config);

  let msg = `✅ **${params.issueKey}** updated`;
  if (params.summary) {
    msg += `\n**Summary:** ${params.summary}`;
  }
  if (params.description) {
    msg += `\n**Description:** updated`;
  }
  if (params.assigneeName || params.assigneeAccountId !== undefined) {
    msg += `\n**Assignee:** updated`;
  }
  msg += `\n**Status:** ${updated.status}`;

  return { issueKey: params.issueKey, message: msg };
}

export async function runFromEnv(params: EditTicketParams): Promise<string> {
  const config = loadJiraConfig();
  const result = await editTicketWorkflow(config, params);
  return result.message;
}
