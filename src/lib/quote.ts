import type { CartItemInput, Product } from "./types";
import { MAX_QTY_PER_LINE } from "./validation";

// Prices a cart against the authoritative catalog. The client's prices and stock are never
// trusted: `price` on an item only tells the shopper that a price changed since they added it.

export type QuoteIssue = "unavailable" | "insufficient_stock" | "price_changed";

export interface QuoteLine {
	productId: string;
	skuId: string;
	slug: string;
	title: string;
	skuName: string;
	image?: string;
	unitPrice: number;
	compareAtPrice?: number;
	requested: number;
	quantity: number;
	lineTotal: number;
	available: number;
	issue?: QuoteIssue;
}

export interface Quote {
	lines: QuoteLine[];
	itemCount: number;
	subtotal: number;
	shippingFee: number;
	total: number;
	/** Amount still needed for free shipping (0 once reached). */
	freeShippingRemaining: number;
	freeShippingThreshold: number;
	hasIssues: boolean;
}

export interface ShippingRules {
	fee: number;
	freeThreshold: number;
}

export function shippingFor(subtotal: number, rules: ShippingRules): number {
	if (subtotal <= 0 || subtotal >= rules.freeThreshold) return 0;
	return rules.fee;
}

/** Merges duplicate product/SKU entries and drops non-positive quantities. */
export function normaliseItems(items: CartItemInput[]): CartItemInput[] {
	const merged = new Map<string, CartItemInput>();
	for (const item of items) {
		const quantity = Math.floor(item.quantity);
		if (!(quantity > 0)) continue;
		const key = `${item.productId}::${item.skuId}`;
		const current = merged.get(key);
		merged.set(key, current ? { ...current, quantity: current.quantity + quantity } : { ...item, quantity });
	}
	return [...merged.values()];
}

export function buildQuote(items: CartItemInput[], products: Product[], rules: ShippingRules): Quote {
	const byId = new Map(products.map((p) => [p.id, p]));
	const lines: QuoteLine[] = normaliseItems(items).map((item) => {
		const product = byId.get(item.productId);
		const sku = product?.skus.find((s) => s.id === item.skuId);
		if (!product || !sku || product.status !== "active" || sku.price <= 0) {
			return {
				productId: item.productId,
				skuId: item.skuId,
				slug: product?.slug ?? "",
				title: product?.title ?? "",
				skuName: sku?.name ?? "",
				image: sku?.image ?? product?.images[0],
				unitPrice: sku?.price ?? item.price ?? 0,
				requested: item.quantity,
				quantity: 0,
				lineTotal: 0,
				available: 0,
				issue: "unavailable",
			};
		}
		const available = Math.max(0, sku.stock);
		const quantity = Math.min(item.quantity, MAX_QTY_PER_LINE, available);
		let issue: QuoteIssue | undefined;
		if (available === 0) issue = "unavailable";
		else if (quantity < item.quantity) issue = "insufficient_stock";
		else if (item.price !== undefined && item.price !== sku.price) issue = "price_changed";
		return {
			productId: product.id,
			skuId: sku.id,
			slug: product.slug,
			title: product.title,
			skuName: sku.name,
			image: sku.image ?? product.images[0],
			unitPrice: sku.price,
			...(sku.compareAtPrice ? { compareAtPrice: sku.compareAtPrice } : {}),
			requested: item.quantity,
			quantity,
			lineTotal: sku.price * quantity,
			available,
			...(issue ? { issue } : {}),
		};
	});

	const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
	const shippingFee = shippingFor(subtotal, rules);
	return {
		lines,
		itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
		subtotal,
		shippingFee,
		total: subtotal + shippingFee,
		freeShippingRemaining: Math.max(0, rules.freeThreshold - subtotal),
		freeShippingThreshold: rules.freeThreshold,
		hasIssues: lines.some((l) => l.issue),
	};
}
