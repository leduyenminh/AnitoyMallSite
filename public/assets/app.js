// Mall of Anitoy storefront script. Progressive enhancement over server-rendered pages:
// theme picker, cart (localStorage, priced by the server), product variants and gallery,
// TikTok click-to-play, checkout, order status polling, order lookup, Win95 Start menu.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const vnd = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const money = (n) => vnd.format(n);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
	get(key, fallback) {
		try {
			return JSON.parse(localStorage.getItem(key)) ?? fallback;
		} catch {
			return fallback;
		}
	},
	set(key, value) {
		try {
			localStorage.setItem(key, JSON.stringify(value));
		} catch {
			/* private mode: cart lives for this page only */
		}
	},
};
const body = document.body;
const shippingFee = Number(body.dataset.shippingFee || 30000);
const freeThreshold = Number(body.dataset.freeThreshold || 150000);

async function api(path, data) {
	const res = await fetch(path, {
		method: data === undefined ? "GET" : "POST",
		headers: data === undefined ? {} : { "content-type": "application/json" },
		body: data === undefined ? undefined : JSON.stringify(data),
	});
	let json = null;
	try {
		json = await res.json();
	} catch {
		/* empty body */
	}
	return { ok: res.ok, status: res.status, data: json };
}

function toast(html, ms = 3200) {
	const region = $("#toasts");
	if (!region) return;
	const el = document.createElement("div");
	el.className = "toast";
	el.innerHTML = html;
	region.append(el);
	setTimeout(() => el.remove(), ms);
}

// ------------------------------------------------------------------ theme

const THEME_KEY = "theme";
const darkQuery = matchMedia("(prefers-color-scheme: dark)");

const THEMES = ["system", "light", "dark", "win95"];

function applyTheme(pref) {
	if (!THEMES.includes(pref)) pref = "system";
	const theme = pref === "system" ? (darkQuery.matches ? "dark" : "light") : pref;
	document.documentElement.dataset.theme = theme;
	document.documentElement.dataset.themePref = pref;
	$$("[data-theme-option]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.themeOption === pref)));
}

function initTheme() {
	let pref = "system";
	try {
		pref = localStorage.getItem(THEME_KEY) || "system";
	} catch {}
	applyTheme(pref);
	darkQuery.addEventListener("change", () => {
		if ((document.documentElement.dataset.themePref || "system") === "system") applyTheme("system");
	});
	const toggle = $("[data-theme-toggle]");
	const menu = $(".theme-menu");
	if (!toggle || !menu) return;
	const close = () => {
		menu.hidden = true;
		toggle.setAttribute("aria-expanded", "false");
	};
	toggle.addEventListener("click", (e) => {
		e.stopPropagation();
		menu.hidden = !menu.hidden;
		toggle.setAttribute("aria-expanded", String(!menu.hidden));
		if (!menu.hidden) $("[aria-checked='true']", menu)?.focus();
	});
	menu.addEventListener("click", (e) => {
		const option = e.target.closest("[data-theme-option]");
		if (!option) return;
		try {
			localStorage.setItem(THEME_KEY, option.dataset.themeOption);
		} catch {}
		applyTheme(option.dataset.themeOption);
		close();
		toggle.focus();
	});
	document.addEventListener("click", (e) => {
		if (!menu.hidden && !menu.contains(e.target)) close();
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !menu.hidden) {
			close();
			toggle.focus();
		}
	});
}

// Windows 95 taskbar: Start menu and tray clock.
function initTaskbar() {
	const start = $("[data-start-toggle]");
	const menu = $("[data-start-menu]");
	if (start && menu) {
		start.addEventListener("click", (e) => {
			e.stopPropagation();
			menu.hidden = !menu.hidden;
			start.setAttribute("aria-expanded", String(!menu.hidden));
		});
		document.addEventListener("click", (e) => {
			if (!menu.hidden && !menu.contains(e.target)) {
				menu.hidden = true;
				start.setAttribute("aria-expanded", "false");
			}
		});
	}
	const clock = $("[data-clock]");
	if (clock) {
		const tick = () => (clock.textContent = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }));
		tick();
		setInterval(tick, 30_000);
	}
}

// ------------------------------------------------------------------ cart

const CART_KEY = "anitoy.cart.v1";
const cart = {
	items() {
		return store.get(CART_KEY, []).filter((i) => i && i.productId && i.skuId && i.quantity > 0);
	},
	save(items) {
		store.set(CART_KEY, items);
		document.dispatchEvent(new CustomEvent("cart:change"));
	},
	add(item, quantity = 1) {
		const items = cart.items();
		const found = items.find((i) => i.productId === item.productId && i.skuId === item.skuId);
		if (found) found.quantity = Math.min(20, found.quantity + quantity);
		else items.push({ productId: item.productId, skuId: item.skuId, quantity: Math.min(20, quantity), price: item.price });
		cart.save(items);
	},
	setQty(skuId, quantity) {
		const items = cart.items()
			.map((i) => (i.skuId === skuId ? { ...i, quantity } : i))
			.filter((i) => i.quantity > 0);
		cart.save(items);
	},
	clear() {
		cart.save([]);
	},
	count() {
		return cart.items().reduce((n, i) => n + i.quantity, 0);
	},
};
window.addEventListener("storage", (e) => e.key === CART_KEY && document.dispatchEvent(new CustomEvent("cart:change")));

function renderBadges() {
	const n = cart.count();
	$$("[data-cart-count]").forEach((b) => {
		b.textContent = n > 99 ? "99+" : String(n);
		b.hidden = n === 0;
	});
}

let quoteSeq = 0;
let lastQuote = null;
async function refreshQuote() {
	const items = cart.items();
	const seq = ++quoteSeq;
	if (!items.length) {
		lastQuote = { lines: [], itemCount: 0, subtotal: 0, shippingFee: 0, total: 0, freeShippingRemaining: freeThreshold, hasIssues: false };
	} else {
		const res = await api("/api/cart/quote", { items });
		if (seq !== quoteSeq) return lastQuote;
		if (!res.ok) {
			if (res.status === 429) toast("Bạn thao tác nhanh quá, thử lại sau ít giây nhé.");
			return lastQuote;
		}
		lastQuote = res.data;
	}
	renderQuote(lastQuote);
	return lastQuote;
}

const issueText = { unavailable: "Đã hết hàng", insufficient_stock: "Chỉ còn ít hơn số bạn chọn", price_changed: "Giá đã thay đổi" };

function lineHtml(l, editable) {
	const issue = l.issue ? `<span class="line__issue">${issueText[l.issue]}${l.issue === "insufficient_stock" ? ` (còn ${l.available})` : ""}</span>` : "";
	const controls = editable
		? `<div><span class="stepper" data-line-stepper="${esc(l.skuId)}">
				<button type="button" aria-label="Giảm" data-line-step="-1">−</button>
				<input type="number" min="0" max="20" value="${l.requested}" aria-label="Số lượng" data-line-qty>
				<button type="button" aria-label="Tăng" data-line-step="1">+</button></span>
				<button type="button" class="line__remove" data-line-remove="${esc(l.skuId)}">Xoá</button></div>`
		: `<p class="small muted">× ${l.quantity}</p>`;
	return `<li class="line">
		${l.image ? `<img src="${esc(l.image)}" width="56" height="56" alt="" loading="lazy">` : "<span></span>"}
		<div><a href="/san-pham/${esc(l.slug)}">${esc(l.title)}</a>
			<p class="small muted">${esc(l.skuName)} · ${money(l.unitPrice)}</p>${issue}${controls}</div>
		<strong>${money(l.lineTotal)}</strong></li>`;
}

function renderQuote(q) {
	renderBadges();
	const empty = `<div class="empty"><p class="muted">Giỏ hàng đang trống.</p><a class="btn btn--primary" href="/san-pham">Mua sắm ngay</a></div>`;
	$$("[data-cart-lines]").forEach((el) => {
		el.innerHTML = q.lines.length ? `<ul class="lines">${q.lines.map((l) => lineHtml(l, true)).join("")}</ul>` : empty;
	});
	$$("[data-summary-lines]").forEach((el) => {
		el.innerHTML = q.lines.length ? q.lines.map((l) => lineHtml(l, false)).join("") : empty;
	});
	$$("[data-cart-subtotal], [data-sum-subtotal]").forEach((el) => (el.textContent = money(q.subtotal)));
	$$("[data-sum-shipping]").forEach((el) => (el.textContent = q.itemCount ? (q.shippingFee ? money(q.shippingFee) : "Miễn phí") : "–"));
	$$("[data-sum-total]").forEach((el) => (el.textContent = money(q.total)));
	$$("[data-ship-meter]").forEach((el) => {
		el.hidden = !q.itemCount;
		const pct = Math.min(100, Math.round((q.subtotal / freeThreshold) * 100));
		$("[data-ship-bar]", el).style.width = `${pct}%`;
		$("[data-ship-text]", el).innerHTML =
			q.freeShippingRemaining > 0 ? `Mua thêm <strong>${money(q.freeShippingRemaining)}</strong> để được freeship` : "🎉 Đơn hàng được <strong>miễn phí vận chuyển</strong>";
	});
	$$("[data-cart-checkout]").forEach((a) => a.classList.toggle("is-disabled", !q.itemCount));
	$$("[data-quote-notice]").forEach((el) => {
		el.hidden = !q.hasIssues;
		el.textContent = q.hasIssues ? "Một số sản phẩm đã thay đổi (hết hàng, giảm số lượng hoặc đổi giá). Vui lòng kiểm tra lại giỏ hàng." : "";
	});
	const submit = $("[data-submit]");
	if (submit) {
		submit.disabled = !q.itemCount;
		submit.textContent = q.itemCount ? `Đặt hàng · ${money(q.total)}` : "Đặt hàng";
	}
}

function initCart() {
	renderBadges();
	document.addEventListener("cart:change", () => {
		renderBadges();
		if (needsQuote()) refreshQuote();
	});
	const drawer = $("#cart-drawer");
	const open = () => {
		if (!drawer) return;
		drawer.hidden = false;
		document.documentElement.style.overflow = "hidden";
		refreshQuote();
		$("[data-cart-close]", drawer.querySelector(".drawer__panel"))?.focus();
	};
	const close = () => {
		if (!drawer) return;
		drawer.hidden = true;
		document.documentElement.style.overflow = "";
	};
	document.addEventListener("click", (e) => {
		if (e.target.closest("[data-cart-open]")) {
			e.preventDefault();
			open();
		} else if (e.target.closest("[data-cart-close]")) close();

		const add = e.target.closest("[data-add-to-cart]");
		if (add) {
			const item = JSON.parse(add.dataset.addToCart);
			cart.add(item, 1);
			toast(`Đã thêm vào giỏ hàng · <a href="/gio-hang" data-cart-open>Xem giỏ</a>`);
		}
		const step = e.target.closest("[data-line-step]");
		if (step) {
			const wrap = step.closest("[data-line-stepper]");
			const input = $("[data-line-qty]", wrap);
			cart.setQty(wrap.dataset.lineStepper, Math.max(0, Math.min(20, Number(input.value) + Number(step.dataset.lineStep))));
		}
		const remove = e.target.closest("[data-line-remove]");
		if (remove) cart.setQty(remove.dataset.lineRemove, 0);
	});
	document.addEventListener("change", (e) => {
		const input = e.target.closest("[data-line-qty]");
		if (input) cart.setQty(input.closest("[data-line-stepper]").dataset.lineStepper, Math.max(0, Math.min(20, Math.floor(Number(input.value) || 0))));
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && drawer && !drawer.hidden) close();
	});
	if (needsQuote()) refreshQuote();
}

const needsQuote = () => Boolean($("[data-cart-page], [data-checkout-form]") || ($("#cart-drawer") && !$("#cart-drawer").hidden));

// ------------------------------------------------------------------ product page

function initProduct() {
	const root = $("[data-product]");
	if (!root) return;
	const product = JSON.parse(root.dataset.product);
	const qtyInput = $("[data-qty]", root);
	let sku = product.skus.find((s) => s.id === $("[data-sku-option]:checked", root)?.value) ?? product.skus.find((s) => s.stock > 0) ?? product.skus[0];

	const update = () => {
		$$("[data-price]", root).forEach((el) => (el.textContent = money(sku.price)));
		const compare = $("[data-compare]", root);
		const off = $("[data-off]", root);
		const pct = sku.compareAtPrice && sku.compareAtPrice > sku.price ? Math.round(((sku.compareAtPrice - sku.price) / sku.compareAtPrice) * 100) : 0;
		if (compare) {
			compare.hidden = !pct;
			compare.textContent = pct ? money(sku.compareAtPrice) : "";
		}
		if (off) {
			off.hidden = !pct;
			off.textContent = pct ? `-${pct}%` : "";
		}
		const stock = $("[data-stock]", root);
		if (stock) stock.textContent = sku.stock > 0 ? `Còn ${sku.stock} sản phẩm` : "Hết hàng";
		const name = $("[data-variant-name]", root);
		if (name) name.textContent = sku.name;
		$$("[data-add-current], [data-buy-now]", root).forEach((b) => (b.disabled = sku.stock <= 0));
		qtyInput.max = String(Math.max(1, Math.min(20, sku.stock)));
		if (Number(qtyInput.value) > Number(qtyInput.max)) qtyInput.value = qtyInput.max;
	};

	$$("[data-sku-option]", root).forEach((input) =>
		input.addEventListener("change", () => {
			sku = product.skus.find((s) => s.id === input.value) ?? sku;
			update();
			const url = new URL(location.href);
			url.searchParams.set("sku", sku.id);
			history.replaceState(null, "", url);
			if (sku.image) showImage(sku.image);
		}),
	);

	$$("[data-step]", root).forEach((b) =>
		b.addEventListener("click", () => {
			qtyInput.value = String(Math.max(1, Math.min(Number(qtyInput.max) || 20, Number(qtyInput.value) + Number(b.dataset.step))));
		}),
	);

	const qty = () => Math.max(1, Math.min(20, Math.floor(Number(qtyInput.value) || 1)));
	$$("[data-add-current]", root).forEach((b) =>
		b.addEventListener("click", () => {
			cart.add({ productId: product.id, skuId: sku.id, price: sku.price }, qty());
			toast(`Đã thêm <strong>${esc(sku.name)}</strong> vào giỏ · <a href="/gio-hang" data-cart-open>Xem giỏ</a>`);
		}),
	);
	$$("[data-buy-now]", root).forEach((b) =>
		b.addEventListener("click", () => {
			cart.add({ productId: product.id, skuId: sku.id, price: sku.price }, qty());
			location.href = "/thanh-toan";
		}),
	);

	// Gallery: thumbnails scroll the main track; the track's position selects the thumbnail.
	const track = $("[data-gallery-track]", root);
	const thumbs = $$("[data-gallery-thumb]", root);
	const select = (i) => thumbs.forEach((t, n) => t.setAttribute("aria-selected", String(n === i)));
	thumbs.forEach((t) =>
		t.addEventListener("click", () => {
			const i = Number(t.dataset.galleryThumb);
			track.scrollTo({ left: track.clientWidth * i, behavior: "smooth" });
			select(i);
		}),
	);
	track?.addEventListener(
		"scroll",
		() => {
			select(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)));
		},
		{ passive: true },
	);
	function showImage(src) {
		const slides = $$("[data-gallery-slide]", root);
		const i = slides.findIndex((img) => img.currentSrc.endsWith(src) || img.getAttribute("src").endsWith(src));
		if (i >= 0) {
			track.scrollTo({ left: track.clientWidth * i, behavior: "smooth" });
			select(i);
		}
	}

	// Sticky buy bar on phones once the main buttons scroll out of view.
	const bar = $("[data-buybar]", root);
	const actions = $(".buybox__actions", root);
	if (bar && actions) {
		// Shown once the buttons have scrolled up behind the sticky header.
		let queued = false;
		const check = () => {
			queued = false;
			const headerHeight = $(".site-header")?.offsetHeight ?? 0;
			bar.classList.toggle("is-visible", actions.getBoundingClientRect().bottom < headerHeight);
		};
		addEventListener(
			"scroll",
			() => {
				if (!queued) {
					queued = true;
					requestAnimationFrame(check);
				}
			},
			{ passive: true },
		);
		check();
	}
	update();
}

// ------------------------------------------------------------------ TikTok player (click to play)

function initTikTok() {
	let modal = null;
	let returnFocus = null;
	const close = () => {
		modal?.remove();
		modal = null;
		document.documentElement.style.overflow = "";
		returnFocus?.focus();
	};
	document.addEventListener("click", (e) => {
		const btn = e.target.closest("[data-tiktok-play]");
		if (!btn) return;
		const id = btn.dataset.tiktokPlay;
		if (!/^\d{10,25}$/.test(id)) return;
		returnFocus = btn;
		modal = document.createElement("div");
		modal.className = "modal";
		modal.setAttribute("role", "dialog");
		modal.setAttribute("aria-modal", "true");
		modal.setAttribute("aria-label", "Video TikTok");
		modal.innerHTML = `<div class="modal__frame">
			<button type="button" class="icon-btn modal__close" aria-label="Đóng video">✕</button>
			<iframe src="https://www.tiktok.com/player/v1/${id}?autoplay=1&description=1&music_info=1&rel=0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen title="Video TikTok"></iframe></div>`;
		modal.addEventListener("click", (ev) => {
			if (ev.target === modal || ev.target.closest(".modal__close")) close();
		});
		document.body.append(modal);
		document.documentElement.style.overflow = "hidden";
		$(".modal__close", modal).focus();
	});
	document.addEventListener("keydown", (e) => e.key === "Escape" && modal && close());
}

// ------------------------------------------------------------------ checkout

const errorText = {
	invalid: "Vui lòng kiểm tra lại các thông tin được đánh dấu.",
	quote_changed: "Giỏ hàng vừa thay đổi (hết hàng hoặc đổi giá). Đã cập nhật lại, vui lòng kiểm tra rồi đặt lại.",
	too_many_orders: "Số điện thoại hoặc mạng của bạn đang có quá nhiều đơn chưa hoàn tất. Vui lòng hoàn tất đơn trước hoặc thử lại sau.",
	verification_failed: "Xác minh chống spam chưa thành công, vui lòng thử lại.",
	rate_limited: "Bạn thao tác quá nhanh. Vui lòng đợi một phút rồi thử lại.",
	server_error: "Có lỗi xảy ra, vui lòng thử lại.",
};
const fieldMap = {
	"customer.name": "name",
	"customer.phone": "phone",
	"customer.email": "email",
	"address.province": "province",
	"address.ward": "ward",
	"address.street": "street",
	paymentMethod: "paymentMethod",
};
const FORM_KEY = "anitoy.checkout.v1";

function initCheckout() {
	const form = $("[data-checkout-form]");
	if (!form) return;
	const err = $("[data-form-error]", form);
	// Restore the shopper's details from a previous visit (stored only on this device).
	const saved = store.get(FORM_KEY, {});
	for (const [k, v] of Object.entries(saved)) {
		const el = form.elements[k];
		if (el && !el.value && typeof v === "string") el.value = v;
	}
	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		err.hidden = true;
		$$("[aria-invalid]", form).forEach((el) => el.removeAttribute("aria-invalid"));
		if (!form.reportValidity()) return;
		const f = new FormData(form);
		const get = (k) => String(f.get(k) ?? "").trim();
		const payload = {
			items: cart.items(),
			customer: { name: get("name"), phone: get("phone"), ...(get("email") ? { email: get("email") } : {}) },
			address: { province: get("province"), ward: get("ward"), street: get("street") },
			...(get("note") ? { note: get("note") } : {}),
			paymentMethod: get("paymentMethod"),
			website: get("website"),
			...(f.get("cf-turnstile-response") ? { turnstileToken: String(f.get("cf-turnstile-response")) } : {}),
		};
		if (!payload.items.length) return;
		const submit = $("[data-submit]", form);
		submit.disabled = true;
		submit.textContent = "Đang đặt hàng…";
		const res = await api("/api/orders", payload);
		if (res.ok && res.data?.url) {
			store.set(FORM_KEY, { name: get("name"), phone: get("phone"), email: get("email"), province: get("province"), ward: get("ward"), street: get("street") });
			cart.clear();
			location.href = res.data.url;
			return;
		}
		const code = res.data?.error || (res.status === 429 ? "rate_limited" : "server_error");
		if (code === "quote_changed" && res.data?.quote) {
			// Adopt what is really available, then show the shopper the corrected cart.
			cart.save(res.data.quote.lines.filter((l) => l.quantity > 0).map((l) => ({ productId: l.productId, skuId: l.skuId, quantity: l.quantity, price: l.unitPrice })));
			renderQuote(res.data.quote);
		}
		for (const field of res.data?.fields ?? []) {
			const el = form.elements[fieldMap[field]];
			if (el && el.setAttribute) el.setAttribute("aria-invalid", "true");
		}
		err.textContent = errorText[code] ?? errorText.server_error;
		err.hidden = false;
		if (window.turnstile) window.turnstile.reset();
		submit.disabled = false;
		renderQuote(lastQuote ?? (await refreshQuote()));
		err.scrollIntoView({ block: "center", behavior: "smooth" });
	});
}

// ------------------------------------------------------------------ order page

function initOrder() {
	const root = $("[data-order-id]");
	if (!root) return;
	const id = root.dataset.orderId;
	const token = new URL(location.href).searchParams.get("t");

	$$("[data-copy]", root).forEach((b) =>
		b.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(b.dataset.copy);
				toast("Đã sao chép");
			} catch {
				toast(esc(b.dataset.copy));
			}
		}),
	);

	const countdown = $("[data-countdown]", root);
	if (countdown) {
		const end = Date.parse(countdown.getAttribute("datetime"));
		const tick = () => {
			const left = Math.max(0, end - Date.now());
			const h = Math.floor(left / 3600000);
			const m = Math.floor((left % 3600000) / 60000);
			const s = Math.floor((left % 60000) / 1000);
			countdown.textContent = left ? `${h ? `${h} giờ ` : ""}${m} phút ${String(s).padStart(2, "0")} giây nữa` : "ngay bây giờ";
		};
		tick();
		setInterval(tick, 1000);
	}

	// Waiting for a transfer or the seller: refresh when the order changes.
	if (root.dataset.poll && token) {
		const version = Number(root.dataset.orderVersion);
		const started = Date.now();
		const poll = async () => {
			if (Date.now() - started > 30 * 60_000 || document.hidden) return;
			const res = await api(`/api/orders/${id}/status?t=${encodeURIComponent(token)}`);
			if (res.ok && res.data.version !== version) location.reload();
		};
		setInterval(poll, 8000);
	}
}

// ------------------------------------------------------------------ order lookup

const statusText = { pending: "Chờ xác nhận", confirmed: "Đã xác nhận", shipped: "Đang giao", delivered: "Đã giao", cancelled: "Đã huỷ", paid: "Đã thanh toán", expired: "Hết hạn" };

function initLookup() {
	const form = $("[data-lookup-form]");
	if (!form) return;
	const out = $("[data-lookup-result]");
	const err = $("[data-form-error]", form);
	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		err.hidden = true;
		const f = new FormData(form);
		const res = await api("/api/orders/lookup", { code: String(f.get("code") || ""), phone: String(f.get("phone") || "") });
		if (!res.ok) {
			out.innerHTML = "";
			err.textContent = res.status === 429 ? errorText.rate_limited : "Không tìm thấy đơn hàng với mã và số điện thoại này.";
			err.hidden = false;
			return;
		}
		const o = res.data;
		const date = (iso) => new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
		out.innerHTML = `<section class="window card-pad" style="margin-top:16px">
			<h2>Đơn <span class="mono">${esc(o.id)}</span> · <span class="status status--${esc(o.status)}">${statusText[o.status] ?? esc(o.status)}</span></h2>
			<p class="muted">${esc(o.customer.name)} · ${esc(o.customer.phone)} · ${esc(o.province)} · đặt lúc ${date(o.createdAt)}</p>
			<p>Thanh toán: <strong>${o.paymentStatus === "paid" ? "Đã thanh toán" : o.paymentMethod === "cod" ? "Trả khi nhận hàng" : "Chưa thanh toán"}</strong></p>
			<ul class="lines">${o.lines.map((l) => `<li class="line">${l.image ? `<img src="${esc(l.image)}" width="56" height="56" alt="">` : "<span></span>"}<div><a href="/san-pham/${esc(l.slug)}">${esc(l.title)}</a><p class="small muted">${esc(l.skuName)} × ${l.quantity}</p></div><strong>${money(l.lineTotal)}</strong></li>`).join("")}</ul>
			<dl class="totals" style="margin-top:12px"><dt>Phí vận chuyển</dt><dd>${o.shippingFee ? money(o.shippingFee) : "Miễn phí"}</dd><dt class="totals__grand">Tổng cộng</dt><dd class="totals__grand">${money(o.total)}</dd></dl>
			<h3 style="margin-top:14px">Lịch sử</h3><ol class="timeline">${o.history.map((h) => `<li>${date(h.at)} – ${statusText[h.status] ?? esc(h.status)}</li>`).join("")}</ol>
			<p class="small muted">Để xem địa chỉ và thanh toán lại, mở đường dẫn đơn hàng bạn nhận được khi đặt.</p></section>`;
	});
}

// ------------------------------------------------------------------ boot

initTheme();
initTaskbar();
initCart();
initProduct();
initTikTok();
initCheckout();
initOrder();
initLookup();
