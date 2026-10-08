import { getTimezoneParts } from '@shared/utils';

export { formatDateTime, getTimezoneParts, getTodayStr, getCurrentTimeStr, uid } from '@shared/utils';

export function getTimezoneLabel(): string {
  const { offset, city } = getTimezoneParts();
  return `${city} ${offset}`.trim();
}
