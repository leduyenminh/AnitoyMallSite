import type { Parcel } from "./shipping";

// Shipping fees from GHN's rate card (bảng giá cước, light goods up to 5 kg, VAT included). A zone
// is a list of weight bands; past its last band, every started kilogram adds `extraPerKg`. GHN
// bills the larger of a parcel's real weight and its size weight, length × width × height (cm)
// / 5000 in kg (https://ghn.vn/blogs/thong-tin-giao-hang/cach-tinh-khoi-luong-hang-hoa).

/** Parcels up to `upTo` grams cost `fee` đồng. */
export interface RateBand {
	upTo: number;
	fee: number;
}

export interface RateCard {
	/** Inside Ho Chi Minh City, where the shop sends from (nội tỉnh). */
	local: RateBand[];
	/** Every other province (liên tỉnh). */
	other: RateBand[];
	/** Added for each started kilogram past a zone's last band. */
	extraPerKg: number;
}

/** GHN's card of 10/11/2026, used where a setting is missing or malformed. */
export const GHN_RATES: RateCard = {
	local: [{ upTo: 3000, fee: 16500 }],
	other: [
		{ upTo: 500, fee: 26000 },
		{ upTo: 1000, fee: 28000 },
		{ upTo: 2000, fee: 30000 },
		{ upTo: 3000, fee: 33000 },
		{ upTo: 4000, fee: 37000 },
		{ upTo: 5000, fee: 42000 },
	],
	extraPerKg: 7000,
};

const MAX_FEE = 5_000_000;

/** Parses "500:26000,1000:28000" (grams:đồng, weights ascending); `fallback` when malformed. */
export function parseBands(value: string | undefined, fallback: RateBand[]): RateBand[] {
	const parts = (value ?? "").split(",");
	if (parts.length > 20) return fallback;
	const bands: RateBand[] = [];
	for (const part of parts) {
		// Plain digits only: an empty fee ("3000:") must not read as 0đ.
		const m = /^\s*(\d{1,6})\s*:\s*(\d{1,7})\s*$/.exec(part);
		if (!m) return fallback;
		const upTo = Number(m[1]);
		const fee = Number(m[2]);
		if (upTo <= (bands[bands.length - 1]?.upTo ?? 0) || upTo > 100_000 || fee > MAX_FEE) return fallback;
		bands.push({ upTo, fee });
	}
	return bands;
}

/** A per-kilogram fee in whole đồng; `fallback` when malformed. */
export function parseExtraPerKg(value: string | undefined, fallback: number): number {
	const m = /^\s*(\d{1,7})\s*$/.exec(value ?? "");
	return m && Number(m[1]) <= MAX_FEE ? Number(m[1]) : fallback;
}

/** The weight GHN bills, in grams: the larger of the real weight and the size weight. */
export function billedGrams(p: Parcel): number {
	return Math.max(p.weight, Math.ceil((p.length * p.width * p.height) / 5));
}

/** The card's fee for a parcel of `grams`, inside HCM (`local`) or to another province. */
export function cardFee(card: RateCard, local: boolean, grams: number): number {
	const bands = local ? card.local : card.other;
	const band = bands.find((b) => grams <= b.upTo);
	if (band) return band.fee;
	const last = bands[bands.length - 1]!;
	return last.fee + Math.ceil((grams - last.upTo) / 1000) * card.extraPerKg;
}
