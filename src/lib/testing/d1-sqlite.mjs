// Test double for a D1 database, backed by Node's built-in SQLite (in memory). It keeps the D1
// semantics the code relies on: numbered parameters (?1), `batch()` runs as one transaction and
// rolls back entirely when a statement fails, and `run()` reports `meta.changes`.
// Test-only: never imported by the Worker.

import { DatabaseSync } from "node:sqlite";

const isQuery = (sql) => /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql);

class Statement {
	constructor(db, sql, params = []) {
		this.db = db;
		this.sql = sql;
		this.params = params;
	}

	bind(...params) {
		return new Statement(this.db, this.sql, params.map((p) => (p === undefined ? null : p)));
	}

	exec() {
		const stmt = this.db.prepare(this.sql);
		if (isQuery(this.sql)) return { success: true, results: stmt.all(...this.params).map((r) => ({ ...r })), meta: { changes: 0 } };
		const info = stmt.run(...this.params);
		return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
	}

	async run() {
		return this.exec();
	}

	async all() {
		return this.exec();
	}

	async first(column) {
		const row = this.exec().results[0] ?? null;
		return column && row ? row[column] : row;
	}
}

export function createTestD1() {
	const db = new DatabaseSync(":memory:");
	return {
		prepare: (sql) => new Statement(db, sql),
		async batch(statements) {
			db.exec("BEGIN");
			try {
				const results = statements.map((s) => s.exec());
				db.exec("COMMIT");
				return results;
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
		},
		async exec(sql) {
			db.exec(sql);
			return { count: 1, duration: 0 };
		},
		close: () => db.close(),
	};
}
