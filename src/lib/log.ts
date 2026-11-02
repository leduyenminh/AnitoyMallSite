// Structured logs for Workers Logs. Only ids, counts, statuses and amounts: never names, phone
// numbers, addresses, emails, request bodies or headers.

type Fields = Record<string, string | number | boolean | null | undefined | string[]>;

const write = (level: "info" | "warn" | "error", event: string, fields: Fields = {}) =>
	console[level === "info" ? "log" : level](JSON.stringify({ level, event, ...fields }));

export const log = {
	info: (event: string, fields?: Fields) => write("info", event, fields),
	warn: (event: string, fields?: Fields) => write("warn", event, fields),
	error: (event: string, fields?: Fields) => write("error", event, fields),
};
