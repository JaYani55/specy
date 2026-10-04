import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/events/time-picker.tsx', import.meta.url), 'utf8');

describe('event time picker adjustment behavior', () => {
  it('keeps the popover open for repeated hour/minute step adjustments', () => {
    assert.match(source, /const handleTimeSelect = \(hour: number, minute: number, closePicker = true\)/);
    assert.match(source, /if \(closePicker\) setIsOpen\(false\)/);
    const adjustHandler = source.match(/const adjustTime = \([\s\S]*?\n  \};/)?.[0];
    assert.ok(adjustHandler);
    assert.match(adjustHandler, /handleTimeSelect\(newHour, newMinute, false\)/);
    assert.doesNotMatch(adjustHandler, /setIsOpen\(false\)/);
  });
});
