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
  runTransaction,
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

/* ---------- Helpers: colors for item/extra buttons ---------- */
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return { r: 255, g: 255, b: 255 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
function getTextColorForBg(hex) {
  const { r, g, b } = hexToRgb(hex);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? "#000" : "#fff";
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
    autoPrintOnCheckout,
    preferredPaperWidthMm,
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
    autoPrintOnCheckout: !!autoPrintOnCheckout,
    preferredPaperWidthMm: Number(preferredPaperWidthMm || 80),
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

  if (typeof data.autoPrintOnCheckout === "boolean")
    out.autoPrintOnCheckout = data.autoPrintOnCheckout;
  if (typeof data.preferredPaperWidthMm === "number")
    out.preferredPaperWidthMm = data.preferredPaperWidthMm;

  return out;
}

function normalizeOrderForCloud(order) {
  return {
    orderNo: order.orderNo,
    worker: order.worker,
    payment: order.payment,
    orderType: order.orderType,
    deliveryFee: order.deliveryFee,
    total: order.total,
    itemsTotal: order.itemsTotal,
    cashReceived: order.cashReceived ?? null,
    changeDue: order.changeDue ?? null,
    done: !!order.done,
    voided: !!order.voided,
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
    orderType: d.orderType,
    deliveryFee: Number(d.deliveryFee || 0),
    total: Number(d.total || 0),
    itemsTotal: Number(d.itemsTotal || 0),
    cashReceived: d.cashReceived != null ? Number(d.cashReceived) : null,
    changeDue: d.changeDue != null ? Number(d.changeDue) : null,
    done: !!d.done,
    voided: !!d.voided,
    note: d.note || "",
    date: asDate(d.date || d.createdAt),
    restockedAt: d.restockedAt ? asDate(d.restockedAt) : undefined,
    cart: Array.isArray(d.cart) ? d.cart : [],
    idemKey: d.idemKey || "",
  };
}

/* ---------- De-duplicate safety ---------- */
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
  { id: 1, name: "Single Smashed Patty", price: 95, uses: {}, color: "" },
  { id: 2, name: "Double Smashed Patty", price: 140, uses: {}, color: "" },
  { id: 3, name: "Triple Smashed Patty", price: 160, uses: {}, color: "" },
  { id: 4, name: "Tux Quatro Smashed Patty", price: 190, uses: {}, color: "" },
  { id: 14, name: "TUXIFY Single", price: 120, uses: {}, color: "" },
  { id: 15, name: "TUXIFY Double", price: 160, uses: {}, color: "" },
  { id: 16, name: "TUXIFY Triple", price: 200, uses: {}, color: "" },
  { id: 17, name: "TUXIFY Quatro", price: 240, uses: {}, color: "" },
  { id: 5, name: "Classic Fries", price: 25, uses: {}, color: "" },
  { id: 6, name: "Cheese Fries", price: 40, uses: {}, color: "" },
  { id: 7, name: "Chili Fries", price: 50, uses: {}, color: "" },
  { id: 8, name: "Tux Fries", price: 75, uses: {}, color: "" },
  { id: 9, name: "Doppy Fries", price: 95, uses: {}, color: "" },
  { id: 10, name: "Classic Hawawshi", price: 80, uses: {}, color: "" },
  { id: 11, name: "Tux Hawawshi", price: 100, uses: {}, color: "" },
  { id: 12, name: "Soda", price: 20, uses: {}, color: "" },
  { id: 13, name: "Water", price: 10, uses: {}, color: "" },
];
const BASE_EXTRAS = [
  { id: 101, name: "Extra Smashed Patty", price: 40, uses: {}, color: "" },
  { id: 102, name: "Bacon", price: 20, uses: {}, color: "" },
  { id: 103, name: "Cheese", price: 15, uses: {}, color: "" },
  { id: 104, name: "Ranch", price: 15, uses: {}, color: "" },
  { id: 105, name: "Mushroom", price: 15, uses: {}, color: "" },
  { id: 106, name: "Caramelized Onion", price: 10, uses: {}, color: "" },
  { id: 107, name: "Jalapeno", price: 10, uses: {}, color: "" },
  { id: 108, name: "Tux Sauce", price: 10, uses: {}, color: "" },
  { id: 109, name: "Extra Bun", price: 10, uses: {}, color: "" },
  { id: 110, name: "Pickle", price: 5, uses: {}, color: "" },
  { id: 111, name: "BBQ / Ketchup / Sweet Chili / Hot Sauce", price: 5, uses: {}, color: "" },
  { id: 112, name: "Mozzarella Cheese", price: 20, uses: {}, color: "" },
  { id: 113, name: "Tux Hawawshi Sauce", price: 10, uses: {}, color: "" },
];
const DEFAULT_INVENTORY = [
  { id: "meat", name: "Meat", unit: "g", qty: 0 },
  { id: "cheese", name: "Cheese", unit: "slices", qty: 0 },
];
const BASE_WORKERS = ["Hassan", "Warda", "Ahmed"];
const DEFAULT_PAYMENT_METHODS = ["Cash", "Card", "Instapay"];
const DEFAULT_ORDER_TYPES = ["Take-Away", "Dine-in", "Delivery"];
const DEFAULT_DELIVERY_FEE = 20;
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

// Bulk delete helper
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

/* --------------------------- COUNTER --------------------------- */
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

// ========= HTML thermal printing helpers =========
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildReceiptHTML(order, widthMm = 80) {
  const m = Math.max(0, Math.min(4, 4));
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

  const cashBlock =
    order.payment === "Cash" && order.cashReceived != null
      ? `
      <div class="row"><div>Cash Received</div><div>${currency(order.cashReceived)}</div></div>
      <div class="row"><div>Change</div><div>${currency(order.changeDue || 0)}</div></div>
    `
      : "";

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
    grid-template-columns: 5fr 1fr 2fr 2.5fr;
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

    <div class="meta">Order No: <strong>#${escHtml(order.orderNo)}</strong></div>
    <div class="meta">Order Date: <strong>${escHtml(orderDateStr)}</strong> • Time: <strong>${escHtml(orderTimeStr)}</strong></div>
    <div class="meta">Worker: ${escHtml(order.worker)} • Payment: ${escHtml(order.payment)} • Type: ${escHtml(order.orderType || "")}</div>

    ${noteBlock}

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

  <script>
    window.onload = function () {
      window.focus();
      window.print();
      setTimeout(() => window.close && window.close(), 200);
    };
  </script>
</body>
</html>
`;
}

function printReceiptHTML(order, widthMm = 80, copy = "Customer", images) {
  const imgs =
    images || { logo: "/tuxlogo.jpg", qr: "/menu-qr.jpg", delivery: "/delivery-logo.jpg" };
  const html = buildReceiptHTML(order, widthMm, copy, imgs);

  const ifr = document.createElement("iframe");
  ifr.style.position = "fixed";
  ifr.style.right = "0";
  ifr.style.bottom = "0";
  ifr.style.width = "0";
  ifr.style.height = "0";
  ifr.style.border = "0";
  document.body.appendChild(ifr);

  const doc = ifr.contentDocument || ifr.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  setTimeout(() => {
    try {
      if (!ifr.contentWindow || ifr.contentWindow.closed) ifr.remove();
    } catch {}
  }, 5000);
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
  const [orderNote, setOrderNote] = useState("");
  const [orderType, setOrderType] = useState(orderTypes[0] || "Take-Away");
  const [deliveryFee, setDeliveryFee] = useState(0);

  const [cashReceived, setCashReceived] = useState(0);

  const [inventory, setInventory] = useState(DEFAULT_INVENTORY);
  const [newInvName, setNewInvName] = useState("");
  const [newInvUnit, setNewInvUnit] = useState("");
  const [newInvQty, setNewInvQty] = useState(0);

  const [inventoryLocked, setInventoryLocked] = useState(false);
  const [inventorySnapshot, setInventorySnapshot] = useState([]);
  const [inventoryLockedAt, setInventoryLockedAt] = useState(null);

  const [adminPins, setAdminPins] = useState({ ...DEFAULT_ADMIN_PINS });
  const [showPins, setShowPins] = useState(false);
  const [pricesUnlocked, setPricesUnlocked] = useState(false);

  const [orders, setOrders] = useState([]);
  const [nextOrderNo, setNextOrderNo] = useState(1);

  const [expenses, setExpenses] = useState([]);


  const [bankUnlocked, setBankUnlocked] = useState(false);
  const [bankTx, setBankTx] = useState([]);
 

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

  const [sortBy] = useState("date-desc");

  const [nowStr, setNowStr] = useState(new Date().toLocaleString());
  useEffect(() => {
    const t = setInterval(() => setNowStr(new Date().toLocaleString()), 1000);
    return () => clearInterval(t);
  }, []);

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

  // NEW: Printing preferences (persisted)
  const [autoPrintOnCheckout, setAutoPrintOnCheckout] = useState(true);
  const [preferredPaperWidthMm, setPreferredPaperWidthMm] = useState(80); // default 80mm

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
          if (typeof unpacked.autoPrintOnCheckout === "boolean")
            setAutoPrintOnCheckout(unpacked.autoPrintOnCheckout);
          if (typeof unpacked.preferredPaperWidthMm === "number")
            setPreferredPaperWidthMm(unpacked.preferredPaperWidthMm);

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
      if (typeof unpacked.autoPrintOnCheckout === "boolean")
        setAutoPrintOnCheckout(unpacked.autoPrintOnCheckout);
      if (typeof unpacked.preferredPaperWidthMm === "number")
        setPreferredPaperWidthMm(unpacked.preferredPaperWidthMm);

      setCloudStatus((s) => ({ ...s, lastLoadAt: new Date(), error: null }));
      alert("Loaded from cloud ✔");
    } catch (e) {
      setCloudStatus((s) => ({ ...s, error: String(e) }));
      alert("Cloud load failed: " + e);
    }
  };

  // Autosave (state doc)
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
          autoPrintOnCheckout,
          preferredPaperWidthMm,
        });
        await setDoc(stateDocRef, body, { merge: true });
        setCloudStatus((s) => ({ ...s, lastSaveAt: new Date(), error: null }));
      } catch (e) {
        setCloudStatus((s) => ({ ...s, error: String(e) }));
      }
    }, 1600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    autoPrintOnCheckout,
    preferredPaperWidthMm,
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
      alert(`Admin ${n} has no PIN set; set a PIN in Edit → Admin PINs.`);
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
      if (window.confirm("Lock current Inventory as Start-of-Day snapshot?"))
        lockInventoryForDay();
    }
  };

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
      c.map((line, idx) =>
        idx !== i
          ? line
          : { ...line, qty: Math.max(1, Number(line.qty || 1) + delta) }
      )
    );

  const setQty = (i, v) =>
    setCart((c) =>
      c.map((line, idx) =>
        idx !== i ? line : { ...line, qty: Math.max(1, Number(v || 1)) }
      )
    );

  const checkout = async () => {
    if (isCheckingOut) return;
    setIsCheckingOut(true);

    try {
      if (!dayMeta.startedAt || dayMeta.endedAt)
        return alert("Start a shift first (Shift → Start Shift).");
      if (cart.length === 0) return alert("Cart is empty.");
      if (!worker) return alert("Select worker.");
      if (!payment) return alert("Select payment.");
      if (!orderType) return alert("Select order type.");

      const required = {};
      for (const line of cart) {
        const uses = line.uses || {};
        for (const k of Object.keys(uses))
          required[k] = (required[k] || 0) + (uses[k] || 0);
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
      setInventory((inv) =>
        inv.map((it) => {
          const need = required[it.id] || 0;
          return need ? { ...it, qty: it.qty - need } : it;
        })
      );

      const itemsTotal = cart.reduce((s, b) => {
        const ex = (b.extras || []).reduce((t, e) => t + Number(e.price || 0), 0);
        return s + (Number(b.price || 0) + ex) * Number(b.qty || 1);
      }, 0);
      const delFee = orderType === "Delivery" ? Math.max(0, Number(deliveryFee || 0)) : 0;
      const total = itemsTotal + delFee;

      const cashVal = payment === "Cash" ? Number(cashReceived || 0) : null;
      const changeDue =
        payment === "Cash" ? Math.max(0, Number((cashVal || 0) - total)) : null;

      let allocatedNo = nextOrderNo;
      if (cloudEnabled && counterDocRef && fbUser && db) {
        try {
          allocatedNo = await allocateOrderNoAtomic(db, counterDocRef);
        } catch (e) {
          console.warn(
            "Atomic order number allocation failed, using local nextOrderNo.",
            e
          );
        }
      }
      setNextOrderNo(allocatedNo + 1);

      const order = {
        orderNo: allocatedNo,
        date: new Date(),
        worker,
        payment,
        orderType,
        deliveryFee: delFee,
        total,
        itemsTotal,
        cashReceived: cashVal,
        changeDue,
        cart,
        done: false,
        voided: false,
        restockedAt: undefined,
        note: orderNote.trim(),
        idemKey: `idk_${fbUser ? fbUser.uid : "anon"}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2)}`,
      };

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

      if (autoPrintOnCheckout) {
        printReceiptHTML(order, Number(preferredPaperWidthMm) || 80, "Customer");
      }

      setCart([]);
      setWorker("");
      setPayment("");
      setOrderNote("");
      setOrderType(orderTypes[0] || "Take-Away");
      setDeliveryFee(orderType === "Delivery" ? defaultDeliveryFee : 0);
      setCashReceived(0);
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
    if (ord.done) return alert("This order is DONE and cannot be voided.");
    if (ord.voided) return alert("This order is already voided & restocked.");
    if (!window.confirm(`Void order #${orderNo} and restock inventory?`)) return;

    const giveBack = {};
    for (const line of ord.cart) {
      const uses = line.uses || {};
      for (const k of Object.keys(uses))
        giveBack[k] = (giveBack[k] || 0) + (uses[k] || 0);
    }
    setInventory((inv) =>
      inv.map((it) => {
        const back = giveBack[it.id] || 0;
        return back ? { ...it, qty: it.qty + back } : it;
      })
    );
    setOrders((o) =>
      o.map((x) =>
        x.orderNo === orderNo ? { ...x, voided: true, restockedAt: new Date() } : x
      )
    );

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
          restockedAt: new Date().toISOString(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (e) {
      console.warn("Cloud update (void) failed:", e);
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
    for (const p of paymentMethods) byPay[p] = 0;
    for (const o of validOrders) {
      const itemsOnly = Number(
        o.itemsTotal != null ? o.itemsTotal : o.total - (o.deliveryFee || 0)
      );
      if (byPay[o.payment] == null) byPay[o.payment] = 0;
      byPay[o.payment] += itemsOnly;
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

  // Old-items tables data
  const reportItemRows = useMemo(() => {
    const acc = new Map(); // key: name|price
    for (const o of orders) {
      if (o.voided) continue;
      for (const line of o.cart || []) {
        const price = Number(line.price || 0);
        const q = Number(line.qty || 1);
        const extrasSum = (line.extras || []).reduce((s, e) => s + Number(e.price || 0), 0);
        const key = `${line.name}|${price}`;
        const prev = acc.get(key) || { name: line.name, price, qty: 0, total: 0 };
        prev.qty += q;
        prev.total += (price + extrasSum) * q;
        acc.set(key, prev);
      }
    }
    return Array.from(acc.values()).sort((a, b) => b.qty - a.qty || b.total - a.total);
  }, [orders]);

  const reportExtraRows = useMemo(() => {
    const acc = new Map(); // key: name|price
    for (const o of orders) {
      if (o.voided) continue;
      for (const line of o.cart || []) {
        const q = Number(line.qty || 1);
        for (const ex of line.extras || []) {
          const price = Number(ex.price || 0);
          const key = `${ex.name}|${price}`;
          const prev = acc.get(key) || { name: ex.name, price, qty: 0, total: 0 };
          prev.qty += q;
          prev.total += price * q;
          acc.set(key, prev);
        }
      }
    }
    return Array.from(acc.values()).sort((a, b) => b.qty - a.qty || b.total - a.total);
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
        head: [
          ["#", "Date", "Worker", "Payment", "Type", "Delivery (E£)", "Total (E£)", "Done", "Voided"],
        ],
        body: getSortedOrders().map((o) => [
          o.orderNo,
          o.date.toLocaleString(),
          o.worker,
          o.payment,
          o.orderType || "",
          (o.deliveryFee || 0).toFixed(2),
          o.total.toFixed(2),
          o.done ? "Yes" : "No",
          o.voided ? "Yes" : "No",
        ]),
        startY: y + 4,
        styles: { fontSize: 9 },
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Totals (excluding voided)", 14, y);

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
    setActiveTab(key);
  };

  

  /* --------------------------- UI --------------------------- */

  /* ---------- Reorder helpers for Edit tab ---------- */
  const moveMenu = (idx, dir) => {
    setMenu((arr) => {
      const next = [...arr];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return arr;
      const [it] = next.splice(idx, 1);
      next.splice(j, 0, it);
      return next;
    });
  };
  const moveExtra = (idx, dir) => {
    setExtraList((arr) => {
      const next = [...arr];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return arr;
      const [it] = next.splice(idx, 1);
      next.splice(j, 0, it);
      return next;
    });
  };

  // Small inline editor toggles
  const [openUsesMenu, setOpenUsesMenu] = useState({});
  const [openColorMenu, setOpenColorMenu] = useState({});
  const [openUsesExtra, setOpenUsesExtra] = useState({});
  const [openColorExtra, setOpenColorExtra] = useState({});

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
                padding: "6px 10 px",
                cursor: "pointer",
              }}
            >
              Start Shift
            </button>
          </>
        ) : (
          <>
            <span>
              <b>Shift started by:</b> {dayMeta.startedBy || "—"} &nbsp;|&nbsp;{" "}
              <b>On-duty:</b> {dayMeta.currentWorker || "—"} &nbsp;|&nbsp;{" "}
              <b>Started at:</b>{" "}
              {dayMeta.startedAt ? new Date(dayMeta.startedAt).toLocaleString() : "—"}
            </span>
            <button
              onClick={changeShift}
              style={{
                background: "#1565c0",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              Change Worker
            </button>
            <button
              onClick={() => generatePDF(false)}
              style={{
                background: "#6d4c41",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              Download Report (PDF)
            </button>
            <button
              onClick={endDay}
              style={{
                background: "#c62828",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              End Day & Reset
            </button>
          </>
        )}

        <div style={{ flex: 1 }} />

        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={dark}
            onChange={(e) => setDark(e.target.checked)}
          />
          Dark
        </label>

        <button
          onClick={loadFromCloud}
          style={{
            border: `1px solid ${btnBorder}`,
            background: "white",
            borderRadius: 6,
            padding: "6px 10px",
            cursor: "pointer",
          }}
        >
          Load from Cloud
        </button>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        {[
          ["orders", "Orders Board"],
          ["pos", "POS"],
          ["report", "Report"],
          ["edit", "Edit"],
          ["settings", "Settings"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => handleTabClick(key)}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: `1px solid ${btnBorder}`,
              background: activeTab === key ? "#1976d2" : "white",
              color: activeTab === key ? "#fff" : (dark ? "#eee" : "#000"),
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ======== ORDERS BOARD ======== */}
      {activeTab === "orders" && (
        <div
          style={{
            border: `1px solid ${cardBorder}`,
            borderRadius: 8,
            padding: 12,
          }}
        >
          {orders.length === 0 ? (
            <div style={{ opacity: 0.7 }}>No orders yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {orders.map((o) => (
                <div
                  key={o.orderNo}
                  style={{
                    border: `1px solid ${cardBorder}`,
                    borderRadius: 8,
                    padding: 10,
                    background: dark ? "#1b1b1b" : "#fff",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      #{o.orderNo} — {o.worker} — {o.payment} — {o.orderType || ""}
                      {o.voided ? " — VOIDED" : o.done ? " — DONE" : ""}
                    </div>
                    <div style={{ opacity: 0.8 }}>
                      {o.date ? new Date(o.date).toLocaleString() : ""}
                    </div>
                  </div>

                  <div style={{ marginTop: 6, fontSize: 14 }}>
                    {(o.cart || []).map((l, i) => (
                      <div key={i} style={{ display: "flex", gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          {l.qty}× {l.name}
                          {(l.extras || []).length ? (
                            <span style={{ opacity: 0.8 }}>
                              {" "}
                              (+{l.extras.map((e) => e.name).join(", ")})
                            </span>
                          ) : null}
                        </div>
                        <div style={{ width: 90, textAlign: "right" }}>
                          E£{Number(l.price || 0).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      onClick={() => markOrderDone(o.orderNo)}
                      disabled={o.done || o.voided}
                      style={{
                        background: o.done ? "#9e9e9e" : "#2e7d32",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        padding: "6px 10px",
                        cursor: o.done || o.voided ? "not-allowed" : "pointer",
                      }}
                    >
                      Mark Done
                    </button>

                    <button
                      onClick={() =>
                        printReceiptHTML(o, Number(preferredPaperWidthMm) || 80, "Customer")
                      }
                      style={{
                        background: "#37474f",
                        color: "#fff",
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
                      disabled={o.voided}
                      style={{
                        background: "#c62828",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        padding: "6px 10px",
                        cursor: o.voided ? "not-allowed" : "pointer",
                      }}
                    >
                      Void & Restock
                    </button>

                    <div style={{ flex: 1 }} />
                    <div style={{ fontWeight: 700 }}>
                      TOTAL: E£{Number(o.total || 0).toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ======== POS ======== */}
      {activeTab === "pos" && (
        <div style={{ display: "grid", gap: 12 }}>
          {/* Menu buttons */}
          <div
            style={{
              border: `1px solid ${cardBorder}`,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Menu</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))",
                gap: 8,
              }}
            >
              {menu.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedBurger(m)}
                  style={{
                    border: `1px solid ${btnBorder}`,
                    borderRadius: 8,
                    padding: 10,
                    cursor: "pointer",
                    background: m.color || "#ffffff",
                    color: getTextColorForBg(m.color || "#ffffff"),
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{m.name}</div>
                  <div>E£{Number(m.price || 0).toFixed(2)}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Extras */}
          <div
            style={{
              border: `1px solid ${cardBorder}`,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Extras</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))",
                gap: 8,
              }}
            >
              {extraList.map((ex) => {
                const selected = !!selectedExtras.find((e) => e.id === ex.id);
                return (
                  <button
                    key={ex.id}
                    onClick={() => toggleExtra(ex)}
                    style={{
                      border: `2px solid ${selected ? "#1976d2" : btnBorder}`,
                      borderRadius: 8,
                      padding: 10,
                      cursor: "pointer",
                      background: ex.color || "#ffffff",
                      color: getTextColorForBg(ex.color || "#ffffff"),
                      textAlign: "left",
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{ex.name}</div>
                    <div>E£{Number(ex.price || 0).toFixed(2)}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quantity + Add */}
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              border: `1px solid ${cardBorder}`,
              borderRadius: 8,
              padding: 10,
              flexWrap: "wrap",
            }}
          >
            <div>
              <b>Selected:</b>{" "}
              {selectedBurger ? selectedBurger.name : <span style={{ opacity: 0.6 }}>—</span>}
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <label>Qty</label>
              <input
                type="number"
                min={1}
                value={selectedQty}
                onChange={(e) => setSelectedQty(Number(e.target.value || 1))}
                style={{ width: 70 }}
              />
            </div>
            <button
              onClick={addToCart}
              style={{
                background: "#2e7d32",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              Add to Cart
            </button>
          </div>

          {/* Cart */}
          <div
            style={{
              border: `1px solid ${cardBorder}`,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Cart</div>
            {cart.length === 0 ? (
              <div style={{ opacity: 0.7 }}>Cart is empty.</div>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {cart.map((line, i) => {
                  const lineExtras = (line.extras || []).map((e) => e.name).join(", ");
                  const lineTotal =
                    (Number(line.price || 0) +
                      (line.extras || []).reduce((s, e) => s + Number(e.price || 0), 0)) *
                    Number(line.qty || 1);
                  return (
                    <div
                      key={i}
                      style={{
                        border: `1px solid ${cardBorder}`,
                        borderRadius: 6,
                        padding: 8,
                      }}
                    >
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700 }}>{line.name}</div>
                          <div style={{ opacity: 0.8, fontSize: 13 }}>
                            {lineExtras ? `+ ${lineExtras}` : ""}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <button
                            onClick={() => changeQty(i, -1)}
                            style={{ padding: "2px 8px" }}
                          >
                            -
                          </button>
                          <input
                            type="number"
                            value={line.qty}
                            min={1}
                            onChange={(e) => setQty(i, Number(e.target.value || 1))}
                            style={{ width: 64 }}
                          />
                          <button
                            onClick={() => changeQty(i, +1)}
                            style={{ padding: "2px 8px" }}
                          >
                            +
                          </button>
                        </div>
                        <div style={{ width: 110, textAlign: "right", fontWeight: 700 }}>
                          E£{lineTotal.toFixed(2)}
                        </div>
                        <button
                          onClick={() => removeFromCart(i)}
                          style={{
                            marginLeft: 8,
                            border: `1px solid ${btnBorder}`,
                            padding: "4px 8px",
                            borderRadius: 6,
                            cursor: "pointer",
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Checkout */}
          <div
            style={{
              border: `1px solid ${cardBorder}`,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div>
                <label>Worker</label>
                <br />
                <select value={worker} onChange={(e) => setWorker(e.target.value)}>
                  <option value="">—</option>
                  {workers.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label>Payment</label>
                <br />
                <select value={payment} onChange={(e) => setPayment(e.target.value)}>
                  <option value="">—</option>
                  {paymentMethods.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label>Order Type</label>
                <br />
                <select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
                  {orderTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {orderType === "Delivery" && (
                <div>
                  <label>Delivery Fee (E£)</label>
                  <br />
                  <input
                    type="number"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(Number(e.target.value || 0))}
                    style={{ width: 120 }}
                  />
                </div>
              )}

              {payment === "Cash" && (
                <div>
                  <label>Cash Received (E£)</label>
                  <br />
                  <input
                    type="number"
                    value={cashReceived}
                    onChange={(e) => setCashReceived(Number(e.target.value || 0))}
                    style={{ width: 140 }}
                  />
                </div>
              )}
            </div>

            <div style={{ marginTop: 10 }}>
              <label>Order Note</label>
              <br />
              <textarea
                value={orderNote}
                onChange={(e) => setOrderNote(e.target.value)}
                rows={3}
                style={{ width: "100%" }}
                placeholder="Optional instructions…"
              />
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
              <button
                onClick={checkout}
                disabled={isCheckingOut}
                style={{
                  background: "#2e7d32",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 12px",
                  cursor: "pointer",
                }}
              >
                {isCheckingOut ? "Processing…" : "Checkout"}
              </button>
              <div style={{ opacity: 0.8, fontSize: 13 }}>
                {autoPrintOnCheckout
                  ? `Auto-print enabled • ${preferredPaperWidthMm}mm`
                  : "Auto-print OFF"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======== REPORT ======== */}
      {activeTab === "report" && (
        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              border: `1px solid ${cardBorder}`,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Totals (excluding voided)</div>
            <div>Revenue (items only): E£{totals.revenueTotal.toFixed(2)}</div>
            <div>Delivery Fees (not in revenue): E£{totals.deliveryFeesTotal.toFixed(2)}</div>
            <div>Expenses: E£{totals.expensesTotal.toFixed(2)}</div>
            <div style={{ fontWeight: 700 }}>
              Margin: E£{(totals.margin || 0).toFixed(2)}
            </div>
          </div>

          {/* Old UI: Items list with Price / Qty / Total */}
          <div
            style={{
              border: `1px solid ${cardBorder}`,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Items (old view)</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Item</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #ccc" }}>
                      Price (E£)
                    </th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #ccc" }}>Qty</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #ccc" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {reportItemRows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: "6px 0" }}>{r.name}</td>
                      <td style={{ textAlign: "right" }}>{r.price.toFixed(2)}</td>
                      <td style={{ textAlign: "right" }}>{r.qty}</td>
                      <td style={{ textAlign: "right" }}>{r.total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Extras table (old view) */}
          <div
            style={{
              border: `1px solid ${cardBorder}`,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Extras (old view)</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Extra</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #ccc" }}>
                      Price (E£)
                    </th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #ccc" }}>Qty</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #ccc" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {reportExtraRows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: "6px 0" }}>{r.name}</td>
                      <td style={{ textAlign: "right" }}>{r.price.toFixed(2)}</td>
                      <td style={{ textAlign: "right" }}>{r.qty}</td>
                      <td style={{ textAlign: "right" }}>{r.total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ======== EDIT ======== */}
      {activeTab === "edit" && (
        <div style={{ display: "grid", gap: 16 }}>
          {/* Workers & Payment Methods editor */}
          <div
            style={{
              border: `1px solid ${cardBorder}`,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Workers & Payments</div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 600 }}>Workers</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {workers.map((w, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        value={w}
                        onChange={(e) =>
                          setWorkers((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))
                        }
                      />
                      <button
                        onClick={() =>
                          setWorkers((arr) => arr.filter((_, j) => j !== i))
                        }
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      placeholder="New worker"
                      value={newWorker}
                      onChange={(e) => setNewWorker(e.target.value)}
                    />
                    <button
                      onClick={() => {
                        const v = norm(newWorker);
                        if (!v) return;
                        setWorkers((arr) => [...arr, v]);
                        setNewWorker("");
                      }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 600 }}>Payment Methods</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {paymentMethods.map((p, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        value={p}
                        onChange={(e) =>
                          setPaymentMethods((arr) =>
                            arr.map((x, j) => (j === i ? e.target.value : x))
                          )
                        }
                      />
                      <button
                        onClick={() =>
                          setPaymentMethods((arr) => arr.filter((_, j) => j !== i))
                        }
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      placeholder="New method"
                      value={newPayment}
                      onChange={(e) => setNewPayment(e.target.value)}
                    />
                    <button
                      onClick={() => {
                        const v = norm(newPayment);
                        if (!v) return;
                        setPaymentMethods((arr) => [...arr, v]);
                        setNewPayment("");
                      }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Menu Items editor (like screenshot) */}
          <div
            style={{
              border: `1px solid ${cardBorder}`,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Menu Items</div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 140px 220px 260px",
                gap: 8,
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              <div>Name</div>
              <div style={{ textAlign: "right", paddingRight: 10 }}>Price (E£)</div>
              <div>Uses</div>
              <div>Actions</div>
            </div>

            {menu.map((it, idx) => (
              <div
                key={it.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 140px 220px 260px",
                  gap: 8,
                  alignItems: "center",
                  borderTop: `1px solid ${cardBorder}`,
                  padding: "8px 0",
                }}
              >
                {/* Name */}
                <input
                  value={it.name}
                  onChange={(e) =>
                    setMenu((arr) =>
                      arr.map((x, j) => (j === idx ? { ...x, name: e.target.value } : x))
                    )
                  }
                />

                {/* Price */}
                <input
                  type="number"
                  value={it.price}
                  onChange={(e) =>
                    setMenu((arr) =>
                      arr.map((x, j) => (j === idx ? { ...x, price: Number(e.target.value || 0) } : x))
                    )
                  }
                  style={{ textAlign: "right", paddingRight: 10 }}
                />

                {/* Uses + Color */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    onClick={() =>
                      setOpenUsesMenu((o) => ({ ...o, [it.id]: !o[it.id] }))
                    }
                    style={{ padding: "6px 10px" }}
                  >
                    Edit Uses
                  </button>

                  <button
                    onClick={() =>
                      setOpenColorMenu((o) => ({ ...o, [it.id]: !o[it.id] }))
                    }
                    style={{ padding: "6px 10px" }}
                  >
                    Edit Color
                  </button>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={() => moveMenu(idx, -1)} title="Move up">
                    ↑
                  </button>
                  <button onClick={() => moveMenu(idx, +1)} title="Move down">
                    ↓
                  </button>
                  <button
                    onClick={() =>
                      setMenu((arr) => arr.filter((_, j) => j !== idx))
                    }
                    style={{ background: "#e53935", color: "#fff", padding: "6px 10px" }}
                  >
                    Delete
                  </button>
                </div>

                {/* Uses editor row */}
                {openUsesMenu[it.id] && (
                  <div
                    style={{
                      gridColumn: "1 / -1",
                      background: softBg,
                      borderRadius: 6,
                      padding: 10,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                      gap: 8,
                    }}
                  >
                    {inventory.map((inv) => {
                      const cur = Number((it.uses || {})[inv.id] || 0);
                      return (
                        <div key={inv.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <div style={{ minWidth: 90 }}>{inv.name}</div>
                          <input
                            type="number"
                            min={0}
                            value={cur}
                            onChange={(e) => {
                              const n = Math.max(0, Number(e.target.value || 0));
                              setMenu((arr) =>
                                arr.map((x, j) => {
                                  if (j !== idx) return x;
                                  const uses = { ...(x.uses || {}) };
                                  if (!n) delete uses[inv.id];
                                  else uses[inv.id] = n;
                                  return { ...x, uses };
                                })
                              );
                            }}
                            style={{ width: 100 }}
                          />
                          <div style={{ opacity: 0.8 }}>{inv.unit}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Color editor row */}
                {openColorMenu[it.id] && (
                  <div
                    style={{
                      gridColumn: "1 / -1",
                      background: softBg,
                      borderRadius: 6,
                      padding: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ width: 160, display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="color"
                        value={it.color || "#ffffff"}
                        onChange={(e) =>
                          setMenu((arr) =>
                            arr.map((x, j) => (j === idx ? { ...x, color: e.target.value } : x))
                          )
                        }
                        style={{ width: 40, height: 30, padding: 0, border: "none" }}
                      />
                      <div
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          border: `1px solid ${btnBorder}`,
                          background: it.color || "#ffffff",
                          color: getTextColorForBg(it.color || "#ffffff"),
                        }}
                      >
                        Preview
                      </div>
                    </div>
                    <button onClick={() => setOpenColorMenu((o) => ({ ...o, [it.id]: false }))}>
                      Close
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Extras editor (same layout) */}
          <div
            style={{
              border: `1px solid ${cardBorder}`,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Extras</div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 140px 220px 260px",
                gap: 8,
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              <div>Name</div>
              <div style={{ textAlign: "right", paddingRight: 10 }}>Price (E£)</div>
              <div>Uses</div>
              <div>Actions</div>
            </div>

            {extraList.map((it, idx) => (
              <div
                key={it.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 140px 220px 260px",
                  gap: 8,
                  alignItems: "center",
                  borderTop: `1px solid ${cardBorder}`,
                  padding: "8px 0",
                }}
              >
                <input
                  value={it.name}
                  onChange={(e) =>
                    setExtraList((arr) =>
                      arr.map((x, j) => (j === idx ? { ...x, name: e.target.value } : x))
                    )
                  }
                />
                <input
                  type="number"
                  value={it.price}
                  onChange={(e) =>
                    setExtraList((arr) =>
                      arr.map((x, j) => (j === idx ? { ...x, price: Number(e.target.value || 0) } : x))
                    )
                  }
                  style={{ textAlign: "right", paddingRight: 10 }}
                />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    onClick={() =>
                      setOpenUsesExtra((o) => ({ ...o, [it.id]: !o[it.id] }))
                    }
                    style={{ padding: "6px 10px" }}
                  >
                    Edit Uses
                  </button>
                  <button
                    onClick={() =>
                      setOpenColorExtra((o) => ({ ...o, [it.id]: !o[it.id] }))
                    }
                    style={{ padding: "6px 10px" }}
                  >
                    Edit Color
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={() => moveExtra(idx, -1)}>↑</button>
                  <button onClick={() => moveExtra(idx, +1)}>↓</button>
                  <button
                    onClick={() =>
                      setExtraList((arr) => arr.filter((_, j) => j !== idx))
                    }
                    style={{ background: "#e53935", color: "#fff", padding: "6px 10px" }}
                  >
                    Delete
                  </button>
                </div>

                {openUsesExtra[it.id] && (
                  <div
                    style={{
                      gridColumn: "1 / -1",
                      background: softBg,
                      borderRadius: 6,
                      padding: 10,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                      gap: 8,
                    }}
                  >
                    {inventory.map((inv) => {
                      const cur = Number((it.uses || {})[inv.id] || 0);
                      return (
                        <div key={inv.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <div style={{ minWidth: 90 }}>{inv.name}</div>
                          <input
                            type="number"
                            min={0}
                            value={cur}
                            onChange={(e) => {
                              const n = Math.max(0, Number(e.target.value || 0));
                              setExtraList((arr) =>
                                arr.map((x, j) => {
                                  if (j !== idx) return x;
                                  const uses = { ...(x.uses || {}) };
                                  if (!n) delete uses[inv.id];
                                  else uses[inv.id] = n;
                                  return { ...x, uses };
                                })
                              );
                            }}
                            style={{ width: 100 }}
                          />
                          <div style={{ opacity: 0.8 }}>{inv.unit}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {openColorExtra[it.id] && (
                  <div
                    style={{
                      gridColumn: "1 / -1",
                      background: softBg,
                      borderRadius: 6,
                      padding: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ width: 160, display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="color"
                        value={it.color || "#ffffff"}
                        onChange={(e) =>
                          setExtraList((arr) =>
                            arr.map((x, j) => (j === idx ? { ...x, color: e.target.value } : x))
                          )
                        }
                        style={{ width: 40, height: 30, padding: 0, border: "none" }}
                      />
                      <div
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          border: `1px solid ${btnBorder}`,
                          background: it.color || "#ffffff",
                          color: getTextColorForBg(it.color || "#ffffff"),
                        }}
                      >
                        Preview
                      </div>
                    </div>
                    <button onClick={() => setOpenColorExtra((o) => ({ ...o, [it.id]: false }))}>
                      Close
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Inventory quick editor */}
          <div
            style={{
              border: `1px solid ${cardBorder}`,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Inventory</div>
            {inventoryLocked && (
  <button
    onClick={unlockInventoryWithPin}
    style={{
      marginBottom: 8,
      background: "#f9a825",
      color: "#000",
      border: "none",
      borderRadius: 6,
      padding: "6px 10px",
      cursor: "pointer",
    }}
  >
    Unlock Inventory (Admin PIN)
  </button>
)}

            <div style={{ display: "grid", gap: 8 }}>
              {inventory.map((it, i) => (
                <div key={it.id} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    value={it.name}
                    onChange={(e) =>
                      setInventory((arr) =>
                        arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))
                      )
                    }
                    style={{ width: 200 }}
                  />
                  <input
                    value={it.unit}
                    onChange={(e) =>
                      setInventory((arr) =>
                        arr.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x))
                      )
                    }
                    style={{ width: 120 }}
                  />
                  <input
                    type="number"
                    value={it.qty}
                    onChange={(e) =>
                      setInventory((arr) =>
                        arr.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value || 0) } : x))
                      )
                    }
                    style={{ width: 120 }}
                  />
                  <button
                    onClick={() => {
                      const id = prompt("New id (letters/numbers only)?", it.id) || it.id;
                      setInventory((arr) =>
                        arr.map((x, j) => (j === i ? { ...x, id } : x))
                      );
                    }}
                  >
                    Set ID
                  </button>
                  <button
                    onClick={() => setInventory((arr) => arr.filter((_, j) => j !== i))}
                    style={{ background: "#e53935", color: "#fff", padding: "6px 10px" }}
                  >
                    Delete
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  placeholder="Name"
                  value={newInvName}
                  onChange={(e) => setNewInvName(e.target.value)}
                  style={{ width: 200 }}
                />
                <input
                  placeholder="Unit"
                  value={newInvUnit}
                  onChange={(e) => setNewInvUnit(e.target.value)}
                  style={{ width: 120 }}
                />
                <input
                  type="number"
                  placeholder="Qty"
                  value={newInvQty}
                  onChange={(e) => setNewInvQty(Number(e.target.value || 0))}
                  style={{ width: 120 }}
                />
                <button
                  onClick={() => {
                    const name = norm(newInvName);
                    const unit = norm(newInvUnit) || "pcs";
                    if (!name) return;
                    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                    setInventory((arr) => [...arr, { id, name, unit, qty: Number(newInvQty || 0) }]);
                    setNewInvName("");
                    setNewInvUnit("");
                    setNewInvQty(0);
                  }}
                >
                  Add Inventory Item
                </button>
              </div>
            </div>
          </div>

          {/* Admin PINs view */}
          <div
            style={{
              border: `1px solid ${cardBorder}`,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontWeight: 700 }}>Admin PINs</div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={showPins}
                  onChange={(e) => setShowPins(e.target.checked)}
                />
                Show
              </label>
            </div>
            {showPins && (
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                {Object.keys(adminPins).map((k) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 90 }}>Admin {k}</div>
                    <input
                      value={adminPins[k]}
                      onChange={(e) =>
                        setAdminPins((obj) => ({ ...obj, [k]: e.target.value }))
                      }
                      style={{ width: 160 }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======== SETTINGS ======== */}
      {activeTab === "settings" && (
        <div
          style={{
            border: `1px solid ${cardBorder}`,
            borderRadius: 8,
            padding: 12,
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 700 }}>Printing</div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={autoPrintOnCheckout}
              onChange={(e) => setAutoPrintOnCheckout(e.target.checked)}
            />
            Auto-print on Checkout
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div>Paper width (mm)</div>
            <input
              type="number"
              value={preferredPaperWidthMm}
              onChange={(e) =>
                setPreferredPaperWidthMm(Math.max(40, Number(e.target.value || 80)))
              }
              style={{ width: 120 }}
            />
            <div style={{ opacity: 0.7 }}>(58 or 80 are common)</div>
          </div>

          <div style={{ height: 6 }} />

          <div style={{ fontWeight: 700 }}>Cloud</div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={cloudEnabled}
              onChange={(e) => setCloudEnabled(e.target.checked)}
            />
            Cloud sync (autosave)
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={realtimeOrders}
              onChange={(e) => setRealtimeOrders(e.target.checked)}
            />
            Orders: realtime stream during active shift
          </label>
          <div style={{ opacity: 0.8, fontSize: 13 }}>
            Last save: {cloudStatus.lastSaveAt ? cloudStatus.lastSaveAt.toLocaleTimeString() : "—"}
            {" • "}
            Last load: {cloudStatus.lastLoadAt ? cloudStatus.lastLoadAt.toLocaleTimeString() : "—"}
            {cloudStatus.error ? (
              <>
                {" • "}
                <span style={{ color: "#c62828" }}>{String(cloudStatus.error)}</span>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}




