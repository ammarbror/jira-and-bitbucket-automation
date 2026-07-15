import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  fetchIssueSummary,
  transitionIssue,
  getTransitions,
  addIssueComment,
} from './jira-client.js';
import type { JiraConfig } from './types.js';

const config: JiraConfig = {
  email: 'bot@example.com',
  apiToken: 'tok_123',
  baseUrl: 'https://my-domain.atlassian.net',
  projectKey: 'PROJ',
};

beforeEach(() => {
  globalThis.fetch = undefined as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = undefined as unknown as typeof globalThis.fetch;
});

void describe('fetchIssueSummary', () => {
  void it('returns key, summary, and status from a Jira issue', async () => {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        url,
        'https://my-domain.atlassian.net/rest/api/3/issue/PROJ-42',
      );
      assert.equal(init?.method ?? 'GET', 'GET');
      return new Response(
        JSON.stringify({
          key: 'PROJ-42',
          fields: {
            summary: 'Fix the login bug',
            status: { name: 'In Progress' },
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    };

    const result = await fetchIssueSummary('PROJ-42', config);
    assert.deepStrictEqual(result, {
      key: 'PROJ-42',
      summary: 'Fix the login bug',
      status: 'In Progress',
    });
  });
});

void describe('transitionIssue', () => {
  void it('POSTs the correct transition body', async () => {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        url,
        'https://my-domain.atlassian.net/rest/api/3/issue/PROJ-42/transitions',
      );
      assert.equal(init?.method, 'POST');
      const body = JSON.parse(init?.body as string);
      assert.deepStrictEqual(body, { transition: { id: '31' } });
      return new Response(null, { status: 204 });
    };

    await transitionIssue('PROJ-42', config, '31');
  });
});

void describe('getTransitions', () => {
  void it('returns an array of id/name transitions', async () => {
    globalThis.fetch = async (url: RequestInfo | URL) => {
      return new Response(
        JSON.stringify({
          transitions: [
            { id: '11', name: 'To Do' },
            { id: '21', name: 'In Progress' },
            { id: '31', name: 'Done' },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    };

    const result = await getTransitions('PROJ-42', config);
    assert.deepStrictEqual(result, [
      { id: '11', name: 'To Do' },
      { id: '21', name: 'In Progress' },
      { id: '31', name: 'Done' },
    ]);
  });
});

void describe('addIssueComment', () => {
  void it('POSTs the correct Atlassian Document Format body', async () => {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        url,
        'https://my-domain.atlassian.net/rest/api/3/issue/PROJ-42/comment',
      );
      assert.equal(init?.method, 'POST');
      const body = JSON.parse(init?.body as string);
      assert.deepStrictEqual(body, {
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Reviewed by automation.',
                },
              ],
            },
          ],
        },
      });
      return new Response(null, { status: 201 });
    };

    await addIssueComment('PROJ-42', config, 'Reviewed by automation.');
  });
});

void describe('error handling', () => {
  void it('throws with HTTP status on non-2xx response', async () => {
    globalThis.fetch = async () => {
      return new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
      });
    };

    await assert.rejects(
      () => fetchIssueSummary('PROJ-999', config),
      (err: Error) => {
        assert.ok(err.message.includes('404'));
        return true;
      },
    );
  });
});
