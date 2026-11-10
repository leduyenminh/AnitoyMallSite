// Mall of Anitoy storefront script. Progressive enhancement over server-rendered pages:
// theme picker, cart (localStorage, priced by the server), product variants and gallery,
// TikTok click-to-play, checkout, order status polling, order lookup, Win95 Start menu.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Pages under /en are English (<html lang="en">); everything else is Vietnamese. Strings with
// markup are static; values put into them go through esc() or money() at the call site.
const LANG = document.documentElement.lang === "en" ? "en" : "vi";
const TEXT = {
	vi: {
		locale: "vi-VN",
		paths: { cart: "/gio-hang", checkout: "/thanh-toan", products: "/san-pham", product: "/san-pham/" },
		tooFast: "Bạn thao tác nhanh quá, thử lại sau ít giây nhé.",
		issues: { unavailable: "Đã hết hàng", insufficient_stock: "Chỉ còn ít hơn số bạn chọn", price_changed: "Giá đã thay đổi" },
		left: (n) => ` (còn ${n})`,
		decrease: "Giảm",
		increase: "Tăng",
		quantity: "Số lượng",
		remove: "Xoá",
		cartEmpty: "Giỏ hàng đang trống.",
		shopNow: "Mua sắm ngay",
		shipEnterAddress: "Nhập địa chỉ để tính",
		shipAtCheckout: "Tính khi thanh toán",
		free: "Miễn phí",
		shipMore: (amount) => `Mua thêm <strong>${amount}</strong> để được freeship`,
		shipFree: "🎉 Đơn hàng được <strong>miễn phí vận chuyển</strong>",
		quoteNotice: "Một số sản phẩm đã thay đổi (hết hàng, giảm số lượng hoặc đổi giá). Vui lòng kiểm tra lại giỏ hàng.",
		placeOrder: "Đặt hàng",
		placing: "Đang đặt hàng…",
		added: "Đã thêm vào giỏ hàng",
		addedSku: (name) => `Đã thêm <strong>${name}</strong> vào giỏ`,
		viewCart: "Xem giỏ",
		inStock: (n) => `Còn ${n} sản phẩm`,
		soldOut: "Hết hàng",
		video: "Video TikTok",
		closeVideo: "Đóng video",
		errors: {
			invalid: "Vui lòng kiểm tra lại các thông tin được đánh dấu.",
			quote_changed: "Giỏ hàng hoặc phí giao hàng vừa thay đổi. Đã cập nhật lại, vui lòng kiểm tra rồi đặt lại.",
			shipping_pending: "Vui lòng chọn phường / xã trong danh sách để tính phí giao hàng.",
			too_many_orders: "Số điện thoại hoặc mạng của bạn đang có quá nhiều đơn chưa hoàn tất. Vui lòng hoàn tất đơn trước hoặc thử lại sau.",
			verification_failed: "Xác minh chống spam chưa thành công, vui lòng thử lại.",
			rate_limited: "Bạn thao tác quá nhanh. Vui lòng đợi một phút rồi thử lại.",
			server_error: "Có lỗi xảy ra, vui lòng thử lại.",
		},
		copied: "Đã sao chép",
		countdown: (h, m, s) => `${h ? `${h} giờ ` : ""}${m} phút ${s} giây nữa`,
		now: "ngay bây giờ",
		status: { pending: "Chờ xác nhận", confirmed: "Đã xác nhận", shipped: "Đang giao", delivered: "Đã giao", cancelled: "Đã huỷ", paid: "Đã thanh toán", expired: "Hết hạn" },
		lookupNotFound: "Không tìm thấy đơn hàng với mã và số điện thoại này.",
		order: "Đơn",
		placedAt: "đặt lúc",
		payment: "Thanh toán:",
		paid: "Đã thanh toán",
		payOnDelivery: "Trả khi nhận hàng",
		unpaid: "Chưa thanh toán",
		shipping: "Phí vận chuyển",
		total: "Tổng cộng",
		history: "Lịch sử",
		lookupHint: "Để xem địa chỉ và thanh toán lại, mở đường dẫn đơn hàng bạn nhận được khi đặt.",
		reviewPickStars: "Chọn số sao trước khi gửi.",
		reviewSaved: "Cảm ơn bạn! Đánh giá sẽ hiện sau khi shop duyệt.",
		reviewFailed: "Chưa gửi được đánh giá, thử lại sau.",
		reviewUpdate: "Cập nhật đánh giá",
	},
	en: {
		locale: "en-GB",
		paths: { cart: "/en/cart", checkout: "/en/checkout", products: "/en/products", product: "/en/products/" },
		tooFast: "That was a bit fast – please try again in a few seconds.",
		issues: { unavailable: "Sold out", insufficient_stock: "Fewer left than you chose", price_changed: "Price changed" },
		left: (n) => ` (${n} left)`,
		decrease: "Decrease",
		increase: "Increase",
		quantity: "Quantity",
		remove: "Remove",
		cartEmpty: "Your cart is empty.",
		shopNow: "Shop now",
		shipEnterAddress: "Enter your address to calculate",
		shipAtCheckout: "Calculated at checkout",
		free: "Free",
		shipMore: (amount) => `Add <strong>${amount}</strong> more for free shipping`,
		shipFree: "🎉 Your order ships <strong>free</strong>",
		quoteNotice: "Some items have changed (sold out, fewer left or a new price). Please check your cart.",
		placeOrder: "Place order",
		placing: "Placing your order…",
		added: "Added to your cart",
		addedSku: (name) => `Added <strong>${name}</strong> to your cart`,
		viewCart: "View cart",
		inStock: (n) => `${n} in stock`,
		soldOut: "Sold out",
		video: "TikTok video",
		closeVideo: "Close video",
		errors: {
			invalid: "Please check the highlighted fields.",
			quote_changed: "Your cart or the delivery fee has just changed. It has been updated; please check it and place the order again.",
			shipping_pending: "Please choose your ward from the list to calculate the delivery fee.",
			too_many_orders: "Your phone number or network has too many unfinished orders. Please complete those first or try again later.",
			verification_failed: "The anti-spam check didn't pass. Please try again.",
			rate_limited: "Too many attempts. Please wait a minute and try again.",
			server_error: "Something went wrong. Please try again.",
		},
		copied: "Copied",
		countdown: (h, m, s) => `${h ? `${h} h ` : ""}${m} min ${s} s from now`,
		now: "now",
		status: { pending: "Awaiting confirmation", confirmed: "Confirmed", shipped: "In transit", delivered: "Delivered", cancelled: "Cancelled", paid: "Paid", expired: "Expired" },
		lookupNotFound: "No order matches this code and phone number.",
		order: "Order",
		placedAt: "placed",
		payment: "Payment:",
		paid: "Paid",
		payOnDelivery: "Pay on delivery",
		unpaid: "Not paid yet",
		shipping: "Shipping",
		total: "Total",
		history: "History",
		lookupHint: "To see the address or pay again, open the order link you received when you ordered.",
		reviewPickStars: "Choose a number of stars first.",
		reviewSaved: "Thank you! Your review will appear once the shop approves it.",
		reviewFailed: "Your review couldn't be sent. Please try again later.",
		reviewUpdate: "Update review",
	},
};
const T = TEXT[LANG];
const vnd = new Intl.NumberFormat(T.locale, { style: "currency", currency: "VND", maximumFractionDigits: 0 });
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
		const tick = () => (clock.textContent = new Date().toLocaleTimeString(T.locale, { hour: "2-digit", minute: "2-digit" }));
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

/** On checkout, the address the shipping fee depends on (GHN prices HCM by ward). */
function quoteAddress() {
	const form = $("[data-checkout-form]");
	const province = String(form?.elements.province?.value ?? "").trim();
	if (!province) return undefined;
	return { province, ward: String(form.elements.ward?.value ?? "").trim().slice(0, 100) };
}

let quoteSeq = 0;
let lastQuote = null;
async function refreshQuote() {
	const items = cart.items();
	const seq = ++quoteSeq;
	if (!items.length) {
		lastQuote = { lines: [], itemCount: 0, subtotal: 0, shippingFee: 0, total: 0, freeShippingRemaining: freeThreshold, hasIssues: false, shippingPending: false };
	} else {
		const address = quoteAddress();
		const res = await api("/api/cart/quote", { items, ...(address ? { address } : {}), ...(LANG === "vi" ? {} : { lang: LANG }) });
		if (seq !== quoteSeq) return lastQuote;
		if (!res.ok) {
			if (res.status === 429) toast(esc(T.tooFast));
			return lastQuote;
		}
		lastQuote = res.data;
	}
	renderQuote(lastQuote);
	return lastQuote;
}

function lineHtml(l, editable) {
	const issue = l.issue ? `<span class="line__issue">${esc(T.issues[l.issue])}${l.issue === "insufficient_stock" ? esc(T.left(l.available)) : ""}</span>` : "";
	const controls = editable
		? `<div><span class="stepper" data-line-stepper="${esc(l.skuId)}">
				<button type="button" aria-label="${esc(T.decrease)}" data-line-step="-1">−</button>
				<input type="number" min="0" max="20" value="${esc(l.requested)}" aria-label="${esc(T.quantity)}" data-line-qty>
				<button type="button" aria-label="${esc(T.increase)}" data-line-step="1">+</button></span>
				<button type="button" class="line__remove" data-line-remove="${esc(l.skuId)}">${esc(T.remove)}</button></div>`
		: `<p class="small muted">× ${esc(l.quantity)}</p>`;
	return `<li class="line">
		${l.image ? `<img src="${esc(l.image)}" width="56" height="56" alt="" loading="lazy">` : "<span></span>"}
		<div><a href="${esc(T.paths.product + l.slug)}">${esc(l.title)}</a>
			<p class="small muted">${esc(l.skuName)} · ${money(l.unitPrice)}</p>${issue}${controls}</div>
		<strong>${money(l.lineTotal)}</strong></li>`;
}

function renderQuote(q) {
	renderBadges();
	const empty = `<div class="empty"><p class="muted">${esc(T.cartEmpty)}</p><a class="btn btn--primary" href="${esc(T.paths.products)}">${esc(T.shopNow)}</a></div>`;
	$$("[data-cart-lines]").forEach((el) => {
		el.innerHTML = q.lines.length ? `<ul class="lines">${q.lines.map((l) => lineHtml(l, true)).join("")}</ul>` : empty;
	});
	$$("[data-summary-lines]").forEach((el) => {
		el.innerHTML = q.lines.length ? q.lines.map((l) => lineHtml(l, false)).join("") : empty;
	});
	$$("[data-cart-subtotal], [data-sum-subtotal]").forEach((el) => (el.textContent = money(q.subtotal)));
	const shippingText = !q.itemCount
		? "–"
		: q.shippingPending
			? $("[data-checkout-form]")
				? T.shipEnterAddress
				: T.shipAtCheckout
			: q.shippingFee
				? money(q.shippingFee)
				: T.free;
	$$("[data-sum-shipping]").forEach((el) => (el.textContent = shippingText));
	$$("[data-ward-hint]").forEach((el) => (el.hidden = q.addressIssue !== "ward"));
	$$("[data-sum-total]").forEach((el) => (el.textContent = money(q.total)));
	$$("[data-ship-meter]").forEach((el) => {
		el.hidden = !q.itemCount;
		const pct = Math.min(100, Math.round((q.subtotal / freeThreshold) * 100));
		$("[data-ship-bar]", el).style.width = `${pct}%`;
		$("[data-ship-text]", el).innerHTML = q.freeShippingRemaining > 0 ? T.shipMore(money(q.freeShippingRemaining)) : T.shipFree;
	});
	$$("[data-cart-checkout]").forEach((a) => a.classList.toggle("is-disabled", !q.itemCount));
	$$("[data-quote-notice]").forEach((el) => {
		el.hidden = !q.hasIssues;
		el.textContent = q.hasIssues ? T.quoteNotice : "";
	});
	const submit = $("[data-submit]");
	if (submit) {
		submit.disabled = !q.itemCount;
		submit.textContent = q.itemCount && !q.shippingPending ? `${T.placeOrder} · ${money(q.total)}` : T.placeOrder;
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
			toast(`${esc(T.added)} · <a href="${esc(T.paths.cart)}" data-cart-open>${esc(T.viewCart)}</a>`);
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
		if (stock) stock.textContent = sku.stock > 0 ? T.inStock(sku.stock) : T.soldOut;
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
			toast(`${T.addedSku(esc(sku.name))} · <a href="${esc(T.paths.cart)}" data-cart-open>${esc(T.viewCart)}</a>`);
		}),
	);
	$$("[data-buy-now]", root).forEach((b) =>
		b.addEventListener("click", () => {
			cart.add({ productId: product.id, skuId: sku.id, price: sku.price }, qty());
			location.href = T.paths.checkout;
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
		modal.setAttribute("aria-label", T.video);
		modal.innerHTML = `<div class="modal__frame">
			<button type="button" class="icon-btn modal__close" aria-label="${esc(T.closeVideo)}">✕</button>
			<iframe src="https://www.tiktok.com/player/v1/${esc(id)}?autoplay=1&description=1&music_info=1&rel=0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen title="${esc(T.video)}"></iframe></div>`;
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

const errorText = T.errors;
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
	// Inside HCM the ward picks GHN's price: offer GHN's ward names and re-price as the address changes.
	const wardList = $("[data-ward-list]", form);
	const syncWardList = () => {
		if (!wardList) return;
		if (form.elements.province.value === wardList.dataset.wardList) form.elements.ward.setAttribute("list", wardList.id);
		else form.elements.ward.removeAttribute("list");
	};
	let wardTimer;
	form.addEventListener("change", (e) => {
		if (e.target.name === "province") syncWardList();
		if (e.target.name === "province" || e.target.name === "ward") refreshQuote();
	});
	form.addEventListener("input", (e) => {
		if (e.target.name !== "ward") return;
		clearTimeout(wardTimer);
		wardTimer = setTimeout(refreshQuote, 500);
	});
	syncWardList();
	if (quoteAddress()) refreshQuote();

	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		err.hidden = true;
		$$("[aria-invalid]", form).forEach((el) => el.removeAttribute("aria-invalid"));
		if (!form.reportValidity()) return;
		// Order only at the total the shopper is looking at: re-price, and stop if anything moved.
		const shown = lastQuote;
		const q = await refreshQuote();
		if (!q || q.shippingPending || !shown || shown.total !== q.total) {
			err.textContent = q?.shippingPending ? errorText.shipping_pending : errorText.quote_changed;
			err.hidden = false;
			if (q?.addressIssue === "ward") form.elements.ward.setAttribute("aria-invalid", "true");
			return;
		}
		const f = new FormData(form);
		const get = (k) => String(f.get(k) ?? "").trim();
		const payload = {
			items: cart.items(),
			customer: { name: get("name"), phone: get("phone"), ...(get("email") ? { email: get("email") } : {}) },
			address: { province: get("province"), ward: get("ward"), street: get("street") },
			...(get("note") ? { note: get("note") } : {}),
			paymentMethod: get("paymentMethod"),
			shippingFee: q.shippingFee,
			website: get("website"),
			...(f.get("cf-turnstile-response") ? { turnstileToken: String(f.get("cf-turnstile-response")) } : {}),
		};
		if (!payload.items.length) return;
		const submit = $("[data-submit]", form);
		submit.disabled = true;
		submit.textContent = T.placing;
		const res = await api("/api/orders", payload);
		if (res.ok && res.data?.url) {
			store.set(FORM_KEY, { name: get("name"), phone: get("phone"), email: get("email"), province: get("province"), ward: get("ward"), street: get("street") });
			cart.clear();
			// The server links the Vietnamese order page; English checkouts open the same order under /en.
			location.href = LANG === "en" ? String(res.data.url).replace(/^\/don-hang\//, "/en/orders/") : res.data.url;
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
				toast(esc(T.copied));
			} catch {
				toast(esc(b.dataset.copy));
			}
		}),
	);

	// Reviews of a delivered order (the server checks the token and the delivery).
	$$("[data-review-form]", root).forEach((form) =>
		form.addEventListener("submit", async (e) => {
			e.preventDefault();
			const err = $("[data-form-error]", form);
			const btn = $('button[type="submit"]', form);
			const data = new FormData(form);
			const rating = Number(data.get("rating"));
			if (!rating) {
				err.textContent = T.reviewPickStars;
				err.hidden = false;
				return;
			}
			btn.disabled = true;
			const res = await api(`/api/orders/${encodeURIComponent(id)}/reviews`, {
				t: token ?? "",
				productId: form.dataset.productId,
				rating,
				comment: String(data.get("comment") || "").slice(0, 1000),
				lang: LANG,
			});
			btn.disabled = false;
			if (res.ok) {
				err.hidden = true;
				btn.textContent = T.reviewUpdate;
				toast(esc(T.reviewSaved), 5000);
				return;
			}
			err.textContent = res.status === 429 ? T.tooFast : T.reviewFailed;
			err.hidden = false;
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
			countdown.textContent = left ? T.countdown(h, m, String(s).padStart(2, "0")) : T.now;
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

const statusText = T.status;

function initLookup() {
	const form = $("[data-lookup-form]");
	if (!form) return;
	const out = $("[data-lookup-result]");
	const err = $("[data-form-error]", form);
	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		err.hidden = true;
		const f = new FormData(form);
		const res = await api("/api/orders/lookup", { code: String(f.get("code") || ""), phone: String(f.get("phone") || ""), ...(LANG === "vi" ? {} : { lang: LANG }) });
		if (!res.ok) {
			out.innerHTML = "";
			err.textContent = res.status === 429 ? errorText.rate_limited : T.lookupNotFound;
			err.hidden = false;
			return;
		}
		const o = res.data;
		const date = (iso) => new Date(iso).toLocaleString(T.locale, { dateStyle: "short", timeStyle: "short" });
		const status = (s) => esc(statusText[s] ?? s);
		const payment = o.paymentStatus === "paid" ? T.paid : o.paymentMethod === "cod" ? T.payOnDelivery : T.unpaid;
		out.innerHTML = `<section class="window card-pad" style="margin-top:16px">
			<h2>${esc(T.order)} <span class="mono">${esc(o.id)}</span> · <span class="status status--${esc(o.status)}">${status(o.status)}</span></h2>
			<p class="muted">${esc(o.customer.name)} · ${esc(o.customer.phone)} · ${esc(o.province)} · ${esc(T.placedAt)} ${esc(date(o.createdAt))}</p>
			<p>${esc(T.payment)} <strong>${esc(payment)}</strong></p>
			<ul class="lines">${o.lines.map((l) => `<li class="line">${l.image ? `<img src="${esc(l.image)}" width="56" height="56" alt="">` : "<span></span>"}<div><a href="${esc(T.paths.product + l.slug)}">${esc(l.title)}</a><p class="small muted">${esc(l.skuName)} × ${esc(l.quantity)}</p></div><strong>${money(l.lineTotal)}</strong></li>`).join("")}</ul>
			<dl class="totals" style="margin-top:12px"><dt>${esc(T.shipping)}</dt><dd>${o.shippingFee ? money(o.shippingFee) : esc(T.free)}</dd><dt class="totals__grand">${esc(T.total)}</dt><dd class="totals__grand">${money(o.total)}</dd></dl>
			<h3 style="margin-top:14px">${esc(T.history)}</h3><ol class="timeline">${o.history.map((h) => `<li>${esc(date(h.at))} – ${status(h.status)}</li>`).join("")}</ol>
			<p class="small muted">${esc(T.lookupHint)}</p></section>`;
	});
}

// ------------------------------------------------------------------ language hint

/** On a Vietnamese page, a visitor whose browser doesn't ask for Vietnamese is told once about the English version. */
function initLangHint() {
	const link = $("[data-lang-switch='en']");
	if (LANG !== "vi" || !link || (navigator.languages ?? [navigator.language]).some((l) => /^vi\b/i.test(l || ""))) return;
	if (store.get("anitoy.langHint.v1", false)) return;
	store.set("anitoy.langHint.v1", true);
	toast(`<span lang="en">This shop is also in English: <a href="${esc(link.getAttribute("href"))}" hreflang="en">English version</a></span>`, 10000);
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
initLangHint();
