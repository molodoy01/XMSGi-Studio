import { describe, expect, it } from 'vitest';
import type { SavedDraft, Template } from '@shared/types';
import { setCurrentAccountId } from '../domain/accountContext';
import {
  convertDomainDraftToLegacy,
  convertDomainTemplateToLegacy,
  convertLegacyDraftToDomain,
  convertLegacyTemplateToDomain,
} from './domainBridge';
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

  it('preserves postId across legacy and domain draft conversion', () => {
    const legacyDraft: SavedDraft = {
      id: 'draft-1',
      name: 'Draft name',
      body: 'hello',
      postId: 'post-42',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    const domainDraft = convertLegacyDraftToDomain(legacyDraft, 'account-1');
    const restored = convertDomainDraftToLegacy(domainDraft);

    expect(domainDraft.postId).toBe('post-42');
    expect(restored.postId).toBe('post-42');
  });

  it('preserves template formatting metadata across legacy and domain conversion', () => {
    const legacyTemplate: Template = {
      id: 'template-1',
      name: 'Greeting',
      body: 'Hello world',
      entities: [
        { type: 'bold', offset: 0, length: 5 },
        { type: 'text_url', offset: 6, length: 5, url: 'https://example.com' },
      ],
      tags: ['work', 'welcome'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    const domainTemplate = convertLegacyTemplateToDomain(legacyTemplate, 'account-1');
    const roundTrippedTemplate = convertDomainTemplateToLegacy(domainTemplate);

    expect(domainTemplate.fields).toEqual([
      'bold:0:5',
      'text_url:6:5:https://example.com',
    ]);
    expect(roundTrippedTemplate).toMatchObject({
      id: 'template-1',
      name: 'Greeting',
      body: 'Hello world',
      entities: [
        { type: 'bold', offset: 0, length: 5 },
        { type: 'text_url', offset: 6, length: 5, url: 'https://example.com' },
      ],
      tags: ['work', 'welcome'],
    });
  });
});
