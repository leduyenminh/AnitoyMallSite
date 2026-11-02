export interface Attribute {
	name: string;
	value: string;
}

export interface Sku {
	id: string;
	productId: string;
	name: string;
	/** Whole đồng (VND has no minor unit). */
	price: number;
	/** The listing's regular price on TikTok Shop, shown struck through. Only real prices. */
	compareAtPrice?: number;
	stock: number;
	position: number;
	image?: string;
	tiktokSkuId?: string;
}

/** draft: hidden until the seller sets a price; archived: delisted, kept for old orders. */
export type ProductStatus = "active" | "draft" | "archived";

export interface Product {
	id: string;
	slug: string;
	status: ProductStatus;
	title: string;
	/** Plain text, paragraphs separated by blank lines. Never rendered as HTML. */
	description: string;
	images: string[];
	collection: string;
	category: string;
	tags: string[];
	attributes: Attribute[];
	/** Merchandising weight; higher sorts first under "Nổi bật". */
	featured: number;
	tiktokProductId?: string;
	tiktokUrl?: string;
	tiktokCategory?: string[];
	/** Rating and units sold on TikTok Shop, shown with attribution (not as our own reviews). */
	tiktokRating?: { value: number; count: number };
	tiktokSold?: number;
	videoIds: string[];
	skus: Sku[];
	createdAt: string;
	updatedAt: string;
}

export interface Video {
	id: string;
	title: string;
	/** TikTok's view count on the snapshot date. */
	views: number;
	pinned?: boolean;
	cover: string;
	/** Derived from the video id (TikTok ids carry their creation time). */
	uploadedAt: string;
}

export type OrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
export type PaymentMethod = "cod" | "vietqr" | "momo" | "zalopay" | "card";
export type PaymentProvider = "momo" | "zalopay" | "vnpay" | "bank";
export type PaymentStatus = "unpaid" | "paid";

export interface OrderLine {
	productId: string;
	skuId: string;
	slug: string;
	title: string;
	skuName: string;
	image?: string;
	unitPrice: number;
	quantity: number;
	lineTotal: number;
}

export interface Address {
	province: string;
	ward: string;
	street: string;
}

export interface Customer {
	name: string;
	phone: string;
	email?: string;
}

export interface OrderEvent {
	status: OrderStatus | "paid" | "expired";
	at: string;
	note?: string;
}

export interface Order {
	id: string;
	/** Random secret in the order link; orders hold personal data. */
	accessToken: string;
	status: OrderStatus;
	paymentMethod: PaymentMethod;
	paymentStatus: PaymentStatus;
	customer: Customer;
	address: Address;
	note?: string;
	lines: OrderLine[];
	subtotal: number;
	shippingFee: number;
	total: number;
	payment?: {
		provider: PaymentProvider;
		ref: string;
		attempts: number;
		transactionId?: string;
		paidAt?: string;
	};
	history: OrderEvent[];
	/** Unconfirmed, unpaid orders are cancelled at this time and their stock released. */
	expiresAt?: string;
	/** Optimistic-locking counter, bumped on every write. */
	version: number;
	createdAt: string;
	updatedAt: string;
}

export interface CartItemInput {
	productId: string;
	skuId: string;
	quantity: number;
	/** Price the shopper saw; only used to flag a price change. */
	price?: number;
}
