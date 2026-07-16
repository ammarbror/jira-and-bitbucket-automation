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

// ---------------------------------------------------------------------------
// Description templates
// ---------------------------------------------------------------------------

function storyTemplate(description: string): string {
  const body = description.trim();
  return [
    'h3. User Story',
    body,
    '',
    'h3. Acceptance Criteria',
    '- [ ] Criterion 1',
    '- [ ] Criterion 2',
    '',
    'h3. Additional Context',
    '- Add any relevant context, links, or notes',
  ].join('\n');
}

function taskTemplate(description: string): string {
  const body = description.trim();
  return [
    'h3. Description',
    body,
    '',
    'h3. Technical Details',
    '- Outline implementation approach, libraries, architecture decisions',
    '',
    'h3. Definition of Done',
    '- [ ] Code changes implemented',
    '- [ ] Tested locally',
    '- [ ] PR submitted',
    '',
    'h3. Notes',
    '- Additional considerations, dependencies, or references',
  ].join('\n');
}

function bugTemplate(description: string): string {
  const body = description.trim();
  return [
    'h3. Description',
    body,
    '',
    'h3. Steps to Reproduce',
    '1. ',
    '2. ',
    '3. ',
    '',
    'h3. Expected Behavior',
    '- Describe what should happen',
    '',
    'h3. Actual Behavior',
    '- Describe what actually happens',
    '',
    'h3. Environment',
    '- Browser/App version:',
    '- Device:',
    '- OS:',
    '',
    'h3. Screenshots / Logs',
    '- Attach screenshots or paste error logs',
  ].join('\n');
}

export function formatDescription(
  issueType: string | undefined,
  description: string,
): string {
  switch (issueType?.toLowerCase()) {
    case 'story':
      return storyTemplate(description);
    case 'bug':
      return bugTemplate(description);
    case 'task':
    default:
      return taskTemplate(description);
  }
}

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

  const description =
    params.description
      ? formatDescription(params.issueType, params.description)
      : undefined;

  const issue = await createIssue(config, {
    summary: params.summary,
    description,
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
