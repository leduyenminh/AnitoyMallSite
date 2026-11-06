// Website prices from TikTok Shop prices. The shop sells here for what it keeps after TikTok's
// fees: site price = TikTok list price − TikTok's percentage fees − TikTok's fixed per-order fee,
// rounded to the nearest `rounding` đồng. Integer đồng throughout; rates are basis points.
// Applied when TikTok prices are copied into the database (importCatalog), so the stored SKU
// price stays the one price that quotes, orders, the feed and JSON-LD all use.

export interface PricingRule {
	/** TikTok's fees as a share of the price, in basis points (1% = 100). */
	feeBps: number;
	/** TikTok's fixed fee per order in đồng, taken off each unit's price. */
	fixedFee: number;
	/** Prices are rounded to the nearest multiple of this many đồng (1 = no rounding). */
	rounding: number;
}

/** No deduction: the TikTok list price as it is. */
export const NO_FEES: PricingRule = { feeBps: 0, fixedFee: 0, rounding: 1 };

/** Site price for a TikTok list price; 0 (not sellable) when there is no TikTok price. */
export function sitePrice(tiktokListPrice: number, rule: PricingRule): number {
	if (!Number.isSafeInteger(tiktokListPrice) || tiktokListPrice <= 0) return 0;
	const afterFees = Math.floor((tiktokListPrice * (10_000 - rule.feeBps)) / 10_000) - rule.fixedFee;
	if (afterFees <= 0) return 0;
	const step = rule.rounding;
	return Math.max(step, Math.round(afterFees / step) * step);
}

/** Parses the pricing settings, falling back to no deduction for anything out of range. */
export function pricingRule(feeBps: string | undefined, fixedFee: string | undefined, rounding: string | undefined): PricingRule {
	const int = (value: string | undefined, min: number, max: number, fallback: number) => {
		const n = Number((value ?? "").trim());
		return (value ?? "").trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
	};
	return {
		feeBps: int(feeBps, 0, 9_000, 0),
		fixedFee: int(fixedFee, 0, 1_000_000, 0),
		rounding: int(rounding, 1, 100_000, 1),
	};
}
