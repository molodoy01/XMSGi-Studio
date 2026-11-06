export type ProductView = 'studio' | 'planner' | 'posts';

const PRODUCT_VIEW_STORAGE_KEY = 'xmsgi-product-view-v1';
const POSTS_RETURN_VIEW_STORAGE_KEY = 'xmsgi-posts-return-view-v1';

export function getInitialProductView(browserDraftMode: boolean): ProductView {
  try {
    const storedView = window.localStorage.getItem(PRODUCT_VIEW_STORAGE_KEY);
    if (storedView === 'planner' || storedView === 'studio' || storedView === 'posts') return storedView;
  } catch {
    // Fall back to the default view when local storage is unavailable.
  }
  return browserDraftMode ? 'planner' : 'studio';
}

export function persistProductView(view: ProductView) {
  try {
    window.localStorage.setItem(PRODUCT_VIEW_STORAGE_KEY, view);
  } catch {
    // Keep navigation working when local storage is unavailable.
  }
}

export function readPostsReturnView(fallback: Exclude<ProductView, 'posts'>): Exclude<ProductView, 'posts'> {
  try {
    const storedView = window.localStorage.getItem(POSTS_RETURN_VIEW_STORAGE_KEY);
    if (storedView === 'planner' || storedView === 'studio') return storedView;
  } catch {
    // Use the current default when local storage is unavailable.
  }
  return fallback;
}

export function getBackgroundProductView(
  view: ProductView,
  fallback: Exclude<ProductView, 'posts'>,
): Exclude<ProductView, 'posts'> {
  return view === 'posts' ? readPostsReturnView(fallback) : view;
}

export function persistPostsReturnView(view: Exclude<ProductView, 'posts'>) {
  try {
    window.localStorage.setItem(POSTS_RETURN_VIEW_STORAGE_KEY, view);
  } catch {
    // Keep navigation working when local storage is unavailable.
  }
}
