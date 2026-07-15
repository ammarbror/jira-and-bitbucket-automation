import type { PRInfo } from './types.js';

const BITBUCKET_PR_URL_RE =
  /^(?:https?:\/\/)?bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)(?:\/.*)?$/i;

export function parsePRURL(url: string): PRInfo {
  const trimmed = url.trim();
  const match = trimmed.match(BITBUCKET_PR_URL_RE);

  if (!match) {
    throw new Error(
      `Invalid Bitbucket PR URL: "${url}". Expected format: https://bitbucket.org/{workspace}/{repo_slug}/pull-requests/{id}`
    );
  }

  const [, workspace, repoSlug, prNumberStr] = match;

  return {
    workspace,
    repoSlug,
    prNumber: parseInt(prNumberStr, 10),
  };
}
