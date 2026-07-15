# jira-and-bitbucket-automation

CLI automation that bridges Jira and Bitbucket: create Jira tickets and run automated PR reviews that detect linked Jira issues, post summaries, and annotate Bitbucket pull requests.

## Setup

```bash
npm install
cp .env.example .env   # then fill in your real credentials
```

Required environment variables (see `.env.example`):

- `BITBUCKET_EMAIL` / `BITBUCKET_API_TOKEN`
- `JIRA_EMAIL` / `JIRA_API_TOKEN`
- `JIRA_URL`
- `JIRA_PROJECT_KEY`

## Structure

- `src/create-ticket/` — create Jira tickets
- `src/review-pr/` — Bitbucket PR review client, Jira issue detection, and review prompts

## Usage

```bash
npx tsx src/create-ticket/index.ts
npx tsx src/review-pr/index.ts
```

> Secrets live in `.env` (git-ignored). Never commit real tokens.
