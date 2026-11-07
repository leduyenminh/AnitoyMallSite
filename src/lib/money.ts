// Amounts are integers in whole đồng everywhere (VND has no minor unit). Amounts from outside
// (the SePay webhook) are converted once, where they enter (src/lib/payments/index.ts).
// English pages show the same đồng amounts with English digit grouping ("₫150,000").

import type { Lang } from "./i18n";

const vnd: Record<Lang, Intl.NumberFormat> = {
	vi: new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }),
	en: new Intl.NumberFormat("en-GB", { style: "currency", currency: "VND", maximumFractionDigits: 0 }),
};

export function formatVnd(amount: number, lang: Lang = "vi"): string {
	return vnd[lang].format(amount);
}

/** "150K", "1,2M" – the shorthand Vietnamese shoppers use; "₫150K", "₫1.2M" in English. */
export function formatShortVnd(amount: number, lang: Lang = "vi"): string {
	const sign = lang === "en" ? "₫" : "";
	if (amount >= 1_000_000) return `${sign}${decimal(amount / 1_000_000, lang)}M`;
	if (amount >= 1000) return `${sign}${Math.round(amount / 1000)}K`;
	return lang === "en" ? `₫${amount}` : `${amount}đ`;
}

export function percentOff(price: number, compareAt?: number): number | undefined {
	if (!compareAt || compareAt <= price) return undefined;
	return Math.round(((compareAt - price) / compareAt) * 100);
}

/** One decimal, comma in Vietnamese ("1,2"), point in English ("1.2"). */
const decimal = (n: number, lang: Lang) => {
	const s = String(+n.toFixed(1));
	return lang === "en" ? s : s.replace(".", ",");
};

/** "199,4K" for view counts ("199.4K" in English). */
export function formatCount(n: number, lang: Lang = "vi"): string {
	if (n >= 1_000_000) return `${decimal(n / 1_000_000, lang)}M`;
	if (n >= 1000) return `${decimal(n / 1000, lang)}K`;
	return String(n);
}
