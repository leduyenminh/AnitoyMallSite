// Amounts are integers in whole đồng everywhere (VND has no minor unit). Gateways with other
// units convert at their boundary (VNPay sends amount × 100).

const vnd = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });

export function formatVnd(amount: number): string {
	return vnd.format(amount);
}

/** "150K", "1,2M" – the shorthand Vietnamese shoppers use. */
export function formatShortVnd(amount: number): string {
	if (amount >= 1_000_000) return `${+(amount / 1_000_000).toFixed(1)}M`.replace(".", ",");
	if (amount >= 1000) return `${Math.round(amount / 1000)}K`;
	return `${amount}đ`;
}

export function percentOff(price: number, compareAt?: number): number | undefined {
	if (!compareAt || compareAt <= price) return undefined;
	return Math.round(((compareAt - price) / compareAt) * 100);
}

/** "199,4K" for view counts. */
export function formatCount(n: number): string {
	if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`.replace(".", ",");
	if (n >= 1000) return `${+(n / 1000).toFixed(1)}K`.replace(".", ",");
	return String(n);
}
