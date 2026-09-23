import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { constantEqual, verifyTelegram } from './security';

const token = '123456:test-token';
const now = 1_800_000_000_000;
function sign(fields: Record<string, string>): string {
  const data = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  return new URLSearchParams({
    ...fields,
    hash: createHmac('sha256', key).update(data).digest('hex'),
  }).toString();
}
test('Telegram signature binds user, launch destination, bot and timestamp', () => {
  const fields = {
    user: JSON.stringify({ id: 12345, first_name: 'Guest' }),
    auth_date: String(now / 1000),
    start_param: 'p_invitation',
  };
  const signed = sign(fields);
  assert.equal(verifyTelegram(signed, token, now).id, '12345');
  assert.throws(() =>
    verifyTelegram(signed.replace('12345', '12346'), token, now)
  );
  assert.throws(() =>
    verifyTelegram(signed.replace('p_invitation', 'p_other'), token, now)
  );
  assert.throws(() => verifyTelegram(signed, 'other-bot', now));
  assert.throws(() =>
    verifyTelegram(`${signed}&auth_date=${now / 1000}`, token, now)
  );
  assert.throws(() =>
    verifyTelegram(
      sign({ ...fields, auth_date: String(now / 1000 - 301) }),
      token,
      now
    )
  );
  assert.throws(() =>
    verifyTelegram(
      sign({ ...fields, auth_date: String(now / 1000 + 31) }),
      token,
      now
    )
  );
  assert.throws(() =>
    verifyTelegram(sign({ ...fields, user: '{"id":"12345"}' }), token, now)
  );
  assert.throws(() => verifyTelegram('', token, now));
});
test('constant equality rejects changed lengths and content', () => {
  assert.equal(constantEqual('abc', 'abc'), true);
  assert.equal(constantEqual('abc', 'abcd'), false);
  assert.equal(constantEqual('abc', 'abd'), false);
});
