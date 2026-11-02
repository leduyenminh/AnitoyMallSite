// Back office: order actions, SKU price/stock edits, product status and catalog import.
// Every call is same-origin JSON (the server rejects anything else).

const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function post(path, data) {
	const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data), credentials: "same-origin" });
	let json = null;
	try {
		json = await res.json();
	} catch {}
	return { ok: res.ok, status: res.status, data: json };
}

const confirmed = (el) => !el.dataset.confirm || window.confirm(el.dataset.confirm);

$$("[data-action]").forEach((btn) =>
	btn.addEventListener("click", async () => {
		if (!confirmed(btn)) return;
		const wrap = btn.closest("[data-order]");
		const err = document.querySelector("[data-form-error]");
		btn.disabled = true;
		const res = await post(`/api/admin/orders/${wrap.dataset.order}`, { action: btn.dataset.action, version: Number(wrap.dataset.version) });
		if (res.ok) return location.reload();
		err.textContent = res.status === 409 ? "Đơn vừa thay đổi (khách thanh toán hoặc đơn hết hạn). Tải lại trang để xem trạng thái mới." : "Không thực hiện được, thử lại.";
		err.hidden = false;
		btn.disabled = false;
	}),
);

$$("[data-save-sku]").forEach((btn) =>
	btn.addEventListener("click", async () => {
		const row = btn.closest("[data-sku-id]");
		const productId = btn.closest("[data-product-id]").dataset.productId;
		const field = (name) => row.querySelector(`[data-field="${name}"]`).value.trim();
		const compare = field("compareAtPrice");
		btn.disabled = true;
		const res = await post(`/api/admin/skus/${row.dataset.skuId}`, {
			productId,
			price: Number(field("price")),
			compareAtPrice: compare === "" ? null : Number(compare),
			stock: Number(field("stock")),
			seenStock: Number(row.dataset.seenStock),
		});
		btn.disabled = false;
		if (res.ok) {
			row.dataset.seenStock = String(res.data.stock);
			row.querySelector('[data-field="stock"]').value = String(res.data.stock);
			btn.textContent = "Đã lưu ✓";
			setTimeout(() => (btn.textContent = "Lưu"), 1500);
		} else btn.textContent = "Lỗi – thử lại";
	}),
);

$$("[data-product-status]").forEach((select) =>
	select.addEventListener("change", async () => {
		const id = select.closest("[data-product-id]").dataset.productId;
		const res = await post(`/api/admin/products/${id}`, { status: select.value });
		select.style.outline = res.ok ? "2px solid #15803d" : "2px solid #b91c1c";
	}),
);

$$("[data-import]").forEach((btn) =>
	btn.addEventListener("click", async () => {
		if (!confirmed(btn)) return;
		btn.disabled = true;
		const res = await post("/api/admin/import", { mode: btn.dataset.import });
		if (res.ok) location.reload();
		else btn.disabled = false;
	}),
);
