import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadBitbucketConfig,
  loadJiraConfig,
  fetchReviewData,
  postBitbucketComments,
  postJiraComments,
} from './index.ts';
import type { PRInfo, BitbucketConfig, JiraConfig, ReviewFinding } from './types.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const prInfo: PRInfo = { workspace: 'ws', repoSlug: 'repo', prNumber: 42 };
const bbConfig: BitbucketConfig = { email: 'e@e.com', apiToken: 'tok' };
const jiraConfig: JiraConfig = {
  email: 'j@j.com',
  apiToken: 'jtok',
  baseUrl: 'https://jira.example.com',
  projectKey: 'KAIRA',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setEnv(env: Record<string, string>): void {
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }
}

function unsetEnv(keys: string[]): void {
  for (const k of keys) {
    delete process.env[k];
  }
}

// ---------------------------------------------------------------------------
// loadBitbucketConfig
// ---------------------------------------------------------------------------

void describe('loadBitbucketConfig', () => {
  const KEYS = ['BITBUCKET_EMAIL', 'BITBUCKET_API_TOKEN'];

  beforeEach(() => {
    setEnv({ BITBUCKET_EMAIL: 'e@e.com', BITBUCKET_API_TOKEN: 'tok' });
  });

  afterEach(() => {
    unsetEnv(KEYS);
  });

  void it('returns BitbucketConfig when all env vars are set', () => {
    const config = loadBitbucketConfig();
    assert.deepStrictEqual(config, { email: 'e@e.com', apiToken: 'tok' });
  });

  void it('throws a clear error when BITBUCKET_EMAIL is missing', () => {
    delete process.env.BITBUCKET_EMAIL;
    assert.throws(() => loadBitbucketConfig(), /BITBUCKET_EMAIL/);
  });

  void it('throws a clear error when BITBUCKET_API_TOKEN is missing', () => {
    delete process.env.BITBUCKET_API_TOKEN;
    assert.throws(() => loadBitbucketConfig(), /BITBUCKET_API_TOKEN/);
  });

  void it('throws when BITBUCKET_EMAIL is an empty string', () => {
    process.env.BITBUCKET_EMAIL = '';
    assert.throws(() => loadBitbucketConfig(), /BITBUCKET_EMAIL/);
  });
});

// ---------------------------------------------------------------------------
// loadJiraConfig
// ---------------------------------------------------------------------------

void describe('loadJiraConfig', () => {
  const KEYS = ['JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_URL', 'JIRA_PROJECT_KEY'];

  beforeEach(() => {
    setEnv({
      JIRA_EMAIL: 'j@j.com',
      JIRA_API_TOKEN: 'jtok',
      JIRA_URL: 'https://jira.example.com',
      JIRA_PROJECT_KEY: 'KAIRA',
    });
  });

  afterEach(() => {
    unsetEnv(KEYS);
  });

  void it('returns JiraConfig when all env vars are set', () => {
    const config = loadJiraConfig();
    assert.deepStrictEqual(config, jiraConfig);
  });

  void it('throws when JIRA_EMAIL is missing', () => {
    delete process.env.JIRA_EMAIL;
    assert.throws(() => loadJiraConfig(), /JIRA_EMAIL/);
  });

  void it('throws when JIRA_API_TOKEN is missing', () => {
    delete process.env.JIRA_API_TOKEN;
    assert.throws(() => loadJiraConfig(), /JIRA_API_TOKEN/);
  });

  void it('throws when JIRA_URL is missing', () => {
    delete process.env.JIRA_URL;
    assert.throws(() => loadJiraConfig(), /JIRA_URL/);
  });

  void it('throws when JIRA_PROJECT_KEY is missing', () => {
    delete process.env.JIRA_PROJECT_KEY;
    assert.throws(() => loadJiraConfig(), /JIRA_PROJECT_KEY/);
  });
});

// ---------------------------------------------------------------------------
// fetchReviewData
// ---------------------------------------------------------------------------

void describe('fetchReviewData', () => {
  const BB_KEYS = ['BITBUCKET_EMAIL', 'BITBUCKET_API_TOKEN'];
  const JIRA_KEYS = ['JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_URL', 'JIRA_PROJECT_KEY'];
  const ALL_KEYS = [...BB_KEYS, ...JIRA_KEYS];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    setEnv({
      BITBUCKET_EMAIL: 'e@e.com',
      BITBUCKET_API_TOKEN: 'tok',
      JIRA_EMAIL: 'j@j.com',
      JIRA_API_TOKEN: 'jtok',
      JIRA_URL: 'https://jira.example.com',
      JIRA_PROJECT_KEY: 'KAIRA',
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    unsetEnv(ALL_KEYS);
  });

  void it('returns all review data fields with correct types', async () => {
    const prJson = {
      title: 'Fix KAIRA-123 login bug',
      description: 'Root cause analysis',
      rendered: { description: '<p>Root cause analysis</p>' },
      source: { branch: { name: 'fix/KAIRA-123' } },
    };
    const commitsJson = {
      values: [
        { message: 'fix: resolve KAIRA-123' },
        { message: 'refactor: cleanup' },
      ],
    };
    const diff =
      '--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1,2 @@\n+const x = 1;\n';

    globalThis.fetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/diff')) {
        return new Response(diff, { status: 200 });
      }
      if (urlStr.includes('/commits')) {
        return new Response(JSON.stringify(commitsJson), { status: 200 });
      }
      // PR details endpoint
      return new Response(JSON.stringify(prJson), { status: 200 });
    };

    const result = await fetchReviewData(
      'https://bitbucket.org/ws/repo/pull-requests/42',
    );

    // Check all fields are present
    assert.ok(result.prInfo, 'prInfo is present');
    assert.strictEqual(result.prInfo.workspace, 'ws');
    assert.strictEqual(result.prInfo.repoSlug, 'repo');
    assert.strictEqual(result.prInfo.prNumber, 42);

    assert.strictEqual(result.prUrl, 'https://bitbucket.org/ws/repo/pull-requests/42');

    assert.ok(result.metadata, 'metadata is present');
    assert.strictEqual(result.metadata.title, 'Fix KAIRA-123 login bug');

    assert.strictEqual(result.diff, diff);

    assert.ok(Array.isArray(result.jiraKeys), 'jiraKeys is an array');
    assert.deepStrictEqual(result.jiraKeys, ['KAIRA-123']);

    assert.deepStrictEqual(result.bbConfig, bbConfig);
    assert.deepStrictEqual(result.jiraConfig, jiraConfig);

    assert.ok(typeof result.reviewPrompt === 'string', 'reviewPrompt is a string');
    assert.ok(result.reviewPrompt.includes('Fix KAIRA-123 login bug'));
    assert.ok(result.reviewPrompt.includes(diff));
  });

  void it('returns empty jiraKeys when metadata has no Jira references', async () => {
    const prJson = {
      title: 'Fix login bug',
      description: 'No jira keys here',
      rendered: { description: '<p>No jira keys here</p>' },
      source: { branch: { name: 'fix/bug' } },
    };
    const commitsJson = { values: [{ message: 'fix login' }] };
    const diff = '--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n-const x = 1;\n+const x = 2;\n';

    globalThis.fetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/diff')) return new Response(diff, { status: 200 });
      if (urlStr.includes('/commits')) return new Response(JSON.stringify(commitsJson), { status: 200 });
      return new Response(JSON.stringify(prJson), { status: 200 });
    };

    const result = await fetchReviewData(
      'https://bitbucket.org/ws/repo/pull-requests/99',
    );

    assert.deepStrictEqual(result.jiraKeys, []);
  });

  void it('throws for an invalid PR URL', async () => {
    await assert.rejects(
      () => fetchReviewData('https://example.com/not-a-pr'),
      /Invalid Bitbucket PR URL/,
    );
  });
});

// ---------------------------------------------------------------------------
// postBitbucketComments
// ---------------------------------------------------------------------------

void describe('postBitbucketComments', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  void it('posts a grouped general comment and inline comments when findings exist', async () => {
    const findings: ReviewFinding[] = [
      { severity: 'CRITICAL', file: 'src/auth.ts', line: 10, message: 'SQL injection vulnerability' },
      { severity: 'HIGH', file: 'src/db.ts', line: 20, message: 'Race condition on shared resource' },
      { severity: 'BUG', file: 'src/util.ts', line: 30, message: 'Null pointer dereference' },
      { severity: 'BUG', file: 'src/other.ts', line: null, message: 'Unhandled edge case' },
    ];

    const posts: Array<{ url: string; body: string }> = [];

    globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit) => {
      posts.push({ url: url.toString(), body: opts?.body as string });
      return new Response(null, { status: 201 });
    };

    await postBitbucketComments(prInfo, bbConfig, findings);

    // 1 general comment + 3 inline comments (the finding with line=null skips inline)
    assert.strictEqual(posts.length, 4);

    // General comment is the first post
    const generalBody = posts[0].body;
    assert.ok(generalBody.includes('### CRITICAL'));
    assert.ok(generalBody.includes('### HIGH'));
    assert.ok(generalBody.includes('### BUG'));
    assert.ok(generalBody.includes('`src/auth.ts:10`'));
    assert.ok(generalBody.includes('`src/other.ts`')); // no line number

    // Inline comments have [SEVERITY] prefix
    const inlineBodies = posts.slice(1).map((p) => p.body);
    assert.ok(inlineBodies.some((b) => b.includes('[CRITICAL] SQL injection')));
    assert.ok(inlineBodies.some((b) => b.includes('[HIGH] Race condition')));
    assert.ok(inlineBodies.some((b) => b.includes('[BUG] Null pointer')));
  });

  void it('posts NO ISSUES FOUND comment when findings are empty', async () => {
    const posts: Array<{ body: string }> = [];

    globalThis.fetch = async (_url: string | URL | Request, opts?: RequestInit) => {
      posts.push({ body: opts?.body as string });
      return new Response(null, { status: 201 });
    };

    await postBitbucketComments(prInfo, bbConfig, []);

    assert.strictEqual(posts.length, 1);
    assert.ok(posts[0].body.includes('NO ISSUES FOUND'));
  });

  void it('skips inline comments that fail without throwing', async () => {
    const findings: ReviewFinding[] = [
      { severity: 'BUG', file: 'src/bad.ts', line: 5, message: 'Broken' },
    ];

    let callCount = 0;
    globalThis.fetch = async (_url: string | URL | Request, _opts?: RequestInit) => {
      callCount++;
      if (callCount === 2) throw new Error('API error — line not in diff');
      return new Response(null, { status: 201 });
    };

    // Should not throw because inline failures are caught
    await postBitbucketComments(prInfo, bbConfig, findings);
    assert.strictEqual(callCount, 2);
  });
});

// ---------------------------------------------------------------------------
// postJiraComments
// ---------------------------------------------------------------------------

void describe('postJiraComments', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  void it('posts a combined cross-reference + summary comment for each Jira key', async () => {
    const findings: ReviewFinding[] = [
      { severity: 'CRITICAL', file: 'a.ts', line: 1, message: 'Issue 1' },
      { severity: 'HIGH', file: 'b.ts', line: 2, message: 'Issue 2' },
    ];

    const commentBodies: string[] = [];

    globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit) => {
      const urlStr = url.toString();
      // Capture only comment POST bodies (not transitions GET)
      if (urlStr.includes('/rest/api/3/issue/') && opts?.method === 'POST') {
        commentBodies.push(opts.body as string);
      }

      // Handle transitions GET — return empty array so no POST transition fires
      if (urlStr.includes('/transitions')) {
        return new Response(
          JSON.stringify({ transitions: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      return new Response('{}', {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    };

    const results = await postJiraComments(
      'https://bitbucket.org/ws/repo/pull-requests/42',
      'Fix things',
      ['KAIRA-1', 'KAIRA-2'],
      jiraConfig,
      findings,
    );

    // 2 keys × 1 combined comment = 2 comment POSTs (transitions GET is not a comment POST)
    assert.strictEqual(commentBodies.length, 2);
    assert.strictEqual(results.length, 2);
    assert.ok(results.every((r) => r.success), 'both succeeded');

    // Each comment body is ADF with a clickable link mark for the PR title
    const firstBody = JSON.parse(commentBodies[0]);
    assert.strictEqual(firstBody.body.type, 'doc');

    // Find the text node that carries the PR title and confirm it has a link mark
    const allTextNodes: Array<{ text: string; marks?: Array<{ type: string; attrs?: { href?: string } }> }> =
      [];
    for (const paragraph of firstBody.body.content) {
      for (const node of paragraph.content ?? []) {
        if (node.type === 'text') allTextNodes.push(node);
      }
    }
    const titleNode = allTextNodes.find((n) => n.text === 'Fix things');
    assert.ok(titleNode, 'PR title text node present');
    assert.ok(titleNode!.marks, 'title node has marks');
    assert.ok(
      titleNode!.marks!.some((m) => m.type === 'link' && m.attrs?.href === 'https://bitbucket.org/ws/repo/pull-requests/42'),
      'title node has clickable link mark with correct href',
    );

    // Summary text present
    const allText = allTextNodes.map((n) => n.text).join('\n');
    assert.ok(allText.includes('Review summary:'));
    assert.ok(allText.includes('2 issue(s) found: 1 Critical, 1 High, 0 Bug'));
    assert.ok(allText.includes('CRITICAL a.ts:1 — Issue 1'));
    assert.ok(allText.includes('HIGH b.ts:2 — Issue 2'));
    assert.ok(allText.includes('See PR comments for details.'));
  });

  void it('only posts cross-reference comments when there are no findings', async () => {
    const posts: string[] = [];

    globalThis.fetch = async (_url: string | URL | Request, opts?: RequestInit) => {
      posts.push(opts?.body as string);
      return new Response('{}', {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    };

    const results = await postJiraComments(
      'https://bitbucket.org/ws/repo/pull-requests/42',
      'Fix things',
      ['KAIRA-1'],
      jiraConfig,
      [],
    );

    // 1 key × 1 comment (cross-reference only) = 1 post
    assert.strictEqual(posts.length, 1);
    assert.strictEqual(results.length, 1);
    assert.ok(results[0].success);
    assert.ok(posts[0].includes('pull request was reviewed'));
  });

  void it('transitions Jira issue to Request Change when findings exist', async () => {
    const findings: ReviewFinding[] = [
      { severity: 'CRITICAL', file: 'a.ts', line: 1, message: 'Issue 1' },
    ];

    const calls: Array<{ url: string; method?: string; body?: string }> = [];

    globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit) => {
      const urlStr = url.toString();
      calls.push({ url: urlStr, method: opts?.method, body: opts?.body as string });

      if (urlStr.endsWith('/transitions') && (!opts?.method || opts.method === 'GET')) {
        return new Response(
          JSON.stringify({
            transitions: [
              { id: '31', name: 'Request Change' },
              { id: '41', name: 'Done' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (urlStr.endsWith('/transitions') && opts?.method === 'POST') {
        return new Response(null, { status: 204 });
      }

      // Comment POST — return 201 with JSON content-type
      return new Response('{}', {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    };

    const results = await postJiraComments(
      'https://bitbucket.org/ws/repo/pull-requests/42',
      'Fix things',
      ['KAIRA-1'],
      jiraConfig,
      findings,
    );

    // 2 comment POSTs (cross-ref + summary) + 1 GET transitions + 1 POST transitions = 4 calls
    const transitionGetCalls = calls.filter(
      (c) => c.url.includes('/transitions') && (!c.method || c.method === 'GET'),
    );
    const transitionPostCalls = calls.filter(
      (c) => c.url.includes('/transitions') && c.method === 'POST',
    );

    assert.strictEqual(transitionGetCalls.length, 1, 'should GET transitions once');
    assert.strictEqual(transitionPostCalls.length, 1, 'should POST transitions once');
    assert.ok(
      transitionPostCalls[0].body?.includes('"transition":{"id":"31"}'),
      'should transition to id 31 (Request Change)',
    );
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, true);
  });

  void it('does NOT transition when there are no findings', async () => {
    const calls: Array<{ url: string; method?: string }> = [];

    globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit) => {
      const urlStr = url.toString();
      calls.push({ url: urlStr, method: opts?.method });
      return new Response('{}', {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    };

    const results = await postJiraComments(
      'https://bitbucket.org/ws/repo/pull-requests/42',
      'Fix things',
      ['KAIRA-1'],
      jiraConfig,
      [],
    );

    const transitionCalls = calls.filter((c) => c.url.includes('/transitions'));
    assert.strictEqual(transitionCalls.length, 0, 'should not call transitions endpoint');
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, true);
  });

  void it('handles API errors for individual keys and continues with others', async () => {
    let callCount = 0;

    globalThis.fetch = async (_url: string | URL | Request, _opts?: RequestInit) => {
      callCount++;
      // First key fails, second key succeeds
      if (callCount <= 1) throw new Error('Network failure');
      return new Response('{}', {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    };

    const results = await postJiraComments(
      'https://bitbucket.org/ws/repo/pull-requests/42',
      'Fix things',
      ['KAIRA-FAIL', 'KAIRA-OK'],
      jiraConfig,
      [],
    );

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].success, false);
    assert.strictEqual(results[0].key, 'KAIRA-FAIL');
    assert.strictEqual(results[1].success, true);
    assert.strictEqual(results[1].key, 'KAIRA-OK');
  });
});
