import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from './schema';

export type PixelDb = LibSQLDatabase<typeof schema>;

export interface Database {
  db: PixelDb;
  client: Client;
  close(): void;
}

/** Open (and migrate) the local database. `url` is a libsql URL, e.g. `file:/path/pixel.db`. */
export async function openDatabase(opts: { url: string; migrationsFolder: string }): Promise<Database> {
  const client = createClient({ url: opts.url });
  await client.execute('PRAGMA foreign_keys = ON');
  if (opts.url.startsWith('file:')) {
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA busy_timeout = 5000');
  }
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: opts.migrationsFolder });
  return { db, client, close: () => client.close() };
}
