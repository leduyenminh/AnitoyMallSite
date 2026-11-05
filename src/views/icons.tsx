import type { Child } from "hono/jsx";

// Inline SVG icons (stroke = currentColor), so they follow every theme.

const paths: Record<string, Child> = {
	search: <path d="m21 21-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />,
	cart: (
		<>
			<path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 8H6" />
			<circle cx="9" cy="20" r="1.4" />
			<circle cx="17" cy="20" r="1.4" />
		</>
	),
	home: <path d="M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10" />,
	grid: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
	play: <path d="M8 5v14l11-7z" />,
	receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4" />,
	truck: <path d="M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />,
	cash: <path d="M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 10v4M18 10v4" />,
	shield: <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z M9 12l2 2 4-4" />,
	qr: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" />,
	close: <path d="M6 6l12 12M18 6 6 18" />,
	plus: <path d="M12 5v14M5 12h14" />,
	minus: <path d="M5 12h14" />,
	star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />,
	palette: <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.7 1.6-1.5 0-1-.8-1.4-.8-2.4 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3ZM7.5 11.5h.01M10 7.5h.01M15 7.5h.01" />,
	chevron: <path d="m9 6 6 6-6 6" />,
	check: <path d="m5 12 5 5 9-10" />,
	clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2" />,
	box: <path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" />,
	phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
	copy: <path d="M8 8h11v13H8zM5 16V3h11" />,
	tiktok: <path d="M14 3v11.5a3.5 3.5 0 1 1-3-3.46M14 3c.5 2.5 2.3 4.2 5 4.5" />,
	filter: <path d="M4 5h16l-6 8v5l-4 2v-7z" />,
	user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0" />,
};

export function Icon({ name, size = 20, label }: { name: keyof typeof paths | string; size?: number; label?: string }) {
	return (
		<svg
			class="icon"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden={label ? undefined : "true"}
			role={label ? "img" : undefined}
			aria-label={label}
		>
			{paths[name] ?? null}
		</svg>
	);
}
