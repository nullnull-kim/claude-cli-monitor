import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en } from '../dist/i18n/en.js';

test('1. en.columns has agent, task, used keys', () => {
  assert.ok('agent' in en.columns, 'en.columns should have agent key');
  assert.ok('task' in en.columns, 'en.columns should have task key');
  assert.ok('used' in en.columns, 'en.columns should have used key');
});

test('2. en.columns does not have type or description keys (old keys removed)', () => {
  assert.ok(!('type' in en.columns), 'en.columns should not have type key');
  assert.ok(!('description' in en.columns), 'en.columns should not have description key');
});
