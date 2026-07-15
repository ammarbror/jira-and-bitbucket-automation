import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parsePRURL } from './url-parser.js';

void describe('parsePRURL', () => {
  void it('parses a standard Bitbucket PR URL', () => {
    const result = parsePRURL(
      'https://bitbucket.org/myworkspace/myrepo/pull-requests/42'
    );
    assert.deepStrictEqual(result, {
      workspace: 'myworkspace',
      repoSlug: 'myrepo',
      prNumber: 42,
    });
  });

  void it('parses a PR URL with a trailing /diff path', () => {
    const result = parsePRURL(
      'https://bitbucket.org/acme/awesome-app/pull-requests/123/diff'
    );
    assert.deepStrictEqual(result, {
      workspace: 'acme',
      repoSlug: 'awesome-app',
      prNumber: 123,
    });
  });

  void it('parses a PR URL without https:// prefix', () => {
    const result = parsePRURL(
      'bitbucket.org/team/project-x/pull-requests/7/whatever/else'
    );
    assert.deepStrictEqual(result, {
      workspace: 'team',
      repoSlug: 'project-x',
      prNumber: 7,
    });
  });

  void it('throws for an invalid URL format', () => {
    assert.throws(() => parsePRURL('not-a-url'), {
      message: /Invalid Bitbucket PR URL/,
    });
  });

  void it('throws for a non-Bitbucket URL', () => {
    assert.throws(
      () => parsePRURL('https://github.com/owner/repo/pull/42'),
      { message: /Invalid Bitbucket PR URL/ }
    );
  });
});
