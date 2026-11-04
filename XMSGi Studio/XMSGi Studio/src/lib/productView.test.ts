import { beforeEach, describe, expect, it } from 'vitest';
import {
  getBackgroundProductView,
  getInitialProductView,
  persistPostsReturnView,
  persistProductView,
  readPostsReturnView,
} from './productView';

const productViewStorageKey = 'xmsgi-product-view-v1';
const postsReturnViewStorageKey = 'xmsgi-posts-return-view-v1';

describe('Initial product view', () => {
  beforeEach(() => {
    window.localStorage.removeItem(productViewStorageKey);
    window.localStorage.removeItem(postsReturnViewStorageKey);
  });

  it('starts Electron sessions in Studio and browser draft sessions in Quick Planner', () => {
    expect(getInitialProductView(false)).toBe('studio');
    expect(getInitialProductView(true)).toBe('planner');
  });

  it('restores Planner or Posts and remembers which product view Posts returns to', () => {
    persistProductView('planner');
    expect(getInitialProductView(false)).toBe('planner');

    persistPostsReturnView('planner');
    persistProductView('posts');
    expect(getInitialProductView(false)).toBe('posts');
    expect(readPostsReturnView('studio')).toBe('planner');
    expect(getBackgroundProductView('posts', 'studio')).toBe('planner');
    expect(getBackgroundProductView('studio', 'planner')).toBe('studio');
  });
});