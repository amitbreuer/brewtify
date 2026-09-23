import assert from 'node:assert/strict';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { test } from 'node:test';
import { createProviderLookup, isPublicProviderAddress, type ProviderResolver } from './network';

const runLookup = (resolve: ProviderResolver, options: LookupOptions = { all: true }, hostname = 'api.spotify.com') =>
  new Promise<{ address: string | LookupAddress[]; family?: number }>((accept, reject) => {
    createProviderLookup(resolve)(hostname, options, (error, address, family) => {
      if (error) reject(error);
      else accept({ address, family });
    });
  });

test('address classifier rejects private, reserved, local, documentation and transition addresses', () => {
  for (const address of [
    '', 'example.org', '2130706433', '127.1', '01.02.03.04',
    '0.0.0.0', '0.1.2.3', '10.1.2.3', '100.64.0.1', '100.127.255.255', '127.0.0.1',
    '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.9', '192.0.2.1',
    '192.31.196.1', '192.52.193.1', '192.88.99.1', '192.168.1.1', '192.175.48.1',
    '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.1',
    '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
    '::', '::1', '::127.0.0.1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1',
    '::ffff:169.254.169.254', '::ffff:8.8.8.8', '64:ff9b::7f00:1', '64:ff9b:1::1',
    '100::1', '2001::1', '2001:2::1', '2001:10::1', '2001:20::1', '2001:db8::1',
    '2002:7f00:1::', '2620:4f:8000::1', '3fff::1', '4000::1', '5f00::1',
    'fc00::1', 'fd00::1', 'fe80::1', 'fe80::1%eth0', 'fec0::1', 'ff02::1',
    '2606:4700:4700::1111%eth0',
  ]) assert.equal(isPublicProviderAddress(address), false, address);
});

test('address classifier permits normal globally routable provider destinations', () => {
  for (const address of [
    '1.1.1.1', '8.8.8.8', '35.186.224.25', '104.154.127.126', '17.253.144.10',
    '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0',
    '2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001:800::200e',
  ]) assert.equal(isPublicProviderAddress(address), true, address);
});

test('socket lookup resolves once and pins exactly the vetted addresses', async () => {
  let calls = 0;
  const addresses = [{ address: '35.186.224.25', family: 4 }, { address: '2606:4700::1111', family: 6 }];
  const result = await runLookup(async hostname => {
    calls++;
    assert.equal(hostname, 'api.spotify.com');
    return addresses;
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.address, addresses);
  assert.notEqual(result.address, addresses);
});

test('socket lookup rejects every mixed public/private response, regardless of requested family/order', async () => {
  for (const bad of [
    { address: '127.0.0.1', family: 4 }, { address: '169.254.169.254', family: 4 },
    { address: '::ffff:127.0.0.1', family: 6 }, { address: 'fd00::1', family: 6 },
    { address: '2001:db8::1', family: 6 },
  ]) {
    for (const reverse of [false, true]) {
      const addresses = [{ address: '35.186.224.25', family: 4 }, bad];
      if (reverse) addresses.reverse();
      for (const options of [{ all: true }, { family: 4 }, { family: 6, all: true }]) {
        await assert.rejects(runLookup(async () => addresses, options), { code: 'EACCES' });
      }
    }
  }
});

test('socket lookup respects single-address/family callers after validating every DNS record', async () => {
  const resolver = async () => [{ address: '35.186.224.25', family: 4 }, { address: '2606:4700::1111', family: 6 }];
  assert.deepEqual(await runLookup(resolver, {}), { address: '35.186.224.25', family: 4 });
  assert.deepEqual(await runLookup(resolver, { family: 'IPv6' }), { address: '2606:4700::1111', family: 6 });
  assert.deepEqual((await runLookup(resolver, { family: 4, all: true })).address, [{ address: '35.186.224.25', family: 4 }]);
  await assert.rejects(runLookup(async () => [{ address: '35.186.224.25', family: 4 }], { family: 6 }), { code: 'EACCES' });
});

test('socket lookup rejects empty, malformed and mismatched-family DNS answers and resolver failures', async () => {
  for (const addresses of [
    [], [{ address: '35.186.224.25', family: 6 }], [{ address: 'localhost', family: 4 }],
    Array(65).fill({ address: '35.186.224.25', family: 4 }),
  ]) await assert.rejects(runLookup(async () => addresses), { code: 'EACCES' });
  await assert.rejects(runLookup(async () => { throw new Error('DNS failed'); }), { code: 'EACCES' });
  await assert.rejects(runLookup(() => { throw new Error('synchronous resolver failure'); }), { code: 'EACCES' });
});

test('socket lookup cannot resolve unapproved hostnames or literals', async () => {
  let calls = 0;
  for (const hostname of ['evil.example', 'api.spotify.com.evil.example', '127.0.0.1', '35.186.224.25', 'itunes.apple.com.', 'itunes.apple.com.evil.example', 'api.music.apple.com']) {
    await assert.rejects(runLookup(async () => { calls++; return []; }, {}, hostname), { code: 'EACCES' });
  }
  assert.equal(calls, 0);
  for (const hostname of ['api.spotify.com', 'accounts.spotify.com', 'itunes.apple.com']) {
    assert.equal((await runLookup(async () => [{ address: '35.186.224.25', family: 4 }], {}, hostname)).address, '35.186.224.25');
  }
});
