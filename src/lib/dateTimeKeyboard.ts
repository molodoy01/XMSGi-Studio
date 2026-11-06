export type DateTimeKeyboardField = 'day' | 'month' | 'year' | 'hours' | 'minutes';

const NEXT_FIELD: Record<DateTimeKeyboardField, DateTimeKeyboardField | null> = {
  day: 'month',
  month: 'year',
  year: 'hours',
  hours: 'minutes',
  minutes: null,
};

export function getNextDateTimeKeyboardField(field: DateTimeKeyboardField) {
  return NEXT_FIELD[field];
}

export function isValidDateTimeKeyboardField(
  field: DateTimeKeyboardField,
  value: string,
  date: string,
  time: string,
): boolean {
  if (!/^\d+$/.test(value)) return false;

  const numericValue = Number(value);
  if (field === 'day' && (numericValue < 1 || numericValue > 31)) return false;
  if (field === 'month' && (numericValue < 1 || numericValue > 12)) return false;
  if (field === 'year' && !/^\d{4}$/.test(value)) return false;
  if (field === 'hours') return numericValue >= 0 && numericValue <= 23;
  if (field === 'minutes') return numericValue >= 0 && numericValue <= 59;

  const [currentYear, currentMonth, currentDay] = date.split('-').map(Number);
  const [currentHours, currentMinutes] = time.split(':').map(Number);
  const year = field === 'year' ? numericValue : currentYear;
  const month = field === 'month' ? numericValue : currentMonth;
  const day = field === 'day' ? numericValue : currentDay;
  const calendarDate = new Date(year, month - 1, day);

  return (
    Number.isInteger(year)
    && Number.isInteger(month)
    && Number.isInteger(day)
    && calendarDate.getFullYear() === year
    && calendarDate.getMonth() === month - 1
    && calendarDate.getDate() === day
    && Number.isInteger(currentHours)
    && Number.isInteger(currentMinutes)
  );
}