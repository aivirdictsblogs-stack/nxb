import { createRequire } from 'node:module';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = import('node:sqlite').DatabaseSync;
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Minimal D1Database implementation over node:sqlite so the real SQL (constraints, triggers, batches) is exercised. */
class Stmt {
  constructor(private db: DatabaseSync, private sql: string, private args: any[] = []) {}
  bind(...a: any[]) { return new Stmt(this.db, this.sql, a); }
  private prep() { return this.db.prepare(this.sql); }
  async first<T = any>(): Promise<T | null> { return (this.prep().get(...this.args) as T) ?? null; }
  async all<T = any>() { return { results: this.prep().all(...this.args) as T[], success: true, meta: {} }; }
  async run() { const r = this.prep().run(...this.args); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  _exec() { return this.run(); }
}
export function makeD1() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync('migrations').sort()) raw.exec(readFileSync(join('migrations', f), 'utf8'));
  const d1: any = {
    prepare: (sql: string) => new Stmt(raw, sql),
    async batch(stmts: Stmt[]) {
      raw.exec('BEGIN');
      try { const out = []; for (const s of stmts) out.push(await s._exec()); raw.exec('COMMIT'); return out; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
    raw,
  };
  return d1 as D1Database & { raw: DatabaseSync };
}
