import { describe, expect, it } from 'vitest';
import { setCurrentAccountId } from '../domain/accountContext';
import { createDomainDraft, createPublishPost } from './postStudioService';

describe('postStudioService', () => {
  it('maps editor content to domain draft', () => {
    const draft = createDomainDraft({
      authorAccountId: 'account-1',
      contentBody: 'Hello world',
      richText: '<p>Hello world</p>',
    });

    expect(draft.authorAccountId).toBe('account-1');
    expect(draft.contentBody).toBe('Hello world');
    expect(draft.richText).toBe('<p>Hello world</p>');
  });

  it('creates a publishable post from a draft', () => {
    const post = createPublishPost({
      accountId: 'account-1',
      channelId: 'channel-1',
      body: 'Scheduled update',
      entities: [{ type: 'bold', offset: 0, length: 8 }],
    });

    expect(post.status).toBe('draft');
    expect(post.accountId).toBe('account-1');
    expect(post.channelId).toBe('channel-1');
    expect(post.body).toBe('Scheduled update');
  });

  it('uses the current account boundary when no explicit account id is passed', () => {
    setCurrentAccountId('account-boundary');

    const draft = createDomainDraft({
      contentBody: 'Hello from boundary',
    });
    const post = createPublishPost({
      channelId: 'channel-boundary',
      body: 'Boundary post',
    });

    expect(draft.authorAccountId).toBe('account-boundary');
    expect(post.accountId).toBe('account-boundary');
    expect(post.channelId).toBe('channel-boundary');
  });
});
