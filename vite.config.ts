import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [cloudflare()],
	// Appended to /assets URLs so every deploy busts browser caches (see public/_headers).
	define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
	server: { port: 5173 },
});
