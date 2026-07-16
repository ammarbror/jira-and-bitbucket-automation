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

function extractRoles(text: string): string[] {
  const roles: string[] = [];
  const roleRegex = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]*)*)\b/g;
  const found = text.match(roleRegex);
  if (found) {
    for (const w of found) {
      const lowered = w.toLowerCase();
      if (
        !['The', 'This', 'That', 'These', 'Those', 'What', 'When', 'Where',
          'Which', 'Will', 'Would', 'Could', 'Should', 'Can', 'May', 'Might',
          'Must', 'Shall', 'Have', 'Has', 'Had', 'Not', 'Are', 'Was', 'Were',
          'Been', 'Being', 'Our', 'Your', 'Their', 'Its', 'His', 'Her',
          'For', 'With', 'From', 'Each', 'Every', 'Some', 'Any', 'Many',
          'Much', 'Few', 'Several', 'All', 'Both', 'Neither', 'Either',
          'How', 'Why', 'Please', 'After', 'Before', 'Then', 'Than', 'Also',
          'Very', 'Just', 'Only', 'Even', 'Still', 'Already', 'About',
          'Into', 'Until', 'During', 'Without', 'Within', 'Through',
          'Create', 'Add', 'Build', 'Make', 'Send', 'Get', 'Set', 'Put',
          'Use', 'Take', 'Find', 'Show', 'Allow', 'Enable', 'Ensure',
          'Android', 'Ios', 'Web', 'Api', 'Rest', 'Soap', 'Json', 'Xml',
          'Http', 'Https', 'Ssl', 'Tls', 'Jwt', 'Otp', 'Qr', 'Cors',
          'Html', 'Css', 'Url', 'Uri', 'Uuid', 'Guid'].includes(w)
      ) {
        const restLower = w.slice(1) === w.slice(1).toLowerCase();
        if (restLower && w.length > 2) {
          roles.push(w);
        }
      }
    }
  }
  return [...new Set(roles)];
}

function extractTopics(text: string): string[] {
  const topics: string[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.replace(/^[-*]\s+/, '').trim();
    const phrases = trimmed.match(/\b([A-Z][a-z]+(?:\s+[a-z]+){0,3})\b/g);
    if (phrases) {
      for (const p of phrases) {
        const lowered = p.toLowerCase();
        if (
          !['The', 'This', 'That', 'What', 'When', 'Where'].includes(p) &&
          !['api', 'json', 'http', 'data', 'user'].includes(lowered) &&
          p.length > 8
        ) {
          topics.push(p);
        }
      }
    }
  }
  return [...new Set(topics)].slice(0, 4);
}

function hasTechIndicators(text: string): Record<string, boolean> {
  const t = text.toLowerCase();
  return {
    api: /\b(?:api|endpoint|rest|graphql|webhook|http)\b/.test(t),
    database: /\b(?:database|db|table|schema|migration|sql|nosql|store|persist)\b/.test(t),
    integration: /\b(?:integrat|third.party|external|connect|partner)\b/.test(t),
    auth: /\b(?:auth|login|sso|oauth|jwt|token|session|permission|role|access.control)\b/.test(t),
    ui: /\b(?:ui|ux|screen|page|button|form|modal|popup|layout|render|view|frontend)\b/.test(t),
    mobile: /\b(?:mobile|ios|android|tablet|app|responsive)\b/.test(t),
    payment: /\b(?:payment|checkout|cart|purchase|invoice|transaction|refund)\b/.test(t),
    notification: /\b(?:notif|email|sms|push|alert|message)\b/.test(t),
    file: /\b(?:file|upload|download|csv|excel|pdf|export|import|attachment)\b/.test(t),
    chatbot: /\b(?:chatbot|chat.bot|conversation|dialogflow|rasa|nlp|gpt|llm)\b/.test(t),
    qr: /\b(?:qr|barcode|scan)\b/.test(t),
  };
}

function storyTemplate(description: string): string {
  const body = description.trim();
  const roles = extractRoles(body);
  const tech = hasTechIndicators(body);

  const ac: string[] = [];

  const lines = body.split('\n').map(l => l.replace(/^[-*\s]+/, '').trim()).filter(Boolean);
  const actionableLines = lines.filter(l =>
    /\b(?:create|add|build|show|display|allow|enable|let|make|send|receive|validate|check|filter|sort|search|calculate|generate|export|import|integrate|connect|sync)\b/i.test(l)
  );

  if (actionableLines.length >= 2) {
    for (const line of actionableLines.slice(0, 3)) {
      ac.push(`- [ ] ${line.replace(/^[a-z]/, c => c.toUpperCase())}`);
    }
  } else {
    if (tech.chatbot) {
      ac.push('- [ ] User can initiate a conversation and receive a relevant response');
      ac.push('- [ ] Bot gracefully handles unrecognised input and escalates when needed');
      ac.push('- [ ] Conversation history is maintained within the session');
    }
    if (tech.qr) {
      ac.push('- [ ] User can scan a QR code to trigger the intended action');
      ac.push('- [ ] System validates the scanned code and handles invalid/expired codes gracefully');
    }
    if (tech.api || tech.integration) {
      ac.push('- [ ] Integration returns correct data for valid requests');
      ac.push('- [ ] Timeouts, network errors, and malformed responses are handled without crashing');
    }
    if (tech.auth) {
      ac.push('- [ ] Unauthenticated users are redirected or blocked appropriately');
      ac.push('- [ ] Role-based access enforced for restricted actions');
    }
    ac.push('- [ ] Loading, empty, success, and error states are all accounted for');
    ac.push('- [ ] Performance is acceptable under expected load (no noticeable lag)');
  }

  const uniqueAc = [...new Set(ac)];

  const context: string[] = [];
  if (roles.length > 0) {
    context.push(`- Target user${roles.length > 1 ? 's' : ''}: ${roles.join(', ')}`);
  }
  if (tech.api || tech.integration) {
    context.push('- May involve API integration or third-party service coordination');
  }
  if (tech.database) {
    context.push('- Likely requires database schema changes or data migration');
  }
  if (tech.ui) {
    context.push('- UI changes may need design review or Figma mockups');
  }
  context.push('- Link any related issues, dependencies, or blocker tickets here');
  context.push('- Note open questions or decisions pending from stakeholders');

  return [
    'h3. User Story',
    body,
    '',
    'h3. Acceptance Criteria',
    ...uniqueAc,
    '',
    'h3. Additional Context',
    ...context,
  ].join('\n');
}

function taskTemplate(description: string): string {
  const body = description.trim();
  const tech = hasTechIndicators(body);
  const topics = extractTopics(body);

  const techDetails: string[] = [];
  if (tech.chatbot) {
    techDetails.push('- Chat platform/LLM provider selection and fallback strategy');
    techDetails.push('- Dialog flow design: intents, entities, context management');
    techDetails.push('- Webhook or API contract between the chat interface and backend');
  }
  if (tech.api) {
    techDetails.push('- API endpoints to create or modify — request/response contract and versioning');
    techDetails.push('- Error handling strategy: retry logic, error codes, idempotency');
  }
  if (tech.database) {
    techDetails.push('- Schema changes: new tables, columns, indexes, or migrations needed');
    techDetails.push('- Data retention, archival, or cleanup policy');
  }
  if (tech.integration) {
    techDetails.push('- Third-party API: authentication method, rate limits, webhook setup');
    techDetails.push('- Failure mode handling: timeouts, partial failures, circuit breaker');
  }
  if (tech.auth) {
    techDetails.push('- Access control: authentication flow, permission model, role scoping');
  }
  if (tech.payment) {
    techDetails.push('- Payment gateway integration: idempotency, refund flow, reconciliation');
  }
  if (tech.notification) {
    techDetails.push('- Notification channel (email/SMS/push) and template management');
  }
  if (tech.file) {
    techDetails.push('- File handling: storage backend, size limits, format validation, CDN strategy');
  }

  if (techDetails.length === 0) {
    techDetails.push('- Modules or services that will be created or modified and why');
    techDetails.push('- Key architecture decisions, design patterns, and trade-offs');
    techDetails.push('- Dependencies on other systems, libraries, or infrastructure');
    techDetails.push('- Performance, security, and observability considerations');
  }

  const dod: string[] = [];
  dod.push('- [ ] Code changes implemented per the technical design');
  dod.push('- [ ] Unit and/or integration tests cover new and modified code paths');
  dod.push('- [ ] Manually verified on local/staging environment');
  dod.push('- [ ] PR submitted for peer review with clear context');

  if (tech.api) {
    dod.push('- [ ] API changes tested via Postman/cURL and documented');
  }
  if (tech.database) {
    dod.push('- [ ] Migration scripts tested on a copy of production data');
  }
  if (tech.ui) {
    dod.push('- [ ] UI reviewed for responsiveness and accessibility');
  }
  if (tech.chatbot) {
    dod.push('- [ ] Bot responses reviewed for correctness and tone');
  }

  const notes: string[] = [];
  notes.push('- Explicitly call out out-of-scope items for future tickets');
  notes.push('- Risks, unknowns, or areas needing further investigation');
  if (topics.length > 0) {
    notes.push(`- Key references: ${topics.join(', ')}`);
  }

  return [
    'h3. Description',
    body,
    '',
    'h3. Technical Details',
    ...techDetails,
    '',
    'h3. Definition of Done',
    ...dod,
    '',
    'h3. Notes',
    ...notes,
  ].join('\n');
}

function bugTemplate(description: string): string {
  const body = description.trim();
  const tech = hasTechIndicators(body);

  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  const stepPatterns = lines.filter(l => /^\d+[.)]/.test(l) || /^-\s/.test(l));
  const hasSteps = stepPatterns.length >= 2;

  const steps: string[] = [];
  if (hasSteps) {
    let idx = 1;
    for (const line of lines) {
      if (/^\d+[.)]/.test(line)) {
        steps.push(line);
        idx++;
      } else if (/^-\s/.test(line)) {
        steps.push(`${idx}. ${line.replace(/^-\s+/, '')}`);
        idx++;
      }
    }
    while (steps.length < 3) {
      steps.push(`${steps.length + 1}. `);
    }
  } else {
    if (tech.chatbot) {
      steps.push('1. Open the chatbot conversation screen');
      steps.push('2. Send a message or scan a QR code that triggers the issue');
      steps.push('3. Observe the incorrect response, missing reply, or crash');
    } else if (tech.api) {
      steps.push('1. Call the API endpoint with the relevant payload (attach request)');
      steps.push('2. Check the response status code and response body');
      steps.push('3. Observe the incorrect response — wrong status, missing fields, or timeout');
    } else if (tech.ui || tech.mobile) {
      steps.push('1. Navigate to the screen (include path or URL)');
      steps.push('2. Perform the action that triggers the bug (include exact input or button)');
      steps.push('3. Observe the incorrect behaviour — error, freeze, or unexpected state');
    } else {
      steps.push('1. Navigate to the feature/module/screen (include URL or entry point)');
      steps.push('2. Perform the action that triggers the bug (include exact input, button clicked, payload)');
      steps.push('3. Observe the incorrect behaviour (include error message, unexpected output, or UI state)');
    }
  }

  const env: string[] = [];
  if (tech.mobile) {
    env.push('- Device model:');
    env.push('- OS version:');
    env.push('- App version / build number:');
  } else if (tech.api) {
    env.push('- Environment (staging / production / local):');
    env.push('- API version / commit hash:');
    env.push('- Client / tool used (Postman, cURL, app):');
  } else {
    env.push('- App version / build number / commit hash:');
    if (tech.mobile) {
      env.push('- Device model:');
    }
    env.push('- OS version:');
    env.push('- Browser name and version (if web):');
  }

  return [
    'h3. Description',
    body,
    '',
    'h3. Steps to Reproduce',
    ...steps,
    '',
    'h3. Expected Behavior',
    '- Exactly what should happen after following the steps above, with measurable conditions',
    '',
    'h3. Actual Behavior',
    '- Exactly what happens instead — paste the error message, stack trace, or unexpected output',
    '',
    'h3. Environment',
    ...env,
    '',
    'h3. Evidence',
    '- Screenshots or screen recording of the bug in action',
    '- Console logs / network tab capture / API response body',
    '- Steps already tried to work around the issue',
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
