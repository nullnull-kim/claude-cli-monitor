/**
 * Tests for i18n — t() placeholder substitution and English translation completeness.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, getTranslations } from '../dist/i18n/index.js';
import { en } from '../dist/i18n/en.js';

// ── t() — 플레이스홀더 치환 ──

test('t: 플레이스홀더 없는 템플릿은 그대로 반환', () => {
  assert.equal(t('Hello World'), 'Hello World');
});

test('t: %s 치환', () => {
  assert.equal(t('Hello %s', 'World'), 'Hello World');
});

test('t: %d 치환', () => {
  assert.equal(t('showing %d rows', 5), 'showing 5 rows');
});

test('t: 복수 %s 치환 순서대로', () => {
  assert.equal(t('%s: %s → %s', 'hook-engineer', 'cyan', 'green'), 'hook-engineer: cyan → green');
});

test('t: %s와 %d 혼합', () => {
  assert.equal(t('Agent %s has %d tokens', 'test', 100), 'Agent test has 100 tokens');
});

test('t: 인자보다 플레이스홀더가 많으면 빈 문자열로 대체', () => {
  assert.equal(t('%s %s', 'only-one'), 'only-one ');
});

test('t: 플레이스홀더보다 인자가 많으면 초과 인자는 무시', () => {
  assert.equal(t('%s', 'a', 'b', 'c'), 'a');
});

test('t: 빈 템플릿 → 빈 문자열', () => {
  assert.equal(t(''), '');
});

test('t: 숫자 인자를 문자열로 변환', () => {
  assert.equal(t('count: %d', 42), 'count: 42');
});

// ── getTranslations() ──

test('getTranslations: 영어 Translations 반환', () => {
  const tr = getTranslations();
  assert.equal(tr.columns.agent, 'Agent');
  assert.equal(tr.cli.noSessions, 'No sessions found.');
});

// ── 번역 키 내용 검증 ──

test('en: 모든 번역 값이 비어있지 않은 문자열', () => {
  for (const [section, obj] of Object.entries(en)) {
    for (const [key, val] of Object.entries(obj)) {
      assert.equal(typeof val, 'string', `en.${section}.${key} should be string`);
      assert.ok(val.length > 0, `en.${section}.${key} should not be empty`);
    }
  }
});

test('en.config.colorChanged: %s 플레이스홀더 포함', () => {
  assert.ok(en.config.colorChanged.includes('%s'));
});

test('en.init.rowsPreview: %d 플레이스홀더 포함', () => {
  assert.ok(en.init.rowsPreview.includes('%d'));
});
