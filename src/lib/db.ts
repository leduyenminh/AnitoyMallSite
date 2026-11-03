import catalogFile from "../data/catalog.json";
import type { Order, Product, ProductStatus, Sku } from "./types";

// D1 access. Products keep searchable columns plus a JSON `data` blob for content; SKUs are rows
// so stock can be changed atomically (`CHECK (stock >= 0)` makes an oversell abort the whole
// batch). Orders keep the columns needed for lookups, limits and expiry plus a JSON blob.

export class OutOfStockError extends Error {}
export class DuplicateOrderError extends Error {}
export class ConflictError extends Error {}

const migrations: string[][] = [
	[
		`CREATE TABLE IF NOT EXISTS products (
			id TEXT PRIMARY KEY,
			slug TEXT NOT NULL UNIQUE,
			status TEXT NOT NULL CHECK (status IN ('active', 'draft', 'archived')),
			featured INTEGER NOT NULL DEFAULT 0,
			data TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS skus (
			id TEXT PRIMARY KEY,
			product_id TEXT NOT NULL REFERENCES products(id),
			name TEXT NOT NULL,
			price INTEGER NOT NULL CHECK (price >= 0),
			compare_at INTEGER CHECK (compare_at IS NULL OR compare_at >= 0),
			stock INTEGER NOT NULL CHECK (stock >= 0),
			position INTEGER NOT NULL DEFAULT 0,
			image TEXT,
			tiktok_sku_id TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS skus_product ON skus (product_id, position)`,
		`CREATE TABLE IF NOT EXISTS orders (
			id TEXT PRIMARY KEY,
			access_token TEXT NOT NULL,
			status TEXT NOT NULL,
			payment_method TEXT NOT NULL,
			payment_status TEXT NOT NULL,
			phone TEXT NOT NULL,
			total INTEGER NOT NULL,
			ip_hash TEXT,
			expires_at TEXT,
			version INTEGER NOT NULL,
			last_op TEXT,
			data TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS orders_expiry ON orders (expires_at) WHERE status = 'pending' AND payment_status = 'unpaid'`,
		`CREATE INDEX IF NOT EXISTS orders_phone ON orders (phone, created_at)`,
		`CREATE INDEX IF NOT EXISTS orders_ip ON orders (ip_hash, created_at)`,
		`CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at)`,
		`CREATE TABLE IF NOT EXISTS bank_transactions (
			id TEXT PRIMARY KEY,
			order_id TEXT,
			amount INTEGER NOT NULL,
			result TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`,
	],
];

let ready: Promise<void> | null = null;

/** Applies pending schema migrations and seeds the catalog on first use (once per isolate). */
export function ensureDb(db: D1Database): Promise<void> {
	ready ??= migrateDb(db).catch((error) => {
		ready = null;
		throw error;
	});
	return ready;
}

/**
 * Applies migrations in order and records the schema version. Migrations are append-only: never
 * edit one that has shipped, add a new entry instead (CLAUDE.md, stored data).
 */
export async function migrateDb(db: D1Database) {
	await db.prepare("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)").run();
	const row = await db.prepare("SELECT v FROM meta WHERE k = 'schema'").first<{ v: string }>();
	for (let version = Number(row?.v ?? 0); version < migrations.length; version++) {
		await db.batch([
			...migrations[version]!.map((sql) => db.prepare(sql)),
			db.prepare("INSERT INTO meta (k, v) VALUES ('schema', ?1) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(String(version + 1)),
		]);
	}
	const count = await db.prepare("SELECT COUNT(*) AS n FROM products").first<{ n: number }>();
	if (!count?.n) await importCatalog(db, { commerce: true });
}

// ------------------------------------------------------------------ catalog

interface CatalogFileProduct extends Omit<Product, "skus" | "createdAt" | "updatedAt"> {
	skus: Omit<Sku, "productId">[];
}

/** The catalog cloned from TikTok Shop by `npm run import`. */
export const catalogSource = catalogFile as unknown as { importedAt: string; products: CatalogFileProduct[] };

const CONTENT_KEYS = [
	"title",
	"description",
	"images",
	"collection",
	"category",
	"tags",
	"attributes",
	"tiktokProductId",
	"tiktokUrl",
	"tiktokCategory",
	"tiktokRating",
	"tiktokSold",
	"videoIds",
] as const;

function productData(p: Pick<Product, (typeof CONTENT_KEYS)[number]>) {
	return JSON.stringify(Object.fromEntries(CONTENT_KEYS.map((k) => [k, p[k]])));
}

/**
 * Upserts the catalog file. New products and SKUs are inserted as they are. Existing ones get
 * fresh content (title, photos, description…); their status, slug, price and stock stay as the
 * seller set them unless `commerce` is true, which also copies TikTok's price, list price and stock.
 */
export async function importCatalog(db: D1Database, { commerce }: { commerce: boolean }) {
	const now = new Date().toISOString();
	const statements: D1PreparedStatement[] = [];
	for (const p of catalogSource.products) {
		statements.push(
			db
				.prepare(
					`INSERT INTO products (id, slug, status, featured, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
					 ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
				)
				.bind(p.id, p.slug, p.status, p.featured, productData(p), now),
		);
		for (const s of p.skus) {
			statements.push(
				db
					.prepare(
						`INSERT INTO skus (id, product_id, name, price, compare_at, stock, position, image, tiktok_sku_id)
						 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
						 ON CONFLICT (id) DO UPDATE SET name = excluded.name, image = excluded.image, position = excluded.position${
								commerce ? ", price = excluded.price, compare_at = excluded.compare_at, stock = excluded.stock" : ""
							}`,
					)
					.bind(s.id, p.id, s.name, s.price, s.compareAtPrice ?? null, s.stock, s.position, s.image ?? null, s.tiktokSkuId ?? null),
			);
		}
	}
	statements.push(bumpCatalogVersion(db));
	await db.batch(statements);
	invalidateCatalog();
}

interface ProductRow {
	id: string;
	slug: string;
	status: ProductStatus;
	featured: number;
	data: string;
	created_at: string;
	updated_at: string;
}

interface SkuRow {
	id: string;
	product_id: string;
	name: string;
	price: number;
	compare_at: number | null;
	stock: number;
	position: number;
	image: string | null;
	tiktok_sku_id: string | null;
}

const skuFromRow = (r: SkuRow): Sku => ({
	id: r.id,
	productId: r.product_id,
	name: r.name,
	price: r.price,
	...(r.compare_at && r.compare_at > r.price ? { compareAtPrice: r.compare_at } : {}),
	stock: r.stock,
	position: r.position,
	...(r.image ? { image: r.image } : {}),
	...(r.tiktok_sku_id ? { tiktokSkuId: r.tiktok_sku_id } : {}),
});

function assemble(rows: ProductRow[], skuRows: SkuRow[]): Product[] {
	const skus = new Map<string, Sku[]>();
	for (const r of skuRows) {
		const list = skus.get(r.product_id) ?? [];
		list.push(skuFromRow(r));
		skus.set(r.product_id, list);
	}
	return rows.map((r) => ({
		...(JSON.parse(r.data) as Omit<Product, "id" | "slug" | "status" | "featured" | "skus" | "createdAt" | "updatedAt">),
		id: r.id,
		slug: r.slug,
		status: r.status,
		featured: r.featured,
		skus: (skus.get(r.id) ?? []).sort((a, b) => a.position - b.position),
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	}));
}

let catalogCache: { at: number; products: Product[] } | null = null;
const CATALOG_TTL_MS = 15_000;

export function invalidateCatalog() {
	catalogCache = null;
}

/** Every product (all statuses), cached briefly per isolate. Checkout re-reads stock uncached. */
export async function loadCatalog(db: D1Database): Promise<Product[]> {
	if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.products;
	const [products, skus] = await db.batch<ProductRow | SkuRow>([
		db.prepare("SELECT * FROM products"),
		db.prepare("SELECT * FROM skus"),
	]);
	const result = assemble(products!.results as ProductRow[], skus!.results as SkuRow[]);
	catalogCache = { at: Date.now(), products: result };
	return result;
}

/** Fresh read of the given products, for pricing a cart or placing an order. */
export async function loadProducts(db: D1Database, ids: string[]): Promise<Product[]> {
	const unique = [...new Set(ids)].slice(0, 50);
	if (!unique.length) return [];
	const marks = unique.map((_, i) => `?${i + 1}`).join(", ");
	const [products, skus] = await db.batch<ProductRow | SkuRow>([
		db.prepare(`SELECT * FROM products WHERE id IN (${marks})`).bind(...unique),
		db.prepare(`SELECT * FROM skus WHERE product_id IN (${marks})`).bind(...unique),
	]);
	return assemble(products!.results as ProductRow[], skus!.results as SkuRow[]);
}

function bumpCatalogVersion(db: D1Database) {
	return db
		.prepare("INSERT INTO meta (k, v) VALUES ('catalog_version', ?1) ON CONFLICT (k) DO UPDATE SET v = excluded.v")
		.bind(Date.now().toString(36));
}

let versionCache: { at: number; value: string } | null = null;

/** Changes whenever the seller edits the catalog; part of the edge page-cache key. */
export async function catalogVersion(db: D1Database): Promise<string> {
	if (versionCache && Date.now() - versionCache.at < 30_000) return versionCache.value;
	const row = await db.prepare("SELECT v FROM meta WHERE k = 'catalog_version'").first<{ v: string }>();
	versionCache = { at: Date.now(), value: row?.v ?? "0" };
	return versionCache.value;
}

export async function updateProduct(
	db: D1Database,
	id: string,
	patch: { status?: ProductStatus; featured?: number },
): Promise<void> {
	await db.batch([
		db
			.prepare(
				"UPDATE products SET status = COALESCE(?2, status), featured = COALESCE(?3, featured), updated_at = ?4 WHERE id = ?1",
			)
			.bind(id, patch.status ?? null, patch.featured ?? null, new Date().toISOString()),
		bumpCatalogVersion(db),
	]);
	invalidateCatalog();
	versionCache = null;
}

/**
 * Seller edits a SKU. Stock is applied as a change from the value the seller saw, so orders placed
 * meanwhile are not overwritten; it can't go below zero.
 */
export async function updateSku(
	db: D1Database,
	id: string,
	patch: { price: number; compareAtPrice: number | null; stock: number; seenStock: number },
): Promise<void> {
	try {
		await db.batch([
			db
				.prepare("UPDATE skus SET price = ?2, compare_at = ?3, stock = MAX(0, stock + (?4 - ?5)) WHERE id = ?1")
				.bind(id, patch.price, patch.compareAtPrice, patch.stock, patch.seenStock),
			bumpCatalogVersion(db),
		]);
	} finally {
		invalidateCatalog();
		versionCache = null;
	}
}

// ------------------------------------------------------------------ orders

interface OrderRow {
	id: string;
	access_token: string;
	status: Order["status"];
	payment_method: Order["paymentMethod"];
	payment_status: Order["paymentStatus"];
	phone: string;
	total: number;
	expires_at: string | null;
	version: number;
	data: string;
	created_at: string;
	updated_at: string;
}

type OrderBlob = Omit<Order, "id" | "accessToken" | "status" | "paymentMethod" | "paymentStatus" | "total" | "expiresAt" | "version" | "createdAt" | "updatedAt">;

function orderFromRow(r: OrderRow): Order {
	return {
		...(JSON.parse(r.data) as OrderBlob),
		id: r.id,
		accessToken: r.access_token,
		status: r.status,
		paymentMethod: r.payment_method,
		paymentStatus: r.payment_status,
		total: r.total,
		...(r.expires_at ? { expiresAt: r.expires_at } : {}),
		version: r.version,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	};
}

function orderBlob(o: Order): string {
	const { id, accessToken, status, paymentMethod, paymentStatus, total, expiresAt, version, createdAt, updatedAt, ...rest } = o;
	return JSON.stringify(rest satisfies OrderBlob);
}

/** Inserts the order and takes its stock in one transaction. */
export async function placeOrder(db: D1Database, order: Order, ipHash: string | null): Promise<void> {
	try {
		await db.batch([
			db
				.prepare(
					`INSERT INTO orders (id, access_token, status, payment_method, payment_status, phone, total, ip_hash, expires_at, version, data, created_at, updated_at)
					 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)`,
				)
				.bind(
					order.id,
					order.accessToken,
					order.status,
					order.paymentMethod,
					order.paymentStatus,
					order.customer.phone,
					order.total,
					ipHash,
					order.expiresAt ?? null,
					order.version,
					orderBlob(order),
					order.createdAt,
				),
			...order.lines.map((l) =>
				db.prepare("UPDATE skus SET stock = stock - ?1 WHERE id = ?2 AND product_id = ?3").bind(l.quantity, l.skuId, l.productId),
			),
		]);
	} catch (error) {
		const message = String(error);
		if (/CHECK constraint failed/i.test(message)) throw new OutOfStockError(message);
		if (/UNIQUE constraint failed: orders\.id/i.test(message)) throw new DuplicateOrderError(message);
		throw error;
	}
	invalidateCatalog();
}

export async function getOrder(db: D1Database, id: string): Promise<Order | null> {
	const row = await db.prepare("SELECT * FROM orders WHERE id = ?1").bind(id).first<OrderRow>();
	return row ? orderFromRow(row) : null;
}

/** Saves `next` only if nobody changed the order since `current` was read. */
export async function saveOrder(db: D1Database, current: Order, next: Order): Promise<Order> {
	const saved = { ...next, version: current.version + 1 };
	const result = await db
		.prepare(
			`UPDATE orders SET status = ?3, payment_status = ?4, expires_at = ?5, data = ?6, updated_at = ?7, version = ?8, last_op = NULL
			 WHERE id = ?1 AND version = ?2`,
		)
		.bind(current.id, current.version, saved.status, saved.paymentStatus, saved.expiresAt ?? null, orderBlob(saved), saved.updatedAt, saved.version)
		.run();
	if (result.meta.changes !== 1) throw new ConflictError(`Order ${current.id} changed meanwhile`);
	return saved;
}

/**
 * Cancels an order and returns its stock in one transaction. The restock statements only run
 * when this very update won (matched by a one-off operation id), so a lost race never restocks twice.
 */
export async function cancelOrder(db: D1Database, current: Order, next: Order): Promise<Order> {
	const saved = { ...next, version: current.version + 1 };
	const op = crypto.randomUUID();
	const results = await db.batch([
		db
			.prepare(
				`UPDATE orders SET status = 'cancelled', payment_status = ?3, expires_at = NULL, data = ?4, updated_at = ?5, version = ?6, last_op = ?7
				 WHERE id = ?1 AND version = ?2 AND status IN ('pending', 'confirmed')`,
			)
			.bind(current.id, current.version, saved.paymentStatus, orderBlob(saved), saved.updatedAt, saved.version, op),
		...current.lines.map((l) =>
			db
				.prepare("UPDATE skus SET stock = stock + ?1 WHERE id = ?2 AND EXISTS (SELECT 1 FROM orders WHERE id = ?3 AND last_op = ?4)")
				.bind(l.quantity, l.skuId, current.id, op),
		),
	]);
	if (results[0]?.meta.changes !== 1) throw new ConflictError(`Order ${current.id} changed meanwhile`);
	invalidateCatalog();
	return { ...saved, status: "cancelled" };
}

export async function listOrders(
	db: D1Database,
	{ status, phone, id, limit = 50, offset = 0 }: { status?: string; phone?: string; id?: string; limit?: number; offset?: number },
): Promise<Order[]> {
	const where: string[] = [];
	const params: (string | number)[] = [];
	if (status) where.push(`status = ?${params.push(status)}`);
	if (phone) where.push(`phone = ?${params.push(phone)}`);
	if (id) where.push(`id = ?${params.push(id)}`);
	const sql = `SELECT * FROM orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?${params.push(limit)} OFFSET ?${params.push(offset)}`;
	const { results } = await db.prepare(sql).bind(...params).all<OrderRow>();
	return results.map(orderFromRow);
}

export async function orderCounts(db: D1Database): Promise<Record<string, number>> {
	const { results } = await db.prepare("SELECT status, COUNT(*) AS n FROM orders GROUP BY status").all<{ status: string; n: number }>();
	return Object.fromEntries(results.map((r) => [r.status, r.n]));
}

/** Unpaid orders still waiting for confirmation whose time is up. */
export async function expiredOrders(db: D1Database, nowIso: string, limit = 50): Promise<Order[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM orders WHERE status = 'pending' AND payment_status = 'unpaid' AND expires_at IS NOT NULL AND expires_at <= ?1
			 ORDER BY expires_at LIMIT ?2`,
		)
		.bind(nowIso, limit)
		.all<OrderRow>();
	return results.map(orderFromRow);
}

/** Open orders (not yet confirmed or paid) for a phone number. */
export async function countOpenOrdersForPhone(db: D1Database, phone: string): Promise<number> {
	const row = await db
		.prepare("SELECT COUNT(*) AS n FROM orders WHERE phone = ?1 AND status = 'pending' AND payment_status = 'unpaid'")
		.bind(phone)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

export async function countRecentOrdersForIp(db: D1Database, ipHash: string, sinceIso: string): Promise<number> {
	const row = await db
		.prepare("SELECT COUNT(*) AS n FROM orders WHERE ip_hash = ?1 AND created_at >= ?2")
		.bind(ipHash, sinceIso)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

/** Records a bank transaction id once; false when it was already processed (webhook retry). */
export async function claimBankTransaction(db: D1Database, id: string, amount: number): Promise<boolean> {
	const result = await db
		.prepare("INSERT INTO bank_transactions (id, amount, result, created_at) VALUES (?1, ?2, 'received', ?3) ON CONFLICT (id) DO NOTHING")
		.bind(id, amount, new Date().toISOString())
		.run();
	return result.meta.changes === 1;
}

export async function setBankTransactionResult(db: D1Database, id: string, orderId: string | null, result: string) {
	await db.prepare("UPDATE bank_transactions SET order_id = ?2, result = ?3 WHERE id = ?1").bind(id, orderId, result).run();
}

export async function releaseBankTransaction(db: D1Database, id: string) {
	await db.prepare("DELETE FROM bank_transactions WHERE id = ?1").bind(id).run();
}
