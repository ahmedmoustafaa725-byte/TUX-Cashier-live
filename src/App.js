import React, { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  getFirestore,
  serverTimestamp,
  Timestamp,
  collection,
  addDoc,
  updateDoc,
  getDoc,
  setDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  where,
  doc as fsDoc,
  writeBatch,
  runTransaction, // <-- atomic counter
} from "firebase/firestore";

/* --------------------------- FIREBASE CONFIG --------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyAp1F6t8zgRiJI9xOzFkKJVsCQIT9BWXno",
  authDomain: "tux-cashier-system.firebaseapp.com",
  projectId: "tux-cashier-system",
  storageBucket: "tux-cashier-system.appspot.com",
  messagingSenderId: "978379497015",
  appId: "1:978379497015:web:ea165dcb6873e0c65929b2",
};

function ensureFirebase() {
  const theApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(theApp);
  const db = getFirestore(theApp);
  return { auth, db };
}

/* --------------------------- APP SETTINGS --------------------------- */
const SHOP_ID = "tux";

const LS_KEY = "tux_pos_local_state_v1";
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
  catch { return {}; }
}
function saveLocalPartial(patch) {
  try {
    const cur = loadLocal();
    localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {}
}

function packStateForCloud(state) {
  const {
    menu,
    extraList,
    orders,
    inventory,
    nextOrderNo,
    dark,
    workers,
    paymentMethods,
    inventoryLocked,
    inventorySnapshot,
    inventoryLockedAt,
    adminPins,
    orderTypes,
    defaultDeliveryFee,
    expenses,
    dayMeta,
    bankTx,
  } = state;

  return {
    version: 1,
    updatedAt: serverTimestamp(),
    menu,
    extras: extraList,
    orders: (orders || []).map((o) => ({
      ...o,
      date: o.date ? o.date.toISOString() : null,
      restockedAt: o.restockedAt ? o.restockedAt.toISOString() : null,
    })),
    inventory,
    nextOrderNo,
    dark,
    workers,
    paymentMethods,
    inventoryLocked,
    inventorySnapshot,
    inventoryLockedAt: inventoryLockedAt
      ? new Date(inventoryLockedAt).toISOString()
      : null,
    adminPins,
    orderTypes,
    defaultDeliveryFee,
    expenses: (expenses || []).map((e) => ({
      ...e,
      date: e.date ? e.date.toISOString() : null,
    })),
    purchases: (state.purchases || []).map((p) => ({ ...p, date: p.date ? p.date.toISOString() : null })), // ⬅️ NEW
purchaseCategories: state.purchaseCategories || [],   // ⬅️ NEW
customers: state.customers || [],                     // ⬅️ NEW
deliveryZones: state.deliveryZones || [],             // ⬅️ NEW

    dayMeta: dayMeta
      ? {
          ...dayMeta,
          startedAt: dayMeta.startedAt
            ? dayMeta.startedAt.toISOString()
            : null,
          endedAt: dayMeta.endedAt ? dayMeta.endedAt.toISOString() : null,
          lastReportAt: dayMeta.lastReportAt
            ? dayMeta.lastReportAt.toISOString()
            : null,
          resetAt: dayMeta.resetAt ? dayMeta.resetAt.toISOString() : null,
          shiftChanges: Array.isArray(dayMeta.shiftChanges)
            ? dayMeta.shiftChanges.map((c) => ({
                ...c,
                at: c?.at ? new Date(c.at).toISOString() : null,
              }))
            : [],
        }
      : {},
    bankTx: (bankTx || []).map((t) => ({
      ...t,
      date: t.date ? t.date.toISOString() : null,
    })),
  };
}

function unpackStateFromCloud(data, fallbackDayMeta = {}) {
  const out = {};
  if (Array.isArray(data.orders)) {
    out.orders = data.orders.map((o) => ({
      ...o,
      date: o.date ? new Date(o.date) : new Date(),
      restockedAt: o.restockedAt ? new Date(o.restockedAt) : undefined,
    }));
  }
 if (Array.isArray(data.expenses)) {
    out.expenses = data.expenses.map((e) => ({
      ...e,
      date: e.date ? new Date(e.date) : new Date(),
    }));
  }
  if (Array.isArray(data.purchases)) {
    out.purchases = data.purchases.map((p) => ({
      ...p,
      date: p.date ? new Date(p.date) : new Date(),
    }));
  }
  if (Array.isArray(data.purchaseCategories)) out.purchaseCategories = data.purchaseCategories;
  if (Array.isArray(data.customers)) out.customers = data.customers;
  if (Array.isArray(data.deliveryZones)) out.deliveryZones = data.deliveryZones;
  if (Array.isArray(data.bankTx)) {
    out.bankTx = data.bankTx.map((t) => ({
      ...t,
      date: t.date ? new Date(t.date) : new Date(),
    }));
  }
  if (data.inventoryLockedAt) out.inventoryLockedAt = new Date(data.inventoryLockedAt);

  if (data.dayMeta) {
    out.dayMeta = {
      startedBy: data.dayMeta.startedBy || "",
      currentWorker: data.dayMeta.currentWorker || "",
      startedAt: data.dayMeta.startedAt ? new Date(data.dayMeta.startedAt) : null,
      endedAt: data.dayMeta.endedAt ? new Date(data.dayMeta.endedAt) : null,
      endedBy: data.dayMeta.endedBy || "",
      lastReportAt: data.dayMeta.lastReportAt ? new Date(data.dayMeta.lastReportAt) : null,
      resetBy: data.dayMeta.resetBy || "",
      resetAt: data.dayMeta.resetAt ? new Date(data.dayMeta.resetAt) : null,
      shiftChanges: Array.isArray(data.dayMeta.shiftChanges)
        ? data.dayMeta.shiftChanges.map((c) => ({
            ...c,
            at: c.at ? new Date(c.at) : null,
          }))
        : [],
    };
  } else {
    out.dayMeta = fallbackDayMeta;
  }

  if (data.menu) out.menu = data.menu;
  if (data.extras) out.extraList = data.extras;
  if (data.inventory) out.inventory = data.inventory;
  if (typeof data.nextOrderNo === "number") out.nextOrderNo = data.nextOrderNo;
  if (typeof data.dark === "boolean") out.dark = data.dark;
  if (Array.isArray(data.workers)) out.workers = data.workers;
  if (Array.isArray(data.paymentMethods)) out.paymentMethods = data.paymentMethods;
  if (typeof data.inventoryLocked === "boolean") out.inventoryLocked = data.inventoryLocked;
  if (Array.isArray(data.inventorySnapshot)) out.inventorySnapshot = data.inventorySnapshot;
  if (data.adminPins) out.adminPins = data.adminPins;
  if (Array.isArray(data.orderTypes)) out.orderTypes = data.orderTypes;
  if (typeof data.defaultDeliveryFee === "number")
    out.defaultDeliveryFee = data.defaultDeliveryFee;

  return out;
}

function normalizeOrderForCloud(order) {
return {
  orderNo: order.orderNo,
  worker: order.worker,
  payment: order.payment,
  paymentParts: Array.isArray(order.paymentParts)
    ? order.paymentParts.map((p) => ({ method: p.method, amount: Number(p.amount || 0) }))
    : [],
  orderType: order.orderType,
  deliveryFee: order.deliveryFee,
  deliveryName: order.deliveryName || "",
deliveryPhone: order.deliveryPhone || "",
deliveryAddress: order.deliveryAddress || "",
deliveryZoneId: order.deliveryZoneId || "",   // ⬅️ NEW

  total: order.total,
  itemsTotal: order.itemsTotal,
  cashReceived: order.cashReceived ?? null,
  changeDue: order.changeDue ?? null,
  done: !!order.done,
  voided: !!order.voided,
  voidReason: order.voidReason || "",
  note: order.note || "",
  date: order.date ? order.date.toISOString() : new Date().toISOString(),
  restockedAt: order.restockedAt ? order.restockedAt.toISOString() : null,
  cart: order.cart || [],
  idemKey: order.idemKey || "",
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
};
}

function orderFromCloudDoc(id, d) {
  const asDate = (v) =>
    v instanceof Timestamp ? v.toDate() : v ? new Date(v) : new Date();
  return {
    cloudId: id,
    orderNo: d.orderNo,
    worker: d.worker,
    payment: d.payment,
    paymentParts: Array.isArray(d.paymentParts)
  ? d.paymentParts.map((p) => ({ method: p.method, amount: Number(p.amount || 0) }))
  : [],

    orderType: d.orderType,
    deliveryFee: Number(d.deliveryFee || 0),
    deliveryName: d.deliveryName || "",
deliveryPhone: d.deliveryPhone || "",
deliveryAddress: d.deliveryAddress || "",
deliveryZoneId: d.deliveryZoneId || "",       // ⬅️ NEW

    total: Number(d.total || 0),
    itemsTotal: Number(d.itemsTotal || 0),
    cashReceived: d.cashReceived != null ? Number(d.cashReceived) : null,
    changeDue: d.changeDue != null ? Number(d.changeDue) : null,
    done: !!d.done,
    voided: !!d.voided,
    voidReason: d.voidReason || "",
    note: d.note || "",
    date: asDate(d.date || d.createdAt),
    restockedAt: d.restockedAt ? asDate(d.restockedAt) : undefined,
    cart: Array.isArray(d.cart) ? d.cart : [],
    idemKey: d.idemKey || "",
  };
}

/* ---------- De-duplicate safety (keep latest per orderNo) ---------- */
function dedupeOrders(list) {
  const byNo = new Map();
  for (const o of list || []) {
    const prev = byNo.get(o.orderNo);
    if (!prev || +new Date(o.date) > +new Date(prev.date)) byNo.set(o.orderNo, o);
  }
  return Array.from(byNo.values()).sort(
    (a, b) => +new Date(b.date) - +new Date(a.date)
  );
}

/* --------------------------- BASE DATA --------------------------- */
const BASE_MENU = [
  { id: 1, name: "Single Smashed Patty", price: 95, uses: {} },
  { id: 2, name: "Double Smashed Patty", price: 140, uses: {} },
  { id: 3, name: "Triple Smashed Patty", price: 160, uses: {} },
  { id: 4, name: "Tux Quatro Smashed Patty", price: 190, uses: {} },
  { id: 14, name: "TUXIFY Single", price: 120, uses: {} },
  { id: 15, name: "TUXIFY Double", price: 160, uses: {} },
  { id: 16, name: "TUXIFY Triple", price: 200, uses: {} },
  { id: 17, name: "TUXIFY Quatro", price: 240, uses: {} },
  { id: 5, name: "Classic Fries", price: 25, uses: {} },
  { id: 6, name: "Cheese Fries", price: 40, uses: {} },
  { id: 7, name: "Chili Fries", price: 50, uses: {} },
  { id: 8, name: "Tux Fries", price: 75, uses: {} },
  { id: 9, name: "Doppy Fries", price: 95, uses: {} },
  { id: 10, name: "Classic Hawawshi", price: 80, uses: {} },
  { id: 11, name: "Tux Hawawshi", price: 100, uses: {} },
  { id: 12, name: "Soda", price: 20, uses: {} },
  { id: 13, name: "Water", price: 10, uses: {} },
];
const BASE_EXTRAS = [
  { id: 101, name: "Extra Smashed Patty", price: 40, uses: {} },
  { id: 102, name: "Bacon", price: 20, uses: {} },
  { id: 103, name: "Cheese", price: 15, uses: {} },
  { id: 104, name: "Ranch", price: 15, uses: {} },
  { id: 105, name: "Mushroom", price: 15, uses: {} },
  { id: 106, name: "Caramelized Onion", price: 10, uses: {} },
  { id: 107, name: "Jalapeno", price: 10, uses: {} },
  { id: 108, name: "Tux Sauce", price: 10, uses: {} },
  { id: 109, name: "Extra Bun", price: 10, uses: {} },
  { id: 110, name: "Pickle", price: 5, uses: {} },
  { id: 111, name: "BBQ / Ketchup / Sweet Chili / Hot Sauce", price: 5, uses: {} },
  { id: 112, name: "Mozzarella Cheese", price: 20, uses: {} },
  { id: 113, name: "Tux Hawawshi Sauce", price: 10, uses: {} },
];
const DEFAULT_INVENTORY = [
  { id: "meat", name: "Meat", unit: "g", qty: 0, costPerUnit: 0 },       // ⬅️ NEW
  { id: "cheese", name: "Cheese", unit: "slices", qty: 0, costPerUnit: 0 }, // ⬅️ NEW
];


const BASE_WORKERS = ["Hassan", "Warda", "Ahmed"];
const DEFAULT_PAYMENT_METHODS = ["Cash", "Card", "Instapay"];
const DEFAULT_ORDER_TYPES = ["Take-Away", "Dine-in", "Delivery"];
const DEFAULT_DELIVERY_FEE = 20;
// ---- Delivery zones (editable in Settings) ----                         // ⬅️ NEW
const DEFAULT_ZONES = [
  { id: "zone-a", name: "Zone A (Nearby)", fee: 20 },
  { id: "zone-b", name: "Zone B (Medium)", fee: 30 },
  { id: "zone-c", name: "Zone C (Far)", fee: 40 },
];

// ---- Purchase categories (you can add more in Purchases tab) ----       // ⬅️ NEW
const DEFAULT_PURCHASE_CATEGORIES = [
  "Buns", "Meat", "Cheese", "Veg", "Sauces", "Packaging", "Drinks"
];

const EDITOR_PIN = "0512";
const DEFAULT_ADMIN_PINS = {
  1: "1111",
  2: "2222",
  3: "3333",
  4: "4444",
  5: "5555",
  6: "6666",
};
const norm = (v) => String(v ?? "").trim();
// Orders eligible for "Void → Expense" are any type other than dine-in or take-away
const isExpenseVoidEligible = (t) => {
  const k = norm(t).toLowerCase();
  return !!k && k !== "take-away" && k !== "take away" && k !== "dine-in" && k !== "dine in";
};


// Bulk delete helper (used at endDay)
async function purgeOrdersInCloud(db, ordersColRef, startDate, endDate) {
  try {
    const startTs = Timestamp.fromDate(startDate);
    const endTs = Timestamp.fromDate(endDate);
    const qy = query(
      ordersColRef,
      where("createdAt", ">=", startTs),
      where("createdAt", "<=", endTs)
    );
    const ss = await getDocs(qy);
    if (ss.empty) return 0;

    const docs = ss.docs;
    let removed = 0;
    for (let i = 0; i < docs.length; i += 400) {
      const chunk = docs.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const d of chunk) batch.delete(d.ref);
      await batch.commit();
      removed += chunk.length;
    }
    return removed;
  } catch (e) {
    console.warn("purgeOrdersInCloud failed:", e);
    return 0;
  }
}

/* --------------------------- COUNTER: Atomic orderNo --------------------------- */
async function allocateOrderNoAtomic(db, counterDocRef) {
  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterDocRef);
    const current = snap.exists() ? Number(snap.data().lastOrderNo || 0) : 0;
    const n = current + 1;
    tx.set(
      counterDocRef,
      { lastOrderNo: n, updatedAt: serverTimestamp() },
      { merge: true }
    );
    return n;
  });
  return next;
}

// ========= HTML thermal printing helpers (outside the component) =========
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildReceiptHTML(order, widthMm = 80) {
  const m = Math.max(0, Math.min(4, 4)); // padding mm
  const currency = (v) => `E£${Number(v || 0).toFixed(2)}`;
  const dt = new Date(order.date);
  const orderDateStr = `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`;
  const orderTimeStr = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const itemsSubtotal =
    order.itemsTotal != null
      ? Number(order.itemsTotal || 0)
      : (order.cart || []).reduce((sum, line) => {
          const base = Number(line.price || 0);
          const extrasSum = (line.extras || []).reduce(
            (s, e) => s + Number(e.price || 0),
            0
          );
          const q = Number(line.qty || 1);
          return sum + (base + extrasSum) * q;
        }, 0);

  const deliveryFee =
    order.orderType === "Delivery"
      ? Math.max(0, Number(order.deliveryFee || 0))
      : 0;

  const grandTotal =
    order.total != null ? Number(order.total || 0) : itemsSubtotal + deliveryFee;
  const paymentBreakdownHtml =
  Array.isArray(order.paymentParts) && order.paymentParts.length
    ? order.paymentParts
        .map(
          (pp) => `
      <div class="row"><div>${escHtml(pp.method)}</div><div>${currency(pp.amount)}</div></div>
    `
        )
        .join("")
    : "";


  const rowsHtml = (order.cart || [])
    .map((ci) => {
      const q = Number(ci.qty || 1);
      const base = `
        <div class="tr">
          <div class="td c-item">${escHtml(ci.name)}</div>
          <div class="td c-qty">${q}</div>
          <div class="td c-price">${currency(ci.price)}</div>
          <div class="td c-total">${currency(ci.price * q)}</div>
        </div>
      `;
      const extras = (ci.extras || [])
        .map(
          (ex) => `
          <div class="tr">
            <div class="td c-item extra">+ ${escHtml(ex.name)}</div>
            <div class="td c-qty">${q}</div>
            <div class="td c-price">${currency(ex.price)}</div>
            <div class="td c-total">${currency(ex.price * q)}</div>
          </div>
        `
        )
        .join("");
      return base + extras;
    })
    .join("");

  const noteBlock =
    order.note && String(order.note).trim()
      ? `
    <div class="note">
      <div class="label">Order Note</div>
      <div class="body">${escHtml(String(order.note).trim())}</div>
    </div>
  `
      : "";
  // NEW: Delivery customer info block (prints only for Delivery)
const deliveryInfoBlock =
  order.orderType === "Delivery"
    ? `
  <div class="cust">
    <div class="meta"><strong>Customer:</strong> ${escHtml(order.deliveryName || "")}</div>
    <div class="meta"><strong>Phone:</strong> ${escHtml(order.deliveryPhone || "")}</div>
    <div class="meta"><strong>Address:</strong> ${escHtml(order.deliveryAddress || "")}</div>
  </div>
`
    : "";


 const cashBlock = (() => {
  if (order.cashReceived == null) return "";
  return `
    <div class="row"><div>Cash Received</div><div>${currency(order.cashReceived)}</div></div>
    <div class="row"><div>Change</div><div>${currency(order.changeDue || 0)}</div></div>
  `;
})();


  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .receipt {
    width: ${widthMm}mm;
    padding: ${m}mm ${m}mm ${m/2}mm ${m}mm;
    font: 11pt/1.35 "Segoe UI", Arial, sans-serif;
    color: #000;
    background: #fff;
  }

  .brand img {
    display: block;
    margin: 0 auto 1mm;
    width: 100%;
    max-width: calc((${widthMm}mm - ${m*2}mm) * .68);
    height: auto;
    object-fit: contain;
  }

  .title { font-weight: 700; text-align: center; font-size: 13pt; margin: 1mm 0 .5mm; }
  .meta.address { text-align: center; font-size: 9pt; opacity: .9; }
  .meta { text-align: left; font-size: 9pt; opacity: .9; }

  .sep { border-top: 1px dashed #000; margin: 2mm 0; }

  .note{
    margin: 1mm 0 2mm;
    padding: 1.5mm;
    border: 1px dashed rgba(0,0,0,.6);
    border-radius: 4px;
    background: #fff;
  }
  .note .label{ font-weight:700; font-size:9pt; margin-bottom:1mm; }
  .note .body{ font-size:10pt; white-space: pre-wrap; }

  .table { display:grid; grid-auto-rows:auto; row-gap:1mm; }
  .thead, .tr {
    display:grid;
    grid-template-columns: 5fr 1fr 2fr 2.5fr; /* Item | Qty | Price | Total */
    column-gap: 2mm; align-items: end;
  }
  .thead {
    font-weight: 700; font-size: 10pt;
    border-bottom: 1px dashed #000; padding-bottom: 1mm;
  }
  .tr { border-bottom: 1px dashed rgba(0,0,0,.6); padding-bottom: 1mm; }
  .c-qty, .c-price, .c-total { text-align: right; }
  .c-item { word-break: break-word; }
  .extra { font-size: 10pt; opacity: .9; }

  .totals { display: grid; gap: 1mm; margin-top: 1mm; }
  .totals .row { display: flex; justify-content: space-between; gap: 4mm; font-weight: 600; }
  .total { font-size: 13pt; font-weight: 900; }

  .footer { margin-top: 2mm; }
  .thanks { text-align: center; font-size: 9pt; margin-bottom: 6mm; white-space: pre-line; }
  .logos { display: flex; justify-content: space-between; align-items: center; gap: 3mm; }
  .logos img { display: block; object-fit: contain; height: auto; }
  .logos img.menu { width: calc((${widthMm}mm - ${m*2}mm) * .42); }
  .logos img.delivery { width: calc((${widthMm}mm - ${m*2}mm) * .52); }

  @media screen { body { background:#f6f6f6; } .receipt { box-shadow: 0 0 6px rgba(0,0,0,.12); margin: 8px auto; } }
  @media print { .receipt { box-shadow:none; } }
</style>
</head>
<body>
  <div class="receipt">
    <div class="brand"><img src="/tuxlogo.jpg" alt="TUX logo"></div>

    <div class="title">TUX — Burger Truck</div>
    <div class="meta address">El-Saada St – Zahraa El-Maadi</div>

    <!-- Order meta -->
    <div class="meta">Order No: <strong>#${escHtml(order.orderNo)}</strong></div>
    <div class="meta">Order Date: <strong>${escHtml(orderDateStr)}</strong> • Time: <strong>${escHtml(orderTimeStr)}</strong></div>
    <div class="meta">Worker: ${escHtml(order.worker)} • Payment: ${escHtml(order.payment)} • Type: ${escHtml(order.orderType || "")}</div>

    ${noteBlock}
    ${deliveryInfoBlock}

    <div class="sep"></div>

    <div class="table">
      <div class="thead">
        <div class="th c-item">Item</div>
        <div class="th c-qty">Qty</div>
        <div class="th c-price">Price</div>
        <div class="th c-total">Total</div>
      </div>
      ${rowsHtml}
    </div>

    <div class="sep"></div>

    <div class="totals">
  <div class="row"><div>Items Subtotal</div><div>${currency(itemsSubtotal)}</div></div>
  ${deliveryFee > 0 ? `<div class="row"><div>Delivery Fee</div><div>${currency(deliveryFee)}</div></div>` : ``}
  <div class="row total"><div>TOTAL</div><div>${currency(grandTotal)}</div></div>
  ${paymentBreakdownHtml ? `<div class="row"><div style="font-weight:700">Paid by</div><div></div></div>` : ``}
  ${paymentBreakdownHtml}
  ${cashBlock}
</div>


    <div class="footer">
      <div class="thanks">Thank you for choosing TUX
See you soon</div>
      <div class="logos">
        <img class="menu" src="/menu-qr.jpg" alt="Menu QR">
        <img class="delivery" src="/delivery-logo.jpg" alt="Delivery">
      </div>
    </div>
  </div>

 
</body>
</html>
`;
}

function printReceiptHTML(order, widthMm = 80, copy = "Customer", images) {
  const html = buildReceiptHTML(order, widthMm, copy, images);

  const ifr = document.createElement("iframe");
  Object.assign(ifr.style, { position:"fixed", right:0, bottom:0, width:0, height:0, border:0 });

  let htmlWritten = false;
  ifr.addEventListener("load", () => {
    // about:blank load fires first; only print after we've written our HTML
    if (!htmlWritten) return;
    try {
      const w = ifr.contentWindow;
      if (!w) return;
      requestAnimationFrame(() => {
        w.focus();
        w.print();
        const cleanup = () => { try { ifr.remove(); } catch {} };
        w.addEventListener("afterprint", cleanup, { once: true });
        setTimeout(cleanup, 8000);
      });
    } catch {}
  });

  document.body.appendChild(ifr);
  const doc = ifr.contentDocument || ifr.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  htmlWritten = true;

  // safety cleanup
  setTimeout(() => { try { if (document.body.contains(ifr)) ifr.remove(); } catch {} }, 12000);
}



export default function App() {
  const [activeTab, setActiveTab] = useState("orders");
  const [dark, setDark] = useState(false);

  const [menu, setMenu] = useState(BASE_MENU);
  const [extraList, setExtraList] = useState(BASE_EXTRAS);

  const [workers, setWorkers] = useState(BASE_WORKERS);
  const [newWorker, setNewWorker] = useState("");
  const [paymentMethods, setPaymentMethods] = useState(DEFAULT_PAYMENT_METHODS);
  const [newPayment, setNewPayment] = useState("");

  const [orderTypes, setOrderTypes] = useState(DEFAULT_ORDER_TYPES);
  const [defaultDeliveryFee, setDefaultDeliveryFee] = useState(DEFAULT_DELIVERY_FEE);

  const [selectedBurger, setSelectedBurger] = useState(null);
  const [selectedExtras, setSelectedExtras] = useState([]);
  const [selectedQty, setSelectedQty] = useState(1);
  const [cart, setCart] = useState([]);

  const [worker, setWorker] = useState("");
  const [payment, setPayment] = useState("");
  // Split payment support
const [splitPay, setSplitPay] = useState(false);
const [payA, setPayA] = useState("");
const [payB, setPayB] = useState("");
const [amtA, setAmtA] = useState(0);
const [amtB, setAmtB] = useState(0);
const [cashReceivedSplit, setCashReceivedSplit] = useState(0);
const [newOrderType, setNewOrderType] = useState("");
const [orderNote, setOrderNote] = useState("");
const [orderType, setOrderType] = useState(orderTypes[0] || "Take-Away");
const [deliveryFee, setDeliveryFee] = useState(0);
  // Delivery customer details (per-order, not persisted globally)
const [deliveryName, setDeliveryName] = useState("");
const [deliveryPhone, setDeliveryPhone] = useState("");
const [deliveryAddress, setDeliveryAddress] = useState("");
  // ───── Purchases & Zones state ─────                                     // ⬅️ NEW
const [purchaseCategories, setPurchaseCategories] = useState(
  DEFAULT_PURCHASE_CATEGORIES.map((name, i) => ({ id: `cat_${i+1}`, name }))
);
const [purchases, setPurchases] = useState([]); // {id, categoryId, ingredientId?, itemName, unit, qty, unitPrice, date: Date}
const [purchaseFilter, setPurchaseFilter] = useState("day"); // 'day' | 'month' | 'year'
const [purchaseCatFilterId, setPurchaseCatFilterId] = useState("");
const [newPurchase, setNewPurchase] = useState({
  categoryId: "",
  itemName: "",
  unit: "pcs",
  qty: 1,
  unitPrice: 0,
  date: new Date().toISOString().slice(0,10),
});
  
const [deliveryZoneId, setDeliveryZoneId] = useState("");               // ⬅️ NEW
const [customers, setCustomers] = useState([]);                         // {phone,name,address,zoneId}
const [deliveryZones, setDeliveryZones] = useState(DEFAULT_ZONES);      // ⬅️ NEW
const [newCategoryName, setNewCategoryName] = useState("");



const [cashReceived, setCashReceived] = useState(0);
const [inventory, setInventory] = useState(DEFAULT_INVENTORY);
const [newInvName, setNewInvName] = useState("");
const [newInvUnit, setNewInvUnit] = useState("");
const [newInvQty, setNewInvQty] = useState(0);
const [inventoryLocked, setInventoryLocked] = useState(false);
const [inventorySnapshot, setInventorySnapshot] = useState([]);
const [inventoryLockedAt, setInventoryLockedAt] = useState(null);

  const [adminPins, setAdminPins] = useState({ ...DEFAULT_ADMIN_PINS });
  const [unlockedPins, setUnlockedPins] = useState({}); // {1:true, 2:false, ...}
  const verifyAdminPin = (n) => {
  const entered = window.prompt(`Enter PIN for Admin ${n}:`, "");
  if (entered == null) return false;
  if (norm(entered) !== norm(adminPins[n] || "")) {
    alert("Invalid PIN.");
    return false;
  }
  return true;
};

const unlockAdminPin = (n) => {
  if (!verifyAdminPin(n)) return;
  setUnlockedPins((u) => ({ ...u, [n]: true }));
};

const lockAdminPin = (n) => {
  setUnlockedPins((u) => ({ ...u, [n]: false }));
};

  const [pricesUnlocked, setPricesUnlocked] = useState(false);

  const [orders, setOrders] = useState([]);
  const [nextOrderNo, setNextOrderNo] = useState(1);

  const [expenses, setExpenses] = useState([]);
  const [newExpName, setNewExpName] = useState("");
  const [newExpUnit, setNewExpUnit] = useState("pcs");
  const [newExpQty, setNewExpQty] = useState(1);
  const [newExpUnitPrice, setNewExpUnitPrice] = useState(0);
  const [newExpNote, setNewExpNote] = useState("");

  const [bankUnlocked, setBankUnlocked] = useState(false);
  const [purchasesUnlocked, setPurchasesUnlocked] = useState(false);

  const [bankTx, setBankTx] = useState([]);
  const [bankForm, setBankForm] = useState({
    type: "deposit",
    amount: 0,
    worker: "",
    note: "",
  });

  const [dayMeta, setDayMeta] = useState({
    startedBy: "",
    currentWorker: "",
    startedAt: null,
    endedAt: null,
    endedBy: "",
    lastReportAt: null,
    resetBy: "",
    resetAt: null,
    shiftChanges: [],
  });

  const sortBy = "date-desc";

  const [nowStr, setNowStr] = useState(new Date().toLocaleString());
  useEffect(() => {
    const t = setInterval(() => setNowStr(new Date().toLocaleString()), 1000);
    return () => clearInterval(t);
  }, []);

  const [newMenuName, setNewMenuName] = useState("");
  const [newMenuPrice, setNewMenuPrice] = useState(0);
  const [newExtraName, setNewExtraName] = useState("");
  const [newExtraPrice, setNewExtraPrice] = useState(0);

  const [localHydrated, setLocalHydrated] = useState(false);
const [lastLocalEditAt, setLastLocalEditAt] = useState(0);

  /* --------------------------- FIREBASE STATE --------------------------- */
  const [fbReady, setFbReady] = useState(false);
  const [fbUser, setFbUser] = useState(null);
  const [cloudEnabled, setCloudEnabled] = useState(true);
  const [realtimeOrders, setRealtimeOrders] = useState(true);
  const [cloudStatus, setCloudStatus] = useState({
    lastSaveAt: null,
    lastLoadAt: null,
    error: null,
  });
  const [hydrated, setHydrated] = useState(false);
  const [lastAppliedCloudAt, setLastAppliedCloudAt] = useState(0);


  // Printing preferences (kept)
  const [autoPrintOnCheckout, setAutoPrintOnCheckout] = useState(true);
  const [preferredPaperWidthMm, setPreferredPaperWidthMm] = useState(80);

  useEffect(() => {
    try {
      const { auth } = ensureFirebase();
      setFbReady(true);
      const unsub = onAuthStateChanged(auth, async (u) => {
        if (!u) {
          try {
            await signInAnonymously(auth);
          } catch (e) {
            setCloudStatus((s) => ({ ...s, error: String(e) }));
          }
        } else {
          setFbUser(u);
        }
      });
      return () => unsub();
    } catch (e) {
      setCloudStatus((s) => ({ ...s, error: String(e) }));
    }
  }, []);

  /* === ADD BELOW THIS LINE (hydrate from local) === */
useEffect(() => {
  if (localHydrated) return;
  const l = loadLocal();
  if (l.menu) setMenu(l.menu);
  if (l.extraList) setExtraList(l.extraList);
  if (l.workers) setWorkers(l.workers);
  if (l.paymentMethods) setPaymentMethods(l.paymentMethods);
  if (l.orderTypes) setOrderTypes(l.orderTypes);
  if (typeof l.defaultDeliveryFee === "number") setDefaultDeliveryFee(l.defaultDeliveryFee);
  if (l.inventory) setInventory(l.inventory);
  if (l.adminPins) setAdminPins((prev) => ({ ...prev, ...l.adminPins }));
  if (typeof l.dark === "boolean") setDark(l.dark);
   /* === ADD BELOW THIS LINE (other tabs & settings) === */
  if (Array.isArray(l.expenses)) setExpenses(l.expenses);
  if (Array.isArray(l.purchaseCategories)) setPurchaseCategories(l.purchaseCategories); // ⬅️ NEW
if (Array.isArray(l.purchases)) setPurchases(
  l.purchases.map(p => ({ ...p, date: p.date ? new Date(p.date) : new Date() }))
); // ⬅️ NEW
if (typeof l.purchaseFilter === "string") setPurchaseFilter(l.purchaseFilter); // ⬅️ NEW
if (Array.isArray(l.customers)) setCustomers(l.customers);           // ⬅️ NEW
if (Array.isArray(l.deliveryZones)) setDeliveryZones(l.deliveryZones); // ⬅️ NEW

  if (Array.isArray(l.bankTx)) setBankTx(l.bankTx);
  if (l.dayMeta) setDayMeta(l.dayMeta);
  if (typeof l.inventoryLocked === "boolean") setInventoryLocked(l.inventoryLocked);
  if (Array.isArray(l.inventorySnapshot)) setInventorySnapshot(l.inventorySnapshot);
  if (l.inventoryLockedAt) setInventoryLockedAt(new Date(l.inventoryLockedAt));
  if (typeof l.autoPrintOnCheckout === "boolean") setAutoPrintOnCheckout(l.autoPrintOnCheckout);
  if (typeof l.preferredPaperWidthMm === "number") setPreferredPaperWidthMm(l.preferredPaperWidthMm);
  if (typeof l.cloudEnabled === "boolean") setCloudEnabled(l.cloudEnabled);
  if (typeof l.realtimeOrders === "boolean") setRealtimeOrders(l.realtimeOrders);
  if (typeof l.nextOrderNo === "number") setNextOrderNo(l.nextOrderNo);

  // If you run with realtimeOrders = false and want orders to survive refresh:
  if (Array.isArray(l.orders)) {
    setOrders(
      l.orders.map((o) => ({
        ...o,
        date: o.date ? new Date(o.date) : new Date(),
        restockedAt: o.restockedAt ? new Date(o.restockedAt) : undefined,
      }))
    );
  }
  /* === END ADD === */
  setLocalHydrated(true);
}, [localHydrated]);
/* === END ADD === */
/* === MIRROR TO LOCAL (all tabs & settings) === */
useEffect(() => { saveLocalPartial({ menu }); }, [menu]);
  useEffect(() => {
  saveLocalPartial({
    purchases: purchases.map(p => ({ ...p, date: p.date ? new Date(p.date).toISOString() : null }))
  });
}, [purchases]); // ⬅️ NEW
  

useEffect(() => { saveLocalPartial({ purchaseCategories }); }, [purchaseCategories]); // ⬅️ NEW
useEffect(() => { saveLocalPartial({ purchaseFilter }); }, [purchaseFilter]);        // ⬅️ NEW
useEffect(() => { saveLocalPartial({ customers }); }, [customers]);                  // ⬅️ NEW
useEffect(() => { saveLocalPartial({ deliveryZones }); }, [deliveryZones]);          // ⬅️ NEW

useEffect(() => { saveLocalPartial({ extraList }); }, [extraList]);
useEffect(() => { saveLocalPartial({ workers }); }, [workers]);
useEffect(() => { saveLocalPartial({ paymentMethods }); }, [paymentMethods]);
useEffect(() => { saveLocalPartial({ orderTypes }); }, [orderTypes]);
useEffect(() => { saveLocalPartial({ defaultDeliveryFee }); }, [defaultDeliveryFee]);
useEffect(() => { saveLocalPartial({ inventory }); }, [inventory]);
useEffect(() => { saveLocalPartial({ adminPins }); }, [adminPins]);
useEffect(() => { saveLocalPartial({ dark }); }, [dark]);
  // Auto-fill delivery name/address/zone by saved phone                  // ⬅️ NEW
useEffect(() => {
  if (orderType !== "Delivery") return;
  const p = String(deliveryPhone || "").trim();
  if (p.length !== 11) return;
  const found = customers.find(c => c.phone === p);
  if (found) {
    if (!deliveryName) setDeliveryName(found.name || "");
    if (!deliveryAddress) setDeliveryAddress(found.address || "");
    if (!deliveryZoneId && found.zoneId) {
      setDeliveryZoneId(found.zoneId);
      const z = deliveryZones.find(z => z.id === found.zoneId);
      if (z) setDeliveryFee(Number(z.fee || 0));
    }
  }
}, [orderType, deliveryPhone, customers, deliveryZones, deliveryName, deliveryAddress, deliveryZoneId]);

  // === OPTIONAL: auto-select first category in add form if none selected
useEffect(() => {
  if (!newPurchase.categoryId && purchaseCategories.length) {
    setNewPurchase(p => ({ ...p, categoryId: purchaseCategories[0].id }));
  }
}, [newPurchase.categoryId, purchaseCategories]);



/* === ADD BELOW THIS LINE (mirror other tabs & settings) === */
useEffect(() => { saveLocalPartial({ expenses }); }, [expenses]);
useEffect(() => { saveLocalPartial({ bankTx }); }, [bankTx]);
useEffect(() => { saveLocalPartial({ dayMeta }); }, [dayMeta]);
useEffect(() => { saveLocalPartial({ inventoryLocked }); }, [inventoryLocked]);
useEffect(() => { saveLocalPartial({ inventorySnapshot }); }, [inventorySnapshot]);
useEffect(() => { saveLocalPartial({ inventoryLockedAt }); }, [inventoryLockedAt]);
useEffect(() => { saveLocalPartial({ autoPrintOnCheckout }); }, [autoPrintOnCheckout]);
useEffect(() => { saveLocalPartial({ preferredPaperWidthMm }); }, [preferredPaperWidthMm]);
useEffect(() => { saveLocalPartial({ cloudEnabled }); }, [cloudEnabled]);
useEffect(() => { saveLocalPartial({ realtimeOrders }); }, [realtimeOrders]);
useEffect(() => { saveLocalPartial({ nextOrderNo }); }, [nextOrderNo]);

// Optional: persist orders when NOT using realtime board
useEffect(() => {
  if (!realtimeOrders) saveLocalPartial({ orders });
}, [orders, realtimeOrders]);
/* === END MIRROR === */

  /* === ADD BELOW THIS LINE (timestamp local edits) === */

  
/* === TIMESTAMP LOCAL EDITS (expanded deps) === */
useEffect(() => {
  setLastLocalEditAt(Date.now());
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [
  menu, extraList, workers, paymentMethods, orderTypes, defaultDeliveryFee,
  inventory, adminPins, dark,
  // added:
  expenses, bankTx, dayMeta, inventoryLocked, inventorySnapshot, inventoryLockedAt,
  autoPrintOnCheckout, preferredPaperWidthMm, cloudEnabled, realtimeOrders, nextOrderNo
  // (intentionally NOT including `orders`; realtime listener drives those)
]);

useEffect(() => {
  if (!orderTypes.includes(orderType)) {
    const def = orderTypes[0] || "";
    setOrderType(def);
    setDeliveryFee(def === "Delivery" ? (deliveryFee || defaultDeliveryFee) : 0);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [orderTypes]);





  const db = useMemo(() => (fbReady ? ensureFirebase().db : null), [fbReady]);
  const stateDocRef = useMemo(
    () => (db ? fsDoc(db, "shops", SHOP_ID, "state", "pos") : null),
    [db]
  );
  const ordersColRef = useMemo(
    () => (db ? collection(db, "shops", SHOP_ID, "orders") : null),
    [db]
  );
  const counterDocRef = useMemo(
    () => (db ? fsDoc(db, "shops", SHOP_ID, "state", "counters") : null),
    [db]
  );

  // Keep UI's "next order #" in sync with the shared counter
  useEffect(() => {
    if (!counterDocRef || !fbUser) return;
    const unsub = onSnapshot(counterDocRef, (snap) => {
      const last = snap.exists() ? Number(snap.data().lastOrderNo || 0) : 0;
      setNextOrderNo(last + 1);
    });
    return () => unsub();
  }, [counterDocRef, fbUser]);

  // One-time initial load for non-realtime state
  useEffect(() => {
    if (!stateDocRef || !fbUser || hydrated) return;

    (async () => {
      try {
        const snap = await getDoc(stateDocRef);
        if (snap.exists()) {
          const data = snap.data() || {};
          const unpacked = unpackStateFromCloud(data, dayMeta);
          if (!realtimeOrders && unpacked.orders) setOrders(unpacked.orders);
          if (unpacked.menu) setMenu(unpacked.menu);
          if (unpacked.extraList) setExtraList(unpacked.extraList);
          if (unpacked.inventory) setInventory(unpacked.inventory);
          if (unpacked.nextOrderNo != null) setNextOrderNo(unpacked.nextOrderNo);
          if (unpacked.dark != null) setDark(unpacked.dark);
          if (unpacked.workers) setWorkers(unpacked.workers);
          if (unpacked.paymentMethods) setPaymentMethods(unpacked.paymentMethods);
          if (unpacked.inventoryLocked != null)
            setInventoryLocked(unpacked.inventoryLocked);
          if (unpacked.inventorySnapshot)
            setInventorySnapshot(unpacked.inventorySnapshot);
          if (unpacked.inventoryLockedAt != null)
            setInventoryLockedAt(unpacked.inventoryLockedAt);
          if (unpacked.adminPins)
            setAdminPins({ ...DEFAULT_ADMIN_PINS, ...unpacked.adminPins });
          if (unpacked.orderTypes) setOrderTypes(unpacked.orderTypes);
          if (unpacked.defaultDeliveryFee != null)
            setDefaultDeliveryFee(unpacked.defaultDeliveryFee);
          if (unpacked.expenses) setExpenses(unpacked.expenses);
          if (unpacked.dayMeta) setDayMeta(unpacked.dayMeta);
          if (unpacked.bankTx) setBankTx(unpacked.bankTx);
          setCloudStatus((s) => ({ ...s, lastLoadAt: new Date(), error: null }));
        }
      } catch (e) {
        console.warn("Initial cloud load failed:", e);
        setCloudStatus((s) => ({ ...s, error: String(e) }));
      } finally {
        setHydrated(true);
      }
    })();
  }, [stateDocRef, fbUser, hydrated, dayMeta, realtimeOrders]);

  useEffect(() => {
  if (!cloudEnabled || !stateDocRef || !fbUser) return;

  const unsub = onSnapshot(stateDocRef, (snap) => {
    try {
      if (!snap.exists()) return;
      if (snap.metadata.hasPendingWrites) return; // ignore our own in-flight writes

      const data = snap.data() || {};
      const ts =
        data.updatedAt instanceof Timestamp
          ? data.updatedAt.toMillis()
          : (data.updatedAt ? new Date(data.updatedAt).getTime() : 0);

      // ignore older/equal updates we've already applied
      if (ts && ts <= (lastAppliedCloudAt || 0)) return;
      // === ADD THIS LINE (do not overwrite fresher local edits) ===
if (ts && lastLocalEditAt && ts < lastLocalEditAt) return;


      const unpacked = unpackStateFromCloud(data, dayMeta);

      // NOTE: when realtimeOrders = true, orders flow is already handled via the "orders" collection listener
      if (unpacked.menu) setMenu(unpacked.menu);
      if (unpacked.extraList) setExtraList(unpacked.extraList);
      if (unpacked.inventory) setInventory(unpacked.inventory);
      if (typeof unpacked.nextOrderNo === "number") setNextOrderNo(unpacked.nextOrderNo);
      if (typeof unpacked.dark === "boolean") setDark(unpacked.dark);
      if (unpacked.workers) setWorkers(unpacked.workers);
      if (unpacked.paymentMethods) setPaymentMethods(unpacked.paymentMethods);
      if (typeof unpacked.inventoryLocked === "boolean") setInventoryLocked(unpacked.inventoryLocked);
      if (unpacked.inventorySnapshot) setInventorySnapshot(unpacked.inventorySnapshot);
      if (unpacked.inventoryLockedAt != null) setInventoryLockedAt(unpacked.inventoryLockedAt);
      if (unpacked.adminPins) setAdminPins({ ...DEFAULT_ADMIN_PINS, ...unpacked.adminPins });
      if (unpacked.orderTypes) setOrderTypes(unpacked.orderTypes);
      if (unpacked.defaultDeliveryFee != null) setDefaultDeliveryFee(unpacked.defaultDeliveryFee);
      if (unpacked.expenses) setExpenses(unpacked.expenses);
      if (unpacked.dayMeta) setDayMeta(unpacked.dayMeta);
      if (unpacked.bankTx) setBankTx(unpacked.bankTx);

      setLastAppliedCloudAt(ts || Date.now());
    } catch (e) {
      console.warn("Realtime state apply failed:", e);
    }
  });

  return () => unsub();
}, [cloudEnabled, stateDocRef, fbUser, dayMeta, lastAppliedCloudAt, lastLocalEditAt]);



  // Manual pull
  const loadFromCloud = async () => {
    if (!stateDocRef || !fbUser) return alert("Firebase not ready.");
    try {
      const snap = await getDoc(stateDocRef);
      if (!snap.exists()) return alert("No cloud state yet to load.");
      const data = snap.data() || {};
      const unpacked = unpackStateFromCloud(data, dayMeta);
      if (!realtimeOrders && unpacked.orders) setOrders(unpacked.orders);
      if (unpacked.menu) setMenu(unpacked.menu);
      if (unpacked.extraList) setExtraList(unpacked.extraList);
      if (unpacked.inventory) setInventory(unpacked.inventory);
      if (unpacked.nextOrderNo != null) setNextOrderNo(unpacked.nextOrderNo);
      if (unpacked.dark != null) setDark(unpacked.dark);
      if (unpacked.workers) setWorkers(unpacked.workers);
      if (unpacked.paymentMethods) setPaymentMethods(unpacked.paymentMethods);
      if (unpacked.inventoryLocked != null)
        setInventoryLocked(unpacked.inventoryLocked);
      if (unpacked.inventorySnapshot)
        setInventorySnapshot(unpacked.inventorySnapshot);
      if (unpacked.inventoryLockedAt != null)
        setInventoryLockedAt(unpacked.inventoryLockedAt);
      if (unpacked.adminPins)
        setAdminPins({ ...DEFAULT_ADMIN_PINS, ...unpacked.adminPins });
      if (unpacked.orderTypes) setOrderTypes(unpacked.orderTypes);
      if (unpacked.defaultDeliveryFee != null)
        setDefaultDeliveryFee(unpacked.defaultDeliveryFee);
      if (unpacked.expenses) setExpenses(unpacked.expenses);
      if (unpacked.dayMeta) setDayMeta(unpacked.dayMeta);
      if (unpacked.bankTx) setBankTx(unpacked.bankTx);

      setCloudStatus((s) => ({ ...s, lastLoadAt: new Date(), error: null }));
      alert("Loaded from cloud ✔");
    } catch (e) {
      setCloudStatus((s) => ({ ...s, error: String(e) }));
      alert("Cloud load failed: " + e);
    }
  };
  const saveToCloudNow = async () => {
  if (!stateDocRef || !fbUser) return alert("Firebase not ready.");
  try {
    const body = packStateForCloud({
      menu,
      extraList,
      orders: realtimeOrders ? [] : orders,
      inventory,
      nextOrderNo,
      dark,
      workers,
      paymentMethods,
      inventoryLocked,
      inventorySnapshot,
      inventoryLockedAt,
      adminPins,
      orderTypes,
      defaultDeliveryFee,
      expenses,
       purchases,
         purchaseCategories,
         customers,
        deliveryZones,
      dayMeta,
      bankTx,
    });
    await setDoc(stateDocRef, body, { merge: true });
    // mark latest timestamps so the cloud listener won't re-apply this back onto us
setLastLocalEditAt(Date.now());
setLastAppliedCloudAt(Date.now());

    alert("Synced to cloud ✔");
  } catch (e) {
    alert("Sync failed: " + e);
  }
};


  // Autosave (state doc) – never saves orders when realtime is ON
  useEffect(() => {
    if (!cloudEnabled || !stateDocRef || !fbUser || !hydrated) return;
    const t = setTimeout(async () => {
      try {
        const body = packStateForCloud({
          menu,
          extraList,
          orders: realtimeOrders ? [] : orders,
          inventory,
          nextOrderNo,
          dark,
          workers,
          paymentMethods,
          inventoryLocked,
          inventorySnapshot,
          inventoryLockedAt,
          adminPins,
          orderTypes,
          defaultDeliveryFee,
          expenses,
          dayMeta,
          bankTx,
        });
        await setDoc(stateDocRef, body, { merge: true });
        setCloudStatus((s) => ({ ...s, lastSaveAt: new Date(), error: null }));
      } catch (e) {
        setCloudStatus((s) => ({ ...s, error: String(e) }));
      }
    }, 1600);
    return () => clearTimeout(t);
  }, [
    cloudEnabled,
    stateDocRef,
    fbUser,
    hydrated,
    menu,
    extraList,
    orders,
    inventory,
    nextOrderNo,
    dark,
    workers,
    paymentMethods,
    inventoryLocked,
    inventorySnapshot,
    inventoryLockedAt,
    adminPins,
    orderTypes,
    defaultDeliveryFee,
    expenses,
    dayMeta,
    bankTx,
    realtimeOrders,
  ]);

  const startedAtMs = dayMeta?.startedAt
    ? new Date(dayMeta.startedAt).getTime()
    : null;
  const endedAtMs = dayMeta?.endedAt
    ? new Date(dayMeta.endedAt).getTime()
    : null;

  // Live board: only show orders within the active shift window
  useEffect(() => {
    if (!realtimeOrders || !ordersColRef || !fbUser) return;
    if (!startedAtMs) {
      setOrders([]);
      return;
    }

    const startTs = Timestamp.fromMillis(startedAtMs);
    const constraints = [where("createdAt", ">=", startTs), orderBy("createdAt", "desc")];
    if (endedAtMs)
      constraints.unshift(where("createdAt", "<=", Timestamp.fromMillis(endedAtMs)));

    const qy = query(ordersColRef, ...constraints);
    const unsub = onSnapshot(qy, (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push(orderFromCloudDoc(d.id, d.data())));
      setOrders(dedupeOrders(arr));
    });
    return () => unsub();
  }, [realtimeOrders, ordersColRef, fbUser, startedAtMs, endedAtMs]);

  /* --------------------------- APP LOGIC --------------------------- */
  const toggleExtra = (extra) => {
    setSelectedExtras((prev) =>
      prev.find((e) => e.id === extra.id)
        ? prev.filter((e) => e.id !== extra.id)
        : [...prev, extra]
    );
  };

  const invById = useMemo(() => {
    const map = {};
    for (const item of inventory) map[item.id] = item;
    return map;
  }, [inventory]);
  // Compute per-item COGS from its `uses` and inventory `costPerUnit`      // ⬅️ NEW
function computeCOGSForItemDef(def, invMap) {
  const uses = def?.uses || {};
  let sum = 0;
  for (const k of Object.keys(uses)) {
    const need = Number(uses[k] || 0);
    const cost = Number(invMap[k]?.costPerUnit || 0);
    sum += need * cost;
  }
  return Number(sum.toFixed(2));
}
// Period helpers for Purchases                                                // ⬅️ NEW
function getPeriodRange(kind, dayMeta) {
  const now = new Date();
  if (kind === "day") {
    const start = dayMeta?.startedAt ? new Date(dayMeta.startedAt) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end   = dayMeta?.endedAt   ? new Date(dayMeta.endedAt)   : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return [start, end];
  }
  if (kind === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0,0,0);
    const end   = new Date(now.getFullYear(), now.getMonth()+1, 0, 23,59,59,999);
    return [start, end];
  }
  const start = new Date(now.getFullYear(), 0, 1, 0,0,0);
  const end   = new Date(now.getFullYear(), 11, 31, 23,59,59,999);
  return [start, end];
}
function isWithin(d, start, end) {
  const t = +d;
  return t >= +start && t <= +end;
}
function sumPurchases(arr) {
  return arr.reduce((s,p)=> s + Number(p.qty || 0) * Number(p.unitPrice || 0), 0);
}



  const promptAdminAndPin = () => {
    const adminStr = window.prompt("Enter Admin number (1 to 6):", "1");
    if (!adminStr) return null;
    const n = Number(adminStr);
    if (![1, 2, 3, 4, 5, 6].includes(n)) {
      alert("Please enter a number from 1 to 6.");
      return null;
    }

    const entered = window.prompt(`Enter PIN for Admin ${n}:`, "");
    if (entered == null) return null;

    const expected = norm(adminPins[n]);
    const attempt = norm(entered);
    if (!expected) {
      alert(
        `Admin ${n} has no PIN set; set a PIN in Edit → Admin PINs.`
      );
      return null;
    }
    if (attempt !== expected) {
      alert("Invalid PIN.");
      return null;
    }
    return n;
  };

  const lockInventoryForDay = () => {
    if (inventoryLocked) return;
    if (inventory.length === 0) return alert("Add at least one inventory item first.");
    if (
      !window.confirm(
        "Lock current inventory as Start-of-Day? You won't be able to edit until End the Day or admin unlock."
      )
    )
      return;

    const snap = inventory.map((it) => ({
      id: it.id,
      name: it.name,
      unit: it.unit,
      qtyAtLock: it.qty,
    }));
    setInventorySnapshot(snap);
    setInventoryLocked(true);
    setInventoryLockedAt(new Date());
  };

  const unlockInventoryWithPin = () => {
    if (!inventoryLocked) return alert("Inventory is already unlocked.");
    const adminNum = promptAdminAndPin();
    if (!adminNum) return;
    if (!window.confirm(`Admin ${adminNum}: Unlock inventory for editing? Snapshot will be kept.`))
      return;
    setInventoryLocked(false);
    alert("Inventory unlocked for editing.");
  };

  const startShift = () => {
    if (dayMeta.startedAt && !dayMeta.endedAt)
      return alert("Shift already started.");
    const nameInput =
      worker ||
      window.prompt(
        "Enter worker name to START shift (or select in Orders tab then return):",
        ""
      );
    const name = norm(nameInput);
    if (!name) return alert("Worker name required.");
    setDayMeta({
      startedBy: name,
      currentWorker: name,
      startedAt: new Date(),
      endedAt: null,
      endedBy: "",
      lastReportAt: null,
      resetBy: "",
      resetAt: null,
      shiftChanges: [],
    });
    if (!inventoryLocked && inventory.length) {
      if (
        window.confirm(
          "Lock current Inventory as Start-of-Day snapshot?"
        )
      )
        lockInventoryForDay();
    }
  };

  // NEW: Change shift updates only current worker
  const changeShift = () => {
    if (!dayMeta.startedAt || dayMeta.endedAt)
      return alert("Start a shift first.");
    const next = window.prompt(`Enter the NEW on-duty worker name:`, "");
    const newName = norm(next);
    if (!newName) return alert("New worker name required.");
    if (norm(newName) === norm(dayMeta.currentWorker))
      return alert("New worker must be different from current on-duty.");
    const prev = dayMeta.currentWorker || dayMeta.startedBy;
    setDayMeta((d) => ({
      ...d,
      currentWorker: newName,
      shiftChanges: [
        ...(d.shiftChanges || []),
        { at: new Date(), from: prev || "?", to: newName },
      ],
    }));
    alert(`On-duty changed: ${prev || "?"} → ${newName}`);
  };

  const endDay = async () => {
    if (!dayMeta.startedAt) return alert("Start a shift first.");
    const who = window.prompt("Enter your name to END THE DAY:", "");
    const endBy = norm(who);
    if (!endBy) return alert("Name is required.");

    const endTime = new Date();
    const metaForReport = { ...dayMeta, endedAt: endTime, endedBy: endBy };

    generatePDF(false, metaForReport);

    if (cloudEnabled && ordersColRef && fbUser && db) {
      try {
        const start = dayMeta.startedAt
          ? new Date(dayMeta.startedAt)
          : orders.length
          ? new Date(Math.min(...orders.map((o) => +o.date)))
          : endTime;
        await purgeOrdersInCloud(db, ordersColRef, start, endTime);
      } catch (e) {
        console.warn("Cloud purge on endDay failed:", e);
      }
      try {
        if (counterDocRef) {
          await setDoc(
            counterDocRef,
            { lastOrderNo: 0, updatedAt: serverTimestamp() },
            { merge: true }
          );
        }
      } catch (e) {
        console.warn("Counter reset failed:", e);
      }
    }

    const validOrders = orders.filter((o) => !o.voided);
    const revenueExclDelivery = validOrders.reduce(
      (s, o) =>
        s +
        Number(
          o.itemsTotal != null ? o.itemsTotal : o.total - (o.deliveryFee || 0)
        ),
      0
    );
    const expensesTotal = expenses.reduce(
      (s, e) => s + Number((e.qty || 0) * (e.unitPrice || 0)),
      0
    );
    const margin = revenueExclDelivery - expensesTotal;

    const txs = [];
    if (margin > 0) {
      txs.push({
        id: `tx_${Date.now()}`,
        type: "init",
        amount: margin,
        worker: endBy,
        note: "Auto Init from day margin",
        date: new Date(),
      });
    } else if (margin < 0) {
      txs.push({
        id: `tx_${Date.now() + 1}`,
        type: "adjustDown",
        amount: Math.abs(margin),
        worker: endBy,
        note: "Auto Adjust Down (negative margin)",
        date: new Date(),
      });
    }
    if (txs.length) setBankTx((arr) => [...txs, ...arr]);

    setOrders([]);
    setNextOrderNo(1);
    setInventoryLocked(false);
    setInventoryLockedAt(null);
    setDayMeta({
      startedBy: "",
      currentWorker: "",
      startedAt: null,
      endedAt: null,
      endedBy: "",
      lastReportAt: null,
      resetBy: "",
      resetAt: null,
      shiftChanges: [],
    });

    alert(`Day ended by ${endBy}. Report downloaded and day reset ✅`);
  };

  // --------- Cart / Checkout ----------
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  // scale a uses map by a factor
const multiplyUses = (uses = {}, factor = 1) => {
  const out = {};
  for (const k of Object.keys(uses)) out[k] = Number(uses[k] || 0) * factor;
  return out;
};


  const addToCart = () => {
    if (!selectedBurger) return alert("Select a burger/item first.");
    const qty = Math.max(1, Number(selectedQty || 1));
    const uses = {};
    const prodUses = selectedBurger.uses || {};
    for (const k of Object.keys(prodUses))
      uses[k] = (uses[k] || 0) + (prodUses[k] || 0) * qty;
    for (const ex of selectedExtras) {
      const exUses = ex.uses || {};
      for (const k of Object.keys(exUses))
        uses[k] = (uses[k] || 0) + (exUses[k] || 0) * qty;
    }
    const line = {
      ...selectedBurger,
      extras: [...selectedExtras],
      price: selectedBurger.price,
      qty,
      uses,
    };
    setCart((c) => [...c, line]);
    setSelectedBurger(null);
    setSelectedExtras([]);
    setSelectedQty(1);
  };

  const removeFromCart = (i) =>
    setCart((c) => c.filter((_, idx) => idx !== i));

 const changeQty = (i, delta) =>
  setCart((c) =>
    c.map((line, idx) => {
      if (idx !== i) return line;
      const oldQty = Math.max(1, Number(line.qty || 1));
      const newQty = Math.max(1, oldQty + delta);
      if (newQty === oldQty) return line;
      return {
        ...line,
        qty: newQty,
        // keep per-line consumption proportional to qty
        uses: multiplyUses(line.uses || {}, newQty / oldQty),
      };
    })
  );

  const setQty = (i, v) =>
  setCart((c) =>
    c.map((line, idx) => {
      if (idx !== i) return line;
      const oldQty = Math.max(1, Number(line.qty || 1));
      const newQty = Math.max(1, Number(v || 1));
      if (newQty === oldQty) return line;
      return {
        ...line,
        qty: newQty,
        uses: multiplyUses(line.uses || {}, newQty / oldQty),
      };
    })
  );


 const checkout = async () => {
  if (isCheckingOut) return;
  setIsCheckingOut(true);

  try {
    if (!dayMeta.startedAt || dayMeta.endedAt)
      return alert("Start a shift first (Shift → Start Shift).");
    if (cart.length === 0) return alert("Cart is empty.");
    if (!worker) return alert("Select worker.");
    if (!orderType) return alert("Select order type.");

    // When NOT split, a single payment is required
    if (!splitPay && !payment) return alert("Select payment.");
    // Require delivery details when order type is Delivery
if (orderType === "Delivery") {
  const n = String(deliveryName || "").trim();
  const p = String(deliveryPhone || "").trim();
  const a = String(deliveryAddress || "").trim();
  setDeliveryZoneId(""); // ⬅️ NEW


  if (!n || !/^\d{11}$/.test(p) || !a) {
    return alert("Please enter customer name, phone Number (11 digits), and address for Delivery.");
  }
}


    // Rebuild per-unit uses from current menu/extras, then multiply by qty
    const cartWithUses = cart.map((line) => {
      const baseItem = menu.find((m) => m.id === line.id);
      const unitUses = { ...(baseItem?.uses || {}) };

      for (const ex of line.extras || []) {
        const exDef = extraList.find((e) => e.id === ex.id) || ex;
        const exUses = exDef.uses || {};
        for (const k of Object.keys(exUses)) {
          unitUses[k] = (unitUses[k] || 0) + Number(exUses[k] || 0);
        }
      }

      const qty = Math.max(1, Number(line.qty || 1));
      return { ...line, uses: multiplyUses(unitUses, qty) };
    });

    // Stock check using rebuilt uses
    const required = {};
    for (const line of cartWithUses) {
      for (const k of Object.keys(line.uses || {})) {
        required[k] = (required[k] || 0) + Number(line.uses[k] || 0);
      }
    }
    for (const k of Object.keys(required)) {
      const invItem = invById[k];
      if (!invItem) continue;
      if ((invItem.qty || 0) < required[k]) {
        return alert(
          `Not enough ${invItem.name} in stock. Need ${required[k]} ${invItem.unit}, have ${invItem.qty} ${invItem.unit}.`
        );
      }
    }
    // Deduct locally
    setInventory((inv) =>
      inv.map((it) => {
        const need = Number(required[it.id] || 0);
        return need ? { ...it, qty: it.qty - need } : it;
      })
    );

    // Totals
    const itemsTotal = cartWithUses.reduce((s, b) => {
      const ex = (b.extras || []).reduce((t, e) => t + Number(e.price || 0), 0);
      return s + (Number(b.price || 0) + ex) * Number(b.qty || 1);
    }, 0);
    const delFee =
      orderType === "Delivery" ? Math.max(0, Number(deliveryFee || 0)) : 0;
    const total = itemsTotal + delFee;

    // Build payment label & parts
    let paymentLabel = payment;
    let paymentParts = [];

    if (splitPay) {
      if (!payA || !payB) return alert("Choose two payment methods.");
      if (payA === payB) return alert("Choose two different methods for split.");
      const a = Math.max(0, Number(amtA || 0));
      const b = Math.max(0, Number(amtB || 0));
      const sum = Number((a + b).toFixed(2));
      if (sum !== Number(total.toFixed(2))) {
        return alert(`Split amounts must equal total (E£${total.toFixed(2)}).`);
      }
      paymentLabel = `${payA}+${payB}`;
      paymentParts = [{ method: payA, amount: a }, { method: payB, amount: b }];
    } else {
      paymentParts = [{ method: payment || "Unknown", amount: total }];
    }

    // Cash handling (single or split)
    let cashVal = null;
    let changeDue = null;
    if (splitPay) {
      const cashPart = paymentParts.find((p) => p.method === "Cash");
      if (cashPart) {
        cashVal = Number(cashReceivedSplit || 0);
        changeDue = Math.max(0, cashVal - Number(cashPart.amount || 0));
      }
    } else if (payment === "Cash") {
      cashVal = Number(cashReceived || 0);
      changeDue = Math.max(0, cashVal - total);
    }

    // Use current local nextOrderNo immediately (to keep print in the click gesture)
    let optimisticNo = nextOrderNo;

    const order = {
      orderNo: optimisticNo,
      date: new Date(),
      worker,
      payment: paymentLabel,
      paymentParts,
      orderType,
      deliveryFee: delFee,
      deliveryName: (orderType === "Delivery" ? String(deliveryName || "").trim() : ""),
deliveryPhone: (orderType === "Delivery" ? String(deliveryPhone || "").trim() : ""),
deliveryAddress: (orderType === "Delivery" ? String(deliveryAddress || "").trim() : ""),
      deliveryZoneId: deliveryZoneId || "",   // ⬅️ NEW


      total,
      itemsTotal,
      cashReceived: cashVal,
      changeDue,
      cart: cartWithUses,
      done: false,
      voided: false,
      restockedAt: undefined,
      note: orderNote.trim(),
      idemKey: `idk_${fbUser ? fbUser.uid : "anon"}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`,
    };

    // Save/update customer (Delivery only)                               // ⬅️ NEW
if (orderType === "Delivery") {
  const rec = {
    phone: order.deliveryPhone,
    name: order.deliveryName,
    address: order.deliveryAddress,
    zoneId: deliveryZoneId || "",
  };
  setCustomers(prev => {
    const i = prev.findIndex(x => x.phone === rec.phone);
    if (i >= 0) {
      const copy = [...prev];
      copy[i] = rec;
      return copy;
    }
    return [rec, ...prev];
  });
}


    // PRINT now
    if (autoPrintOnCheckout) {
      printReceiptHTML(order, Number(preferredPaperWidthMm) || 80, "Customer");
    }

    // Optimistic counter
    setNextOrderNo(optimisticNo + 1);

    // Persist to cloud / allocate atomic order number
    let allocatedNo = optimisticNo;
    if (cloudEnabled && counterDocRef && fbUser && db) {
      try {
        allocatedNo = await allocateOrderNoAtomic(db, counterDocRef);
        if (allocatedNo !== optimisticNo) {
          order.orderNo = allocatedNo;
          setNextOrderNo(allocatedNo + 1);
        }
      } catch (e) {
        console.warn("Atomic order number allocation failed, using optimistic number.", e);
      }
    }

    if (!realtimeOrders) setOrders((o) => [order, ...o]);

    if (cloudEnabled && ordersColRef && fbUser) {
      try {
        const ref = await addDoc(ordersColRef, normalizeOrderForCloud(order));
        if (!realtimeOrders) {
          setOrders((prev) =>
            prev.map((oo) =>
              oo.orderNo === order.orderNo ? { ...oo, cloudId: ref.id } : oo
            )
          );
        }
      } catch (e) {
        console.warn("Cloud order write failed:", e);
      }
    }

    // Reset order UI
    setCart([]);
    setWorker("");
    setPayment("");
    setOrderNote("");
    const defaultType = orderTypes[0] || "Take-Away";
    setOrderType(defaultType);
    setDeliveryFee(defaultType === "Delivery" ? defaultDeliveryFee : 0);
    setCashReceived(0);
    // Clear delivery details
setDeliveryName("");
setDeliveryPhone("");
setDeliveryAddress("");

    // reset split
    setSplitPay(false);
    setPayA(""); setPayB("");
    setAmtA(0); setAmtB(0);
    setCashReceivedSplit(0);
  } finally {
    setIsCheckingOut(false);
  }
};

  

 // --------- Order actions ----------
const markOrderDone = async (orderNo) => {
  setOrders((o) =>
    o.map((ord) => (ord.orderNo !== orderNo || ord.done ? ord : { ...ord, done: true }))
  );
  try {
    if (!cloudEnabled || !ordersColRef || !fbUser) return;
    let targetId = orders.find((o) => o.orderNo === orderNo)?.cloudId;
    if (!targetId) {
      const qy = query(ordersColRef, where("orderNo", "==", orderNo));
      const ss = await getDocs(qy);
      if (!ss.empty) targetId = ss.docs[0].id;
    }
    if (targetId) {
      await updateDoc(fsDoc(db, "shops", SHOP_ID, "orders", targetId), {
        done: true,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (e) {
    console.warn("Cloud update (done) failed:", e);
  }
};

const voidOrderAndRestock = async (orderNo) => {
  const ord = orders.find((o) => o.orderNo === orderNo);
  if (!ord) return;
  if (ord.done) return alert("This order is DONE and cannot be cancelled.");
  if (ord.voided) return alert("This order is already cancelled/returned.");
  // Require a reason
const reasonRaw = window.prompt(
  `Reason for CANCEL (restock) — order #${orderNo}:`,
  ""
);
const reason = String(reasonRaw || "").trim();
if (!reason) return alert("A reason is required.");

  if (!window.confirm(`Cancel order #${orderNo} and restock inventory?`)) return;

  // Compute items to give back
  const giveBack = {};
  for (const line of ord.cart) {
    const uses = line.uses || {};
    for (const k of Object.keys(uses)) {
      giveBack[k] = (giveBack[k] || 0) + (uses[k] || 0);
    }
  }

  // Restock locally
  setInventory((inv) =>
    inv.map((it) => {
      const back = giveBack[it.id] || 0;
      return back ? { ...it, qty: it.qty + back } : it;
    })
  );

  // Mark cancelled with restock timestamp
  const when = new Date();
  setOrders((o) =>
  o.map((x) =>
    x.orderNo === orderNo
      ? { ...x, voided: true, restockedAt: when, voidReason: reason }
      : x
  )
);


  // Cloud update
  try {
    if (!cloudEnabled || !ordersColRef || !fbUser) return;
    let targetId = ord.cloudId;
    if (!targetId) {
      const qy = query(ordersColRef, where("orderNo", "==", orderNo));
      const ss = await getDocs(qy);
      if (!ss.empty) targetId = ss.docs[0].id;
    }
    if (targetId) {
      await updateDoc(fsDoc(db, "shops", SHOP_ID, "orders", targetId), {
        voided: true,
        voidReason: reason,   

        restockedAt: when.toISOString(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (e) {
    console.warn("Cloud update (cancel/restock) failed:", e);
  }
};

const voidOrderToExpense = async (orderNo) => {
  const ord = orders.find((o) => o.orderNo === orderNo);
  if (!ord) return;
  if (ord.done) return alert("This order is DONE and cannot be voided.");
  if (ord.voided) return alert("This order is already voided.");
  if (!isExpenseVoidEligible(ord.orderType)) {
    return alert("This action is only for non Dine-in / Take-Away orders.");
  }
  // Require a reason
const reasonRaw = window.prompt(
  `Reason for RETURN (no restock) — order #${orderNo}:`,
  ""
);
const reason = String(reasonRaw || "").trim();
if (!reason) return alert("A reason is required.");


  // Use items-only total as the waste amount (delivery fee isn't item cost)
  const itemsOnly = ord.itemsTotal != null
    ? Number(ord.itemsTotal || 0)
    : Math.max(0, Number(ord.total || 0) - Number(ord.deliveryFee || 0));

  const ok = window.confirm(
    `Void order #${orderNo} WITHOUT restock and add expense for wasted items (E£${itemsOnly.toFixed(2)})?`
  );
  if (!ok) return;

  // 1) Mark voided (no restock)
  setOrders((o) =>
  o.map((x) =>
    x.orderNo === orderNo
      ? { ...x, voided: true, restockedAt: undefined, voidReason: reason }
      : x
  )
);


  // 2) Push an expense row at the top
  const expRow = {
    id: `exp_${Date.now()}`,
    name: `Voided order #${orderNo} — ${ord.orderType || "-"}`,
    unit: "order",
    qty: 1,
    unitPrice: itemsOnly,
    note: reason,
    date: new Date(),
  };
  setExpenses((arr) => [expRow, ...arr]);

  // 3) Cloud: mark order as voided (no restock timestamp)
  try {
    if (cloudEnabled && ordersColRef && fbUser) {
      let targetId = ord.cloudId;
      if (!targetId) {
        const qy = query(ordersColRef, where("orderNo", "==", orderNo));
        const ss = await getDocs(qy);
        if (!ss.empty) targetId = ss.docs[0].id;
      }
      if (targetId) {
        await updateDoc(fsDoc(db, "shops", SHOP_ID, "orders", targetId), {
          voided: true,
          voidReason: reason,
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (e) {
    console.warn("Cloud update (void→expense) failed:", e);
  }
};




  // --------------------------- REPORT TOTALS ---------------------------
  const getSortedOrders = () => {
    const arr = [...orders];
    if (sortBy === "date-desc") arr.sort((a, b) => b.date - a.date);
    if (sortBy === "date-asc") arr.sort((a, b) => a.date - b.date);
    if (sortBy === "worker") arr.sort((a, b) => a.worker.localeCompare(b.worker));
    if (sortBy === "payment") arr.sort((a, b) => a.payment.localeCompare(b.payment));
    return arr;
  };

  const totals = useMemo(() => {
    const validOrders = orders.filter((o) => !o.voided);
    const revenueTotal = validOrders.reduce(
      (s, o) =>
        s +
        Number(
          o.itemsTotal != null ? o.itemsTotal : o.total - (o.deliveryFee || 0)
        ),
      0
    );
   const byPay = {};
// seed known methods (optional)
for (const p of paymentMethods) byPay[p] = 0;

for (const o of validOrders) {
  const itemsOnly = Number(
    o.itemsTotal != null ? o.itemsTotal : o.total - (o.deliveryFee || 0)
  );

  if (Array.isArray(o.paymentParts) && o.paymentParts.length) {
    const sumParts = o.paymentParts.reduce((s, p) => s + Number(p.amount || 0), 0) || o.total || itemsOnly;
    for (const part of o.paymentParts) {
      const m = part.method || "Unknown";
      const share = sumParts ? (Number(part.amount || 0) / sumParts) : 0;
      if (byPay[m] == null) byPay[m] = 0;
      byPay[m] += itemsOnly * share;
    }
  } else {
    const m = o.payment || "Unknown";
    if (byPay[m] == null) byPay[m] = 0;
    byPay[m] += itemsOnly;
  }
}
    const byType = {};
    for (const t of orderTypes) byType[t] = 0;
    for (const o of validOrders) {
      const itemsOnly = Number(
        o.itemsTotal != null ? o.itemsTotal : o.total - (o.deliveryFee || 0)
      );
      if (byType[o.orderType] == null) byType[o.orderType] = 0;
      byType[o.orderType] += itemsOnly;
    }
    const deliveryFeesTotal = validOrders.reduce(
      (s, o) => s + (o.deliveryFee || 0),
      0
    );
    const expensesTotal = expenses.reduce(
      (s, e) => s + Number((e.qty || 0) * (e.unitPrice || 0)),
      0
    );
    const margin = revenueTotal - expensesTotal;
    return { revenueTotal, byPay, byType, deliveryFeesTotal, expensesTotal, margin };
  }, [orders, paymentMethods, orderTypes, expenses]);

  const salesStats = useMemo(() => {
    const itemMap = new Map();
    const extraMap = new Map();
    const add = (map, id, name, count, revenue) => {
      const prev = map.get(id) || { id, name, count: 0, revenue: 0 };
      prev.count += count;
      prev.revenue += revenue;
      map.set(id, prev);
    };
    for (const o of orders) {
      if (o.voided) continue;
      for (const line of o.cart || []) {
        const q = Number(line.qty || 1);
        const base = Number(line.price || 0);
        add(itemMap, line.id, line.name, q, base * q);
        for (const ex of line.extras || [])
          add(extraMap, ex.id, ex.name, q, Number(ex.price || 0) * q);
      }
    }
    const items = Array.from(itemMap.values()).sort(
      (a, b) => b.count - a.count || b.revenue - a.revenue
    );
    const extras = Array.from(extraMap.values()).sort(
      (a, b) => b.count - a.count || b.revenue - a.revenue
    );
    return { items, extras };
  }, [orders]);

  const inventoryReportRows = useMemo(() => {
    if (!inventorySnapshot || inventorySnapshot.length === 0) return [];
    const snapMap = {};
    for (const s of inventorySnapshot) snapMap[s.id] = s;
    return inventory.map((it) => {
      const s = snapMap[it.id];
      const start = s ? s.qtyAtLock : 0;
      const now = it.qty;
      const used = Math.max(0, start - now);
      return { name: it.name, unit: it.unit, start, now, used };
    });
  }, [inventory, inventorySnapshot]);
  // --- Purchases: compute current period & filtered rows
const [pStart, pEnd] = useMemo(
  () => getPeriodRange(purchaseFilter, dayMeta),
  [purchaseFilter, dayMeta]
);

const filteredPurchases = useMemo(() => {
 const withinPeriod = (purchases || []).filter((p) => {
    const d = p?.date instanceof Date ? p.date : new Date(p?.date);
    return isWithin(d, pStart, pEnd);
  });
  return purchaseCatFilterId
    ? withinPeriod.filter((p) => p.categoryId === purchaseCatFilterId)
    : withinPeriod;
}, [purchases, pStart, pEnd, purchaseCatFilterId]);

// KPI: Total Purchases for the selected period
const totalPurchasesInPeriod = useMemo(
  () => sumPurchases(filteredPurchases),
  [filteredPurchases]
);

// Map category -> total amount in period
const catTotals = useMemo(() => {
  const m = new Map();
  for (const p of filteredPurchases) {
    const amt = Number(p.qty || 0) * Number(p.unitPrice || 0);
    m.set(p.categoryId || "", (m.get(p.categoryId || "") || 0) + amt);
  }
  return m;
}, [filteredPurchases]);

// Map category -> rows (sorted by date)
const byCategory = useMemo(() => {
  const m = new Map();
  for (const p of filteredPurchases) {
    const key = p.categoryId || "";
    const arr = m.get(key) || [];
    arr.push(p);
    m.set(key, arr);
  }
  // ✅ no unused variable
  for (const arr of m.values()) {
    arr.sort((a, b) => +new Date(a.date) - +new Date(b.date));
  }
  return m;
}, [filteredPurchases]);


// KPI: Net after Purchases

const handleAddPurchase = () => {
  const { categoryId, itemName, unit, qty, unitPrice, date } = newPurchase;

  if (!categoryId) return alert("Select a category.");
  const name = String(itemName || "").trim();
  if (!name) return alert("Enter item name.");

  const row = {
    id: `p_${Date.now()}`,
    categoryId,
    itemName: name,
    unit: String(unit || "pcs"),
    qty: Math.max(0, Number(qty || 0)),
    unitPrice: Math.max(0, Number(unitPrice || 0)),
    date: date ? new Date(date) : new Date(),
  };

  setPurchases((arr) => [row, ...arr]);
  setNewPurchase({
    categoryId: "",
    itemName: "",
    unit: "pcs",
    qty: 1,
    unitPrice: 0,
    date: new Date().toISOString().slice(0, 10),
  });
};
  // Admin-protected: wipe all purchases
const resetAllPurchases = () => {
  const okAdmin = !!promptAdminAndPin();
  if (!okAdmin) return;
  if (!window.confirm("Reset ALL purchases (cannot be undone)?")) return;
  setPurchases([]);
  setPurchaseCatFilterId("");
};
// === ADD BELOW: remove a single category AND all its purchases =========
const removePurchaseCategory = (catId) => {
  const cat = purchaseCategories.find(c => c.id === catId);
  const name = cat?.name || "(unknown)";
  if (!window.confirm(`Delete category "${name}" and ALL its purchases? This cannot be undone.`)) return;

  // 1) drop the category itself
  setPurchaseCategories(list => list.filter(c => c.id !== catId));

  // 2) cascade delete purchases of this category
  setPurchases(list => list.filter(p => p.categoryId !== catId));

  // 3) clear UI selections if they pointed to the removed id
  setPurchaseCatFilterId(prev => (prev === catId ? "" : prev));
  setNewPurchase(p => (p.categoryId === catId ? { ...p, categoryId: "" } : p));
};


  // --------------------------- PDF: REPORT ---------------------------
  const generatePDF = (silent = false, metaOverride = null) => {
    try {
      const m = metaOverride || dayMeta;
      const doc = new jsPDF();
      doc.text("TUX — Shift Report", 14, 12);

      const startedStr = m.startedAt ? new Date(m.startedAt).toLocaleString() : "—";
      const endedStr = m.endedAt ? new Date(m.endedAt).toLocaleString() : "—";

      autoTable(doc, {
        head: [["Start By", "Start At", "Current Worker", "End At"]],
        body: [[m.startedBy || "—", startedStr, m.currentWorker || "—", endedStr]],
        startY: 18,
        theme: "grid",
      });


      let y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : 28;
      doc.text("Shift Timeline", 14, y);
      const timelineRows = [];
      timelineRows.push(["Started", startedStr, m.startedBy || "—"]);
      (m.shiftChanges || []).forEach((c, i) => {
        const when = c?.at ? new Date(c.at).toLocaleString() : "—";
        timelineRows.push([`Changed #${i + 1}`, when, `${c.from || "?"} → ${c.to || "?"}`]);
      });
      timelineRows.push(["Day Ended", endedStr, m.endedBy || "—"]);
      autoTable(doc, {
        head: [["Event", "When", "Actor(s)"]],
        body: timelineRows,
        startY: y + 4,
        theme: "grid",
        styles: { fontSize: 10 },
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : 28;
      doc.text("Orders", 14, y);
      autoTable(doc, {
   head: [["#", "Date", "Worker", "Payment", "Type", "Delivery (E£)", "Total (E£)", "Status", "Reason"]],
   body: getSortedOrders().map((o) => [
  o.orderNo,
  o.date.toLocaleString(),
  o.worker,
  o.payment,
  o.orderType || "",
  (o.deliveryFee || 0).toFixed(2),
  o.total.toFixed(2),
  o.voided ? (o.restockedAt ? "Cancelled" : "Returned") : (o.done ? "Done" : "Not done"),
  o.voided ? (o.voidReason || "") : "",
]),
   startY: y + 4,
   styles: { fontSize: 9 },
 });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Totals (excluding canceled/returned)", 14, y);

      const totalsBody = [
        ["Revenue (Shift, excl. delivery)", totals.revenueTotal.toFixed(2)],
        ["Delivery Fees (not in revenue)", totals.deliveryFeesTotal.toFixed(2)],
        ["Expenses (Shift)", totals.expensesTotal.toFixed(2)],
        ["Margin (Revenue - Expenses)", totals.margin.toFixed(2)],
      ];
      for (const p of Object.keys(totals.byPay))
        totalsBody.push([
          `By Payment — ${p} (items only)`,
          (totals.byPay[p] || 0).toFixed(2),
        ]);
      for (const t of Object.keys(totals.byType))
        totalsBody.push([
          `By Order Type — ${t} (items only)`,
          (totals.byType[t] || 0).toFixed(2),
        ]);

      autoTable(doc, {
        head: [["Metric", "Amount (E£)"]],
        body: totalsBody,
        startY: y + 4,
        theme: "grid",
        styles: { fontSize: 10 },
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Items — Times Ordered", 14, y);
      autoTable(doc, {
        head: [["Item", "Times", "Revenue (E£)"]],
        body: salesStats.items.map((r) => [r.name, String(r.count), r.revenue.toFixed(2)]),
        startY: y + 4,
        theme: "grid",
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Extras — Times Ordered", 14, y);
      autoTable(doc, {
        head: [["Extra", "Times", "Revenue (E£)"]],
        body: salesStats.extras.map((r) => [r.name, String(r.count), r.revenue.toFixed(2)]),
        startY: y + 4,
        theme: "grid",
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Inventory — Start vs Now", 14, y);

      if (!inventoryReportRows.length) {
        autoTable(doc, {
          head: [["Info"]],
          body: [["No inventory snapshot yet. Lock inventory to capture start-of-day."]],
          startY: y + 4,
          theme: "grid",
        });
      } else {
        autoTable(doc, {
          head: [["Item", "Unit", "Start Qty", "Current Qty", "Used"]],
          body: inventoryReportRows.map((r) => [
            r.name,
            r.unit,
            String(r.start),
            String(r.now),
            String(r.used),
          ]),
          startY: y + 4,
          theme: "grid",
        });
      }

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Expenses (Shift)", 14, y);
      autoTable(doc, {
        head: [["Name", "Unit", "Qty", "Unit Price (E£)", "Total (E£)", "Date", "Note"]],
        body: expenses.map((e) => [
          e.name,
          e.unit,
          String(e.qty),
          Number(e.unitPrice || 0).toFixed(2),
          (Number(e.qty || 0) * Number(e.unitPrice || 0)).toFixed(2),
          e.date ? new Date(e.date).toLocaleString() : "",
          e.note || "",
        ]),
        startY: y + 4,
        theme: "grid",
        styles: { fontSize: 9 },
      });

      setDayMeta((d) => ({ ...d, lastReportAt: new Date() }));
      doc.save("tux_shift_report.pdf");
      if (!silent) alert("PDF downloaded.");
    } catch (err) {
      console.error(err);
      alert("Could not generate PDF. Try again (ensure pop-ups are allowed).");
    }
  };

  // ---------- helpers for Edit (reorder + consumption toggles) ----------
  const [openMenuConsId, setOpenMenuConsId] = useState(null);
  const [openExtraConsId, setOpenExtraConsId] = useState(null);
  const moveByIndex = (arr, idx, dir) => {
    const ni = idx + dir;
    if (ni < 0 || ni >= arr.length) return arr;
    const copy = [...arr];
    const [it] = copy.splice(idx, 1);
    copy.splice(ni, 0, it);
    return copy;
  };
  const moveMenuUp = (id) =>
    setMenu((arr) => {
      const idx = arr.findIndex((x) => x.id === id);
      if (idx < 0) return arr;
      return moveByIndex(arr, idx, -1);
    });
  const moveMenuDown = (id) =>
    setMenu((arr) => {
      const idx = arr.findIndex((x) => x.id === id);
      if (idx < 0) return arr;
      return moveByIndex(arr, idx, +1);
    });
  const moveExtraUp = (id) =>
    setExtraList((arr) => {
      const idx = arr.findIndex((x) => x.id === id);
      if (idx < 0) return arr;
      return moveByIndex(arr, idx, -1);
    });
  const moveExtraDown = (id) =>
    setExtraList((arr) => {
      const idx = arr.findIndex((x) => x.id === id);
      if (idx < 0) return arr;
      return moveByIndex(arr, idx, +1);
    });

  const cardBorder = dark ? "#555" : "#ddd";
  const softBg = dark ? "#1e1e1e" : "#f5f5f5";
  const btnBorder = "#ccc";
  const containerStyle = {
    maxWidth: 1024,
    margin: "0 auto",
    padding: 16,
    background: dark ? "#121212" : "white",
    color: dark ? "#eee" : "black",
    minHeight: "100vh",
    transition: "background 0.2s ease, color 0.2s ease",
  };

  const handleTabClick = (key) => {
    if (key === "edit" && !pricesUnlocked) {
      const entered = window.prompt("Enter Editor PIN to open Edit:", "");
      if (entered == null) return;
      if (norm(entered) !== norm(EDITOR_PIN)) return alert("Wrong PIN.");
      setPricesUnlocked(true);
    }
    if (key === "bank" && !bankUnlocked) {
      const ok = !!promptAdminAndPin();
      if (!ok) return;
      setBankUnlocked(true);
    }
     if (key === "purchases" && !purchasesUnlocked) {
      const ok = !!promptAdminAndPin();
      if (!ok) return;
      setPurchasesUnlocked(true);
    }
    setActiveTab(key);
  };

  const bankBalance = useMemo(() => {
    return bankTx.reduce((sum, t) => {
      const a = Number(t.amount || 0);
      if (t.type === "deposit" || t.type === "init" || t.type === "adjustUp") return sum + a;
      if (t.type === "withdraw" || t.type === "adjustDown") return sum - a;
      return sum;
    }, 0);
  }, [bankTx]);
  // Money formatter for Purchases KPI & tables
const currency = (v) => `E£${Number(v || 0).toFixed(2)}`;

// Date -> YYYY-MM-DD for Purchases tables
const prettyDate = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
};

     // === ADD BELOW: Purchases PDF report =================================
const generatePurchasesPDF = () => {
  try {
    const doc = new jsPDF();
    const [start, end] = getPeriodRange(purchaseFilter, dayMeta);
    const title = `TUX — Purchases Report (${purchaseFilter.toUpperCase()})`;
    doc.text(title, 14, 12);

    const periodStr =
      `${start.toLocaleDateString()} → ${end.toLocaleDateString()}`;

    // Build filtered rows just like the UI
    const within = (purchases || []).filter((p) => {
      const d = p?.date instanceof Date ? p.date : new Date(p?.date);
      return isWithin(d, start, end);
    });
    const rows = purchaseCatFilterId
      ? within.filter((p) => p.categoryId === purchaseCatFilterId)
      : within;

    const totalAll = rows.reduce(
      (s, p) => s + Number(p.qty || 0) * Number(p.unitPrice || 0),
      0
    );

    // Header table
    autoTable(doc, {
      head: [["Period", "Filter", "Total (E£)"]],
      body: [[periodStr,
        purchaseCatFilterId
          ? (purchaseCategories.find(c=>c.id===purchaseCatFilterId)?.name || "(unknown)")
          : "All categories",
        totalAll.toFixed(2)]],
      startY: 18,
      theme: "grid",
      styles: { fontSize: 10 },
    });

    // Category totals
    const catMap = new Map();
    for (const p of rows) {
      const amt = Number(p.qty || 0) * Number(p.unitPrice || 0);
      const k = p.categoryId || "";
      catMap.set(k, (catMap.get(k) || 0) + amt);
    }

    let y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : 30;
    doc.text("Totals by Category", 14, y);
    const catBody = Array.from(catMap.entries())
      .map(([cid, amt]) => [
        purchaseCategories.find(c=>c.id===cid)?.name || "(unknown)",
        amt.toFixed(2),
      ])
      .sort((a,b) => Number(b[1]) - Number(a[1])); // desc by E£

    autoTable(doc, {
      head: [["Category", "Amount (E£)"]],
      body: catBody.length ? catBody : [["(no data)", "0.00"]],
      startY: y + 4,
      theme: "grid",
      styles: { fontSize: 10 },
    });

    // Full line items
    y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 36;
    doc.text("Line Items", 14, y);

    const lineBody = rows
      .slice()
      .sort((a, b) => +new Date(a.date) - +new Date(b.date))
      .map((p) => {
        const catName = purchaseCategories.find(c => c.id === p.categoryId)?.name || "-";
        const total = Number(p.qty || 0) * Number(p.unitPrice || 0);
        const d = p?.date instanceof Date ? p.date : new Date(p?.date);
        return [
          d.toLocaleDateString(),
          catName,
          p.itemName || "",
          String(p.unit || ""),
          Number(p.qty || 0).toString(),
          Number(p.unitPrice || 0).toFixed(2),
          total.toFixed(2),
        ];
      });

    autoTable(doc, {
      head: [["Date", "Category", "Item", "Unit", "Qty", "Unit Price", "Total (E£)"]],
      body: lineBody.length ? lineBody : [["—","—","—","—","0","0.00","0.00"]],
      startY: y + 4,
      theme: "grid",
      styles: { fontSize: 9 },
    });

    doc.save("tux_purchases_report.pdf");
    alert("Purchases PDF downloaded.");
  } catch (e) {
    console.error(e);
    alert("Could not generate Purchases PDF. Ensure pop-ups are allowed.");
  }
};


  /* --------------------------- UI --------------------------- */

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0 }}>🍔 TUX — Burger Truck POS</h1>
        <small>{nowStr}</small>
      </div>

      {/* Shift Control Bar */}
      <div
        style={{
          padding: 10,
          borderRadius: 6,
          background: softBg,
          marginBottom: 10,
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {!dayMeta.startedAt ? (
          <>
            <span>
              <b>Shift not started.</b>
            </span>
            <button
              onClick={startShift}
              style={{
                background: "#2e7d32",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              Start Shift
            </button>
            <small style={{ opacity: 0.8 }}>
              Select/enter worker first (Orders tab) or you'll be prompted.
            </small>
          </>
        ) : (
          <>
            <span>
              Started by <b>{dayMeta.startedBy}</b> at{" "}
              <b>{new Date(dayMeta.startedAt).toLocaleString()}</b>
              {dayMeta.currentWorker && (
                <> • Current: <b>{dayMeta.currentWorker}</b></>
              )}
            </span>
            <button
              onClick={() => generatePDF()}
              style={{
                background: "#7e57c2",
                color: "white",
                border: "none",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              Download PDF Report
            </button>
            <button
              onClick={changeShift}
              style={{
                background: "#37474f",
                color: "white",
                border: "none",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              Change Shift (on-duty)
            </button>
            <button
              onClick={endDay}
              style={{
                background: "#e53935",
                color: "white",
                border: "none",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              End the Day (requires PDF)
            </button>
          </>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          ["orders", "Orders"],
          ["board", "Orders Board"],
          ["inventory", "Inventory"],
          ["expenses", "Expenses"],
          ["purchases", "Purchases"], // ⬅️ NEW

          ["bank", "Bank"],
          ["reports", "Reports"],
          ["edit", "Edit"],            // renamed from Prices
          ["settings", "Settings"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => handleTabClick(key)}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: `1px solid ${btnBorder}`,
              background: activeTab === key ? "#ffd54f" : dark ? "#333" : "#eee",
              color: dark ? "#fff" : "#000",
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ORDERS */}
      {activeTab === "orders" && (
        <div>
          <h2>Select item</h2>

          <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 300 }}>
              <h3>Burgers & Items</h3>
              {/* TILE GRID (small icon-like cards) */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 10,
                }}
              >
                {menu.map((item) => {
                  const isSel = selectedBurger?.id === item.id;
                  const bg = item.color || (dark ? "#1e1e1e" : "#ffffff");
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedBurger(item)}
                      style={{
                        textAlign: "left",
                        padding: 12,
                        border: isSel ? "2px solid #1976d2" : `1px solid ${btnBorder}`,
                        borderRadius: 10,
                        background: bg,
                        color: dark ? "#eee" : "#000",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{item.name}</div>
                      <div>E£{item.price}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 300 }}>
              <h3>Extras (for selected item)</h3>
              {/* TILE GRID (multi-select) */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 10,
                }}
              >
                {extraList.map((ex) => {
                  const checked = !!selectedExtras.find((e) => e.id === ex.id);
                  const bg = ex.color || (dark ? "#1e1e1e" : "#ffffff");
                  return (
                    <button
                      key={ex.id}
                      onClick={() => toggleExtra(ex)}
                      style={{
                        textAlign: "left",
                        padding: 12,
                        border: checked ? "2px solid #1976d2" : `1px solid ${btnBorder}`,
                        borderRadius: 10,
                        background: bg,
                        color: dark ? "#eee" : "#000",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{ex.name}</div>
                      <div>E£{ex.price}</div>
                    </button>
                  );
                })}
              </div>

              {/* Qty + Add */}
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <strong>Qty:</strong>
                <button
                  onClick={() => setSelectedQty((q) => Math.max(1, Number(q || 1) - 1))}
                  style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${btnBorder}` }}
                >
                  –
                </button>
                <input
                  type="number"
                  value={selectedQty}
                  onChange={(e) => setSelectedQty(Math.max(1, Number(e.target.value || 1)))}
                  style={{ width: 70, textAlign: "center" }}
                />
                <button
                  onClick={() => setSelectedQty((q) => Math.max(1, Number(q || 1) + 1))}
                  style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${btnBorder}` }}
                >
                  +
                </button>

                <button
                  onClick={addToCart}
                  style={{
                    marginLeft: "auto",
                    padding: "10px 14px",
                    borderRadius: 6,
                    border: "none",
                    background: "#42a5f5",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  Add to cart
                </button>
              </div>
            </div>
          </div>

          {/* Cart */}
          <h3 style={{ marginTop: 16 }}>Cart</h3>
          {cart.length === 0 && <p>No items yet.</p>}
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {cart.map((it, idx) => {
              const extrasSum = (it.extras || []).reduce(
                (t, e) => t + Number(e.price || 0),
                0
              );
              const lineTotal =
                (Number(it.price || 0) + extrasSum) * Number(it.qty || 1);
              return (
                <li
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    border: `1px solid ${cardBorder}`,
                    borderRadius: 6,
                    padding: 8,
                    marginBottom: 6,
                    background: dark ? "#1a1a1a" : "transparent",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <strong>{it.name}</strong> — E£{it.price}
                    {it.extras?.length > 0 && (
                      <ul style={{ margin: "4px 0 0 16px", color: dark ? "#bbb" : "#555" }}>
                        {it.extras.map((e) => (
                          <li key={e.id}>+ {e.name} (E£{e.price})</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Qty stepper in cart */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      onClick={() => changeQty(idx, -1)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: `1px solid ${btnBorder}`,
                      }}
                    >
                      –
                    </button>
                    <input
                      type="number"
                      value={it.qty || 1}
                      onChange={(e) => setQty(idx, e.target.value)}
                      style={{ width: 60, textAlign: "center" }}
                    />
                    <button
                      onClick={() => changeQty(idx, +1)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: `1px solid ${btnBorder}`,
                      }}
                    >
                      +
                    </button>
                  </div>

                  <div style={{ minWidth: 120, textAlign: "right" }}>
                    <div>
                      <small>Line total</small>
                    </div>
                    <div>
                      <b>E£{lineTotal.toFixed(2)}</b>
                    </div>
                  </div>

                  <button
                    onClick={() => removeFromCart(idx)}
                    style={{
                      background: "#ef5350",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Notes */}
          <div style={{ margin: "8px 0 12px" }}>
            <label>
              <strong>Order notes:</strong>{" "}
              <input
                type="text"
                value={orderNote}
                placeholder="e.g., no pickles, extra spicy"
                onChange={(e) => setOrderNote(e.target.value)}
                style={{
                  width: 420,
                  maxWidth: "90%",
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: `1px solid ${btnBorder}`,
                  background: dark ? "#1e1e1e" : "white",
                  color: dark ? "#eee" : "#000",
                }}
              />
            </label>
          </div>

          {/* Selection groups & Checkout */}
          <div style={{ display: "grid", gap: 12 }}>
            {/* Button groups row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 8,
              }}
            >
              {/* Worker group */}
              <div
                style={{
                  border: `1px solid ${btnBorder}`,
                  borderRadius: 8,
                  padding: 8,
                  background: dark ? "#191919" : "#fafafa",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Worker</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {workers.map((w) => (
                    <button
                      key={w}
                      onClick={() => setWorker(w)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: `1px solid ${btnBorder}`,
                        background: worker === w ? "#c8e6c9" : "#fff",
                        cursor: "pointer",
                      }}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              {/* Payment group */}
              <div
                style={{
                  border: `1px solid ${btnBorder}`,
                  borderRadius: 8,
                  padding: 8,
                  background: dark ? "#191919" : "#fafafa",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Payment</div>
<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
  {paymentMethods.map((p) => (
    <button
      key={p}
      onClick={() => { setPayment(p); setSplitPay(false); }}
      style={{
        padding: "8px 10px",
        borderRadius: 8,
        border: `1px solid ${btnBorder}`,
        background: !splitPay && payment === p ? "#c8e6c9" : "#fff",
        cursor: "pointer",
      }}
    >
      {p}
    </button>
  ))}
</div>

{/* Split toggle */}
<div style={{ marginTop: 8 }}>
  <label>
    <input
      type="checkbox"
      checked={splitPay}
      onChange={(e) => {
        const on = e.target.checked;
        setSplitPay(on);
        if (on) setPayment(""); // ignore single payment when split
      }}
    />{" "}
    Split into two methods
  </label>
</div>

{/* Split UI */}
{splitPay && (
  <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
    <div>
      <div style={{ marginBottom: 4 }}><b>Method A</b></div>
      <select
        value={payA}
        onChange={(e) => setPayA(e.target.value)}
        style={{ width: "100%", padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}` }}
      >
        <option value="">Select method</option>
        {paymentMethods.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <input
        type="number"
        placeholder="Amount"
        value={amtA}
        onChange={(e) => setAmtA(Number(e.target.value || 0))}
        style={{ width: "100%", marginTop: 6 }}
      />
    </div>
    <div>
      <div style={{ marginBottom: 4 }}><b>Method B</b></div>
      <select
        value={payB}
        onChange={(e) => setPayB(e.target.value)}
        style={{ width: "100%", padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}` }}
      >
        <option value="">Select method</option>
        {paymentMethods.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <input
        type="number"
        placeholder="Amount"
        value={amtB}
        onChange={(e) => setAmtB(Number(e.target.value || 0))}
        style={{ width: "100%", marginTop: 6 }}
      />
    </div>
  </div>
)}

{/* Cash inputs */}
{!splitPay && payment === "Cash" && (
  <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
    <label>
      Cash received:&nbsp;
      <input
        type="number"
        value={cashReceived}
        onChange={(e) => setCashReceived(Number(e.target.value || 0))}
        style={{ width: 140 }}
      />
    </label>
    <small style={{ opacity: 0.8 }}>
      Change:{" "}
      <b>
        E£
        {(
          Math.max(
            0,
            Number(cashReceived || 0) -
              (cart.reduce((s, b) => {
                const ex = (b.extras || []).reduce((t, e) => t + Number(e.price || 0), 0);
                return s + (Number(b.price || 0) + ex) * Number(b.qty || 1);
              }, 0) + (orderType === "Delivery" ? Number(deliveryFee || 0) : 0))
          ) || 0
        ).toFixed(2)}
      </b>
    </small>
  </div>
)}

{splitPay && (payA === "Cash" || payB === "Cash") && (
  <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
    <label>
      Cash received (for cash part):&nbsp;
      <input
        type="number"
        value={cashReceivedSplit}
        onChange={(e) => setCashReceivedSplit(Number(e.target.value || 0))}
        style={{ width: 180 }}
      />
    </label>
    <small style={{ opacity: 0.8 }}>
      Change on cash part:{" "}
      <b>
        E£
        {(() => {
          const cashAmt = (payA === "Cash" ? amtA : 0) + (payB === "Cash" ? amtB : 0);
          return Math.max(0, Number(cashReceivedSplit || 0) - Number(cashAmt || 0)).toFixed(2);
        })()}
      </b>
    </small>
  </div>
)}

              </div>

              {/* Order type group */}
              <div
                style={{
                  border: `1px solid ${btnBorder}`,
                  borderRadius: 8,
                  padding: 8,
                  background: dark ? "#191919" : "#fafafa",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Order Type</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {orderTypes.map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setOrderType(t);
                        setDeliveryFee(t === "Delivery" ? (deliveryFee || defaultDeliveryFee) : 0);
                      }}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: `1px solid ${btnBorder}`,
                        background: orderType === t ? "#c8e6c9" : "#fff",
                        cursor: "pointer",
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {orderType === "Delivery" && (
  <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
    <div>
      <label>
        Delivery fee:&nbsp;
        <input
          type="number"
          value={deliveryFee}
          onChange={(e) => setDeliveryFee(Number(e.target.value || 0))}
          style={{ width: 120 }}
        />
      </label>
      <small style={{ opacity: 0.75 }}>
        &nbsp;(Default: E£{Number(defaultDeliveryFee || 0).toFixed(2)})
      </small>
    </div>
    <div>  {/* Zone auto-sets fee */}                                    {/* ⬅️ NEW */}
  <label>
    Zone:&nbsp;
    <select
      value={deliveryZoneId}
      onChange={(e) => {
        const zid = e.target.value;
        setDeliveryZoneId(zid);
        const z = deliveryZones.find(z => z.id === zid);
        if (z) setDeliveryFee(Number(z.fee || 0));
      }}
      style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}` }}
    >
      <option value="">Select zone</option>
      {deliveryZones.map(z => <option key={z.id} value={z.id}>{z.name} — E£{Number(z.fee||0).toFixed(2)}</option>)}
    </select>
  </label>
</div>


    {/* NEW: Customer details (only for Delivery) */}
    <input
      type="text"
      placeholder="Customer name"
      value={deliveryName}
      onChange={(e) => setDeliveryName(e.target.value)}
      style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}` }}
    />
    <input
  type="tel"
  list="phone-saved" 
  inputMode="numeric"
  pattern="\d{11}"
  maxLength={11}
  placeholder="Phone Number"
  value={deliveryPhone}
  onChange={(e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 11);
    setDeliveryPhone(digits);
  }}
  onKeyDown={(e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const allowed = ["Backspace","Delete","ArrowLeft","ArrowRight","Home","End","Tab"];
    if (allowed.includes(e.key) || ctrl) return;
    if (!/^\d$/.test(e.key)) e.preventDefault(); // block non-digits
  }}
  style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}` }}
/>
    <input
      type="text"
      placeholder="Address"
      value={deliveryAddress}
      onChange={(e) => setDeliveryAddress(e.target.value)}
      style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}` }}
    />
  </div>
)}

              </div>
            </div>

            {/* Totals + Checkout row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <div>
                <strong>Order Total (incl. delivery if any):</strong>{" "}
                E£
                {(
                  cart.reduce((s, b) => {
                    const ex = (b.extras || []).reduce(
                      (t, e) => t + Number(e.price || 0),
                      0
                    );
                    return (
                      s + (Number(b.price || 0) + ex) * Number(b.qty || 1)
                    );
                  }, 0) +
                  (orderType === "Delivery"
                    ? Number(deliveryFee || 0)
                    : 0)
                ).toFixed(2)}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  onClick={checkout}
                  disabled={isCheckingOut}
                  style={{
                    background: isCheckingOut ? "#9e9e9e" : "#43a047",
                    color: "white",
                    border: "none",
                    borderRadius: 8,
                    padding: "10px 14px",
                    cursor: isCheckingOut ? "not-allowed" : "pointer",
                    minWidth: 140,
                  }}
                >
                  {isCheckingOut ? "Processing..." : "Checkout"}
                </button>
                <small>
                  Next order #: <b>{nextOrderNo}</b>
                </small>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ORDERS BOARD */}
      {activeTab === "board" && (
        <div>
          <h2>Orders Board {realtimeOrders ? "(Live)" : ""}</h2>
          {orders.length === 0 && <p>No orders yet.</p>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {orders.map((o) => (
              <li
                key={`${o.cloudId || "local"}_${o.orderNo}`}
                style={{
                  border: `1px solid ${cardBorder}`,
                  borderRadius: 6,
                  padding: 10,
                  marginBottom: 8,
                  background: o.voided
                    ? dark
                      ? "#4a2b2b"
                      : "#ffebee"
                    : o.done
                    ? dark
                      ? "#14331a"
                      : "#e8f5e9"
                    : dark
                    ? "#333018"
                    : "#fffde7",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <strong>
                    Order #{o.orderNo} — E£{o.total.toFixed(2)}{" "}
                    {o.cloudId ? "☁" : ""}
                  </strong>
                  <span>{o.date.toLocaleString()}</span>
                </div>
                <div style={{ color: dark ? "#ccc" : "#555", marginTop: 4 }}>
                  Worker: {o.worker} • Payment: {o.payment}
                      {Array.isArray(o.paymentParts) && o.paymentParts.length ? (
                        <> ({o.paymentParts.map(p => `${p.method}: E£${Number(p.amount||0).toFixed(2)}`).join(" + ")})</>
                      ) : null}
                       • Type: {o.orderType || "-"}
                  {o.orderType === "Delivery" && (
                    <> • Delivery: E£{Number(o.deliveryFee || 0).toFixed(2)}</>
                  )}
                  {o.payment === "Cash" && o.cashReceived != null && (
                    <> • Cash: E£{o.cashReceived.toFixed(2)} • Change: E£{(o.changeDue || 0).toFixed(2)}</>
                  )}
                  {" "}• Status:{" "}
                             <strong>
                               {o.voided
                                 ? (o.restockedAt ? "Cancelled" : "Returned")
                                 : (o.done ? "Done" : "Not done")}
                             </strong>
                             {o.voided && (
  <>
    {o.restockedAt && (
      <span> • Cancelled at: {o.restockedAt.toLocaleString()}</span>
    )}
    {o.voidReason && (
      <span> • Reason: {o.voidReason}</span>
    )}
  </>
)}

                </div>

                <ul style={{ marginTop: 8, marginBottom: 8 }}>
                  {o.cart.map((ci, idx) => (
                    <li key={idx} style={{ marginLeft: 12 }}>
                      • {ci.name} × {ci.qty || 1} — E£{ci.price} each
                      {ci.extras?.length > 0 && (
                        <ul
                          style={{
                            margin: "2px 0 6px 18px",
                            color: dark ? "#bbb" : "#555",
                          }}
                        >
                          {ci.extras.map((ex) => (
                            <li key={ex.id}>
                              + {ex.name} (E£{ex.price}) × {ci.qty || 1}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {!o.done && !o.voided && (
                    <button
                      onClick={() => markOrderDone(o.orderNo)}
                      style={{
                        background: "#43a047",
                        color: "white",
                        border: "none",
                        borderRadius: 6,
                        padding: "6px 10px",
                        cursor: "pointer",
                      }}
                    >
                      Mark DONE (locks)
                    </button>
                  )}
                  {o.done && (
                    <button
                      disabled
                      style={{
                        background: "#9e9e9e",
                        color: "white",
                        border: "none",
                        borderRadius: 6,
                        padding: "6px 10px",
                        cursor: "not-allowed",
                      }}
                    >
                      DONE (locked)
                    </button>
                  )}

                  {/* Single Print button (removed all other print options) */}
                  <button
                    onClick={() => printReceiptHTML(o, Number(preferredPaperWidthMm) || 80, "Customer")}
                    disabled={o.voided}
                    style={{
                      background: o.voided ? "#039be588" : "#039be5",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    Print
                  </button>

                  <button
                   onClick={() => voidOrderAndRestock(o.orderNo)}
                   disabled={o.done || o.voided}
                    style={{
                      background: o.done || o.voided ? "#ef9a9a" : "#c62828",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 10px",
                      cursor: o.done || o.voided ? "not-allowed" : "pointer",
                    }}
                  >
                     Cancel (restock)
                  </button>

                      {!o.done && !o.voided && isExpenseVoidEligible(o.orderType) && (
                 <button
                   onClick={() => voidOrderToExpense(o.orderNo)}
                  style={{
                    background: "#fb8c00",        // orange
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 10px",
                    cursor: "pointer",
                  }}
  >
    Returned
  </button>
)}

                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* INVENTORY */}
      {activeTab === "inventory" && (
        <div>
          <h2>Inventory</h2>

          <div
            style={{
              padding: 10,
              borderRadius: 6,
              background: inventoryLocked
                ? dark
                  ? "#2b3a2b"
                  : "#e8f5e9"
                : dark
                ? "#332d1e"
                : "#fffde7",
              marginBottom: 10,
            }}
          >
            {inventoryLocked ? (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <strong>Locked:</strong>
                <span>
                  Start-of-day captured{" "}
                  {inventoryLockedAt
                    ? `at ${new Date(inventoryLockedAt).toLocaleString()}`
                    : "" }
                  . Editing disabled until <b>End the Day</b> or admin unlock.
                </span>
                <button
                  onClick={unlockInventoryWithPin}
                  style={{
                    background: "#8e24aa",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 10px",
                    cursor: "pointer",
                  }}
                >
                  Unlock Inventory (Admin PIN)
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span>Set your quantities, then:</span>
                <button
                  onClick={lockInventoryForDay}
                  style={{
                    background: "#2e7d32",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 10px",
                    cursor: "pointer",
                  }}
                >
                  Lock Inventory (start of day)
                </button>
              </div>
            )}
          </div>

          <div style={{ marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>
                    Item
                  </th>
                  <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>
                    Unit
                  </th>
                  <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>
                    Qty
                  </th>
                  <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((it) => (
                  <tr key={it.id}>
                    <td style={{ padding: 6 }}>{it.name}</td>
                    <td style={{ padding: 6 }}>{it.unit}</td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="number"
                        value={it.qty}
                        disabled={inventoryLocked}
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value || 0));
                          setInventory((inv) =>
                            inv.map((x) =>
                              x.id === it.id ? { ...x, qty: v } : x
                            )
                          );
                        }}
                        style={{ width: 120 }}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <button
                        disabled={inventoryLocked}
                        onClick={() =>
                          setInventory((inv) => inv.filter((x) => x.id !== it.id))
                        }
                        style={{
                          background: inventoryLocked ? "#9e9e9e" : "#c62828",
                          color: "#fff",
                          border: "none",
                          borderRadius: 6,
                          padding: "6px 10px",
                          cursor: inventoryLocked ? "not-allowed" : "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Add new inventory item */}
            {!inventoryLocked && (
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <input
                  type="text"
                  placeholder="Item name"
                  value={newInvName}
                  onChange={(e) => setNewInvName(e.target.value)}
                  style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}` }}
                />
                <input
                  type="text"
                  placeholder="Unit (g, pcs...)"
                  value={newInvUnit}
                  onChange={(e) => setNewInvUnit(e.target.value)}
                  style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, width: 120 }}
                />
                <input
                  type="number"
                  placeholder="Qty"
                  value={newInvQty}
                  onChange={(e) => setNewInvQty(Number(e.target.value || 0))}
                  style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, width: 120 }}
                />
                <button
                  onClick={() => {
                    const name = String(newInvName || "").trim();
                    const unit = String(newInvUnit || "").trim() || "pcs";
                    const qty = Math.max(0, Number(newInvQty || 0));
                    if (!name) return alert("Name required.");
                    const id =
                            name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "") ||
                             `inv_${Date.now()}`;
                    if (inventory.some((x) => x.id === id)) {
                      return alert("Item with same id exists, use a different name.");
                    }
                    setInventory((inv) => [...inv, { id, name, unit, qty }]);
                    setNewInvName("");
                    setNewInvUnit("");
                    setNewInvQty(0);
                  }}
                  style={{
                    background: "#1976d2",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 12px",
                    cursor: "pointer",
                  }}
                >
                  Add item
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* EXPENSES */}
      {activeTab === "expenses" && (
        <div>
          <h2>Expenses (Shift)</h2>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <input
              type="text"
              placeholder="Name"
              value={newExpName}
              onChange={(e) => setNewExpName(e.target.value)}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}` }}
            />
            <input
              type="text"
              placeholder="Unit"
              value={newExpUnit}
              onChange={(e) => setNewExpUnit(e.target.value)}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, width: 120 }}
            />
            <input
              type="number"
              placeholder="Qty"
              value={newExpQty}
              onChange={(e) => setNewExpQty(Number(e.target.value || 0))}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, width: 120 }}
            />
            <input
              type="number"
              placeholder="Unit Price (E£)"
              value={newExpUnitPrice}
              onChange={(e) => setNewExpUnitPrice(Number(e.target.value || 0))}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, width: 160 }}
            />
            <input
              type="text"
              placeholder="Note"
              value={newExpNote}
              onChange={(e) => setNewExpNote(e.target.value)}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, minWidth: 220 }}
            />
            <button
              onClick={() => {
                const name = String(newExpName || "").trim();
                if (!name) return alert("Expense name required.");
                const row = {
                  id: `exp_${Date.now()}`,
                  name,
                  unit: newExpUnit || "pcs",
                  qty: Math.max(0, Number(newExpQty || 0)),
                  unitPrice: Math.max(0, Number(newExpUnitPrice || 0)),
                  note: newExpNote || "",
                  date: new Date(),
                };
                setExpenses((arr) => [row, ...arr]);
                setNewExpName("");
                setNewExpUnit("pcs");
                setNewExpQty(1);
                setNewExpUnitPrice(0);
                setNewExpNote("");
              }}
              style={{
                background: "#2e7d32",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "8px 12px",
                cursor: "pointer",
              }}
            >
              Add Expense
            </button>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Name</th>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Unit</th>
                <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Qty</th>
                <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Unit Price</th>
                <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Total</th>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Date</th>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Note</th>
                <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td style={{ padding: 6 }}>{e.name}</td>
                  <td style={{ padding: 6 }}>{e.unit}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{e.qty}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>E£{Number(e.unitPrice || 0).toFixed(2)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>
                    E£{(Number(e.qty || 0) * Number(e.unitPrice || 0)).toFixed(2)}
                  </td>
                  <td style={{ padding: 6 }}>{e.date ? new Date(e.date).toLocaleString() : ""}</td>
                  <td style={{ padding: 6 }}>{e.note}</td>
                  <td style={{ padding: 6 }}>
                    <button
                      onClick={() => setExpenses((arr) => arr.filter((x) => x.id !== e.id))}
                      style={{
                        background: "#c62828",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        padding: "6px 10px",
                        cursor: "pointer",
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 8, opacity: 0.8 }}>
                    No expenses yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
{activeTab === "purchases" && (
  <div>
    <h2>Purchases</h2>

    {/* DAY / MONTH / YEAR buttons under title (right) */}
    <div style={{
      display: "flex",
      justifyContent: "flex-end",
      gap: 8,
      margin: "6px 0 10px"
    }}>
      {["day","month","year"].map((k) => (
        <button
          key={k}
          onClick={() => setPurchaseFilter(k)}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: `1px solid ${btnBorder}`,
            background: purchaseFilter === k ? "#ffd54f" : (dark ? "#2b2b2b" : "#f2f2f2"),
            fontWeight: 700,
            cursor: "pointer"
          }}
          aria-pressed={purchaseFilter === k}
        >
          {k.toUpperCase()}
        </button>
      ))}
<button
   onClick={() => setPurchaseCatFilterId("")}
   title="Show purchases from all categories"
   style={{ padding:"6px 10px", borderRadius:8, border:`1px solid ${btnBorder}`, background: dark ? "#2b2b2b" : "#f2f2f2", fontWeight:700, cursor:"pointer" }}
 >
   SHOW ALL
 </button>
 <button
   onClick={resetAllPurchases}
   style={{ padding:"6px 10px", borderRadius:8, border:"none", background:"#c62828", color:"#fff", fontWeight:700, cursor:"pointer" }}
 >
   Reset Purchases
 </button>
     {/* === ADD: Purchases PDF === */}
<button
  onClick={generatePurchasesPDF}
  style={{ padding:"6px 10px", borderRadius:8, border:"none", background:"#7e57c2", color:"#fff", fontWeight:700, cursor:"pointer" }}
>
  Download Purchases PDF
</button>

    </div>

    {/* === KPI ROW (only Total Purchases now) ========================= */}
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 12,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          position: "relative",
          padding: 16,
          borderRadius: 12,
          background: dark ? "#1e1e1e" : "#fff",
          border: `1px solid ${cardBorder}`,
        }}
      >
        <div style={{ fontWeight: 600, opacity: 0.9 }}>Total Purchases</div>
        <div style={{ marginTop: 6, fontSize: 24, fontWeight: 800 }}>
          {currency(totalPurchasesInPeriod)}
        </div>
      </div>
    </div>


   

 {/* === ADD PURCHASE ========================================== */}
<div
  style={{
    padding: 14,
    borderRadius: 12,
    background: dark ? "#1a1a1a" : "#fff",
    border: `1px solid ${cardBorder}`,
    marginBottom: 12,
    width: 940,            // fits columns + gaps + padding/borders
    maxWidth: 940,
    margin: "0 auto",
    boxSizing: "border-box",
  }}
>
  <div style={{ fontWeight: 700, marginBottom: 8, color: dark ? "#eee" : "#111" }}>
    Add Purchase
  </div>

  <div
    style={{
      display: "grid",
      // Row 1: Category | Item | Unit | Qty | Unit Price
      gridTemplateColumns: "200px 340px 100px 100px 120px",
      gap: 12,                 // constant space between all fields
      alignItems: "center",
    }}
  >
   {/* Category + Delete */}
<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
  <select
    value={newPurchase.categoryId}
    onChange={(e) => {
      const id = e.target.value;
      setNewPurchase((p) => ({ ...p, categoryId: id }));
      setPurchaseCatFilterId(id);
    }}
    style={{
      padding: 10,
      borderRadius: 10,
      border: `1px solid ${btnBorder}`,
      background: dark ? "#121212" : "#fff",
      color: dark ? "#eee" : "#000",
      minWidth: 0,
      width: "100%",
    }}
  >
    <option value="">Category…</option>
    {purchaseCategories.map((c) => (
      <option key={c.id} value={c.id}>{c.name}</option>
    ))}
  </select>

  {/* Delete current category (uses removePurchaseCategory) */}
  <button
    type="button"
    title="Delete selected category"
    onClick={() => {
      if (!newPurchase.categoryId) return;
      removePurchaseCategory(newPurchase.categoryId);
    }}
    style={{
      padding: "10px 12px",
      borderRadius: 10,
      border: `1px solid ${btnBorder}`,
      background: dark ? "#2a2a2a" : "#fff",
      color: dark ? "#eee" : "#000",
      cursor: newPurchase.categoryId ? "pointer" : "not-allowed",
      opacity: newPurchase.categoryId ? 1 : 0.5,
      whiteSpace: "nowrap",
    }}
  >
    🗑
  </button>
</div>


    {/* Item name */}
    <input
      type="text"
      placeholder="Item name"
      value={newPurchase.itemName}
      onChange={(e) =>
        setNewPurchase((p) => ({ ...p, itemName: e.target.value }))
      }
      style={{
        padding: 10,
        borderRadius: 10,
        border: `1px solid ${btnBorder}`,
        background: dark ? "#121212" : "#fff",
        color: dark ? "#eee" : "#000",
        minWidth: 0,
        width: "100%",
      }}
    />

    {/* Unit (fixed list) */}
    <select
      value={newPurchase.unit}
      onChange={(e) => setNewPurchase((p) => ({ ...p, unit: e.target.value }))}
      style={{
        padding: 10,
        borderRadius: 10,
        border: `1px solid ${btnBorder}`,
        textAlign: "center",
        background: dark ? "#121212" : "#fff",
        color: dark ? "#eee" : "#000",
        minWidth: 0,
        width: "100%",
      }}
    >
      {["pcs","kg","g","L","ml","pack","box","bag","dozen","bottle","can","carton","slice","block","Paper"].map((u) => (
        <option key={u} value={u}>{u}</option>
      ))}
    </select>

    {/* Qty */}
    <input
      type="number"
      step="any"
      min={0}
      value={newPurchase.qty}
      onChange={(e) =>
        setNewPurchase((p) => ({ ...p, qty: Number(e.target.value || 0) }))
      }
      style={{
        padding: 10,
        borderRadius: 10,
        border: `1px solid ${btnBorder}`,
        textAlign: "center",
        minWidth: 0,
        width: "100%",
      }}
    />

    {/* Unit price */}
    <input
      type="number"
      step="0.01"
      min={0}
      value={newPurchase.unitPrice}
      onChange={(e) =>
        setNewPurchase((p) => ({ ...p, unitPrice: Number(e.target.value || 0) }))
      }
      style={{
        padding: 10,
        borderRadius: 10,
        border: `1px solid ${btnBorder}`,
        textAlign: "center",
        minWidth: 0,
        width: "100%",
      }}
    />

    {/* Row 2: Date (col 1) + Add button (col 2) */}
    <input
      type="date"
      value={newPurchase.date}
      onChange={(e) => setNewPurchase((p) => ({ ...p, date: e.target.value }))}
      style={{
        gridColumn: "1 / 2",
        padding: 10,
        borderRadius: 10,
        border: `1px solid ${btnBorder}`,
        background: dark ? "#121212" : "#fff",
        color: dark ? "#eee" : "#000",
        minWidth: 0,
        width: "100%",
      }}
    />

    <button
      onClick={handleAddPurchase}
      style={{
        gridColumn: "2 / 3",
        padding: "10px 14px",
        borderRadius: 10,
        border: "none",
        background: "#000",
        color: "#fff",
        cursor: "pointer",
        whiteSpace: "nowrap",
        width: "100%",
      }}
    >
      Add Purchase
    </button>
  </div>
</div>


    {/* === DETAILS LIST ================================================= */}
    <div style={{ marginTop: 4 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>All Categories</div>

      {purchaseCategories.map((cat) => {
        const rows = byCategory.get(cat.id) || [];
        const total = catTotals.get(cat.id) || 0;
        return (
          <div
            key={cat.id}
            style={{
              border: `1px solid ${cardBorder}`,
              borderRadius: 12,
              background: dark ? "#141414" : "#fff",
              marginBottom: 12,
              overflow: "hidden",
            }}
          >
            {/* Section header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                background: dark ? "#1c1c1c" : "#fafafa",
                borderBottom: `1px solid ${cardBorder}`,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  width: 24,
                  height: 24,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 6,
                  border: `1px solid ${btnBorder}`,
                  fontSize: 14,
                }}
              >
                📦
              </span>
              <div style={{ fontWeight: 700 }}>{cat.name}</div>
              <div style={{ opacity: 0.8 }}>• {currency(total)}</div>
            </div>

            {/* Table */}
            <div style={{ padding: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Date", "Item", "Unit", "Qty", "Unit Price", "Total"].map(
                      (h) => (
                        <th
                          key={h}
                          style={{
                            textAlign:
                              h === "Qty" || h === "Unit Price" || h === "Total"
                                ? "right"
                                : "left",
                            borderBottom: `1px solid ${cardBorder}`,
                            padding: 8,
                            fontWeight: 700,
                          }}
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 8, opacity: 0.7 }}>
                        No purchases in this period.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr key={r.id}>
                        <td style={{ padding: 8 }}>{prettyDate(r.date)}</td>
                        <td style={{ padding: 8 }}>{r.itemName || "-"}</td>
                        <td style={{ padding: 8 }}>{r.unit || "-"}</td>
                        <td style={{ padding: 8, textAlign: "right" }}>
                          {Number(r.qty || 0)}
                        </td>
                        <td style={{ padding: 8, textAlign: "right" }}>
                          {currency(r.unitPrice)}
                        </td>
                        <td style={{ padding: 8, textAlign: "right" }}>
                          {currency(Number(r.qty || 0) * Number(r.unitPrice || 0))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  </div>
)}



      {/* BANK */}
      {activeTab === "bank" && (
        <div>
          <h2>Bank / Cashbox</h2>
          <div
            style={{
              marginBottom: 10,
              padding: 10,
              borderRadius: 6,
              background: dark ? "#1b2631" : "#e3f2fd",
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <strong>Balance:</strong> <span>E£{bankBalance.toFixed(2)}</span>
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <select
              value={bankForm.type}
              onChange={(e) => setBankForm((f) => ({ ...f, type: e.target.value }))}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}` }}
            >
              <option value="deposit">Deposit (+)</option>
              <option value="withdraw">Withdraw (-)</option>
              <option value="adjustUp">Adjust Up (+)</option>
              <option value="adjustDown">Adjust Down (-)</option>
              <option value="init">Init (set by margin)</option>
            </select>
            <input
              type="number"
              placeholder="Amount"
              value={bankForm.amount}
              onChange={(e) => setBankForm((f) => ({ ...f, amount: Number(e.target.value || 0) }))}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, width: 160 }}
            />
            <input
              type="text"
              placeholder="Worker"
              list="bank-worker-list"
              value={bankForm.worker}
              onChange={(e) => setBankForm((f) => ({ ...f, worker: e.target.value }))}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, width: 180 }}
            />
            <datalist id="bank-worker-list">
              {workers.map((w) => (
                <option key={w} value={w} />
              ))}
            </datalist>
            <input
              type="text"
              placeholder="Note"
              value={bankForm.note}
              onChange={(e) => setBankForm((f) => ({ ...f, note: e.target.value }))}
              style={{ padding:                   6, borderRadius: 6, border: `1px solid ${btnBorder}`, minWidth: 240 }}
            />
            <button
              onClick={() => {
                const amt = Number(bankForm.amount || 0);
                if (!amt) return alert("Amount must be > 0.");
                const row = {
                  id: `tx_${Date.now()}`,
                  type: bankForm.type || "deposit",
                  amount: Math.abs(amt),
                  worker: bankForm.worker || "",
                  note: bankForm.note || "",
                  date: new Date(),
                };
                setBankTx((arr) => [row, ...arr]);
                setBankForm({ type: "deposit", amount: 0, worker: "", note: "" });
              }}
              style={{
                background: "#1976d2",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "8px 12px",
                cursor: "pointer",
              }}
            >
              Add Entry
            </button>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Type</th>
                <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Amount (E£)</th>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Worker</th>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Date</th>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Note</th>
                <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bankTx.map((t) => (
                <tr key={t.id}>
                  <td style={{ padding: 6 }}>{t.type}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{Number(t.amount || 0).toFixed(2)}</td>
                  <td style={{ padding: 6 }}>{t.worker}</td>
                  <td style={{ padding: 6 }}>{t.date ? new Date(t.date).toLocaleString() : ""}</td>
                  <td style={{ padding: 6 }}>{t.note}</td>
                  <td style={{ padding: 6 }}>
                    <button
                      onClick={() => setBankTx((arr) => arr.filter((x) => x.id !== t.id))}
                      style={{
                        background: "#c62828",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        padding: "6px 10px",
                        cursor: "pointer",
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {bankTx.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 8, opacity: 0.8 }}>
                    No bank entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* REPORTS */}
      {activeTab === "reports" && (
        <div>
          <h2>Reports</h2>

          {/* Totals overview */}
          <div
            style={{
              marginBottom: 12,
              padding: 10,
              borderRadius: 6,
              background: dark ? "#1b2631" : "#e3f2fd",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 10,
            }}
          >
            <div><b>Revenue (items only):</b><br/>E£{totals.revenueTotal.toFixed(2)}</div>
            <div><b>Delivery Fees:</b><br/>E£{totals.deliveryFeesTotal.toFixed(2)}</div>
            <div><b>Expenses:</b><br/>E£{totals.expensesTotal.toFixed(2)}</div>
            <div><b>Margin:</b><br/>E£{totals.margin.toFixed(2)}</div>
          </div>

          {/* Items summary (old style: name, unit price (avg), qty, total) */}
          <h3>Items Sold</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Item</th>
                <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Qty</th>
                <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Avg Price (E£)</th>
                <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Total (E£)</th>
              </tr>
            </thead>
            <tbody>
              {salesStats.items.map((r) => {
                const avg = r.count ? r.revenue / r.count : 0;
                return (
                  <tr key={r.id}>
                    <td style={{ padding: 6 }}>{r.name}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{r.count}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{avg.toFixed(2)}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{r.revenue.toFixed(2)}</td>
                  </tr>
                );
              })}
              {salesStats.items.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 8, opacity: 0.8 }}>No items sold in this shift.</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Extras summary */}
          <h3>Extras Sold</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Extra</th>
                <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Qty</th>
                <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Avg Price (E£)</th>
                <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Total (E£)</th>
              </tr>
            </thead>
            <tbody>
              {salesStats.extras.map((r) => {
                const avg = r.count ? r.revenue / r.count : 0;
                return (
                  <tr key={r.id}>
                    <td style={{ padding: 6 }}>{r.name}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{r.count}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{avg.toFixed(2)}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{r.revenue.toFixed(2)}</td>
                  </tr>
                );
              })}
              {salesStats.extras.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 8, opacity: 0.8 }}>No extras sold in this shift.</td>
                </tr>
              )}
            </tbody>
          </table>
                {/* Inventory — Start vs Now */}
<h3>Inventory — Start vs Now</h3>
{(!inventorySnapshot || inventorySnapshot.length === 0) ? (
  <p style={{ opacity: 0.8 }}>
    No inventory snapshot yet. Use <b>Inventory → Lock Inventory (start of day)</b> to capture start quantities.
  </p>
) : (
  <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
    <thead>
      <tr>
        <th style={{ textAlign: "left",  borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Item</th>
        <th style={{ textAlign: "left",  borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Unit</th>
        <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Start Qty</th>
        <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Current Qty</th>
        <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Used</th>
      </tr>
    </thead>
    <tbody>
      {inventoryReportRows.map((r) => (
        <tr key={r.name}>
          <td style={{ padding: 6 }}>{r.name}</td>
          <td style={{ padding: 6 }}>{r.unit}</td>
          <td style={{ padding: 6, textAlign: "right" }}>{r.start}</td>
          <td style={{ padding: 6, textAlign: "right" }}>{r.now}</td>
          <td style={{ padding: 6, textAlign: "right" }}>{r.used}</td>
        </tr>
      ))}
    </tbody>
  </table>
)}

        </div>
      )}

      {/* EDIT (was "Prices") */}
      {activeTab === "edit" && (
        <div>
          <h2>Edit</h2>

          {/* Items editor */}
          <h3>Menu Items</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Name</th>
                <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Price (E£)</th>
                <th style={{ textAlign: "center", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Color</th>
                <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Arrange</th>
                <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {menu.map((it, idx) => (
                <React.Fragment key={it.id}>
                  <tr>
                    <td style={{ padding: 6 }}>
                      <input
                        type="text"
                        value={it.name}
                        onChange={(e) =>
                          setMenu((arr) => arr.map((x) => (x.id === it.id ? { ...x, name: e.target.value } : x)))
                        }
                        style={{ width: "100%", padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}` }}
                      />
                    </td>
                    <td style={{ padding: 6, textAlign: "right" }}>
                      <input
                        type="number"
                        value={it.price}
                        onChange={(e) =>
                          setMenu((arr) => arr.map((x) => (x.id === it.id ? { ...x, price: Number(e.target.value || 0) } : x)))
                        }
                        style={{ width: 120, padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ padding: 6, textAlign: "center" }}>
                      <input
                        type="color"
                        value={it.color || "#ffffff"}
                        onChange={(e) =>
                          setMenu((arr) => arr.map((x) => (x.id === it.id ? { ...x, color: e.target.value } : x)))
                        }
                        style={{ width: 40, height: 28, border: "none", background: "none" }}
                      />
                    </td>
                    <td style={{ padding: 6, textAlign: "center" }}>
                      <button onClick={() => moveMenuUp(it.id)} style={{ marginRight: 6 }}>↑</button>
                      <button onClick={() => moveMenuDown(it.id)}>↓</button>
                    </td>
                    <td style={{ padding: 6 }}>
                      <button
                        onClick={() => setOpenMenuConsId((v) => (v === it.id ? null : it.id))}
                        style={{
                          background: "#455a64",
                          color: "#fff",
                          border: "none",
                          borderRadius: 6,
                          padding: "6px 10px",
                          cursor: "pointer",
                          marginRight: 6,
                        }}
                      >
                        Edit Consumption
                      </button>
                      <button
                        onClick={() => setMenu((arr) => arr.filter((x) => x.id !== it.id))}
                        style={{
                          background: "#c62828",
                          color: "#fff",
                          border: "none",
                          borderRadius: 6,
                          padding: "6px 10px",
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                  {openMenuConsId === it.id && (
                    <tr>
                      <td colSpan={5} style={{ padding: 6, background: dark ? "#151515" : "#fafafa" }}>
                       <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                              columnGap: 16,
                              rowGap: 14,
                            }}
                          >

                          {inventory.map((inv) => {
                            const cur = Number((it.uses || {})[inv.id] || 0);
                            return (
                              <label
                                key={inv.id}
                                style={{
                                  display: "flex",
                                  gap: 6,
                                  alignItems: "center",
                                  padding: 6,
                                  borderRadius: 6,
                                  border: `1px solid ${btnBorder}`,
                                  background: dark ? "#1e1e1e" : "#fff",
                                }}
                              >
                                <span style={{ minWidth: 120 }}>{inv.name} ({inv.unit})</span>
                                <input
                                  type="number"
                                  value={cur}
                                  min={0}
                                  step="any"
                                  onChange={(e) => {
                                    const v = Math.max(0, Number(e.target.value || 0));
                                    setMenu((arr) =>
                                      arr.map((x) =>
                                        x.id === it.id
                                          ? {
                                              ...x,
                                              uses: v > 0
                                                ? { ...(x.uses || {}), [inv.id]: v }
                                                : Object.fromEntries(Object.entries(x.uses || {}).filter(([k]) => k !== inv.id)),
                                            }
                                          : x
                                      )
                                    );
                                  }}
                                  style={{ width: 120 }}
                                />
                              </label>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {menu.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 8, opacity: 0.8 }}>No items. Add some below.</td>
                </tr>
              )}
            </tbody>
          </table>
{/* ───────── Inventory Costs (E£/unit) & COGS (place right after Items/Extras) ───────── */}  {/* ⬅️ NEW */}
<h3 style={{ marginTop: 18 }}>Inventory Costs (E£ / unit)</h3>
<table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
  <thead>
    <tr>
      <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Ingredient</th>
      <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Unit</th>
      <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Cost / Unit (E£)</th>
    </tr>
  </thead>
  <tbody>
    {inventory.map((it) => (
      <tr key={it.id}>
        <td style={{ padding: 6 }}>{it.name}</td>
        <td style={{ padding: 6 }}>{it.unit}</td>
        <td style={{ padding: 6, textAlign: "right" }}>
          <input
            type="number"
            step="any"
            value={Number(it.costPerUnit ?? 0)}
            onChange={(e) => {
              const v = Number(e.target.value || 0);
              setInventory((inv) => inv.map(x => x.id === it.id ? { ...x, costPerUnit: v } : x));
            }}
            style={{ width: 140, textAlign: "right" }}
          />
        </td>
      </tr>
    ))}
  </tbody>
</table>

<h3>COGS per Menu Item (auto)</h3>
<table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
  <thead>
    <tr>
      <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Item</th>
      <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>COGS / unit (E£)</th>
      <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Price (E£)</th>
      <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Gross / unit (E£)</th>
    </tr>
  </thead>
  <tbody>
    {menu.map((m) => {
      const cogs = computeCOGSForItemDef(m, invById);
      const price = Number(m.price || 0);
      return (
        <tr key={m.id}>
          <td style={{ padding: 6 }}>{m.name}</td>
          <td style={{ padding: 6, textAlign: "right" }}>{cogs.toFixed(2)}</td>
          <td style={{ padding: 6, textAlign: "right" }}>{price.toFixed(2)}</td>
          <td style={{ padding: 6, textAlign: "right" }}>{(price - cogs).toFixed(2)}</td>
        </tr>
      );
    })}
  </tbody>
</table>


          {/* Add item */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
            <input
              type="text"
              placeholder="New item name"
              value={newMenuName}
              onChange={(e) => setNewMenuName(e.target.value)}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, minWidth: 220 }}
            />
            <input
              type="number"
              placeholder="Price (E£)"
              value={newMenuPrice}
              onChange={(e) => setNewMenuPrice(Number(e.target.value || 0))}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, width: 160 }}
            />
            <button
              onClick={() => {
                const name = String(newMenuName || "").trim();
                if (!name) return alert("Name required.");
                const id = Date.now();
                setMenu((arr) => [...arr, { id, name, price: Math.max(0, Number(newMenuPrice || 0)), uses: {}, color: "#ffffff" }]);
                setNewMenuName("");
                setNewMenuPrice(0);
              }}
              style={{
                background: "#2e7d32",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "8px 12px",
                cursor: "pointer",
              }}
            >
              Add Item
            </button>
          </div>

          {/* Extras editor */}
          <h3>Extras</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Name</th>
                <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Price (E£)</th>
                <th style={{ textAlign: "center", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Color</th>
                <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Arrange</th>
                <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {extraList.map((ex, idx) => (
                <React.Fragment key={ex.id}>
                  <tr>
                    <td style={{ padding: 6 }}>
                      <input
                        type="text"
                        value={ex.name}
                        onChange={(e) =>
                          setExtraList((arr) => arr.map((x) => (x.id === ex.id ? { ...x, name: e.target.value } : x)))
                        }
                        style={{ width: "100%", padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}` }}
                      />
                    </td>
                    <td style={{ padding: 6, textAlign: "right" }}>
                      <input
                        type="number"
                        value={ex.price}
                        onChange={(e) =>
                          setExtraList((arr) => arr.map((x) => (x.id === ex.id ? { ...x, price: Number(e.target.value || 0) } : x)))
                        }
                        style={{ width: 120, padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ padding: 6, textAlign: "center" }}>
                      <input
                        type="color"
                        value={ex.color || "#ffffff"}
                        onChange={(e) =>
                          setExtraList((arr) => arr.map((x) => (x.id === ex.id ? { ...x, color: e.target.value } : x)))
                        }
                        style={{ width: 40, height: 28, border: "none", background: "none" }}
                      />
                    </td>
                    <td style={{ padding: 6, textAlign: "center" }}>
                      <button onClick={() => moveExtraUp(ex.id)} style={{ marginRight: 6 }}>↑</button>
                      <button onClick={() => moveExtraDown(ex.id)}>↓</button>
                    </td>
                    <td style={{ padding: 6 }}>
                      <button
                        onClick={() => setOpenExtraConsId((v) => (v === ex.id ? null : ex.id))}
                        style={{
                          background: "#455a64",
                          color: "#fff",
                          border: "none",
                          borderRadius: 6,
                          padding: "6px 10px",
                          cursor: "pointer",
                          marginRight: 6,
                        }}
                      >
                        Edit Consumption
                      </button>
                          
                      <button
                        onClick={() => setExtraList((arr) => arr.filter((x) => x.id !== ex.id))}
                        style={{
                          background: "#c62828",
                          color: "#fff",
                          border: "none",
                          borderRadius: 6,
                          padding: "6px 10px",
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                  {openExtraConsId === ex.id && (
  <tr>
    <td colSpan={5} style={{ padding: 6, background: dark ? "#151515" : "#fafafa" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          columnGap: 16,
          rowGap: 14,
        }}
      >
        {inventory.map((inv) => {
          const cur = Number((ex.uses || {})[inv.id] || 0);
          return (
            <label
              key={inv.id}
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                padding: 6,
                borderRadius: 6,
                border: `1px solid ${btnBorder}`,
                background: dark ? "#1e1e1e" : "#fff",
              }}
            >
              <span style={{ minWidth: 120 }}>
                {inv.name} ({inv.unit})
              </span>
              <input
                type="number"
                value={cur}
                min={0}
                step="any"
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value || 0));
                  setExtraList((arr) =>
                    arr.map((x) =>
                      x.id === ex.id
                        ? {
                            ...x,
                            uses:
                              v > 0
                                ? { ...(x.uses || {}), [inv.id]: v }
                                : Object.fromEntries(
                                    Object.entries(x.uses || {}).filter(
                                      ([k]) => k !== inv.id
                                    )
                                  ),
                          }
                        : x
                    )
                  );
                }}
                style={{ width: 120 }}
              />
            </label>
          );
        })}
      </div>
    </td>
  </tr>
)}


                </React.Fragment>
              ))}
              {extraList.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 8, opacity: 0.8 }}>No extras. Add some below.</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Add extra */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
            <input
              type="text"
              placeholder="New extra name"
              value={newExtraName}
              onChange={(e) => setNewExtraName(e.target.value)}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, minWidth: 220 }}
            />
            <input
              type="number"
              placeholder="Price (E£)"
              value={newExtraPrice}
              onChange={(e) => setNewExtraPrice(Number(e.target.value || 0))}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, width: 160 }}
            />
            <button
  onClick={() => {
    const name = String(newExtraName || "").trim();
    if (!name) return alert("Name required.");

    const id = Date.now();
    setExtraList((arr) => [
      ...arr,
      {
        id,
        name,
        price: Math.max(0, Number(newExtraPrice || 0)),
        uses: {},
        color: "#ffffff",
      },
    ]);

    setNewExtraName("");
    setNewExtraPrice(0);
  }}
  style={{
    background: "#2e7d32",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "8px 12px",
    cursor: "pointer",
  }}
>
  Add Extra
</button>


          {/* Workers / Payments / Order Types — side-by-side */}
<h3>People & Payments</h3>

<div
  style={{
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(260px, 1fr))",
    gap: 12,
    marginBottom: 16,
  }}
>
  {/* Workers */}
  <div
    style={{
      border: `1px solid ${btnBorder}`,
      borderRadius: 8,
      padding: 10,
      background: dark ? "#191919" : "#fafafa",
    }}
  >
    <div style={{ fontWeight: 700, marginBottom: 8 }}>Workers</div>

    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {workers.map((w, idx) => (
        <li
          key={`${w}-${idx}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: 6,
            border: `1px solid ${btnBorder}`,
            borderRadius: 6,
            background: dark ? "#1e1e1e" : "#fff",
            marginBottom: 6,
          }}
        >
          <span>{w}</span>
          <button
            onClick={() =>
              setWorkers((arr) => arr.filter((x, i) => i !== idx))
            }
            style={{
              background: "#c62828",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "4px 8px",
              cursor: "pointer",
            }}
          >
            Remove
          </button>
        </li>
      ))}
      {workers.length === 0 && (
        <li style={{ opacity: 0.8, padding: 6 }}>No workers yet.</li>
      )}
    </ul>

    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
      <input
        type="text"
        placeholder="New worker name"
        value={newWorker}
        onChange={(e) => setNewWorker(e.target.value)}
        style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, flex: 1 }}
      />
      <button
        onClick={() => {
          const v = String(newWorker || "").trim();
          if (!v) return alert("Worker name required.");
          if (workers.some((x) => String(x).trim().toLowerCase() === v.toLowerCase()))
            return alert("Worker already exists.");
          setWorkers((arr) => [...arr, v]);
          setNewWorker("");
        }}
        style={{
          background: "#1976d2",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "8px 12px",
          cursor: "pointer",
        }}
      >
        Add
      </button>
    </div>
  </div>

  {/* Payment Methods */}
  <div
    style={{
      border: `1px solid ${btnBorder}`,
      borderRadius: 8,
      padding: 10,
      background: dark ? "#191919" : "#fafafa",
    }}
  >
    <div style={{ fontWeight: 700, marginBottom: 8 }}>Payment Methods</div>

    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {paymentMethods.map((p, idx) => (
        <li
          key={`${p}-${idx}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: 6,
            border: `1px solid ${btnBorder}`,
            borderRadius: 6,
            background: dark ? "#1e1e1e" : "#fff",
            marginBottom: 6,
          }}
        >
          <span>{p}</span>
          <button
            onClick={() =>
              setPaymentMethods((arr) => arr.filter((x, i) => i !== idx))
            }
            style={{
              background: "#c62828",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "4px 8px",
              cursor: "pointer",
            }}
          >
            Remove
          </button>
        </li>
      ))}
      {paymentMethods.length === 0 && (
        <li style={{ opacity: 0.8, padding: 6 }}>No payment methods yet.</li>
      )}
    </ul>

    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
      <input
        type="text"
        placeholder="New payment method"
        value={newPayment}
        onChange={(e) => setNewPayment(e.target.value)}
        style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, flex: 1 }}
      />
      <button
        onClick={() => {
          const v = String(newPayment || "").trim();
          if (!v) return alert("Payment method required.");
          if (paymentMethods.some((x) => String(x).trim().toLowerCase() === v.toLowerCase()))
            return alert("Payment method already exists.");
          setPaymentMethods((arr) => [...arr, v]);
          setNewPayment("");
        }}
        style={{
          background: "#1976d2",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "8px 12px",
          cursor: "pointer",
        }}
      >
        Add
      </button>
    </div>
  </div>

  {/* Order Types (third column) */}
  <div
    style={{
      border: `1px solid ${btnBorder}`,
      borderRadius: 8,
      padding: 10,
      background: dark ? "#191919" : "#fafafa",
    }}
  >
    <div style={{ fontWeight: 700, marginBottom: 8 }}>Order Types</div>

    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {orderTypes.map((t, idx) => (
        <li
          key={`${t}-${idx}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: 6,
            border: `1px solid ${btnBorder}`,
            borderRadius: 6,
            background: dark ? "#1e1e1e" : "#fff",
            marginBottom: 6,
          }}
        >
          <span>{t}</span>
          <button
            onClick={() =>
              setOrderTypes((arr) => arr.filter((x, i) => i !== idx))
            }
            style={{
              background: "#c62828",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "4px 8px",
              cursor: "pointer",
            }}
          >
            Remove
          </button>
        </li>
      ))}
      {orderTypes.length === 0 && (
        <li style={{ opacity: 0.8, padding: 6 }}>No order types yet.</li>
      )}
    </ul>

    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
      <input
        type="text"
        placeholder="New order type"
        value={newOrderType}
        onChange={(e) => setNewOrderType(e.target.value)}
        style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, flex: 1 }}
      />
      <button
        onClick={() => {
          const v = String(newOrderType || "").trim();
          if (!v) return alert("Order type required.");
          if (orderTypes.some((x) => String(x).trim().toLowerCase() === v.toLowerCase()))
            return alert("Order type already exists.");
          setOrderTypes((arr) => [...arr, v]);
          setNewOrderType("");
        }}
        style={{
          background: "#1976d2",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "8px 12px",
          cursor: "pointer",
        }}
      >
        Add
      </button>
    </div>
  </div>
</div>

<h3>Delivery Zones & Fees</h3>   {/* ⬅️ NEW */}
<table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
  <thead>
    <tr>
      <th style={{ textAlign: "left", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Name</th>
      <th style={{ textAlign: "right", borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Fee (E£)</th>
      <th style={{ borderBottom: `1px solid ${cardBorder}`, padding: 6 }}>Actions</th>
    </tr>
  </thead>
  <tbody>
    {deliveryZones.map(z => (
      <tr key={z.id}>
        <td style={{ padding: 6 }}>
          <input
            type="text"
            value={z.name}
            onChange={(e)=> setDeliveryZones(arr => arr.map(x => x.id === z.id ? { ...x, name: e.target.value } : x))}
            style={{ width: "100%" }}
          />
        </td>
        <td style={{ padding: 6, textAlign: "right" }}>
          <input
            type="number"
            value={z.fee}
            onChange={(e)=> setDeliveryZones(arr => arr.map(x => x.id === z.id ? { ...x, fee: Number(e.target.value || 0) } : x))}
            style={{ width: 140, textAlign: "right" }}
          />
        </td>
        <td style={{ padding: 6 }}>
          <button
            onClick={()=> setDeliveryZones(arr => arr.filter(x => x.id !== z.id))}
            style={{ background: "#c62828", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
          >
            Remove
          </button>
        </td>
      </tr>
    ))}
  </tbody>
</table>
<div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
  <input id="new-zone-name" type="text" placeholder="Zone name" style={{ flex: 1 }} />
  <input id="new-zone-fee" type="number" placeholder="Fee" style={{ width: 160 }} />
  <button
    onClick={() => {
      const n = String(document.getElementById("new-zone-name").value || "").trim();
      const f = Number(document.getElementById("new-zone-fee").value || 0);
      if (!n) return;
      setDeliveryZones(arr => [...arr, { id: `z_${Date.now()}`, name: n, fee: Math.max(0, f) }]);
      document.getElementById("new-zone-name").value = "";
      document.getElementById("new-zone-fee").value = "";
    }}
    style={{ background: "#1976d2", color: "#fff", border: "none", borderRadius: 6, padding: "8px 12px", cursor: "pointer" }}
  >
    Add Zone
  </button>
</div>


        
<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
  {[1,2,3,4,5,6].map((n) => {
    const isUnlocked = !!unlockedPins[n];
    return (
      <div key={n} style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ minWidth: 80 }}>Admin {n}</span>
        <input
          type="password"
          value={isUnlocked ? (adminPins[n] || "") : ""}
          placeholder="••••"
          disabled={!isUnlocked}
          onChange={(e) => {
            // digits only, up to 6 chars
            const v = (e.target.value || "").replace(/\D/g, "").slice(0, 6);
            setAdminPins((p) => ({ ...p, [n]: v }));
          }}
          style={{ flex: 1, padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}` }}
        />
        {isUnlocked ? (
          <button
            onClick={() => lockAdminPin(n)}
            style={{ background: "#6d4c41", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
          >
            Lock
          </button>
        ) : (
          <button
            onClick={() => unlockAdminPin(n)}
            style={{ background: "#1976d2", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
          >
            Unlock
          </button>
        )}
      </div>
    );
  })}
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS */}
      {activeTab === "settings" && (
        <div>
          <h2>Settings</h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${cardBorder}` }}>
              <h4 style={{ marginTop: 0 }}>Printing</h4>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={autoPrintOnCheckout}
                  onChange={(e) => setAutoPrintOnCheckout(e.target.checked)}
                />
                Auto-print on Checkout
              </label>
              <div style={{ marginTop: 8 }}>
                <label>
                  Paper width (mm):&nbsp;
                  <input
                    type="number"
                    value={preferredPaperWidthMm}
                    onChange={(e) => setPreferredPaperWidthMm(Math.max(40, Number(e.target.value || 80)))}
                    style={{ width: 120 }}
                  />
                </label>
                <small style={{ display: "block", opacity: 0.75 }}>
                  Typical sizes: 80, 58. Your current: {preferredPaperWidthMm} mm.
                </small>
              </div>
            </div>

            <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${cardBorder}` }}>
              <h4 style={{ marginTop: 0 }}>Display</h4>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
                Dark theme
              </label>
            </div>

            <div style={{ padding: 10, borderRadius: 6, border: `1px solid ${cardBorder}` }}>
              <h4 style={{ marginTop: 0 }}>Cloud</h4>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={cloudEnabled}
                  onChange={(e) => setCloudEnabled(e.target.checked)}
                />
                Enable cloud autosave (state)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={realtimeOrders}
                  onChange={(e) => setRealtimeOrders(e.target.checked)}
                />
                Live Orders Board (realtime)
              </label>
             <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
  <button onClick={saveToCloudNow} style={{ background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px" }}>
    Sync to Cloud
  </button>
  <button onClick={loadFromCloud} style={{ background: "#1976d2", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px" }}>
    Load from Cloud
  </button>
  <small style={{ opacity: 0.8 }}>
    Last save: {cloudStatus.lastSaveAt ? cloudStatus.lastSaveAt.toLocaleString() : "—"} • Last load: {cloudStatus.lastLoadAt ? cloudStatus.lastLoadAt.toLocaleString() : "—"}
  </small>
  {cloudStatus.error && (
    <small style={{ color: "#c62828" }}>Error: {String(cloudStatus.error)}</small>
  )}
</div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}




















