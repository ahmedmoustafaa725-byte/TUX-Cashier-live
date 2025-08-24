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

function packStateForCloud(state) {
  const {
    menu, extraList, orders, inventory, nextOrderNo, dark, workers, paymentMethods,
    inventoryLocked, inventorySnapshot, inventoryLockedAt, adminPins, orderTypes,
    defaultDeliveryFee, expenses, dayMeta, bankTx,
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
    inventoryLockedAt: inventoryLockedAt ? new Date(inventoryLockedAt).toISOString() : null,
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
          startedAt: dayMeta.startedAt ? dayMeta.startedAt.toISOString() : null,
          endedAt: dayMeta.endedAt ? dayMeta.endedAt.toISOString() : null,
          lastReportAt: dayMeta.lastReportAt ? dayMeta.lastReportAt.toISOString() : null,
          resetAt: dayMeta.resetAt ? dayMeta.resetAt.toISOString() : null,
          shiftChanges: Array.isArray(dayMeta.shiftChanges)
            ? dayMeta.shiftChanges.map((c) => ({
                ...c, at: c?.at ? new Date(c.at).toISOString() : null,
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
      startedAt: data.dayMeta.startedAt ? new Date(data.dayMeta.startedAt) : null,
      endedAt: data.dayMeta.endedAt ? new Date(data.dayMeta.endedAt) : null,
      endedBy: data.dayMeta.endedBy || "",
      lastReportAt: data.dayMeta.lastReportAt ? new Date(data.dayMeta.lastReportAt) : null,
      resetBy: data.dayMeta.resetBy || "",
      resetAt: data.dayMeta.resetAt ? new Date(data.dayMeta.resetAt) : null,
      shiftChanges: Array.isArray(data.dayMeta.shiftChanges)
        ? data.dayMeta.shiftChanges.map((c) => ({ ...c, at: c.at ? new Date(c.at) : null }))
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
  if (typeof data.defaultDeliveryFee === "number") out.defaultDeliveryFee = data.defaultDeliveryFee;

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
  const asDate = (v) => (v instanceof Timestamp ? v.toDate() : v ? new Date(v) : new Date());
  return {
    cloudId: id,
    orderNo: d.orderNo,
    worker: d.worker,
    payment: d.payment,
    orderType: d.orderType,
    deliveryFee: Number(d.deliveryFee || 0),
    total: Number(d.total || 0),
    itemsTotal: Number(d.itemsTotal || 0),
    done: !!d.done,
    voided: !!d.voided,
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
  return Array.from(byNo.values()).sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

/* --------------------------- HELPERS --------------------------- */
async function loadAsDataURL(path) {
  const res = await fetch(path);
  const blob = await res.blob();
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
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
  { id: "meat", name: "Meat", unit: "g", qty: 0 },
  { id: "cheese", name: "Cheese", unit: "slices", qty: 0 },
];
const BASE_WORKERS = ["Hassan", "Warda", "Ahmed"];
const DEFAULT_PAYMENT_METHODS = ["Cash", "Card", "Instapay"];
const DEFAULT_ORDER_TYPES = ["Take-Away", "Dine-in", "Delivery"];
const DEFAULT_DELIVERY_FEE = 20;
const EDITOR_PIN = "0512";
const DEFAULT_ADMIN_PINS = { 1: "1111", 2: "2222", 3: "3333", 4: "4444", 5: "5555", 6: "6666" };
const norm = (v) => String(v ?? "").trim();

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

/* -------------------- NEW: QZ TRAY PRINTER INTEGRATION -------------------- */
// This enables: 1) Detect installed printers  2) Silent auto-print of the receipt
// Requirements:
//  - Install the desktop app "QZ Tray" on your POS PC.
//  - Add <script src="https://cdnjs.cloudflare.com/ajax/libs/qz-tray/2.2.5/qz-tray.js"></script> to public/index.html
//  - (Optional) Configure a code-signing cert for production. This sample works for dev (you may see trust prompts).

const hasQZ = () => typeof window !== "undefined" && window.qz;

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
  const [cart, setCart] = useState([]);
  const [worker, setWorker] = useState("");
  const [payment, setPayment] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [orderType, setOrderType] = useState(orderTypes[0] || "Take-Away");
  const [deliveryFee, setDeliveryFee] = useState(0);

  const [inventory, setInventory] = useState(DEFAULT_INVENTORY);
  const [newInvName, setNewInvName] = useState("");
  const [newInvUnit, setNewInvUnit] = useState("");
  const [newInvQty, setNewInvQty] = useState(0);

  const [inventoryLocked, setInventoryLocked] = useState(false);
  const [inventorySnapshot, setInventorySnapshot] = useState([]);
  const [inventoryLockedAt, setInventoryLockedAt] = useState(null);

  const [adminPins, setAdminPins] = useState({ ...DEFAULT_ADMIN_PINS });
  const [pricesUnlocked, setPricesUnlocked] = useState(false);
  const [adminPinsEditUnlocked, setAdminPinsEditUnlocked] = useState({
    1: false, 2: false, 3: false, 4: false, 5: false, 6: false,
  });

  const [orders, setOrders] = useState([]);
  const [nextOrderNo, setNextOrderNo] = useState(1); // live preview

  const [expenses, setExpenses] = useState([]);
  const [newExpName, setNewExpName] = useState("");
  const [newExpUnit, setNewExpUnit] = useState("pcs");
  const [newExpQty, setNewExpQty] = useState(1);
  const [newExpUnitPrice, setNewExpUnitPrice] = useState(0);
  const [newExpNote, setNewExpNote] = useState("");

  const [bankUnlocked, setBankUnlocked] = useState(false);
  const [bankTx, setBankTx] = useState([]);
  const [bankForm, setBankForm] = useState({ type: "deposit", amount: 0, worker: "", note: "" });

  const [dayMeta, setDayMeta] = useState({
    startedBy: "",
    startedAt: null,
    endedAt: null,
    endedBy: "",
    lastReportAt: null,
    resetBy: "",
    resetAt: null,
    shiftChanges: [],
  });

  const [sortBy, setSortBy] = useState("date-desc");

  const [nowStr, setNowStr] = useState(new Date().toLocaleString());
  useEffect(() => {
    const t = setInterval(() => setNowStr(new Date().toLocaleString()), 1000);
    return () => clearInterval(t);
  }, []);

  const [usesEditOpenMenu, setUsesEditOpenMenu] = useState({});
  const [usesEditOpenExtra, setUsesEditOpenExtra] = useState({});
  const [newMenuName, setNewMenuName] = useState("");
  const [newMenuPrice, setNewMenuPrice] = useState(0);
  const [newExtraName, setNewExtraName] = useState("");
  const [newExtraPrice, setNewExtraPrice] = useState(0);

  /* --------------------------- FIREBASE STATE --------------------------- */
  const [fbReady, setFbReady] = useState(false);
  const [fbUser, setFbUser] = useState(null);
  const [cloudEnabled, setCloudEnabled] = useState(true);
  const [realtimeOrders, setRealtimeOrders] = useState(true);
  const [cloudStatus, setCloudStatus] = useState({ lastSaveAt: null, lastLoadAt: null, error: null });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const { auth } = ensureFirebase();
      setFbReady(true);
      const unsub = onAuthStateChanged(auth, async (u) => {
        if (!u) {
          try { await signInAnonymously(auth); } catch (e) { setCloudStatus((s) => ({ ...s, error: String(e) })); }
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

  // Keep UI's next order # in sync
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
          if (unpacked.inventoryLocked != null) setInventoryLocked(unpacked.inventoryLocked);
          if (unpacked.inventorySnapshot) setInventorySnapshot(unpacked.inventorySnapshot);
          if (unpacked.inventoryLockedAt != null) setInventoryLockedAt(unpacked.inventoryLockedAt);
          if (unpacked.adminPins) setAdminPins({ ...DEFAULT_ADMIN_PINS, ...unpacked.adminPins });
          if (unpacked.orderTypes) setOrderTypes(unpacked.orderTypes);
          if (unpacked.defaultDeliveryFee != null) setDefaultDeliveryFee(unpacked.defaultDeliveryFee);
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
      if (unpacked.inventoryLocked != null) setInventoryLocked(unpacked.inventoryLocked);
      if (unpacked.inventorySnapshot) setInventorySnapshot(unpacked.inventorySnapshot);
      if (unpacked.inventoryLockedAt != null) setInventoryLockedAt(unpacked.inventoryLockedAt);
      if (unpacked.adminPins) setAdminPins({ ...DEFAULT_ADMIN_PINS, ...unpacked.adminPins });
      if (unpacked.orderTypes) setOrderTypes(unpacked.orderTypes);
      if (unpacked.defaultDeliveryFee != null) setDefaultDeliveryFee(unpacked.defaultDeliveryFee);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cloudEnabled, stateDocRef, fbUser, hydrated, menu, extraList, orders, inventory, nextOrderNo,
    dark, workers, paymentMethods, inventoryLocked, inventorySnapshot, inventoryLockedAt,
    adminPins, orderTypes, defaultDeliveryFee, expenses, dayMeta, bankTx, realtimeOrders,
  ]);

  const startedAtMs = dayMeta?.startedAt ? new Date(dayMeta.startedAt).getTime() : null;
  const endedAtMs = dayMeta?.endedAt ? new Date(dayMeta.endedAt).getTime() : null;

  // Live board
  useEffect(() => {
    if (!realtimeOrders || !ordersColRef || !fbUser) return;
    if (!startedAtMs) { setOrders([]); return; }

    const startTs = Timestamp.fromMillis(startedAtMs);
    const constraints = [where("createdAt", ">=", startTs), orderBy("createdAt", "desc")];
    if (endedAtMs) constraints.unshift(where("createdAt", "<=", Timestamp.fromMillis(endedAtMs)));

    const qy = query(ordersColRef, ...constraints);
    const unsub = onSnapshot(qy, (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push(orderFromCloudDoc(d.id, d.data())));
      setOrders(dedupeOrders(arr));
    });
    return () => unsub();
  }, [realtimeOrders, ordersColRef, fbUser, startedAtMs, endedAtMs]);

  /* -------------------- NEW: PRINTER STATE & FUNCTIONS -------------------- */
  const [printerState, setPrinterState] = useState({ connected: false, printers: [], defaultPrinter: null });
  const [selectedPrinter, setSelectedPrinter] = useState(null);

  const connectQZ = async () => {
    if (!hasQZ()) { alert("QZ Tray library not found. Add the <script> tag and install QZ Tray."); return false; }
    try {
      if (!window.qz.websocket.isActive()) {
        await window.qz.websocket.connect();
      }
      return true;
    } catch (e) {
      console.warn("QZ connect failed", e);
      alert("Could not connect to QZ Tray. Is the desktop app running?");
      return false;
    }
  };

  const detectPrinters = async () => {
    const ok = await connectQZ();
    if (!ok) return;
    try {
      const list = await window.qz.printers.find();
      const def = await window.qz.printers.getDefault();
      setPrinterState({ connected: true, printers: list, defaultPrinter: def || null });
      setSelectedPrinter((p) => p || def || (list && list[0]) || null);
      if (!list || list.length === 0) alert("No printers found. Check Windows printers.");
    } catch (e) {
      console.warn("QZ list printers failed", e);
      alert("Failed to list printers via QZ.");
    }
  };

  const printPDFViaQZ = async (doc, widthMm = 80) => {
    const ok = await connectQZ();
    if (!ok) throw new Error("QZ not connected");
    const printer = selectedPrinter || printerState.defaultPrinter;
    const cfg = window.qz.configs.create(printer || null, {
      units: "mm",
      // height can be large to allow long tickets; QZ will clip automatically
      size: { width: widthMm, height: 1000 },
      rasterize: true,       // better compatibility for PDFs on thermal printers
      scaleContent: true,    // "fit in"
      copies: 1,
    });
    // jsPDF -> base64 pdf
    const b64 = doc.output("datauristring").split(",")[1];
    const data = [{ type: "pdf", data: b64 }];
    await window.qz.print(cfg, data);
  };

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
    if (![1, 2, 3, 4, 5, 6].includes(n)) { alert("Please enter a number from 1 to 6."); return null; }
    const entered = window.prompt(`Enter PIN for Admin ${n}:`, "");
    if (entered == null) return null;

    const expected = norm(adminPins[n]);
    const attempt = norm(entered);
    if (!expected) { alert(`Admin ${n} has no PIN set; set a PIN in Prices → Admin PINs.`); return null; }
    if (attempt !== expected) { alert("Invalid PIN."); return null; }
    return n;
  };

  const lockInventoryForDay = () => {
    if (inventoryLocked) return;
    if (inventory.length === 0) return alert("Add at least one inventory item first.");
    if (!window.confirm("Lock current inventory as Start-of-Day? You won't be able to edit until End the Day or admin unlock.")) return;

    const snap = inventory.map((it) => ({ id: it.id, name: it.name, unit: it.unit, qtyAtLock: it.qty }));
    setInventorySnapshot(snap);
    setInventoryLocked(true);
    setInventoryLockedAt(new Date());
  };

  const unlockInventoryWithPin = () => {
    if (!inventoryLocked) return alert("Inventory is already unlocked.");
    const adminNum = promptAdminAndPin();
    if (!adminNum) return;
    if (!window.confirm(`Admin ${adminNum}: Unlock inventory for editing? Snapshot will be kept.`)) return;
    setInventoryLocked(false);
    alert("Inventory unlocked for editing.");
  };

  const startShift = () => {
    if (dayMeta.startedAt && !dayMeta.endedAt) return alert("Shift already started.");
    const nameInput = worker || window.prompt("Enter worker name to START shift (or select in Orders tab then return):", "");
    const name = norm(nameInput);
    if (!name) return alert("Worker name required.");
    setDayMeta({
      startedBy: name,
      startedAt: new Date(),
      endedAt: null,
      endedBy: "",
      lastReportAt: null,
      resetBy: "",
      resetAt: null,
      shiftChanges: [],
    });
    if (!inventoryLocked && inventory.length) {
      if (window.confirm("Lock current Inventory as Start-of-Day snapshot?")) lockInventoryForDay();
    }
  };

  const changeShift = () => {
    if (!dayMeta.startedAt || dayMeta.endedAt) return alert("Start a shift first.");
    const current = window.prompt(`Enter the CURRENT worker name to confirm:`, "");
    if (norm(current) !== norm(dayMeta.startedBy)) return alert(`Only ${dayMeta.startedBy} can hand over the shift.`);
    const next = window.prompt(`Enter the NEW worker name to take over:`, "");
    const newName = norm(next);
    if (!newName) return alert("New worker name required.");
    if (norm(newName) === norm(dayMeta.startedBy)) return alert("New worker must be different from current worker.");
    setDayMeta((d) => ({
      ...d,
      startedBy: newName,
      shiftChanges: [...(d.shiftChanges || []), { at: new Date(), from: d.startedBy, to: newName }],
    }));
    alert(`Shift changed: ${dayMeta.startedBy} → ${newName}`);
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
          : (orders.length ? new Date(Math.min(...orders.map(o => +o.date))) : endTime);
        await purgeOrdersInCloud(db, ordersColRef, start, endTime);
      } catch (e) {
        console.warn("Cloud purge on endDay failed:", e);
      }
      try {
        if (counterDocRef) {
          await setDoc(counterDocRef, { lastOrderNo: 0, updatedAt: serverTimestamp() }, { merge: true });
        }
      } catch (e) {
        console.warn("Counter reset failed:", e);
      }
    }

    const validOrders = orders.filter((o) => !o.voided);
    const revenueExclDelivery = validOrders.reduce(
      (s, o) => s + Number(o.itemsTotal != null ? o.itemsTotal : (o.total - (o.deliveryFee || 0))), 0
    );
    const expensesTotal = expenses.reduce((s, e) => s + Number((e.qty || 0) * (e.unitPrice || 0)), 0);
    const margin = revenueExclDelivery - expensesTotal;

    const txs = [];
    if (margin > 0) {
      txs.push({ id: `tx_${Date.now()}`, type: "init", amount: margin, worker: endBy, note: "Auto Init from day margin", date: new Date() });
    } else if (margin < 0) {
      txs.push({ id: `tx_${Date.now() + 1}`, type: "adjustDown", amount: Math.abs(margin), worker: endBy, note: "Auto Adjust Down (negative margin)", date: new Date() });
    }
    if (txs.length) setBankTx((arr) => [...txs, ...arr]);

    setOrders([]);
    setNextOrderNo(1);
    setInventoryLocked(false);
    setInventoryLockedAt(null);
    setDayMeta({
      startedBy: "",
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
    const uses = {};
    const prodUses = selectedBurger.uses || {};
    for (const k of Object.keys(prodUses)) uses[k] = (uses[k] || 0) + (prodUses[k] || 0);
    for (const ex of selectedExtras) {
      const exUses = ex.uses || {};
      for (const k of Object.keys(exUses)) uses[k] = (uses[k] || 0) + (exUses[k] || 0);
    }
    const line = { ...selectedBurger, extras: [...selectedExtras], price: selectedBurger.price, uses };
    setCart((c) => [...c, line]);
    setSelectedBurger(null);
    setSelectedExtras([]);
  };

  const removeFromCart = (i) => setCart((c) => c.filter((_, idx) => idx !== i));

  const checkout = async () => {
    if (isCheckingOut) return;
    setIsCheckingOut(true);

    try {
      if (!dayMeta.startedAt || dayMeta.endedAt) return alert("Start a shift first (Shift → Start Shift).");
      if (cart.length === 0) return alert("Cart is empty.");
      if (!worker) return alert("Select worker.");
      if (!payment) return alert("Select payment.");
      if (!orderType) return alert("Select order type.");

      // Stock check
      const required = {};
      for (const line of cart) {
        const uses = line.uses || {};
        for (const k of Object.keys(uses)) required[k] = (required[k] || 0) + (uses[k] || 0);
      }
      for (const k of Object.keys(required)) {
        const invItem = invById[k];
        if (!invItem) continue;
        if ((invItem.qty || 0) < required[k]) {
          return alert(`Not enough ${invItem.name} in stock. Need ${required[k]} ${invItem.unit}, have ${invItem.qty} ${invItem.unit}.`);
        }
      }
      // Deduct
      setInventory((inv) =>
        inv.map((it) => {
          const need = required[it.id] || 0;
          return need ? { ...it, qty: it.qty - need } : it;
        })
      );

      const baseSubtotal = cart.reduce((s, b) => s + Number(b.price || 0), 0);
      const extrasSubtotal = cart.reduce((s, b) => s + (b.extras || []).reduce((t, e) => t + Number(e.price || 0), 0), 0);
      const itemsTotal = baseSubtotal + extrasSubtotal;
      const delFee = orderType === "Delivery" ? Math.max(0, Number(deliveryFee || 0)) : 0;
      const total = itemsTotal + delFee;

      // Allocate a UNIQUE order number from Firestore (atomic)
      let allocatedNo = nextOrderNo;
      if (cloudEnabled && counterDocRef && fbUser && db) {
        try {
          allocatedNo = await allocateOrderNoAtomic(db, counterDocRef);
        } catch (e) {
          console.warn("Atomic order number allocation failed, using local nextOrderNo.", e);
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
        cart,
        done: false,
        voided: false,
        restockedAt: undefined,
        note: orderNote.trim(),
        idemKey: `idk_${fbUser ? fbUser.uid : "anon"}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      };

      if (!realtimeOrders) setOrders((o) => [order, ...o]);

      if (cloudEnabled && ordersColRef && fbUser) {
        try {
          const ref = await addDoc(ordersColRef, normalizeOrderForCloud(order));
          if (!realtimeOrders) {
            setOrders((prev) => prev.map((oo) => (oo.orderNo === order.orderNo ? { ...oo, cloudId: ref.id } : oo)));
          }
        } catch (e) {
          console.warn("Cloud order write failed:", e);
        }
      }

      // NEW: Auto-print receipt at 80mm, fit-to-width
      await printThermalTicket(order, 80, "Customer", /*auto*/ true);

      setCart([]);
      setWorker("");
      setPayment("");
      setOrderNote("");
      setOrderType(orderTypes[0] || "Take-Away");
      setDeliveryFee(orderType === "Delivery" ? defaultDeliveryFee : 0);
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
          done: true, updatedAt: serverTimestamp(),
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
      for (const k of Object.keys(uses)) giveBack[k] = (giveBack[k] || 0) + (uses[k] || 0);
    }
    setInventory((inv) =>
      inv.map((it) => {
        const back = giveBack[it.id] || 0;
        return back ? { ...it, qty: it.qty + back } : it;
      })
    );
    setOrders((o) => o.map((x) => (x.orderNo === orderNo ? { ...x, voided: true, restockedAt: new Date() } : x)));

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
          voided: true, restockedAt: new Date().toISOString(), updatedAt: serverTimestamp(),
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
      (s, o) => s + Number(o.itemsTotal != null ? o.itemsTotal : (o.total - (o.deliveryFee || 0))), 0
    );
    const byPay = {};
    for (const p of paymentMethods) byPay[p] = 0;
    for (const o of validOrders) {
      const itemsOnly = Number(o.itemsTotal != null ? o.itemsTotal : (o.total - (o.deliveryFee || 0)));
      if (byPay[o.payment] == null) byPay[o.payment] = 0;
      byPay[o.payment] += itemsOnly;
    }
    const byType = {};
    for (const t of orderTypes) byType[t] = 0;
    for (const o of validOrders) {
      const itemsOnly = Number(o.itemsTotal != null ? o.itemsTotal : (o.total - (o.deliveryFee || 0)));
      if (byType[o.orderType] == null) byType[o.orderType] += 0;
      byType[o.orderType] += itemsOnly;
    }
    const deliveryFeesTotal = validOrders.reduce((s, o) => s + (o.deliveryFee || 0), 0);
    const expensesTotal = expenses.reduce((s, e) => s + Number((e.qty || 0) * (e.unitPrice || 0)), 0);
    const margin = revenueTotal - expensesTotal;
    return { revenueTotal, byPay, byType, deliveryFeesTotal, expensesTotal, margin };
  }, [orders, paymentMethods, orderTypes, expenses]);

  const salesStats = useMemo(() => {
    const itemMap = new Map();
    const extraMap = new Map();
    const add = (map, id, name, count, revenue) => {
      const prev = map.get(id) || { id, name, count: 0, revenue: 0 };
      prev.count += count; prev.revenue += revenue; map.set(id, prev);
    };
    for (const o of orders) {
      if (o.voided) continue;
      for (const line of o.cart || []) {
        const base = Number(line.price || 0);
        add(itemMap, line.id, line.name, 1, base);
        for (const ex of line.extras || []) add(extraMap, ex.id, ex.name, 1, Number(ex.price || 0));
      }
    }
    const items = Array.from(itemMap.values()).sort((a, b) => b.count - a.count || b.revenue - a.revenue);
    const extras = Array.from(extraMap.values()).sort((a, b) => b.count - a.count || b.revenue - a.revenue);
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

  // --------------------------- PDF: REPORT ---------------------------
  const generatePDF = (silent = false, metaOverride = null) => {
    try {
      const m = metaOverride || dayMeta;
      const doc = new jsPDF();
      doc.text("TUX — Shift Report", 14, 12);

      const startedStr = m.startedAt ? new Date(m.startedAt).toLocaleString() : "—";
      const endedStr = m.endedAt ? new Date(m.endedAt).toLocaleString() : "—";

      autoTable(doc, {
        head: [["Start By", "Start At", "End At"]],
        body: [[m.startedBy || "—", startedStr, endedStr]],
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
        head: [["#", "Date", "Worker", "Payment", "Type", "Delivery (E£)", "Total (E£)", "Done", "Voided"]],
        body: getSortedOrders().map((o) => [
          o.orderNo, o.date.toLocaleString(), o.worker, o.payment, o.orderType || "",
          (o.deliveryFee || 0).toFixed(2), o.total.toFixed(2), o.done ? "Yes" : "No", o.voided ? "Yes" : "No",
        ]),
        startY: y + 4,
        styles: { fontSize: 9 },
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Totals (excluding voided)", 14, y);

          const totalsBody = [
        ["Revenue (Shift, excl. delivery)", (totals.revenueTotal || 0).toFixed(2)],
        ["Delivery fees (collected)", (totals.deliveryFeesTotal || 0).toFixed(2)],
        ["Expenses (materials/ops)", (totals.expensesTotal || 0).toFixed(2)],
        ["Margin (Revenue - Expenses)", (totals.margin || 0).toFixed(2)],
      ];

      autoTable(doc, {
        head: [["Metric", "E£"]],
        body: totalsBody,
        startY: y + 4,
        theme: "grid",
        styles: { fontSize: 10 },
      });

      // Payment breakdown
      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("By Payment Method (items only)", 14, y);
      const payRows = Object.entries(totals.byPay || {}).map(([k, v]) => [k, (v || 0).toFixed(2)]);
      autoTable(doc, {
        head: [["Payment", "E£"]],
        body: payRows,
        startY: y + 4,
        theme: "grid",
        styles: { fontSize: 10 },
      });

      // Order type breakdown
      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("By Order Type (items only)", 14, y);
      const typeRows = Object.entries(totals.byType || {}).map(([k, v]) => [k, (v || 0).toFixed(2)]);
      autoTable(doc, {
        head: [["Type", "E£"]],
        body: typeRows,
        startY: y + 4,
        theme: "grid",
        styles: { fontSize: 10 },
      });

      // Inventory report (if snapshot available)
      if (inventoryReportRows.length > 0) {
        y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
        doc.text("Inventory Usage (from Start-of-Day snapshot)", 14, y);
        autoTable(doc, {
          head: [["Item", "Unit", "Start", "Now", "Used"]],
          body: inventoryReportRows.map((r) => [
            r.name,
            r.unit,
            String(r.start ?? 0),
            String(r.now ?? 0),
            String(r.used ?? 0),
          ]),
          startY: y + 4,
          theme: "grid",
          styles: { fontSize: 9 },
        });
      }

      // Top sellers (items & extras)
      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Top Sellers — Items", 14, y);
      autoTable(doc, {
        head: [["Item", "Qty", "Revenue (E£)"]],
        body: (salesStats.items || []).map((it) => [it.name, String(it.count), it.revenue.toFixed(2)]),
        startY: y + 4,
        theme: "grid",
        styles: { fontSize: 9 },
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Top Sellers — Extras", 14, y);
      autoTable(doc, {
        head: [["Extra", "Qty", "Revenue (E£)"]],
        body: (salesStats.extras || []).map((ex) => [ex.name, String(ex.count), ex.revenue.toFixed(2)]),
        startY: y + 4,
        theme: "grid",
        styles: { fontSize: 9 },
      });

      // Expenses table
      if ((expenses || []).length) {
        y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
        doc.text("Expenses", 14, y);
        autoTable(doc, {
          head: [["Name", "Qty", "Unit", "Unit Price (E£)", "Total (E£)", "Date", "Note"]],
          body: expenses.map((e) => [
            e.name || "—",
            String(e.qty ?? 0),
            e.unit || "—",
            Number(e.unitPrice || 0).toFixed(2),
            Number((e.qty || 0) * (e.unitPrice || 0)).toFixed(2),
            e.date ? new Date(e.date).toLocaleString() : "—",
            e.note || "",
          ]),
          startY: y + 4,
          theme: "grid",
          styles: { fontSize: 9 },
        });
      }

      // Footer
      const footerY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 270) + 10;
      const printedAt = new Date().toLocaleString();
      doc.setFontSize(9);
      doc.text(`Generated: ${printedAt}`, 14, Math.min(footerY, 290));

      if (!silent) {
        const fname =
          `TUX_ShiftReport_${(m.startedAt ? new Date(m.startedAt) : new Date()).toISOString().slice(0, 10)}.pdf`;
        doc.save(fname);
      }
      return doc;
    } catch (err) {
      console.warn("PDF generation failed:", err);
      if (!silent) alert("PDF generation failed: " + err);
      return null;
    }
  };

  /* --------------------------- ORDER NO (ATOMIC) --------------------------- */
  async function allocateOrderNoAtomic(dbObj, counterRef) {
    const val = await runTransaction(dbObj, async (tx) => {
      const snap = await tx.get(counterRef);
      const last = snap.exists() ? Number(snap.data().lastOrderNo || 0) : 0;
      const next = last + 1;
      tx.set(counterRef, { lastOrderNo: next, updatedAt: serverTimestamp() }, { merge: true });
      return next;
    });
    return val;
  }

  /* --------------------------- THERMAL TICKET --------------------------- */
  async function printThermalTicket(order, widthMm = 80, copyLabel = "Customer", autoPrint = true) {
    try {
      // Emulate 80mm roll; height big enough, printer will cut/clip
      const doc = new jsPDF({
        unit: "mm",
        format: [widthMm, 200],
      });

      let y = 6;
      doc.setFontSize(14);
      doc.text("TUX", 6, y);
      doc.setFontSize(10);
      doc.text("Burgers • Hawawshi • Fries", 6, (y += 5));

      doc.setFontSize(9);
      const dt = order.date ? new Date(order.date).toLocaleString() : new Date().toLocaleString();
      doc.text(`#${order.orderNo}  •  ${dt}`, 6, (y += 5));
      doc.text(`Worker: ${order.worker || "-"}`, 6, (y += 4));
      doc.text(`Payment: ${order.payment || "-"}`, 6, (y += 4));
      doc.text(`Type: ${order.orderType || "-"}`, 6, (y += 4));
      if (order.note) doc.text(`Note: ${order.note}`, 6, (y += 4));

      // line
      doc.line(6, (y += 2), widthMm - 6, y);

      // Items
      doc.setFontSize(10);
      doc.text("Items:", 6, (y += 5));
      doc.setFontSize(9);
      for (const line of order.cart || []) {
        const base = Number(line.price || 0);
        doc.text(`• ${line.name} — E£ ${base.toFixed(2)}`, 8, (y += 5));
        for (const ex of line.extras || []) {
          doc.text(`   + ${ex.name} — E£ ${Number(ex.price || 0).toFixed(2)}`, 10, (y += 4));
        }
      }

      // Subtotals
      const itemsOnly = Number(order.itemsTotal != null ? order.itemsTotal : (order.total - (order.deliveryFee || 0)));
      doc.line(6, (y += 3), widthMm - 6, y);
      doc.text(`Items Subtotal: E£ ${itemsOnly.toFixed(2)}`, 6, (y += 5));
      if (order.deliveryFee) doc.text(`Delivery: E£ ${Number(order.deliveryFee).toFixed(2)}`, 6, (y += 4));
      doc.setFontSize(11);
      doc.text(`TOTAL: E£ ${Number(order.total || 0).toFixed(2)}`, 6, (y += 6));

      // Footer
      doc.setFontSize(9);
      doc.line(6, (y += 3), widthMm - 6, y);
      doc.text(`${copyLabel} copy — Thank you!`, 6, (y += 5));
      doc.text("Scan for menu: tux-cashier-app.netlify.app", 6, (y += 4));

      if (autoPrint && hasQZ()) {
        await printPDFViaQZ(doc, widthMm);
      } else if (!autoPrint) {
        // save to file if not auto printing
        doc.save(`TUX_Order_${order.orderNo}.pdf`);
      } else {
        // fallback open
        window.open(doc.output("bloburl"), "_blank");
      }
      return doc;
    } catch (e) {
      console.warn("printThermalTicket failed:", e);
      alert("Printing failed: " + e);
      return null;
    }
  }
  /* --------------------------- EFFECTS & SMALL HANDLERS --------------------------- */
  // Auto-set delivery fee when order type changes
  useEffect(() => {
    if (orderType === "Delivery") setDeliveryFee(defaultDeliveryFee || 0);
    else setDeliveryFee(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderType, defaultDeliveryFee]);

  const addInventoryItem = () => {
    const name = String(newInvName || "").trim();
    const unit = String(newInvUnit || "").trim() || "pcs";
    const qty = Number(newInvQty || 0);
    if (!name) return alert("Inventory item name required.");
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (inventory.some((i) => i.id === id)) return alert("An item with this name already exists.");
    setInventory((inv) => [...inv, { id, name, unit, qty }]);
    setNewInvName(""); setNewInvUnit(""); setNewInvQty(0);
  };

  const addExpense = () => {
    const name = String(newExpName || "").trim();
    const qty = Number(newExpQty || 0);
    const unit = String(newExpUnit || "").trim() || "pcs";
    const unitPrice = Number(newExpUnitPrice || 0);
    const note = String(newExpNote || "");
    if (!name) return alert("Expense name required.");
    setExpenses((e) => [
      ...e,
      {
        id: `exp_${Date.now()}`,
        name, qty, unit, unitPrice, note,
        date: new Date(),
      },
    ]);
    setNewExpName(""); setNewExpQty(1); setNewExpUnit("pcs"); setNewExpUnitPrice(0); setNewExpNote("");
  };

  const unlockBank = () => {
    const pin = window.prompt("Enter editor PIN to unlock Bank & Expenses:", "");
    if (pin === EDITOR_PIN) setBankUnlocked(true);
    else alert("Wrong PIN.");
  };

  const addBankTx = () => {
    const amount = Number(bankForm.amount || 0);
    const type = bankForm.type || "deposit";
    const workerName = String(bankForm.worker || "").trim() || (dayMeta.startedBy || "—");
    const note = String(bankForm.note || "");
    if (!amount) return alert("Enter an amount.");
    setBankTx((arr) => [
      { id: `tx_${Date.now()}`, type, amount, worker: workerName, note, date: new Date() },
      ...arr,
    ]);
    setBankForm({ type: "deposit", amount: 0, worker: "", note: "" });
  };

  const testPrintTicket = async () => {
    const sample = {
      orderNo: 999,
      date: new Date(),
      worker: worker || "Tester",
      payment: payment || "Cash",
      orderType: orderType || "Take-Away",
      deliveryFee: 0,
      total: 123.45,
      itemsTotal: 123.45,
      cart: [
        { name: "Sample Burger", price: 95, extras: [{ name: "Cheese", price: 15 }] },
        { name: "Fries", price: 25, extras: [] },
      ],
      note: "Sample ticket",
    };
    await printThermalTicket(sample, 80, "Test", true);
  };

  /* ------------------------------------ UI ------------------------------------ */
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16, color: dark ? "#eee" : "#222", background: dark ? "#111" : "#fafafa" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>TUX — POS</h1>
        <label style={{ marginLeft: "auto" }}>
          <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark
        </label>
      </header>

      {/* Tabs */}
      <nav style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["orders", "prices", "inventory", "reports", "bank"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ccc",
              background: activeTab === tab ? "#4f46e5" : "#fff",
              color: activeTab === tab ? "#fff" : "#222",
              cursor: "pointer",
            }}
          >
            {tab.toUpperCase()}
          </button>
        ))}
      </nav>

      {/* Status bar */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <strong>Now:</strong> {nowStr}
        <span>|</span>
        <strong>Shift:</strong>{" "}
        {dayMeta.startedAt ? `Started by ${dayMeta.startedBy} @ ${new Date(dayMeta.startedAt).toLocaleString()}` : "— Not started —"}
        {dayMeta.endedAt ? ` | Ended @ ${new Date(dayMeta.endedAt).toLocaleString()}` : ""}
        <span style={{ marginLeft: "auto" }}>
          <button onClick={startShift} style={{ marginRight: 6 }}>Start Shift</button>
          <button onClick={changeShift} style={{ marginRight: 6 }}>Change Shift</button>
          <button onClick={endDay} style={{ background: "#ef4444", color: "#fff" }}>End Day</button>
        </span>
      </div>

      {/* Cloud controls & QZ */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <label>
          <input type="checkbox" checked={cloudEnabled} onChange={(e) => setCloudEnabled(e.target.checked)} /> Cloud Save
        </label>
        <label title="When ON, orders stream live from Firestore within the shift window. When OFF, orders are kept only locally and saved to 'state' on autosave.">
          <input type="checkbox" checked={realtimeOrders} onChange={(e) => setRealtimeOrders(e.target.checked)} /> Realtime Orders
        </label>
        <button onClick={loadFromCloud}>Load From Cloud</button>
        <small>
          {cloudStatus.error ? <span style={{ color: "#ef4444" }}>Error: {cloudStatus.error}</span> : ""}
          {cloudStatus.lastSaveAt ? ` • Last save: ${cloudStatus.lastSaveAt.toLocaleTimeString()}` : ""}
          {cloudStatus.lastLoadAt ? ` • Last load: ${cloudStatus.lastLoadAt.toLocaleTimeString()}` : ""}
        </small>
        <span style={{ marginLeft: "auto" }}>
          <button onClick={detectPrinters} style={{ marginRight: 6 }}>Detect Printers</button>
          <select
            value={selectedPrinter || ""}
            onChange={(e) => setSelectedPrinter(e.target.value || null)}
            style={{ marginRight: 6 }}
          >
            <option value="">{printerState.defaultPrinter ? `(Default) ${printerState.defaultPrinter}` : "Select printer"}</option>
            {(printerState.printers || []).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <button onClick={testPrintTicket}>Test Print</button>
        </span>
      </div>

      {/* --------------------- ORDERS TAB --------------------- */}
      {activeTab === "orders" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Left: Build order */}
          <section style={{ background: dark ? "#1a1a1a" : "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Build Order</h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label>Worker</label>
                <select value={worker} onChange={(e) => setWorker(e.target.value)} style={{ width: "100%" }}>
                  <option value="">— Select —</option>
                  {workers.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label>Payment</label>
                <select value={payment} onChange={(e) => setPayment(e.target.value)} style={{ width: "100%" }}>
                  <option value="">— Select —</option>
                  {paymentMethods.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label>Order Type</label>
                <select value={orderType} onChange={(e) => setOrderType(e.target.value)} style={{ width: "100%" }}>
                  {orderTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label>Delivery Fee</label>
                <input type="number" value={deliveryFee} onChange={(e) => setDeliveryFee(Number(e.target.value || 0))} style={{ width: "100%" }} />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label>Note</label>
              <textarea value={orderNote} onChange={(e) => setOrderNote(e.target.value)} rows={2} style={{ width: "100%" }} />
            </div>

            <hr style={{ margin: "12px 0" }} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label>Item</label>
                <select
                  value={selectedBurger ? selectedBurger.id : ""}
                  onChange={(e) => {
                    const id = Number(e.target.value || 0);
                    const item = BASE_MENU.concat(menu).find((m) => m.id === id) || menu.find((m) => m.id === id);
                    setSelectedBurger(item || null);
                  }}
                  style={{ width: "100%" }}
                >
                  <option value="">— Choose item —</option>
                  {menu.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — E£ {Number(m.price || 0).toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label>Extras</label>
                <div style={{ maxHeight: 120, overflow: "auto", border: "1px solid #ddd", borderRadius: 6, padding: 6 }}>
                  {extraList.map((ex) => {
                    const checked = !!selectedExtras.find((e) => e.id === ex.id);
                    return (
                      <label key={ex.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleExtra(ex)} />
                        <span>{ex.name} — E£ {Number(ex.price || 0).toFixed(2)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <button onClick={addToCart}>Add to Cart</button>
            </div>

            <div style={{ marginTop: 12 }}>
              <h4>Cart</h4>
              {cart.length === 0 ? <em>No items.</em> : (
                <table width="100%" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th align="left">Item</th>
                      <th align="right">E£</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((line, i) => (
                      <tr key={i}>
                        <td>
                          {line.name}
                          {(line.extras || []).length ? (
                            <div style={{ fontSize: 12, opacity: 0.8 }}>
                              {(line.extras || []).map((e) => e.name).join(", ")}
                            </div>
                          ) : null}
                        </td>
                        <td align="right">{Number(line.price || 0).toFixed(2)}{(line.extras || []).length ? ` + ${line.extras.reduce((s, e) => s + Number(e.price || 0), 0).toFixed(2)}` : ""}</td>
                        <td align="right">
                          <button onClick={() => removeFromCart(i)}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <button onClick={checkout} disabled={isCheckingOut} style={{ background: "#16a34a", color: "#fff", padding: "8px 12px", borderRadius: 6 }}>
                {isCheckingOut ? "Processing..." : `Checkout  (#${nextOrderNo})`}
              </button>
            </div>
          </section>

          {/* Right: Orders & totals */}
          <section style={{ background: dark ? "#1a1a1a" : "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>Orders</h3>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ marginLeft: "auto" }}>
                <option value="date-desc">Latest first</option>
                <option value="date-asc">Oldest first</option>
                <option value="worker">By worker</option>
                <option value="payment">By payment</option>
              </select>
            </div>

            <div style={{ marginBottom: 10 }}>
              <strong>Revenue (items only):</strong> E£ {Number(totals.revenueTotal || 0).toFixed(2)} &nbsp;|&nbsp;
              <strong>Delivery fees:</strong> E£ {Number(totals.deliveryFeesTotal || 0).toFixed(2)} &nbsp;|&nbsp;
              <strong>Expenses:</strong> E£ {Number(totals.expensesTotal || 0).toFixed(2)} &nbsp;|&nbsp;
              <strong>Margin:</strong> E£ {Number(totals.margin || 0).toFixed(2)}
            </div>

            <div style={{ maxHeight: 420, overflow: "auto" }}>
              <table width="100%" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th align="left">#</th>
                    <th align="left">Date</th>
                    <th align="left">Worker</th>
                    <th align="left">Pay</th>
                    <th align="left">Type</th>
                    <th align="right">Items E£</th>
                    <th align="right">Deliv E£</th>
                    <th align="right">Total E£</th>
                    <th align="center">Done</th>
                    <th align="center">Voided</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {getSortedOrders().map((o) => {
                    const itemsOnly = Number(o.itemsTotal != null ? o.itemsTotal : (o.total - (o.deliveryFee || 0)));
                    return (
                      <tr key={o.orderNo}>
                        <td>#{o.orderNo}</td>
                        <td>{o.date.toLocaleString()}</td>
                        <td>{o.worker}</td>
                        <td>{o.payment}</td>
                        <td>{o.orderType || ""}</td>
                        <td align="right">{itemsOnly.toFixed(2)}</td>
                        <td align="right">{Number(o.deliveryFee || 0).toFixed(2)}</td>
                        <td align="right">{Number(o.total || 0).toFixed(2)}</td>
                        <td align="center">{o.done ? "✔" : "—"}</td>
                        <td align="center">{o.voided ? "✔" : "—"}</td>
                        <td align="right" style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          {!o.done && !o.voided && <button onClick={() => markOrderDone(o.orderNo)}>Mark Done</button>}
                          {!o.voided && !o.done && <button onClick={() => voidOrderAndRestock(o.orderNo)} style={{ background: "#ef4444", color: "#fff" }}>Void & Restock</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* --------------------- PRICES TAB --------------------- */}
      {activeTab === "prices" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Menu items */}
          <section style={{ background: dark ? "#1a1a1a" : "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Menu Items</h3>
            <table width="100%" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">Name</th>
                  <th align="right">Price (E£)</th>
                </tr>
              </thead>
              <tbody>
                {menu.map((m, idx) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td align="right">
                      <input
                        type="number"
                        value={m.price}
                        onChange={(e) => {
                          const val = Number(e.target.value || 0);
                          setMenu((arr) => arr.map((x, i) => (i === idx ? { ...x, price: val } : x)));
                        }}
                        style={{ width: 100 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input placeholder="New item name" value={newMenuName} onChange={(e) => setNewMenuName(e.target.value)} />
              <input type="number" placeholder="Price" value={newMenuPrice} onChange={(e) => setNewMenuPrice(Number(e.target.value || 0))} />
              <button
                onClick={() => {
                  const name = String(newMenuName || "").trim();
                  if (!name) return alert("Name required.");
                  const id = Math.max(1, ...menu.map((m) => Number(m.id) || 0)) + 1;
                  setMenu((arr) => [...arr, { id, name, price: Number(newMenuPrice || 0), uses: {} }]);
                  setNewMenuName(""); setNewMenuPrice(0);
                }}
              >
                Add Item
              </button>
            </div>

            <div style={{ marginTop: 12 }}>
              <label>Default Delivery Fee: </label>
              <input type="number" value={defaultDeliveryFee} onChange={(e) => setDefaultDeliveryFee(Number(e.target.value || 0))} />
            </div>
          </section>

          {/* Extras & Lists */}
          <section style={{ background: dark ? "#1a1a1a" : "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Extras</h3>
            <table width="100%" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">Name</th>
                  <th align="right">Price (E£)</th>
                </tr>
              </thead>
              <tbody>
                {extraList.map((ex, idx) => (
                  <tr key={ex.id}>
                    <td>{ex.name}</td>
                    <td align="right">
                      <input
                        type="number"
                        value={ex.price}
                        onChange={(e) => {
                          const val = Number(e.target.value || 0);
                          setExtraList((arr) => arr.map((x, i) => (i === idx ? { ...x, price: val } : x)));
                        }}
                        style={{ width: 100 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input placeholder="New extra name" value={newExtraName} onChange={(e) => setNewExtraName(e.target.value)} />
              <input type="number" placeholder="Price" value={newExtraPrice} onChange={(e) => setNewExtraPrice(Number(e.target.value || 0))} />
              <button
                onClick={() => {
                  const name = String(newExtraName || "").trim();
                  if (!name) return alert("Name required.");
                  const id = Math.max(100, ...extraList.map((m) => Number(m.id) || 0)) + 1;
                  setExtraList((arr) => [...arr, { id, name, price: Number(newExtraPrice || 0), uses: {} }]);
                  setNewExtraName(""); setNewExtraPrice(0);
                }}
              >
                Add Extra
              </button>
            </div>

            <hr style={{ margin: "12px 0" }} />

            <h4>Workers</h4>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input placeholder="Add worker" value={newWorker} onChange={(e) => setNewWorker(e.target.value)} />
              <button onClick={() => {
                const nm = String(newWorker || "").trim();
                if (!nm) return;
                if (workers.includes(nm)) return alert("Already exists.");
                setWorkers((arr) => [...arr, nm]); setNewWorker("");
              }}>Add</button>
            </div>
            <div>{workers.join(", ") || <em>— none —</em>}</div>

            <h4 style={{ marginTop: 12 }}>Payment Methods</h4>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input placeholder="Add payment method" value={newPayment} onChange={(e) => setNewPayment(e.target.value)} />
              <button onClick={() => {
                const nm = String(newPayment || "").trim();
                if (!nm) return;
                if (paymentMethods.includes(nm)) return alert("Already exists.");
                setPaymentMethods((arr) => [...arr, nm]); setNewPayment("");
              }}>Add</button>
            </div>
            <div>{paymentMethods.join(", ") || <em>— none —</em>}</div>

            <h4 style={{ marginTop: 12 }}>Order Types</h4>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input placeholder="Add order type" onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = String(e.currentTarget.value || "").trim();
                  if (!val) return;
                  if (orderTypes.includes(val)) return alert("Already exists.");
                  setOrderTypes((arr) => [...arr, val]);
                  e.currentTarget.value = "";
                }
              }} />
              <small>Press Enter to add</small>
            </div>
            <div>{orderTypes.join(", ")}</div>
          </section>
        </div>
      )}

      {/* --------------------- INVENTORY TAB --------------------- */}
      {activeTab === "inventory" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <section style={{ background: dark ? "#1a1a1a" : "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Inventory</h3>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input placeholder="Name" value={newInvName} onChange={(e) => setNewInvName(e.target.value)} />
              <input placeholder="Unit (e.g. g, pcs)" value={newInvUnit} onChange={(e) => setNewInvUnit(e.target.value)} />
              <input type="number" placeholder="Qty" value={newInvQty} onChange={(e) => setNewInvQty(Number(e.target.value || 0))} />
              <button onClick={addInventoryItem}>Add</button>
            </div>

            <table width="100%" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">Name</th>
                  <th align="left">Unit</th>
                  <th align="right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((it, idx) => (
                  <tr key={it.id}>
                    <td>{it.name}</td>
                    <td>
                      <input
                        value={it.unit}
                        onChange={(e) => setInventory((arr) => arr.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))}
                        style={{ width: 80 }}
                      />
                    </td>
                    <td align="right">
                      <input
                        type="number"
                        value={it.qty}
                        onChange={(e) => setInventory((arr) => arr.map((x, i) => (i === idx ? { ...x, qty: Number(e.target.value || 0) } : x)))}
                        style={{ width: 100 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              {!inventoryLocked && <button onClick={lockInventoryForDay}>Lock Inventory (Start-of-Day)</button>}
              {inventoryLocked && <button onClick={unlockInventoryWithPin}>Unlock (Admin PIN)</button>}
              <small style={{ opacity: 0.8 }}>
                {inventoryLocked ? `Locked @ ${inventoryLockedAt ? new Date(inventoryLockedAt).toLocaleString() : "—"}` : "Currently editable"}
              </small>
            </div>
          </section>

          <section style={{ background: dark ? "#1a1a1a" : "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Snapshot / Usage</h3>
            {inventorySnapshot && inventorySnapshot.length ? (
              <table width="100%" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th align="left">Item</th>
                    <th align="left">Unit</th>
                    <th align="right">Start</th>
                    <th align="right">Now</th>
                    <th align="right">Used</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryReportRows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td>{r.unit}</td>
                      <td align="right">{r.start}</td>
                      <td align="right">{r.now}</td>
                      <td align="right">{r.used}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <em>No snapshot yet. Lock inventory to create one.</em>
            )}
          </section>
        </div>
      )}

      {/* --------------------- REPORTS TAB --------------------- */}
      {activeTab === "reports" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
          <section style={{ background: dark ? "#1a1a1a" : "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Shift Report</h3>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <div><strong>Started:</strong> {dayMeta.startedAt ? new Date(dayMeta.startedAt).toLocaleString() : "—"}</div>
              <div><strong>By:</strong> {dayMeta.startedBy || "—"}</div>
              <div><strong>Ended:</strong> {dayMeta.endedAt ? new Date(dayMeta.endedAt).toLocaleString() : "—"}</div>
              <div><strong>By:</strong> {dayMeta.endedBy || "—"}</div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <div><strong>Revenue (items only):</strong> E£ {Number(totals.revenueTotal || 0).toFixed(2)}</div>
              <div><strong>Delivery fees:</strong> E£ {Number(totals.deliveryFeesTotal || 0).toFixed(2)}</div>
              <div><strong>Expenses:</strong> E£ {Number(totals.expensesTotal || 0).toFixed(2)}</div>
              <div><strong>Margin:</strong> E£ {Number(totals.margin || 0).toFixed(2)}</div>
            </div>

            <button onClick={() => generatePDF(false)} style={{ padding: "8px 12px", borderRadius: 6 }}>Download Report PDF</button>
          </section>
        </div>
      )}

      {/* --------------------- BANK & EXPENSES TAB --------------------- */}
      {activeTab === "bank" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <section style={{ background: dark ? "#1a1a1a" : "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>Expenses</h3>
              {!bankUnlocked && <button onClick={unlockBank}>Unlock (PIN)</button>}
            </div>

            <div style={{ opacity: bankUnlocked ? 1 : 0.5, pointerEvents: bankUnlocked ? "auto" : "none" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 100px 120px", gap: 8, marginBottom: 8 }}>
                <input placeholder="Name" value={newExpName} onChange={(e) => setNewExpName(e.target.value)} />
                <input type="number" placeholder="Qty" value={newExpQty} onChange={(e) => setNewExpQty(Number(e.target.value || 0))} />
                <input placeholder="Unit" value={newExpUnit} onChange={(e) => setNewExpUnit(e.target.value)} />
                <input type="number" placeholder="Unit Price" value={newExpUnitPrice} onChange={(e) => setNewExpUnitPrice(Number(e.target.value || 0))} />
              </div>
              <input placeholder="Note" value={newExpNote} onChange={(e) => setNewExpNote(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
              <button onClick={addExpense}>Add Expense</button>
            </div>

            <div style={{ marginTop: 12, maxHeight: 300, overflow: "auto" }}>
              <table width="100%" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th align="left">Name</th>
                    <th align="right">Qty</th>
                    <th align="left">Unit</th>
                    <th align="right">Unit E£</th>
                    <th align="right">Total E£</th>
                    <th align="left">Date</th>
                    <th align="left">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id}>
                      <td>{e.name}</td>
                      <td align="right">{e.qty}</td>
                      <td>{e.unit}</td>
                      <td align="right">{Number(e.unitPrice || 0).toFixed(2)}</td>
                      <td align="right">{Number((e.qty || 0) * (e.unitPrice || 0)).toFixed(2)}</td>
                      <td>{e.date ? new Date(e.date).toLocaleString() : "—"}</td>
                      <td>{e.note || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={{ background: dark ? "#1a1a1a" : "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>Bank / Cash Movements</h3>
              {!bankUnlocked && <button onClick={unlockBank}>Unlock (PIN)</button>}
            </div>

            <div style={{ opacity: bankUnlocked ? 1 : 0.5, pointerEvents: bankUnlocked ? "auto" : "none" }}>
              <div style={{ display: "grid", gridTemplateColumns: "150px 120px 1fr", gap: 8, marginBottom: 8 }}>
                <select value={bankForm.type} onChange={(e) => setBankForm((f) => ({ ...f, type: e.target.value }))}>
                  <option value="deposit">Deposit (to Bank)</option>
                  <option value="withdraw">Withdraw (from Bank)</option>
                  <option value="adjustUp">Adjust Up</option>
                  <option value="adjustDown">Adjust Down</option>
                </select>
                <input type="number" placeholder="Amount" value={bankForm.amount} onChange={(e) => setBankForm((f) => ({ ...f, amount: Number(e.target.value || 0) }))} />
                <input placeholder="Worker" value={bankForm.worker} onChange={(e) => setBankForm((f) => ({ ...f, worker: e.target.value }))} />
              </div>
              <input placeholder="Note" value={bankForm.note} onChange={(e) => setBankForm((f) => ({ ...f, note: e.target.value }))} style={{ width: "100%", marginBottom: 8 }} />
              <button onClick={addBankTx}>Add Movement</button>
            </div>

            <div style={{ marginTop: 12, maxHeight: 300, overflow: "auto" }}>
              <table width="100%" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th align="left">Type</th>
                    <th align="right">Amount</th>
                    <th align="left">Worker</th>
                    <th align="left">Note</th>
                    <th align="left">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {bankTx.map((t) => (
                    <tr key={t.id}>
                      <td>{t.type}</td>
                      <td align="right">{Number(t.amount || 0).toFixed(2)}</td>
                      <td>{t.worker || "—"}</td>
                      <td>{t.note || ""}</td>
                      <td>{t.date ? new Date(t.date).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <footer style={{ marginTop: 24, opacity: 0.7, fontSize: 12 }}>
        © TUX POS — {new Date().getFullYear()}
      </footer>
    </div>
  );
}
