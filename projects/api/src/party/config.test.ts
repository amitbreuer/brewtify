import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPrerequisites, PartyError } from './config';

test('Party prerequisites require no Apple credentials but retain Spotify and infrastructure gates', t => {
  const values: Record<string, string | undefined> = {
    PARTY_PUBLIC_ORIGIN: 'https://party.test',
    PARTY_TELEGRAM_BOT_USERNAME: 'test_party_bot',
    DATABASE_URL: 'postgresql://localhost/unused',
    ENCRYPTION_KEY: 'ab'.repeat(32),
    TELEGRAM_BOT_TOKEN: 'test',
    PARTY_IDENTITY_KEY: 'cd'.repeat(32),
    SPOTIFY_CLIENT_ID: 'test-client',
    PARTY_SPOTIFY_REDIRECT_URI: 'https://party.test/api/party/auth/callback',
    PARTY_HOST_ALLOWLIST: 'host',
    PARTY_TASKS_PROJECT: 'test',
    PARTY_TASKS_LOCATION: 'test',
    PARTY_TASKS_QUEUE: 'test',
    PARTY_TASKS_SERVICE_ACCOUNT: 'tasks@test.invalid',
    PARTY_TASKS_AUDIENCE: 'https://party.test',
    APPLE_MUSIC_TEAM_ID: undefined,
    APPLE_MUSIC_KEY_ID: undefined,
    APPLE_MUSIC_PRIVATE_KEY: undefined,
  };
  for (const [name, value] of Object.entries(values)) {
    const original = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    t.after(() => {
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    });
  }
  assert.doesNotThrow(checkPrerequisites);
  for (const name of ['SPOTIFY_CLIENT_ID', 'PARTY_HOST_ALLOWLIST', 'PARTY_TASKS_QUEUE', 'PARTY_IDENTITY_KEY']) {
    delete process.env[name];
    assert.throws(checkPrerequisites, (error: unknown) =>
      error instanceof PartyError && error.code === 'configuration_required' && error.message.includes(name));
    process.env[name] = values[name];
  }
});
