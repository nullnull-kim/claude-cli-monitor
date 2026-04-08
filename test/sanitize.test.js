import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDisplayString } from '../dist/sanitize.js';

test('1. 정상 문자열 통과', () => {
  const input = 'Hello, World!';
  assert.equal(sanitizeDisplayString(input), 'Hello, World!');
});

test('2. 제어 문자 제거', () => {
  // \t (0x09), \r (0x0D), \x01, \x7F 등 제어 문자 제거
  const input = 'Hello\x01\x07\t\r\x7FWorld';
  assert.equal(sanitizeDisplayString(input), 'HelloWorld');
});

test('2b. \\n은 공백으로 치환', () => {
  const input = 'Hello\nWorld';
  assert.equal(sanitizeDisplayString(input), 'Hello World');
});

test('3. ANSI 이스케이프 시퀀스 제거', () => {
  // 색상 코드
  const input = '\x1B[31mRed Text\x1B[0m';
  assert.equal(sanitizeDisplayString(input), 'Red Text');
});

test('3b. CSI 커서 이동 시퀀스 제거', () => {
  const input = '\x1B[2J\x1B[HClear Screen';
  assert.equal(sanitizeDisplayString(input), 'Clear Screen');
});

test('3c. 복합 ANSI 시퀀스 제거', () => {
  const input = '\x1B[1;32mBold Green\x1B[0m Normal';
  assert.equal(sanitizeDisplayString(input), 'Bold Green Normal');
});

test('4. CJK 문자 정상 처리', () => {
  const input = '안녕하세요 Hello 你好 こんにちは';
  assert.equal(sanitizeDisplayString(input), '안녕하세요 Hello 你好 こんにちは');
});

test('5. 빈 문자열 처리', () => {
  assert.equal(sanitizeDisplayString(''), '');
});

test('6. 200자 초과 시 잘라내기', () => {
  const input = 'a'.repeat(250);
  const result = sanitizeDisplayString(input);
  assert.equal(result.length, 200);
  assert.equal(result, 'a'.repeat(200));
});

test('6b. 정확히 200자는 잘라내지 않음', () => {
  const input = 'b'.repeat(200);
  const result = sanitizeDisplayString(input);
  assert.equal(result.length, 200);
});

test('7. trim 처리', () => {
  const input = '  Hello World  ';
  assert.equal(sanitizeDisplayString(input), 'Hello World');
});

test('7b. trim + 제어 문자 복합', () => {
  const input = '  \x01Hello\x02  ';
  assert.equal(sanitizeDisplayString(input), 'Hello');
});

test('8. null 입력 → 빈 문자열', () => {
  assert.equal(sanitizeDisplayString(null), '');
});

test('8b. undefined 입력 → 빈 문자열', () => {
  assert.equal(sanitizeDisplayString(undefined), '');
});

test('8c. 숫자 입력 → 빈 문자열', () => {
  assert.equal(sanitizeDisplayString(42), '');
});

test('9. 부분 ANSI 시퀀스 (완결된 최소 CSI)', () => {
  // \x1B[w is a valid (though rare) CSI sequence — final byte 'w' in range [@-~]
  // The matched sequence is removed; remaining text is kept
  const input = 'hello\x1B[world';
  assert.equal(sanitizeDisplayString(input), 'helloorld');
});

test('9b. 대응 없는 단독 ESC 제거', () => {
  // ESC (0x1B) not followed by a recognized sequence is stripped as control char
  const input = 'hello\x1Bworld';
  assert.equal(sanitizeDisplayString(input), 'helloworld');
});

test('10. 200자 경계의 CJK 문자', () => {
  // CJK 기본 한글 음절은 BMP (U+AC00-U+D7A3), JS length = 1 per char
  const input = '가'.repeat(201);
  const result = sanitizeDisplayString(input);
  assert.equal(result.length, 200);
  assert.equal(result, '가'.repeat(200));
});

test('10b. 정확히 200자 CJK는 절단 없음', () => {
  const input = '가'.repeat(200);
  const result = sanitizeDisplayString(input);
  assert.equal(result.length, 200);
});

test('11. NFD 분해형 한글을 NFC 합성형으로 정규화', () => {
  // "테스트" in NFD (decomposed: ㅌ+ㅔ+ㅅ+ㅡ+ㅌ+ㅡ)
  const nfd = '\u1110\u1166\u1109\u1173\u1110\u1173';
  const result = sanitizeDisplayString(nfd);
  // NFC should produce precomposed Hangul syllables
  assert.equal(result, nfd.normalize('NFC'));
  // Verify it's not the decomposed form
  assert.notEqual(result, nfd);
});

test('11b. 이미 NFC인 한글은 변경 없음', () => {
  const nfc = '테스트';
  const result = sanitizeDisplayString(nfc);
  assert.equal(result, '테스트');
});
