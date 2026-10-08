import { beforeEach, describe, expect, it } from 'vitest';
import { readPlannerDraft, writePlannerDraft } from './plannerDraft';

const plannerDraftStorageKey = 'xmsgi-planner-draft-text';

describe('Planner draft persistence', () => {
  beforeEach(() => {
    window.localStorage.removeItem(plannerDraftStorageKey);
  });

  it('restores the latest text after a reload', () => {
    writePlannerDraft('Text typed into Planner');

    expect(readPlannerDraft()).toBe('Text typed into Planner');
  });

  it('removes the saved text when the composer is cleared', () => {
    writePlannerDraft('Text typed into Planner');
    writePlannerDraft('');

    expect(readPlannerDraft()).toBe('');
    expect(window.localStorage.getItem(plannerDraftStorageKey)).toBeNull();
  });
});