import type { JiraConfig } from '../review-pr/types.ts';
import { loadJiraConfig } from '../review-pr/index.ts';
import {
  createIssue,
  findBoards,
  findTargetSprint,
  addIssueToSprint,
  textToADF,
} from '../review-pr/jira-client.ts';

export type { JiraConfig };

export { loadJiraConfig, textToADF };

function formatResult(
  issueKey: string,
  summary: string,
  sprintName: string | null,
  boardName: string | null,
): string {
  let msg = `✅ **Ticket created: ${issueKey}**\n\n**Summary:** ${summary}`;
  if (sprintName) {
    msg += `\n**Sprint:** ${sprintName}`;
  }
  if (boardName) {
    msg += `\n**Board:** ${boardName}`;
  }
  return msg;
}

export { createIssue, findBoards, findTargetSprint, addIssueToSprint };

export interface TicketParams {
  summary: string;
  description?: string;
  issueType?: string;
  assigneeAccountId?: string;
  customFields?: Record<string, unknown>;
}

export type TicketResult = {
  issueKey: string;
  sprintName: string | null;
  boardName: string | null;
  message: string;
};

export async function createTicketWorkflow(
  config: JiraConfig,
  params: TicketParams,
): Promise<TicketResult> {
  const boards = await findBoards(config);
  if (boards.length === 0) {
    throw new Error(
      `No boards found for project "${config.projectKey}". Make sure the project has a board configured.`,
    );
  }
  const board = boards[0];

  let sprintName: string | null = null;
  const sprint = await findTargetSprint(config, board.id);
  if (sprint) {
    sprintName = sprint.name;
  }

  const issue = await createIssue(config, {
    summary: params.summary,
    description: params.description,
    issueType: params.issueType,
    assigneeAccountId: params.assigneeAccountId,
    customFields: params.customFields,
  });

  if (sprint) {
    await addIssueToSprint(config, sprint.id, issue.key);
  }

  const message = formatResult(
    issue.key,
    params.summary,
    sprintName,
    board.name,
  );

  return {
    issueKey: issue.key,
    sprintName,
    boardName: board.name,
    message,
  };
}

export async function runFromEnv(params: TicketParams): Promise<string> {
  const config = loadJiraConfig();
  const result = await createTicketWorkflow(config, params);
  return result.message;
}
