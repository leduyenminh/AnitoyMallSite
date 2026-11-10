import { z } from "zod";
import { randomToken } from "./crypto";
import { withCatalogBump } from "./db";
import { getOrderForViewer } from "./orders";

// Reviews from this website's buyers. A buyer rates each product of a delivered order once (1–5
// stars and an optional comment) from the private order page; editing it sends it back for
// approval. The seller approves or hides each review in /admin; only approved ones are shown and
// counted. A review stores a masked name ("A. N."), never the buyer's name, phone or address.

export type ReviewStatus = "pending" | "approved" | "hidden";

export interface Review {
	id: string;
	orderId: string;
	productId: string;
	rating: number;
	comment: string;
	/** Masked reviewer name, e.g. "A. N." for "Nguyen Van A". */
	author: string;
	lang: "vi" | "en";
	status: ReviewStatus;
	createdAt: string;
	updatedAt: string;
}

/** What product pages show: no order id. */
export type PublicReview = Pick<Review, "id" | "rating" | "comment" | "author" | "lang" | "createdAt">;

export const MAX_COMMENT = 1000;

export const reviewSchema = z.object({
	/** The order's access token, from the order link. */
	t: z.string().min(10).max(100),
	productId: z.string().min(1).max(100),
	rating: z.number().int().min(1).max(5),
	comment: z.string().trim().max(MAX_COMMENT).default(""),
	lang: z.enum(["vi", "en"]).default("vi"),
});

/**
 * Initials of a Vietnamese name, given name first: "Nguyễn Văn An" → "A. N.", "Minh" → "M.".
 * Vietnamese names are family name first, given name last.
 */
export function reviewerName(name: string): string {
	const words = name
		.trim()
		.split(/\s+/)
		.map((w) => Array.from(w).find((ch) => /\p{L}/u.test(ch)))
		.filter((ch): ch is string => Boolean(ch))
		.map((ch) => ch.toLocaleUpperCase("vi"));
	if (!words.length) return "";
	if (words.length === 1) return `${words[0]}.`;
	return `${words.at(-1)}. ${words[0]}.`;
}

interface ReviewRow {
	id: string;
	order_id: string;
	product_id: string;
	rating: number;
	comment: string;
	author: string;
	lang: "vi" | "en";
	status: ReviewStatus;
	created_at: string;
	updated_at: string;
}

const fromRow = (r: ReviewRow): Review => ({
	id: r.id,
	orderId: r.order_id,
	productId: r.product_id,
	rating: r.rating,
	comment: r.comment,
	author: r.author,
	lang: r.lang,
	status: r.status,
	createdAt: r.created_at,
	updatedAt: r.updated_at,
});

export type SubmitResult = "saved" | "invalid" | "not_found" | "not_delivered";

/**
 * Saves the buyer's review of one product of their order. Needs the order's access token and a
 * delivered order containing the product; the same answer for a wrong order id and a wrong token.
 */
export async function submitReview(db: D1Database, orderId: string, raw: unknown, now = new Date()): Promise<SubmitResult> {
	const parsed = reviewSchema.safeParse(raw);
	if (!parsed.success) return "invalid";
	const input = parsed.data;
	const order = await getOrderForViewer(db, orderId, input.t);
	if (!order) return "not_found";
	if (order.status !== "delivered") return "not_delivered";
	if (!order.lines.some((l) => l.productId === input.productId)) return "invalid";
	const at = now.toISOString();
	const previous = await db.prepare("SELECT status FROM reviews WHERE order_id = ?1 AND product_id = ?2").bind(order.id, input.productId).first<{ status: ReviewStatus }>();
	await db
		.prepare(
			`INSERT INTO reviews (id, order_id, product_id, rating, comment, author, lang, status, created_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?8)
			 ON CONFLICT (order_id, product_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, lang = excluded.lang,
			   status = 'pending', updated_at = excluded.updated_at`,
		)
		.bind(`rv_${randomToken(12)}`, order.id, input.productId, input.rating, input.comment, reviewerName(order.customer.name), input.lang, at)
		.run();
	// An edit of a published review takes it off the product page until approved again. Bumped for
	// any edit: the seller may have approved it between the read above and the save.
	if (previous) await withCatalogBump(db, []);
	return "saved";
}

/** The buyer's own reviews on their order page (the caller has checked the access token). */
export async function reviewsForOrder(db: D1Database, orderId: string): Promise<Review[]> {
	const { results } = await db.prepare("SELECT * FROM reviews WHERE order_id = ?1").bind(orderId).all<ReviewRow>();
	return results.map(fromRow);
}

/** Approved reviews of a product, newest first. */
export async function approvedReviews(db: D1Database, productId: string, limit = 20): Promise<PublicReview[]> {
	const { results } = await db
		.prepare("SELECT id, rating, comment, author, lang, created_at FROM reviews WHERE product_id = ?1 AND status = 'approved' ORDER BY created_at DESC LIMIT ?2")
		.bind(productId, limit)
		.all<Pick<ReviewRow, "id" | "rating" | "comment" | "author" | "lang" | "created_at">>();
	return results.map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, author: r.author, lang: r.lang, createdAt: r.created_at }));
}

/** /admin: reviews to moderate (pending first), or those with one status. */
export async function listReviews(db: D1Database, status?: ReviewStatus, limit = 200): Promise<Review[]> {
	const { results } = status
		? await db.prepare("SELECT * FROM reviews WHERE status = ?1 ORDER BY updated_at DESC LIMIT ?2").bind(status, limit).all<ReviewRow>()
		: await db.prepare("SELECT * FROM reviews ORDER BY status = 'pending' DESC, updated_at DESC LIMIT ?1").bind(limit).all<ReviewRow>();
	return results.map(fromRow);
}

export async function reviewCounts(db: D1Database): Promise<Record<ReviewStatus, number>> {
	const { results } = await db.prepare("SELECT status, COUNT(*) AS n FROM reviews GROUP BY status").all<{ status: ReviewStatus; n: number }>();
	return { pending: 0, approved: 0, hidden: 0, ...Object.fromEntries(results.map((r) => [r.status, r.n])) };
}

/**
 * The seller approves or hides a review, as last seen in /admin (`seen` is its `updatedAt`): if the
 * buyer edited it meanwhile, nothing changes and the seller reads it again. Product pages (cached
 * by catalog version) follow.
 */
export async function setReviewStatus(
	db: D1Database,
	id: string,
	status: Exclude<ReviewStatus, "pending">,
	seen: string,
	now = new Date(),
): Promise<"updated" | "changed"> {
	const [res] = await withCatalogBump(db, [db.prepare("UPDATE reviews SET status = ?2, updated_at = ?3 WHERE id = ?1 AND updated_at = ?4").bind(id, status, now.toISOString(), seen)]);
	return res!.meta.changes === 1 ? "updated" : "changed";
}

