import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

/**
 * Tiny key/value store. Uses Postgres when DATABASE_URL is set (Railway),
 * otherwise a JSON file in ./data (local development).
 */
export interface KV {
  load(key: string): Promise<unknown | null>;
  save(key: string, value: unknown): Promise<void>;
}

class PgKV implements KV {
  private pool: pg.Pool;
  private ready: Promise<void>;
  constructor(url: string) {
    const ssl = /localhost|127\.0\.0\.1|railway\.internal/.test(url) ? false : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString: url, ssl });
    this.ready = this.pool
      .query('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())')
      .then(() => undefined);
  }
  async load(key: string) {
    await this.ready;
    const r = await this.pool.query('SELECT value FROM kv WHERE key = $1', [key]);
    return r.rows[0]?.value ?? null;
  }
  async save(key: string, value: unknown) {
    await this.ready;
    await this.pool.query(
      'INSERT INTO kv (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
      [key, JSON.stringify(value)],
    );
  }
}

class FileKV implements KV {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }
  private file(key: string) {
    return path.join(this.dir, `${key}.json`);
  }
  async load(key: string) {
    try {
      return JSON.parse(fs.readFileSync(this.file(key), 'utf8'));
    } catch {
      return null;
    }
  }
  async save(key: string, value: unknown) {
    const tmp = this.file(key) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, this.file(key));
  }
}

export function createStore(): KV {
  const url = process.env.DATABASE_URL;
  if (url) {
    console.log('[store] using Postgres');
    return new PgKV(url);
  }
  console.log('[store] using local files in ./data');
  return new FileKV(path.resolve('data'));
}

/** Debounced saver so rapid changes result in one write. */
export function debouncedSaver(kv: KV, key: string, getValue: () => unknown, ms = 400) {
  let timer: NodeJS.Timeout | null = null;
  let saving = Promise.resolve();
  const flush = () => {
    timer = null;
    const value = getValue();
    saving = saving.then(() => kv.save(key, value)).catch((e) => console.error(`[store] save ${key} failed`, e));
    return saving;
  };
  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, ms);
    },
    async flushNow() {
      if (timer) clearTimeout(timer);
      await flush();
    },
  };
}
