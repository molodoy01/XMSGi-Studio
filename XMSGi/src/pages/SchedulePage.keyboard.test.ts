import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pageSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'SchedulePage.tsx'),
  'utf8',
);

describe('SchedulePage keyboard date/time wiring', () => {
  it('wires Escape to cancel the active keyboard flow and restore its snapshot', () => {
    expect(pageSource).toContain("if (event.key === 'Escape')");
    expect(pageSource).toContain('keyboardDateTimeSnapshotRef.current');
    expect(pageSource).toContain('event.currentTarget.blur();');
  });

  it('keeps the existing native date picker and time picker controls', () => {
    expect(pageSource).toContain('togglePicker(\'date\', datePickerRef)');
    expect(pageSource).toContain('onClick={openTimePicker}');
    expect(pageSource).toContain('moment-native-date-picker');
    expect(pageSource).toContain('moment-native-time-picker');
  });

  it('supports Space as a sequential date/time separator', () => {
    expect(pageSource).toContain("if (event.key !== 'Enter' && event.key !== ' ') return;");
  });

  it('positions the time menu above the clock trigger', () => {
    expect(pageSource).toContain('trigger.top - menu.offsetHeight - 6');
  });
});
