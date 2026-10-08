export type ProductView = 'studio' | 'planner';

const PRODUCT_VIEW_STORAGE_KEY = 'xmsgi-product-view';

export function readLastProductView(): ProductView {
  try {
    const value = window.localStorage.getItem(PRODUCT_VIEW_STORAGE_KEY);
    return value === 'planner' || value === 'studio' ? value : 'studio';
  } catch {
    return 'studio';
  }
}

export function writeLastProductView(view: ProductView) {
  try {
    window.localStorage.setItem(PRODUCT_VIEW_STORAGE_KEY, view);
  } catch {
    // Keep navigation usable when local storage is unavailable.
  }
}