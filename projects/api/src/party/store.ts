import { Pool, PoolClient, QueryResultRow } from 'pg';
import { required, PartyError } from './config';

let pool: Pool | undefined;
export function database(): Pool {
  return (pool ??= new Pool({
    connectionString: required('DATABASE_URL'),
    max: 8,
    connectionTimeoutMillis: 5000,
  }));
}

export async function rows<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  client?: PoolClient
): Promise<T[]> {
  return (await (client ?? database()).query<T>(sql, values)).rows;
}

export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  existing?: PoolClient
): Promise<T> {
  const client = existing ?? (await database().connect());
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (!existing) client.release();
  }
}

// Session locks survive the commit that records "sending" before the remote write.
export async function hostLock<T>(
  key: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await database().connect();
  let acquired = false;
  let connectionFailed = false;
  const onError = () => {
    connectionFailed = true;
  };
  client.on('error', onError);
  try {
    const [lock] = await rows<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
      [`party:${key}`],
      client
    );
    acquired = lock.locked;
    if (!acquired)
      throw new PartyError(
        409,
        'host_busy',
        'Another host operation is in progress. Please retry.',
        2
      );
    return await fn(client);
  } finally {
    try {
      if (acquired && !connectionFailed)
        await client.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
          [`party:${key}`]
        );
    } catch {
      connectionFailed = true;
    }
    client.off('error', onError);
    client.release(connectionFailed);
  }
}
