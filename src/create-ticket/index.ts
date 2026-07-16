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
    '- [ ] Happy path: primary flow works end-to-end with valid inputs',
    '- [ ] Error handling: app gracefully handles invalid/missing inputs without crashing',
    '- [ ] Edge cases: boundary values, empty states, rapid repeated actions',
    '- [ ] UI/UX: loading, success, and error states are visible to user',
    '',
    'h3. Additional Context',
    '- Link to Figma/design mockups or user flow diagrams',
    '- Related issues, dependencies, or blocker tickets',
    '- User research, analytics data, or bug reports that drove this story',
    '- Questions open for PO/designer/stakeholder review',
  ].join('\n');
}

function taskTemplate(description: string): string {
  const body = description.trim();
  return [
    'h3. Description',
    body,
    '',
    'h3. Technical Details',
    '- Which services/modules/endpoints will be created or modified and why',
    '- Key architecture decisions and trade-offs considered',
    '- Database schema changes (new tables, columns, indexes, migrations)',
    '- Third-party integrations: API contracts, auth method, rate limits, error handling',
    '- Performance & security considerations (caching, pagination, input sanitisation, access control)',
    '',
    'h3. Definition of Done',
    '- [ ] Code changes implemented per technical design',
    '- [ ] Unit/integration tests added for new and modified code paths',
    '- [ ] Manually tested on local/staging environment',
    '- [ ] PR submitted for peer review with clear description',
    '- [ ] Feature flag or rollout plan defined if behind a flag',
    '',
    'h3. Notes',
    '- Out-of-scope items explicitly called out for future tickets',
    '- Risks, unknowns, or areas needing further investigation',
    '- References: relevant docs, ADRs, Slack discussions, or PR links',
  ].join('\n');
}

function bugTemplate(description: string): string {
  const body = description.trim();
  return [
    'h3. Description',
    body,
    '',
    'h3. Steps to Reproduce',
    '1. Navigate to the feature/module/screen (include URL or entry point)',
    '2. Perform the action that triggers the bug (include exact input, button clicked, API payload)',
    '3. Observe the incorrect behaviour (include exact error message, unexpected output, or UI state)',
    '',
    'h3. Expected Behavior',
    '- Exactly what should happen after following the reproduction steps above, with measurable conditions',
    '',
    'h3. Actual Behavior',
    '- Exactly what happens instead — paste the error message, stack trace, unexpected output, or UI anomaly',
    '',
    'h3. Environment',
    '- App version / build number / commit hash:',
    '- Device model (if mobile/tablet):',
    '- OS version:',
    '- Browser name and version (if web):',
    '- Network type (WiFi / cellular / VPN):',
    '',
    'h3. Evidence',
    '- Screenshots or screen recording of the bug in action',
    '- Browser console logs / network tab capture / API response body',
    '- Steps tried to work around the issue',
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
