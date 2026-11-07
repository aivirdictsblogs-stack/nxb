import { uid, notifyStmt, auditStmt } from './util';

export type LedgerEntry = {
  userId: string; amountMinor: number; // signed: + credit, - debit
  type: 'deposit' | 'purchase' | 'refund' | 'admin_credit' | 'admin_debit';
  reference: string; refType?: string; refId?: string; description?: string; actorId?: string | null;
};
/**
 * Statements that apply one ledger entry atomically (use inside db.batch).
 * Safety: UNIQUE(reference) blocks double credits/charges; CHECK(balance_minor>=0) aborts the
 * whole batch on overdraft. Ledger row is inserted first so a duplicate reference fails fast.
 */
export function ledgerStmts(db: D1Database, e: LedgerEntry): D1PreparedStatement[] {
  if (!Number.isInteger(e.amountMinor) || e.amountMinor === 0) throw new Error('amount must be a non-zero integer (minor units)');
  return [
    db.prepare(`INSERT INTO wallet_transactions (id,user_id,reference,type,amount_minor,balance_after_minor,ref_type,ref_id,description,actor_id)
      VALUES (?,?,?,?,?, (SELECT balance_minor FROM wallet_accounts WHERE user_id=?) + ?, ?,?,?,?)`)
      .bind(uid(), e.userId, e.reference, e.type, e.amountMinor, e.userId, e.amountMinor, e.refType ?? null, e.refId ?? null, e.description ?? null, e.actorId ?? null),
    db.prepare('UPDATE wallet_accounts SET balance_minor = balance_minor + ? WHERE user_id = ?').bind(e.amountMinor, e.userId),
  ];
}
export async function getBalance(db: D1Database, userId: string) {
  const r = await db.prepare('SELECT balance_minor FROM wallet_accounts WHERE user_id=?').bind(userId).first<{ balance_minor: number }>();
  return r?.balance_minor ?? 0;
}
/** Ledger reconciliation: stored balance must equal the sum of ledger entries. */
export async function reconcile(db: D1Database, userId: string) {
  const r = await db.prepare(`SELECT w.balance_minor AS balance, COALESCE((SELECT SUM(amount_minor) FROM wallet_transactions WHERE user_id=w.user_id),0) AS ledger FROM wallet_accounts w WHERE w.user_id=?`).bind(userId).first<{ balance: number; ledger: number }>();
  return { balance: r?.balance ?? 0, ledger: r?.ledger ?? 0, ok: !!r && r.balance === r.ledger };
}
export { notifyStmt, auditStmt };
