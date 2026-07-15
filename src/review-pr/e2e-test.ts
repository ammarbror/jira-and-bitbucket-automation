import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fetchReviewData, postBitbucketComments, postJiraComments } from './index.ts';
import type { ReviewFinding } from './types.ts';

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

const ALL_ENV_KEYS = [
  'BITBUCKET_EMAIL',
  'BITBUCKET_API_TOKEN',
  'JIRA_EMAIL',
  'JIRA_API_TOKEN',
  'JIRA_URL',
  'JIRA_PROJECT_KEY',
] as const;

function setEnv(env: Record<string, string>): void {
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }
}

function unsetEnv(keys: readonly string[]): void {
  for (const k of keys) {
    delete process.env[k];
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_URL = 'https://bitbucket.org/kartiniotomasi/core-api-v2/pull-requests/42';

const prJson = {
  title: 'KAIRA-123 Fix authentication vulnerability',
  description: 'KAIRA-456 tracking issue for auth rewrite',
  rendered: { description: '<p>KAIRA-456 tracking issue for auth rewrite</p>' },
  source: { branch: { name: 'feature/KAIRA-123-fix-auth' } },
};

const commitsJson = {
  values: [
    { message: 'KAIRA-123: add input validation' },
    { message: 'KAIRA-456: update integration tests' },
  ],
};

const diffContent = [
  'diff --git a/src/auth.ts b/src/auth.ts',
  'index abc..def 100644',
  '--- a/src/auth.ts',
  '+++ b/src/auth.ts',
  '@@ -12,6 +12,8 @@',
  ' import { getUser } from "./db";',
  ' ',
  '+  const query = `SELECT * FROM users WHERE id = ${userId}`;',
  '+  const query = `SELECT * FROM users WHERE id = ${userId}`;',
  ' ',
  'diff --git a/src/api/handler.ts b/src/api/handler.ts',
  'index 123..456 100644',
  '--- a/src/api/handler.ts',
  '+++ b/src/api/handler.ts',
  '@@ -40,7 +40,7 @@',
  '   cache.set(key, value);',
  '+  // missing lock around shared cache',
  ' ',
  'diff --git a/src/utils/validator.ts b/src/utils/validator.ts',
  'index 789..012 100644',
  '--- a/src/utils/validator.ts',
  '+++ b/src/utils/validator.ts',
  '@@ -85,7 +85,7 @@',
  '-  if (index > arr.length) {',
  '+  if (index >= arr.length) {',
  '',
].join('\n');

const sampleFindings: ReviewFinding[] = [
  {
    severity: 'CRITICAL',
    file: 'src/auth.ts',
    line: 15,
    message: 'SQL injection via raw query concatenation',
  },
  {
    severity: 'HIGH',
    file: 'src/api/handler.ts',
    line: 42,
    message: 'Race condition on shared cache',
  },
  {
    severity: 'BUG',
    file: 'src/utils/validator.ts',
    line: 88,
    message: 'Off-by-one in array bounds check',
  },
];

// ---------------------------------------------------------------------------
// E2E test
// ---------------------------------------------------------------------------

void describe('End-to-end: fetchReviewData → postBitbucketComments → postJiraComments', () => {
  let originalFetch: typeof globalThis.fetch;
  /** Ordered log of every fetch invocation during the test. */
  const callLog: Array<{ url: string; method: string }> = [];

  before(() => {
    originalFetch = globalThis.fetch;
    setEnv({
      BITBUCKET_EMAIL: 'bb-bot@example.com',
      BITBUCKET_API_TOKEN: 'bb-token-abc123',
      JIRA_EMAIL: 'jira-bot@example.com',
      JIRA_API_TOKEN: 'jira-token-xyz789',
      JIRA_URL: 'https://kaira.atlassian.net',
      JIRA_PROJECT_KEY: 'KAIRA',
    });
  });

  after(() => {
    globalThis.fetch = originalFetch;
    unsetEnv(ALL_ENV_KEYS);
    callLog.length = 0;
  });

  void it('completes the full PR review pipeline with mocked APIs', async () => {
    // -----------------------------------------------------------------------
    // Mock globalThis.fetch with URL-based routing
    // -----------------------------------------------------------------------
    globalThis.fetch = async (
      url: string | URL | Request,
      opts?: RequestInit,
    ): Promise<Response> => {
      const urlStr = url.toString();
      const method = opts?.method ?? 'GET';
      callLog.push({ url: urlStr, method });

      // Bitbucket diff endpoint
      if (urlStr.includes('/diff')) {
        return new Response(diffContent, { status: 200 });
      }

      // Bitbucket commits endpoint
      if (urlStr.includes('/commits')) {
        return new Response(JSON.stringify(commitsJson), { status: 200 });
      }

      // Bitbucket PR info endpoint (GET to pullrequests/{id} with no extra path segment)
      if (
        method === 'GET' &&
        urlStr.includes('/pullrequests/42') &&
        !urlStr.includes('/comments') &&
        !urlStr.includes('/diff')
      ) {
        return new Response(JSON.stringify(prJson), { status: 200 });
      }

      // Bitbucket comment POST (general or inline)
      if (method === 'POST' && urlStr.includes('/comments')) {
        return new Response(null, { status: 201 });
      }

      // Jira API POST (comment on issue)
      if (method === 'POST' && urlStr.includes('/rest/api/3/issue/')) {
        return new Response('{}', {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }

      // Jira API GET (e.g. fetchIssueSummary) — not expected in this flow but handle gracefully
      if (method === 'GET' && urlStr.includes('/rest/api/3/issue/')) {
        return new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch: ${method} ${urlStr}`);
    };

    // ===================================================================
    // Step 1 & 2: fetchReviewData
    // ===================================================================
    const reviewData = await fetchReviewData(SAMPLE_URL);

    // --- Verify fetchReviewData output shape -----------------------------

    // prInfo
    assert.ok(reviewData.prInfo, 'prInfo is present');
    assert.strictEqual(reviewData.prInfo.workspace, 'kartiniotomasi');
    assert.strictEqual(reviewData.prInfo.repoSlug, 'core-api-v2');
    assert.strictEqual(reviewData.prInfo.prNumber, 42);

    // prUrl
    assert.strictEqual(reviewData.prUrl, SAMPLE_URL);

    // metadata
    assert.ok(reviewData.metadata, 'metadata is present');
    assert.strictEqual(
      reviewData.metadata.title,
      'KAIRA-123 Fix authentication vulnerability',
    );
    assert.strictEqual(reviewData.metadata.description, '<p>KAIRA-456 tracking issue for auth rewrite</p>');
    assert.strictEqual(reviewData.metadata.sourceBranch, 'feature/KAIRA-123-fix-auth');

    // diff
    assert.strictEqual(reviewData.diff, diffContent);

    // jiraKeys — extracted from title, description, branch, and commits
    assert.ok(Array.isArray(reviewData.jiraKeys));
    assert.strictEqual(reviewData.jiraKeys.length, 2);
    assert.ok(reviewData.jiraKeys.includes('KAIRA-123'));
    assert.ok(reviewData.jiraKeys.includes('KAIRA-456'));

    // configs
    assert.strictEqual(reviewData.bbConfig.email, 'bb-bot@example.com');
    assert.strictEqual(reviewData.bbConfig.apiToken, 'bb-token-abc123');
    assert.strictEqual(reviewData.jiraConfig.email, 'jira-bot@example.com');
    assert.strictEqual(reviewData.jiraConfig.apiToken, 'jira-token-xyz789');
    assert.strictEqual(reviewData.jiraConfig.baseUrl, 'https://kaira.atlassian.net');
    assert.strictEqual(reviewData.jiraConfig.projectKey, 'KAIRA');

    // reviewPrompt — built from title, description, and diff
    assert.ok(typeof reviewData.reviewPrompt === 'string', 'reviewPrompt is a string');
    assert.ok(
      reviewData.reviewPrompt.includes('KAIRA-123 Fix authentication vulnerability'),
      'reviewPrompt contains the PR title',
    );
    assert.ok(
      reviewData.reviewPrompt.includes('KAIRA-456 tracking issue for auth rewrite'),
      'reviewPrompt contains the PR description',
    );
    assert.ok(
      reviewData.reviewPrompt.includes(diffContent),
      'reviewPrompt contains the full diff',
    );

    // Verify API call count for fetchReviewData phase
    // Expected: 1 PR info GET + 1 commits GET + 1 diff GET = 3 calls
    const fetchDataPhaseCalls = callLog.length;
    assert.strictEqual(
      fetchDataPhaseCalls,
      3,
      `fetchReviewData should make exactly 3 API calls (got ${fetchDataPhaseCalls})`,
    );

    // ===================================================================
    // Step 3: postBitbucketComments
    // ===================================================================
    await postBitbucketComments(reviewData.prInfo, reviewData.bbConfig, sampleFindings);

    // Expected: 1 general comment POST + 3 inline comment POSTs = 4 calls
    const bbCommentPhaseCalls = callLog.length - fetchDataPhaseCalls;
    assert.strictEqual(
      bbCommentPhaseCalls,
      4,
      `postBitbucketComments should make exactly 4 API calls (got ${bbCommentPhaseCalls})`,
    );

    // Verify Bitbucket comment POSTs
    const bbPosts = callLog.filter(
      (c) => c.method === 'POST' && c.url.includes('/comments'),
    );
    // There should be 4 Bitbucket comment POSTs: 1 general + 3 inline
    assert.strictEqual(
      bbPosts.length,
      4,
      `should have 4 Bitbucket comment POSTs (got ${bbPosts.length})`,
    );

    // Re-parse the bodies from the actual fetch calls
    // We re-call fetch with capturing to get bodies
    const bbBodies: string[] = [];
    const bbInlinePaths: Array<{ path: string; to: number }> = [];

    // Re-mock to capture bodies for verification
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (
      url: string | URL | Request,
      opts?: RequestInit,
    ): Promise<Response> => {
      const urlStr = url.toString();
      const method = opts?.method ?? 'GET';
      callLog.push({ url: urlStr, method });

      if (method === 'POST' && urlStr.includes('/comments')) {
        const parsed = JSON.parse(opts!.body as string);
        bbBodies.push(parsed.content.raw);
        if (parsed.inline) {
          bbInlinePaths.push({ path: parsed.inline.path, to: parsed.inline.to });
        }
        return new Response(null, { status: 201 });
      }

      if (method === 'POST' && urlStr.includes('/rest/api/3/issue/')) {
        return new Response('{}', {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected re-fetch: ${method} ${urlStr}`);
    };

    // Re-run Bitbucket comment posting to capture bodies
    await postBitbucketComments(reviewData.prInfo, reviewData.bbConfig, sampleFindings);

    // Restore the original mock
    globalThis.fetch = origFetch;

    // First general comment should contain severity groupings
    const generalComment = bbBodies[0];
    assert.ok(generalComment.includes('### CRITICAL'), 'general comment has CRITICAL section');
    assert.ok(generalComment.includes('### HIGH'), 'general comment has HIGH section');
    assert.ok(generalComment.includes('### BUG'), 'general comment has BUG section');
    assert.ok(
      generalComment.includes('`src/auth.ts:15`'),
      'general comment includes CRITICAL finding location',
    );
    assert.ok(
      generalComment.includes('`src/api/handler.ts:42`'),
      'general comment includes HIGH finding location',
    );
    assert.ok(
      generalComment.includes('`src/utils/validator.ts:88`'),
      'general comment includes BUG finding location',
    );

    // Inline comment bodies should have [SEVERITY] prefix
    const inlineBodies = bbBodies.slice(1);
    assert.strictEqual(inlineBodies.length, 3, 'there should be 3 inline comments');
    assert.ok(
      inlineBodies.some((b) => b.includes('[CRITICAL] SQL injection')),
      'inline comment has CRITICAL prefix',
    );
    assert.ok(
      inlineBodies.some((b) => b.includes('[HIGH] Race condition')),
      'inline comment has HIGH prefix',
    );
    assert.ok(
      inlineBodies.some((b) => b.includes('[BUG] Off-by-one')),
      'inline comment has BUG prefix',
    );

    // Inline paths should match expected files and lines
    assert.ok(
      bbInlinePaths.some((p) => p.path === 'src/auth.ts' && p.to === 15),
      'inline comment targets src/auth.ts:15',
    );
    assert.ok(
      bbInlinePaths.some((p) => p.path === 'src/api/handler.ts' && p.to === 42),
      'inline comment targets src/api/handler.ts:42',
    );
    assert.ok(
      bbInlinePaths.some((p) => p.path === 'src/utils/validator.ts' && p.to === 88),
      'inline comment targets src/utils/validator.ts:88',
    );

    // ===================================================================
    // Step 4: postJiraComments
    // ===================================================================
    const jiraResults = await postJiraComments(
      SAMPLE_URL,
      reviewData.metadata.title,
      reviewData.jiraKeys,
      reviewData.jiraConfig,
      sampleFindings,
    );

    // 2 Jira keys × 1 combined comment each (cross-ref + summary in a single ADF doc) = 2 POSTs
    const afterFetchCalls = callLog.length; // includes re-mock calls from body capture

    // Count Jira-specific calls
    const jiraPosts = callLog.filter(
      (c) => c.method === 'POST' && c.url.includes('/rest/api/3/issue/'),
    );
    // Total Jira posts should be 2
    assert.strictEqual(
      jiraPosts.length,
      2,
      `postJiraComments should make 2 API calls (got ${jiraPosts.length})`,
    );

    // Both Jira keys should have succeeded
    assert.strictEqual(jiraResults.length, 2);
    assert.ok(jiraResults.every((r) => r.success), 'both Jira keys succeeded');

    // Verify Jira comment bodies by re-running with body capture
    const jiraBodies: string[] = [];

    globalThis.fetch = async (
      url: string | URL | Request,
      opts?: RequestInit,
    ): Promise<Response> => {
      const urlStr = url.toString();
      const method = opts?.method ?? 'GET';
      callLog.push({ url: urlStr, method });

      if (method === 'POST' && urlStr.includes('/rest/api/3/issue/')) {
        // Flatten all text nodes across the ADF doc into one string for assertion
        const doc = JSON.parse(opts!.body as string).body;
        const text = doc.content
          .flatMap((p: { content?: Array<{ text?: string }> }) =>
            (p.content ?? []).map((n) => n.text ?? ''),
          )
          .join('');
        jiraBodies.push(text);
        return new Response('{}', {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch: ${method} ${urlStr}`);
    };

    const jiraResults2 = await postJiraComments(
      SAMPLE_URL,
      reviewData.metadata.title,
      reviewData.jiraKeys,
      reviewData.jiraConfig,
      sampleFindings,
    );

    assert.strictEqual(jiraResults2.length, 2);
    assert.ok(jiraResults2.every((r) => r.success));

    // 2 keys × 1 combined comment = 2 bodies
    assert.strictEqual(jiraBodies.length, 2);

    // Each combined comment: cross-ref + summary
    for (const body of jiraBodies) {
      assert.ok(
        body.includes('pull request was reviewed'),
        'comment mentions PR review',
      );
      assert.ok(
        body.includes('Review summary:'),
        'comment has review summary section',
      );
      assert.ok(
        body.includes('3 issue(s)'),
        'summary mentions total issue count',
      );
      assert.ok(
        body.includes('1 Critical, 1 High, 1 Bug'),
        'summary has correct severity breakdown',
      );
    }

    // ===================================================================
    // Summary: total API calls across the full pipeline
    // ===================================================================
    // Original phase: 3 (data fetch)
    // BB comments (first run): 4
    // BB comments (re-run for body capture): 4
    // Jira comments (first run): 4
    // Jira comments (re-run for body capture): 4
    // Total fetch data calls: 3 (fetchReviewData) + 4 (first BB) + 4 (re-run BB) + 4 (first Jira) + 4 (re-run Jira) = 19
    // But the first-run Jira calls are counted in callLog via the original mock (route-based),
    // and the re-run calls via the body-capture mock. So all Jira calls are in callLog.
    // The exact count isn't critical — what matters is each phase made expected calls.
  });
});
