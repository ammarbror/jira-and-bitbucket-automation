import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchPRInfo,
  fetchPRDiff,
  fetchPRCommits,
  postGeneralComment,
  postInlineComment,
} from './bitbucket-client.ts';
import type { PRInfo } from './types.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testInfo: PRInfo = { workspace: 'ws', repoSlug: 'repo', prNumber: 1 };
const testConfig = { email: 'e@e.com', apiToken: 'tok' };

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// fetchPRInfo
// ---------------------------------------------------------------------------

void describe('fetchPRInfo', () => {
  void it('fetches PR metadata and commit messages', async () => {
    const prJson = {
      title: 'Fix important bug',
      description: 'Root cause analysis',
      rendered: { description: '<p>Root cause analysis</p>' },
      source: { branch: { name: 'fix/KAIRA-123' } },
    };
    const commitsJson = {
      values: [
        { message: 'first commit' },
        { message: 'second commit' },
      ],
    };

    let callIndex = 0;
    globalThis.fetch = async (url: string | URL | Request) => {
      callIndex++;
      if (callIndex === 1) {
        assert.match(url.toString(), /\/pullrequests\/1$/);
        return new Response(JSON.stringify(prJson), { status: 200 });
      }
      assert.match(url.toString(), /\/pullrequests\/1\/commits/);
      return new Response(JSON.stringify(commitsJson), { status: 200 });
    };

    const result = await fetchPRInfo(testInfo, testConfig);
    assert.deepStrictEqual(result, {
      title: 'Fix important bug',
      description: '<p>Root cause analysis</p>',
      sourceBranch: 'fix/KAIRA-123',
      commitMessages: ['first commit', 'second commit'],
    });
  });
});

// ---------------------------------------------------------------------------
// fetchPRDiff
// ---------------------------------------------------------------------------

void describe('fetchPRDiff', () => {
  void it('returns diff as a string', async () => {
    const diff = '--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1,2 @@\n+console.log("hello");\n';

    globalThis.fetch = async () =>
      new Response(diff, { status: 200, headers: { 'content-type': 'text/plain' } });

    const result = await fetchPRDiff(testInfo, testConfig);
    assert.strictEqual(result, diff);
  });
});

// ---------------------------------------------------------------------------
// fetchPRCommits
// ---------------------------------------------------------------------------

void describe('fetchPRCommits', () => {
  void it('returns an array of commit messages', async () => {
    const commitsJson = {
      values: [
        { message: 'feat: add login', date: '2025-01-01' },
        { message: 'fix: typo', date: '2025-01-02' },
      ],
    };

    globalThis.fetch = async () => new Response(JSON.stringify(commitsJson), { status: 200 });

    const result = await fetchPRCommits(testInfo, testConfig);
    assert.deepStrictEqual(result, ['feat: add login', 'fix: typo']);
  });
});

// ---------------------------------------------------------------------------
// postGeneralComment
// ---------------------------------------------------------------------------

void describe('postGeneralComment', () => {
  void it('POSTs with correct body and Content-Type', async () => {
    let capturedMethod: string | undefined;
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;
    let capturedHeaders: Headers | undefined;

    globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit) => {
      capturedUrl = url.toString();
      capturedMethod = opts?.method;
      capturedBody = opts?.body as string;
      capturedHeaders = opts?.headers as Headers;
      return new Response(null, { status: 201 });
    };

    await postGeneralComment(testInfo, testConfig, 'Great PR!');

    assert.match(capturedUrl!, /\/pullrequests\/1\/comments$/);
    assert.strictEqual(capturedMethod, 'POST');

    const parsed = JSON.parse(capturedBody!);
    assert.deepStrictEqual(parsed, { content: { raw: 'Great PR!' } });
  });
});

// ---------------------------------------------------------------------------
// postInlineComment
// ---------------------------------------------------------------------------

void describe('postInlineComment', () => {
  void it('POSTs with inline fields in the body', async () => {
    let capturedBody: string | undefined;

    globalThis.fetch = async (_url: string | URL | Request, opts?: RequestInit) => {
      capturedBody = opts?.body as string;
      return new Response(null, { status: 201 });
    };

    await postInlineComment(testInfo, testConfig, 'Fix this line', 'src/app.ts', 42);

    const parsed = JSON.parse(capturedBody!);
    assert.deepStrictEqual(parsed, {
      content: { raw: 'Fix this line' },
      inline: { to: 42, path: 'src/app.ts' },
    });
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

void describe('error handling', () => {
  void it('throws an error including the HTTP status on non-2xx', async () => {
    globalThis.fetch = async () =>
      new Response('rate limit exceeded', { status: 429, statusText: 'Too Many Requests' });

    await assert.rejects(
      () => fetchPRInfo(testInfo, testConfig),
      /429.*Too Many Requests.*rate limit exceeded/,
    );
  });
});
