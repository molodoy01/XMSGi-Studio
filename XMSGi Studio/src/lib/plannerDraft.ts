const PLANNER_DRAFT_STORAGE_KEY = 'xmsgi-planner-draft-text';

export function readPlannerDraft() {
  try {
    return window.localStorage.getItem(PLANNER_DRAFT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writePlannerDraft(message: string) {
  try {
    if (message) window.localStorage.setItem(PLANNER_DRAFT_STORAGE_KEY, message);
    else window.localStorage.removeItem(PLANNER_DRAFT_STORAGE_KEY);
  } catch {
    // Keep Planner usable when local storage is unavailable.
  }
}