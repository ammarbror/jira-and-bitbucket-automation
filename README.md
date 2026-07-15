# jira-and-bitbucket-automation

OpenCode slash commands that bridge Jira and Bitbucket: create Jira tickets and run automated PR reviews that cross-reference Jira issues — all from within your OpenCode chat session.

## Features

- **`/review-pr <bitbucket-pr-url>`** — Fetches the PR diff, runs an LLM-based review (CRITICAL/HIGH/BUG only), posts findings as Bitbucket comments + inline annotations, and cross-references linked Jira issues with a review summary.
- **`/create-ticket <work-type>: <description>`** — Creates a Jira ticket and assigns it to the current active sprint. Supports `task:`, `bug:`, `story:` (or `feature:`) prefixes; auto-detects work type from description when no prefix is given.

## Getting Started

### Prerequisites

- [OpenCode](https://opencode.ai) — the CLI where the slash commands run.
- Node.js 20+ (for running the automation scripts).
- Atlassian credentials:
  - **Bitbucket** — [API token](https://bitbucket.org/account/settings/app-passwords/) (app passwords deprecated June 2026).
  - **Jira** — [API token](https://id.atlassian.com/manage-profile/security/api-tokens).
  - Jira URL (e.g. `https://your-domain.atlassian.net`) and project key.

### Setup

```bash
# 1. Clone into your OpenCode workspace
git clone https://github.com/ammarbror/jira-and-bitbucket-automation.git
cd jira-and-bitbucket-automation

# 2. Install dependencies
npm install

# 3. Configure credentials
cp .env.example .env
# Edit .env with your real tokens:
#   BITBUCKET_EMAIL, BITBUCKET_API_TOKEN
#   JIRA_EMAIL, JIRA_API_TOKEN, JIRA_URL, JIRA_PROJECT_KEY
```

> **Never commit `.env`.** It's git-ignored. Use `.env.example` as a template.

### OpenCode Integration

The project is already configured for OpenCode via `opencode.json`. Once cloned into a workspace OpenCode has access to, the `/review-pr` and `/create-ticket` commands are automatically available.

The `opencode.json` config registers each command with:
- A **description** shown in OpenCode's command list.
- A **template** prompt that tells the OpenCode agent how to execute the task (which functions to call, how to parse arguments, what to return).

No additional OpenCode configuration is needed — the commands Just Work™.

## Usage

### `/review-pr`

```
/review-pr https://bitbucket.org/myworkspace/myrepo/pull-requests/42
```

What happens:
1. Parses the Bitbucket PR URL to extract workspace, repo, and PR number.
2. Fetches PR metadata (title, description, source branch) and the unified diff.
3. Extracts Jira issue keys (e.g. `KAIRA-123`) from the PR title, description, and commit messages.
4. Builds a structured review prompt and sends it to the LLM for analysis.
5. The LLM returns findings at three severity levels: **CRITICAL** (security), **HIGH** (logic errors), **BUG** (definite bugs). Style/performance/architecture suggestions are excluded.
6. Posts a grouped summary comment on the Bitbucket PR and inline comments on affected lines.
7. If Jira issues were detected, posts cross-reference comments on each Jira issue (with findings summary) and optionally transitions the issue to "Request Change".

### `/create-ticket`

```
/create-ticket task: Add error logging to the payment service
/create-ticket bug: Null pointer exception when user submits empty form
/create-ticket story: Allow users to export reports as CSV
```

What happens:
1. Detects the work type from the prefix (`task:`, `bug:`, `story:`/`feature:`) or infers it from the description.
2. Strips the prefix and generates a concise summary (max ~80 chars).
3. Creates the issue in the configured Jira project.
4. Finds the current active sprint (or next open sprint) and assigns the ticket to it.
5. Returns the issue key, sprint name, board name, and summary.

## Architecture

```
src/
├── create-ticket/
│   └── index.ts           # createTicketWorkflow() — issue creation + sprint assignment
└── review-pr/
    ├── index.ts            # fetchReviewData(), postBitbucketComments(), postJiraComments()
    ├── types.ts            # TypeScript interfaces (PRInfo, ReviewFinding, configs...)
    ├── url-parser.ts       # parsePRURL() — Bitbucket PR URL → PRInfo
    ├── bitbucket-client.ts # Bitbucket API: fetch PR info, diff, commits, post comments
    ├── jira-client.ts      # Jira API: create issue, find boards/sprints, post comments, transitions
    ├── jira-detector.ts    # extractJiraKeys() — regex scan for Jira issue keys in text
    ├── prompts.ts          # Review system prompt + buildReviewPrompt() with diff injection
    └── e2e-test.ts         # End-to-end test exercising the full workflow
```

### Data flow

```
User: /review-pr <url>
  │
  ├─► parsePRURL(url)              → {workspace, repoSlug, prNumber}
  ├─► loadBitbucketConfig() + loadJiraConfig()  ← .env
  ├─► fetchPRInfo() + fetchPRDiff()              ← Bitbucket API (parallel)
  ├─► extractJiraKeys(metadata)     → ["KAIRA-123", ...]
  ├─► buildReviewPrompt(diff, ...)  → structured LLM prompt
  ├─► LLM reviews diff              → ReviewFinding[]
  ├─► postBitbucketComments()       → grouped + inline comments
  └─► postJiraComments()            → cross-reference on each Jira issue
```

## Development

```bash
# Run all unit tests (uses Node.js built-in test runner + tsx)
npx tsx --test src/**/*.test.ts

# Run the end-to-end test (requires real .env credentials)
npx tsx --test src/review-pr/e2e-test.ts
```

The project uses:
- **TypeScript** with `tsx` for direct execution (no build step).
- **Node.js native `fetch`** for all API calls (Node 20+).
- **Node.js `node:test`** for testing.
- No external runtime dependencies.

## Security

- **`.env` is git-ignored** — credentials stay on your machine.
- **`.omo/` is git-ignored** — internal planning artifacts are not published.
- API tokens are loaded from environment variables only, never hardcoded.
- The review prompt explicitly forbids the LLM from outputting style/performance suggestions — only security and bug findings.
- If a Jira issue has review findings, the PR review can optionally transition it to "Request Change" (configurable via `JIRA_REQUEST_CHANGE_STATUS` env var; defaults to `Request Change`).
