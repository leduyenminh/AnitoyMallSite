/** In-memory D1 stand-in for tests (see d1-sqlite.mjs). */
export function createTestD1(): D1Database & { close(): void };
