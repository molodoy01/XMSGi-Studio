import { beforeEach, describe, expect, it } from 'vitest';
import { readLastProductView, writeLastProductView } from './productView';

const productViewStorageKey = 'xmsgi-product-view';

describe('Product view persistence', () => {
  beforeEach(() => {
    window.localStorage.removeItem(productViewStorageKey);
  });

  it('defaults a fresh installation to Studio', () => {
    expect(readLastProductView()).toBe('studio');
  });

  it('restores the last view after the app closes and opens again', () => {
    writeLastProductView('planner');

    expect(readLastProductView()).toBe('planner');
  });
});