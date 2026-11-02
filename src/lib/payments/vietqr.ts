import qrcode from "qrcode-generator";

// VietQR (NAPAS 247) payload in the EMVCo merchant-presented format. Any Vietnamese banking app
// can scan it; the transfer goes straight to the configured account with the amount and the
// order code prefilled, so no intermediary ever holds the money.

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as EMVCo field 63 requires. */
export function crc16(data: string): string {
	let crc = 0xffff;
	for (let i = 0; i < data.length; i++) {
		crc ^= data.charCodeAt(i) << 8;
		for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
	}
	return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Keeps a transfer memo to what every bank accepts: ASCII letters, digits and spaces. */
export function safeMemo(memo: string): string {
	return memo
		.normalize("NFD")
		.replace(/[\u0300-\u036F]/g, "")
		.replace(/[đĐ]/g, "D")
		.replace(/[^A-Za-z0-9 ]/g, "")
		.slice(0, 25)
		.trim();
}

export function vietQrPayload(input: { bin: string; accountNo: string; amount: number; memo: string }): string {
	const account = tlv("00", "A000000727") + tlv("01", tlv("00", input.bin) + tlv("01", input.accountNo)) + tlv("02", "QRIBFTTA");
	const body =
		tlv("00", "01") +
		tlv("01", "12") + // dynamic QR: amount and memo are fixed
		tlv("38", account) +
		tlv("53", "704") + // VND
		tlv("54", String(Math.round(input.amount))) +
		tlv("58", "VN") +
		tlv("62", tlv("08", safeMemo(input.memo))) +
		"6304";
	return body + crc16(body);
}

/** QR code as an inline SVG, black on white in every theme so any banking app can scan it. */
export function qrSvg(payload: string, label: string): string {
	const qr = qrcode(0, "M");
	qr.addData(payload);
	qr.make();
	const size = qr.getModuleCount();
	const margin = 2;
	let path = "";
	for (let r = 0; r < size; r++) {
		for (let c = 0; c < size; c++) if (qr.isDark(r, c)) path += `M${c + margin} ${r + margin}h1v1h-1z`;
	}
	const full = size + margin * 2;
	const title = label.replace(/[<>&"]/g, "");
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" role="img" aria-label="${title}" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
