import { z } from "zod";

// Vietnam's 34 provincial-level units after the merger effective 1 July 2025. Districts were
// abolished, so an address is province → ward/commune → street.
export const provinces = [
	"Thành phố Hà Nội",
	"Thành phố Hồ Chí Minh",
	"Thành phố Hải Phòng",
	"Thành phố Đà Nẵng",
	"Thành phố Cần Thơ",
	"Thành phố Huế",
	"An Giang",
	"Bắc Ninh",
	"Cà Mau",
	"Cao Bằng",
	"Đắk Lắk",
	"Điện Biên",
	"Đồng Nai",
	"Đồng Tháp",
	"Gia Lai",
	"Hà Tĩnh",
	"Hưng Yên",
	"Khánh Hòa",
	"Lai Châu",
	"Lâm Đồng",
	"Lạng Sơn",
	"Lào Cai",
	"Nghệ An",
	"Ninh Bình",
	"Phú Thọ",
	"Quảng Ngãi",
	"Quảng Ninh",
	"Quảng Trị",
	"Sơn La",
	"Tây Ninh",
	"Thái Nguyên",
	"Thanh Hóa",
	"Tuyên Quang",
	"Vĩnh Long",
] as const;

/** Vietnamese mobile numbers: 0 or +84, a 3/5/7/8/9 network prefix and 8 digits. */
const VN_PHONE = /^(?:\+?84|0)([35789]\d{8})$/;

export function normalisePhone(input: string): string | null {
	const match = VN_PHONE.exec(input.replace(/[\s.\-()]/g, ""));
	return match ? `0${match[1]}` : null;
}

export function isValidEmail(input: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.trim());
}

// Order codes avoid look-alike characters (0/O, 1/I/L) so they can be read over the phone and
// typed as a bank-transfer memo.
export const ORDER_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Accepts "MA3K7PQ2X", "ma 3k7 pq2x" or "3K7PQ2X" and returns "MA3K7PQ2X". */
export function normaliseOrderCode(input: string): string {
	const code = input.toUpperCase().replace(/[\s.\-]/g, "");
	return code.length === 7 ? `MA${code}` : code;
}

export function isOrderCode(id: string): boolean {
	return /^MA[2-9A-HJKMNP-Z]{7}$/.test(id);
}

/**
 * Candidate order codes inside free text such as a bank-transfer description. Banks may drop or
 * insert spaces, so both forms are scanned, including overlapping matches. Callers confirm a
 * candidate against the database (and the amount), so a false candidate is harmless.
 */
export function findOrderCodes(text: string): string[] {
	const upper = text.toUpperCase();
	const found = new Set<string>();
	for (const source of [upper, upper.replace(/[\s.\-_]/g, "")]) {
		const re = /MA[2-9A-HJKMNP-Z]{7}/g;
		for (let m = re.exec(source); m; m = re.exec(source)) {
			found.add(m[0]);
			re.lastIndex = m.index + 1;
		}
	}
	return [...found].slice(0, 10);
}

export const MAX_QTY_PER_LINE = 20;

const cartItem = z.object({
	productId: z.string().min(1).max(100),
	skuId: z.string().min(1).max(100),
	quantity: z.number().int().min(1).max(99),
	price: z.number().int().nonnegative().optional(),
});

/** Where a quote ships to; shipping is priced once the province is known (HCM wards are checked against GHN's list). */
const destination = z.object({
	province: z.enum(provinces),
	ward: z.string().trim().max(100),
});

/** Language of product names in a quote or lookup answer; amounts are the same in both. */
const lang = z.enum(["vi", "en"]).optional();

export const quoteSchema = z.object({ items: z.array(cartItem).max(30), address: destination.optional(), lang });

/** The province of Ho Chi Minh City, where the shop sends from (GHN's same-province rate, and GHN parcels from /admin). */
export const HCM_PROVINCE = "Thành phố Hồ Chí Minh" satisfies (typeof provinces)[number];

export const checkoutSchema = z.object({
	items: z.array(cartItem).min(1).max(30),
	customer: z.object({
		name: z.string().trim().min(2).max(100),
		phone: z.string().trim().min(9).max(20),
		email: z.string().trim().max(200).optional(),
	}),
	address: z.object({
		province: z.enum(provinces),
		ward: z.string().trim().min(2).max(100),
		street: z.string().trim().min(3).max(200),
	}),
	note: z.string().trim().max(500).optional(),
	paymentMethod: z.enum(["cod", "vietqr"]),
	/** Shipping fee the shopper saw; only used to flag a change, never charged. */
	shippingFee: z.number().int().nonnegative().max(10_000_000).optional(),
	/** Honeypot: a field humans never see. Bots that fill it are rejected. */
	website: z.string().max(200).optional(),
	turnstileToken: z.string().max(4096).optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

/** GHN order status callback (developer.ghn.vn → Order Status Callback); other fields are ignored. */
export const ghnCallbackSchema = z.object({
	ShopID: z.number().int(),
	OrderCode: z.string().max(50),
	ClientOrderCode: z.string().max(50).nullish(),
	Type: z.string().max(50),
	Status: z.string().max(50),
	CODAmount: z.number().int().nonnegative().max(1_000_000_000),
	CODTransferDate: z.string().max(50).nullish(),
});

export const lookupSchema = z.object({
	code: z.string().trim().min(7).max(20),
	phone: z.string().trim().min(9).max(20),
	lang,
});
