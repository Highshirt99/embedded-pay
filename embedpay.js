(function (window, document) {
  "use strict";

  const CHECKOUT_PAGE = window.EMBEDPAY_CHECKOUT || "./checkout.html";
  const MERCHANT_NAME = window.EMBEDPAY_MERCHANT_NAME || "";
  const MERCHANT_LOGO = window.EMBEDPAY_MERCHANT_LOGO || "";

  // ─── Cart State ──────────────────────────────────────────────
  const cartState = new Map();
  let cartListeners = [];

  function cartAdd(id, unitPrice, description) {
    if (cartState.has(id)) {
      cartState.get(id).qty += 1;
    } else {
      cartState.set(id, { description, unitPrice, qty: 1 });
    }
    _notifyCart();
  }

  function cartSetQty(id, qty) {
    if (qty < 1) cartState.delete(id);
    else if (cartState.has(id)) cartState.get(id).qty = qty;
    _notifyCart();
  }

  function cartRemove(id) {
    cartState.delete(id);
    _notifyCart();
  }

  function cartClear() {
    cartState.clear();
    _notifyCart();
  }

  function cartCount() {
    let n = 0;
    cartState.forEach(item => (n += item.qty));
    return n;
  }

  function cartSnapshot() {
    return Array.from(cartState.entries()).map(([id, item]) => ({
      id,
      description: item.description,
      unitPrice: item.unitPrice,
      qty: item.qty,
      lineTotal: item.unitPrice * item.qty,
    }));
  }

  function getCartTotals(btn) {
    let subtotal = 0;
    cartState.forEach(i => (subtotal += i.unitPrice * i.qty));

    const shipping = parseFloat(btn?.dataset.shipping || 0);
    const taxPct = parseFloat(btn?.dataset.tax || 0);
    const tax =
      taxPct > 0
        ? Math.round(subtotal * (taxPct / 100) * 100) / 100
        : 0;

    return {
      subtotal,
      shipping,
      tax,
      taxPct,
      total: subtotal + shipping + tax,
    };
  }

  function _notifyCart() {
    const snapshot = cartSnapshot();

    cartListeners.forEach(fn => {
      try {
        fn(snapshot);
      } catch (e) {
        console.error("[EmbedPay cart listener error]", e);
      }
    });

    window.dispatchEvent(
      new CustomEvent("embedpay:cart:update", {
        detail: { items: snapshot, count: cartCount() },
      })
    );
  }

  // ─── Utils ───────────────────────────────────────────────────
  let _itemSeq = 0;

  function itemId(btn) {
    if (!btn._epId) btn._epId = "ep_item_" + ++_itemSeq;
    return btn._epId;
  }

  function generateRef() {
    return (
      "EP-" +
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2, 8).toUpperCase()
    );
  }

  function parseAmount(str) {
    return parseFloat((str || "0").replace(/,/g, "")) || 0;
  }

  function toSmallestUnit(naira, currency) {
    return Math.round(naira * 100);
  }

  // ─── FIXED createSession ─────────────────────────────────────
  async function createSession(payload) {
    try {
      const res = await fetch(
        "https://api.alexpay.com/v1/embed/session",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        throw new Error("Failed to create session");
      }

      return await res.json();
    } catch (err) {
      console.warn("[EmbedPay] API failed, using fallback", err);
    }

    // ─── Fallback (dev/demo mode) ───────────────────────────────
    await new Promise(r => setTimeout(r, 500));

    if (!payload.publishable_key) throw new Error("Invalid publishable key.");
    if (!payload.amount || payload.amount < 1) {
      throw new Error("Amount must be greater than zero.");
    }

    const sessionId =
      "sess_" + Math.random().toString(36).slice(2, 16);

    sessionStorage.setItem(
      "ep_session_" + sessionId,
      JSON.stringify({
        ...payload,
        totalSmallest: toSmallestUnit(
          payload.amount,
          payload.currency
        ),
      })
    );

    return { session_id: sessionId };
  }

  // ─── UI Helpers ──────────────────────────────────────────────
  function setLoading(btn, on) {
    if (on) {
      btn._epOrigHtml = btn.innerHTML;
      btn.innerHTML = "Processing...";
      btn.disabled = true;
    } else {
      btn.innerHTML = btn._epOrigHtml || "Checkout";
      btn.disabled = false;
    }
  }

  function showToast(msg) {
    alert(msg);
  }

  // ─── Bindings ────────────────────────────────────────────────
  function bindCartItem(btn) {
    btn.addEventListener("click", e => {
      e.preventDefault();

      const id = itemId(btn);
      const price = parseAmount(btn.dataset.amount);
      const desc = btn.dataset.description || "Item";

      if (!price) {
        console.warn("Missing price");
        return;
      }

      cartAdd(id, price, desc);
    });
  }

  function bindCheckout(btn) {
    btn.addEventListener("click", async e => {
      e.preventDefault();

      const isCart = btn.dataset.cartTotal === "true";
      const currency = (btn.dataset.currency || "NGN").toUpperCase();

      let subtotal, total, items;

      if (isCart) {
        if (cartState.size === 0) {
          showToast("Cart is empty");
          return;
        }

        const t = getCartTotals(btn);
        subtotal = t.subtotal;
        total = t.total;
        items = cartSnapshot();
      } else {
        subtotal = parseAmount(btn.dataset.amount);
        total = subtotal;
        items = null;
      }

      setLoading(btn, true);

      try {
        const session = await createSession({
          publishable_key: "pk_live_bc2eadc2_Q15azEuGSteqjsl-sQaXN-w9BPSEYxOe3UmdW39S_kA",
          ref: generateRef(),
          currency,
          subtotalNaira: subtotal,
          amount: total,
          cartItems: items,
          method: "mobilemoney",
          email: "test@gmail.com"
        });

        // window.location.href =
        //   CHECKOUT_PAGE + "?session=" + session.session_id;
      } catch (err) {
        showToast(err.message);
      }

      setLoading(btn, false);
    });
  }

  function mount() {
    document
      .querySelectorAll("[data-cart-item]")
      .forEach(bindCartItem);

    document
      .querySelectorAll('[data-identifier="embedded-pay-checkout"]')
      .forEach(bindCheckout);
  }

  function init() {
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", mount)
      : mount();
  }

  // ─── Public API ──────────────────────────────────────────────
  window.EmbedPay = {
    cart: {
      add: cartAdd,
      remove: cartRemove,
      clear: cartClear,
      items: cartSnapshot,
      count: cartCount,
     totals: getCartTotals,

    },
    onCartUpdate(fn) {
      cartListeners.push(fn);
    },
    refresh: mount,
  };

  init();
})(window, document);