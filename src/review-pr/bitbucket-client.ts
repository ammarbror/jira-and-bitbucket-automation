import type { PRInfo, PRMetadata } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAuth(config: { email: string; apiToken: string }): string {
  return `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`;
}

async function apiFetch(
  url: string,
  config: { email: string; apiToken: string },
  options: RequestInit = {},
): Promise<Response> {
  const auth = buildAuth(config);
  const headers = new Headers(options.headers);
  headers.set('Authorization', auth);

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '(unable to read body)');
    throw new Error(`Bitbucket API error: ${res.status} ${res.statusText} — ${body}`);
  }
  return res;
}

function prUrl(info: PRInfo): string {
  return `https://api.bitbucket.org/2.0/repositories/${info.workspace}/${info.repoSlug}/pullrequests/${info.prNumber}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch PR metadata (title, description, source branch) and commit messages.
 */
export async function fetchPRInfo(
  info: PRInfo,
  config: { email: string; apiToken: string },
): Promise<PRMetadata> {
  const res = await apiFetch(prUrl(info), config);
  const data = await res.json();

  const title: string = data.title ?? '';
  const rawDesc = data.rendered?.description ?? data.description ?? '';
  const description: string = typeof rawDesc === 'string' ? rawDesc : (rawDesc?.raw ?? rawDesc?.html ?? String(rawDesc));
  const sourceBranch: string = data.source?.branch?.name ?? '';

  const commitMessages = await fetchPRCommits(info, config);

  return { title, description, sourceBranch, commitMessages };
}

/**
 * Fetch the unified diff for a pull request (returns raw diff text).
 */
export async function fetchPRDiff(
  info: PRInfo,
  config: { email: string; apiToken: string },
): Promise<string> {
  const res = await apiFetch(`${prUrl(info)}/diff`, config, {
    headers: { Accept: 'application/json' } as Record<string, string>,
  });
  return res.text();
}

/**
 * Fetch commit messages for a pull request.
 */
export async function fetchPRCommits(
  info: PRInfo,
  config: { email: string; apiToken: string },
): Promise<string[]> {
  const res = await apiFetch(`${prUrl(info)}/commits`, config);
  const data = await res.json();
  const values: Array<{ message?: string }> = data.values ?? [];
  return values.map((c) => c.message ?? '');
}

/**
 * Post a general (non-inline) comment on a pull request.
 */
export async function postGeneralComment(
  info: PRInfo,
  config: { email: string; apiToken: string },
  content: string,
): Promise<void> {
  const res = await apiFetch(`${prUrl(info)}/comments`, config, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' } as Record<string, string>,
    body: JSON.stringify({ content: { raw: content } }),
  });
  // consume body so the connection is properly released
  await res.text();
}

/**
 * Post an inline comment on a specific file / line of a pull request.
 */
export async function postInlineComment(
  info: PRInfo,
  config: { email: string; apiToken: string },
  content: string,
  file: string,
  line: number,
): Promise<void> {
  const res = await apiFetch(`${prUrl(info)}/comments`, config, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' } as Record<string, string>,
    body: JSON.stringify({ content: { raw: content }, inline: { to: line, path: file } }),
  });
  await res.text();
}
