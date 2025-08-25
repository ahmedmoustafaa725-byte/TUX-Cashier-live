import React, { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
// ❌ removed: import qz from "qz-tray";
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
  runTransaction,          // <-- atomic counter
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
    idemKey: order.idemKey || "",     // idempotency guard
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

/* --------------------------- COUNTER: Atomic orderNo --------------------------- */
// We use shops/{SHOP_ID}/state/counters  with field "lastOrderNo"
async function allocateOrderNoAtomic(db, counterDocRef) {
  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterDocRef);
    const current = snap.exists() ? Number(snap.data().lastOrderNo || 0) : 0;
    const n = current + 1;
    tx.set(counterDocRef, { lastOrderNo: n, updatedAt: serverTimestamp() }, { merge: true });
    return n;
  });
  return next;
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
  const [nextOrderNo, setNextOrderNo] = useState(1); // live preview of what will be allocated

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

  // NEW: Printing preferences (UI + logic)
  const [autoPrintOnCheckout, setAutoPrintOnCheckout] = useState(true);
  const [preferredPaperWidthMm, setPreferredPaperWidthMm] = useState(80); // default 80mm

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

  // Live board: only show orders within the active shift window
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
      setOrders(dedupeOrders(arr)); // keep latest per orderNo
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
      // Reset the shared counter to start from #1 next day
      try {
        if (counterDocRef) {
          await setDoc(counterDocRef, { lastOrderNo: 0, updatedAt: serverTimestamp() }, { merge: true });
        }
      } catch (e) {
        console.warn("Counter reset failed:", e);
      }
    }

    // Daily margin into Bank
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
  const [isCheckingOut, setIsCheckingOut] = useState(false); // guard against double taps

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

      // Allocate a UNIQUE order number from Firestore (atomic across devices)
      let allocatedNo = nextOrderNo;
      if (cloudEnabled && counterDocRef && fbUser && db) {
        try {
          allocatedNo = await allocateOrderNoAtomic(db, counterDocRef);
        } catch (e) {
          console.warn("Atomic order number allocation failed, using local nextOrderNo.", e);
        }
      }
      setNextOrderNo(allocatedNo + 1); // UI feedback

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

      // 🔸 Print using the existing PDF ticket (no QZ dependency)
      try {
        if (autoPrintOnCheckout) {
          await printThermalTicket(order, Number(preferredPaperWidthMm) || 80, "Customer", { autoPrint: true });
        }
      } catch (err) {
        console.warn("PDF print failed:", err);
      }

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
        head: [["Start By", "Start At", "End At"]], body: [[m.startedBy || "—", startedStr, endedStr]],
        startY: 18, theme: "grid",
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
        body: timelineRows, startY: y + 4, theme: "grid", styles: { fontSize: 10 },
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : 28;
      doc.text("Orders", 14, y);
      autoTable(doc, {
        head: [["#", "Date", "Worker", "Payment", "Type", "Delivery (E£)", "Total (E£)", "Done", "Voided"]],
        body: getSortedOrders().map((o) => [
          o.orderNo, o.date.toLocaleString(), o.worker, o.payment, o.orderType || "",
          (o.deliveryFee || 0).toFixed(2), o.total.toFixed(2), o.done ? "Yes" : "No", o.voided ? "Yes" : "No",
        ]),
        startY: y + 4, styles: { fontSize: 9 },
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Totals (excluding voided)", 14, y);

      const totalsBody = [
        ["Revenue (Shift, excl. delivery)", totals.revenueTotal.toFixed(2)],
        ["Delivery Fees (not in revenue)", totals.deliveryFeesTotal.toFixed(2)],
        ["Expenses (Shift)", totals.expensesTotal.toFixed(2)],
        ["Margin (Revenue - Expenses)", totals.margin.toFixed(2)],
      ];
      for (const p of Object.keys(totals.byPay)) totalsBody.push([`By Payment — ${p} (items only)`, (totals.byPay[p] || 0).toFixed(2)]);
      for (const t of Object.keys(totals.byType)) totalsBody.push([`By Order Type — ${t} (items only)`, (totals.byType[t] || 0).toFixed(2)]);

      autoTable(doc, { head: [["Metric", "Amount (E£)"]], body: totalsBody, startY: y + 4, theme: "grid", styles: { fontSize: 10 } });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Items — Times Ordered", 14, y);
      autoTable(doc, {
        head: [["Item", "Times", "Revenue (E£)"]],
        body: salesStats.items.map((r) => [r.name, String(r.count), r.revenue.toFixed(2)]),
        startY: y + 4, theme: "grid",
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Extras — Times Ordered", 14, y);
      autoTable(doc, {
        head: [["Extra", "Times", "Revenue (E£)"]],
        body: salesStats.extras.map((r) => [r.name, String(r.count), r.revenue.toFixed(2)]),
        startY: y + 4, theme: "grid",
      });

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Inventory — Start vs Now", 14, y);

      if (!inventoryReportRows.length) {
        autoTable(doc, {
          head: [["Info"]],
          body: [["No inventory snapshot yet. Lock inventory to capture start-of-day."]],
          startY: y + 4, theme: "grid",
        });
      } else {
        autoTable(doc, {
          head: [["Item", "Unit", "Start Qty", "Current Qty", "Used"]],
          body: inventoryReportRows.map((r) => [r.name, r.unit, String(r.start), String(r.now), String(r.used)]),
          startY: y + 4, theme: "grid",
        });
      }

      y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : y + 40;
      doc.text("Expenses (Shift)", 14, y);
      autoTable(doc, {
        head: [["Name", "Unit", "Qty", "Unit Price (E£)", "Total (E£)", "Date", "Note"]],
        body: expenses.map((e) => [
          e.name, e.unit, String(e.qty), Number(e.unitPrice || 0).toFixed(2),
          (Number(e.qty || 0) * Number(e.unitPrice || 0)).toFixed(2),
          e.date ? new Date(e.date).toLocaleString() : "", e.note || "",
        ]),
        startY: y + 4, theme: "grid", styles: { fontSize: 9 },
      });

      setDayMeta((d) => ({ ...d, lastReportAt: new Date() }));
      doc.save("tux_shift_report.pdf");
      if (!silent) alert("PDF downloaded.");
    } catch (err) {
      console.error(err);
      alert("Could not generate PDF. Try again (ensure pop-ups are allowed).");
    }
  };

  // --------------------------- PDF: THERMAL (with auto-print) ---------------------------
  /**
   * Prints ticket as an 80mm/58mm PDF.
   * opts.autoPrint = true will open a new tab with print dialog automatically.
   * NOTE: Browsers control the final "Fit to printable area" toggle. We size the page to widthMm for best results.
   */
  const printThermalTicket = async (order, widthMm = 80, copy = "Customer", opts = { autoPrint: false }) => {
    try {
      if (order.voided) return alert("This order is voided; no tickets can be printed.");
      if (order.done && copy === "Kitchen") return alert("Order is done; kitchen ticket not available.");

      const MAX_H = 1000;
      const doc = new jsPDF({ unit: "mm", format: [widthMm, MAX_H], compress: true });

      doc.setTextColor(0, 0, 0);
      doc.setDrawColor(0, 0, 0);

      const margin = 4;
      const colRight = widthMm - margin;
      let y = margin;

      const safe = (s) => String(s ?? "").replace(/[\u2013\u2014]/g, "-");

      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      doc.text(safe("TUX - Burger Truck"), margin, y); y += 6;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`${safe(copy)} Copy`, margin, y); y += 5;

      doc.text(`Order #${order.orderNo}`, margin, y); y += 4;
      doc.text(new Date(order.date).toLocaleString(), margin, y); y += 5;

      doc.text(`Worker: ${safe(order.worker)}`, margin, y); y += 4;
      doc.text(`Payment: ${safe(order.payment)} | Type: ${safe(order.orderType)}`, margin, y); y += 5;

      if (order.orderType === "Delivery") {
        doc.text(`Delivery Fee: E£${(order.deliveryFee || 0).toFixed(2)}`, margin, y);
        y += 5;
      }

      if (order.note) {
        doc.text("NOTE:", margin, y); y += 5;
        const wrapped = doc.splitTextToSize(safe(order.note), widthMm - margin * 2);
        wrapped.forEach(line => { doc.text(line, margin, y); y += 4; });
        y += 2;
      }

      doc.text("Items", margin, y); y += 5;

      order.cart.forEach((ci) => {
        const nameWrapped = doc.splitTextToSize(safe(ci.name), widthMm - margin * 2);
        nameWrapped.forEach((w, i) => {
          doc.text(w, margin, y);
          if (i === 0) doc.text(`E£${Number(ci.price || 0).toFixed(2)}`, colRight, y, { align: "right" });
          y += 4;
        });
        (ci.extras || []).forEach((ex) => {
          const exWrapped = doc.splitTextToSize(`+ ${safe(ex.name)}`, widthMm - margin * 2 - 2);
          exWrapped.forEach((w, i) => {
            doc.text(w, margin + 2, y);
            if (i === 0) doc.text(`E£${Number(ex.price || 0).toFixed(2)}`, colRight, y, { align: "right" });
            y += 4;
          });
        });
        y += 1;
      });

      doc.line(margin, y, widthMm - margin, y); y += 3;
      doc.text("TOTAL", margin, y);
      doc.text(`E£${Number(order.total || 0).toFixed(2)}`, widthMm - margin, y, { align: "right" });
      y += 6;

      doc.setFontSize(8);

      if (order.voided) {
        doc.text("VOIDED / RESTOCKED", margin, y);
        y += 5;
      } else if (order.done) {
        doc.text("DONE", margin, y);
        y += 5;
      } else {
        const footerLines = [
          "Thank you for your Visit!",
          "See you Soon",
        ];
        footerLines.forEach((line) => { doc.text(line, margin, y); y += 4; });

        try { doc.setLineDash([1, 1], 0); } catch {}
        doc.line(margin, y, widthMm - margin, y);
        try { doc.setLineDash(); } catch {}
        y += 8;
      }

      // 📸 Append icons ONLY to the Customer copy
      if (copy === "Customer") {
        const padding = margin * 2;
        const maxW = Math.max(10, widthMm - padding);

        const drawImageFromPaths = async (paths, preferredWidthMm) => {
          for (const p of paths) {
            try {
              const dataUrl = await loadAsDataURL(p);
              const im = await new Promise((resolve, reject) => {
                const _im = new Image();
                _im.onload = () => resolve(_im);
                _im.onerror = reject;
                _im.src = dataUrl;
              });
              const aspect = im.width > 0 ? im.height / im.width : 1;
              const drawW = Math.min(preferredWidthMm, maxW);
              const drawH = drawW * aspect;
              const x = (widthMm - drawW) / 2;
              const fmt = p.toLowerCase().endsWith(".png") ? "PNG" : "JPEG";
              doc.addImage(dataUrl, fmt, x, y, drawW, drawH);
              y += drawH + 4;
              return true;
            } catch {
              // try next candidate
            }
          }
          return false;
        };

        // Order: Logo -> QR -> Delivery banner
        await drawImageFromPaths(
          ["/receipt/tux-logo.jpg", "/receipt/tux-logo.png", "/tux-logo.jpg", "/tux-logo.png"],
          Math.min(35, maxW)
        );

        await drawImageFromPaths(
          ["/receipt/qr.jpg", "/receipt/qr.png", "/qr.jpg", "/qr.png"],
          Math.min(35, maxW)
        );
        await drawImageFromPaths(
          ["/receipt/delivery.jpg", "/receipt/delivery.png", "/delivery.jpg", "/delivery.png"],
          Math.min(60, maxW)
        );
      }

      if (opts?.autoPrint) {
        try { doc.autoPrint({ variant: "non-conform" }); } catch {}
        const url = doc.output("bloburl");
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        doc.save(`tux_${copy.toLowerCase()}_${Math.round(widthMm)}mm_order_${order.orderNo}.pdf`);
      }
    } catch (err) {
      console.error(err);
      alert("Could not print ticket. Ensure pop-ups are allowed and try again.");
    }
  };

  // 🔹 Simple test-print helper (uses demo order)
  const testPrint = async (width = preferredPaperWidthMm) => {
    const demo = {
      orderNo: 999,
      date: new Date(),
      worker: worker || "Test",
      payment: "Cash",
      orderType: "Take-Away",
      deliveryFee: 0,
      itemsTotal: 145,
      total: 145,
      cart: [
        { id: 1, name: "Single Smashed Patty", price: 95, extras: [{ id: 103, name: "Cheese", price: 15 }] },
        { id: 5, name: "Classic Fries", price: 25, extras: [] },
        { id: 12, name: "Soda", price: 10, extras: [] },
      ],
      done: false,
      voided: false,
      note: "Test print",
    };
    await printThermalTicket(demo, Number(width) || 80, "Customer", { autoPrint: true });
  };

  const cardBorder = dark ? "#555" : "#ddd";
  const softBg = dark ? "#1e1e1e" : "#f5f5f5";
  const btnBorder = "#ccc";
  const containerStyle = {
    maxWidth: 1024, margin: "0 auto", padding: 16,
    background: dark ? "#121212" : "white", color: dark ? "#eee" : "black",
    minHeight: "100vh", transition: "background 0.2s ease, color 0.2s ease",
  };

  const handleTabClick = (key) => {
    if (key === "prices" && !pricesUnlocked) {
      const entered = window.prompt("Enter Editor PIN to open Prices:", "");
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

  const bankBalance = useMemo(() => {
    return bankTx.reduce((sum, t) => {
      const a = Number(t.amount || 0);
      if (t.type === "deposit" || t.type === "init" || t.type === "adjustUp") return sum + a;
      if (t.type === "withdraw" || t.type === "adjustDown") return sum - a;
      return sum;
    }, 0);
  }, [bankTx]);

  /* --------------------------- UI --------------------------- */
  const firebaseConfigured = !!(firebaseConfig && firebaseConfig.apiKey);

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>🍔 TUX — Burger Truck POS</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <small>{nowStr}</small>

          {/* Cloud */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "2px 6px", borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#222" : "#f3f3f3" }}>
            <span>☁</span>
            {!firebaseConfigured && <small style={{ color: "#c62828" }}>Setup Firebase config</small>}
            {firebaseConfigured && (
              <>
                            {/* Auth / Cloud status */}
              <small style={{ opacity: 0.85 }}>
                {fbUser ? `uid:${fbUser.uid.slice(0, 6)}…` : "auth:…"}
              </small>
              <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={cloudEnabled}
                  onChange={(e) => setCloudEnabled(e.target.checked)}
                />
                <small>Cloud ON</small>
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={realtimeOrders}
                  onChange={(e) => setRealtimeOrders(e.target.checked)}
                />
                <small>Realtime Orders</small>
              </label>
              <button
                onClick={loadFromCloud}
                style={{ padding: "2px 6px", borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "white" }}
              >
                Load
              </button>
              {cloudStatus?.lastSaveAt && (
                <small>saved: {new Date(cloudStatus.lastSaveAt).toLocaleTimeString()}</small>
              )}
              {cloudStatus?.lastLoadAt && (
                <small>loaded: {new Date(cloudStatus.lastLoadAt).toLocaleTimeString()}</small>
              )}
              </>
            )}
          </div>

          {/* Print prefs */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 6px", borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#222" : "#f3f3f3" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={autoPrintOnCheckout}
                onChange={(e) => setAutoPrintOnCheckout(e.target.checked)}
              />
              <small>Auto-print on Checkout</small>
            </label>
            <small>Paper</small>
            <select
              value={preferredPaperWidthMm}
              onChange={(e) => setPreferredPaperWidthMm(Number(e.target.value))}
              style={{ padding: "2px 6px", borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "white" }}
            >
              <option value={80}>80 mm</option>
              <option value={58}>58 mm</option>
            </select>
            <button
              onClick={() => testPrint(preferredPaperWidthMm)}
              style={{ padding: "2px 6px", borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "white" }}
            >
              Test Print
            </button>
          </div>

          {/* Theme */}
          <label style={{ display: "flex", gap: 6, alignItems: "center", padding: "2px 6px", borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#222" : "#f3f3f3" }}>
            <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
            <small>Dark</small>
          </label>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {[
          ["orders", "Orders"],
          ["prices", "Prices"],
          ["inventory", "Inventory"],
          ["expenses", "Expenses"],
          ["bank", "Bank"],
          ["shift", "Shift"],
          ["report", "Report"],
          ["settings", "Settings"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => handleTabClick(key)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: `1px solid ${btnBorder}`,
              background: activeTab === key ? (dark ? "#2a2a2a" : "#e9f5ff") : (dark ? "#1b1b1b" : "white"),
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* CONTENT */}
      {activeTab === "orders" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 1.2fr", gap: 12 }}>
          {/* Build Order */}
          <div style={{ border: `1px solid ${cardBorder}`, borderRadius: 10, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Build Order</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <h4 style={{ margin: "8px 0" }}>Menu</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {menu.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedBurger(m)}
                      style={{
                        textAlign: "left",
                        borderRadius: 8,
                        border: `1px solid ${btnBorder}`,
                        padding: 8,
                        background: selectedBurger?.id === m.id ? (dark ? "#2a2a2a" : "#eef6ff") : (dark ? "#1b1b1b" : "white"),
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{m.name}</div>
                      <small>E£ {Number(m.price || 0).toFixed(2)}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <h4 style={{ margin: "8px 0" }}>Extras</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {extraList.map((ex) => {
                    const on = selectedExtras.find((e) => e.id === ex.id);
                    return (
                      <label
                        key={ex.id}
                        onClick={() => toggleExtra(ex)}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          borderRadius: 8,
                          border: `1px solid ${btnBorder}`,
                          padding: 8,
                          background: on ? (dark ? "#2a2a2a" : "#eef6ff") : (dark ? "#1b1b1b" : "white"),
                          cursor: "pointer",
                        }}
                      >
                        <span>{ex.name}</span>
                        <small>E£ {Number(ex.price || 0).toFixed(2)}</small>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={addToCart}
                style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "#f1fff1" }}
              >
                Add to Cart
              </button>
              {selectedBurger && (
                <small style={{ opacity: 0.8 }}>
                  Selected: <b>{selectedBurger.name}</b> (+ {selectedExtras.length} extras)
                </small>
              )}
            </div>
          </div>

          {/* Cart */}
          <div style={{ border: `1px solid ${cardBorder}`, borderRadius: 10, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Cart</h3>
            {cart.length === 0 && <div style={{ opacity: 0.7 }}>Cart is empty.</div>}
            {cart.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {cart.map((line, i) => (
                  <li
                    key={i}
                    style={{ border: `1px solid ${btnBorder}`, borderRadius: 8, padding: 8, background: dark ? "#181818" : softBg }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{line.name}</div>
                        {(line.extras || []).map((e, idx) => (
                          <div key={idx} style={{ fontSize: 12, opacity: 0.85 }}>+ {e.name} — E£ {Number(e.price || 0).toFixed(2)}</div>
                        ))}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div>E£ {Number(line.price || 0).toFixed(2)}</div>
                        <button
                          onClick={() => removeFromCart(i)}
                          style={{ marginTop: 6, padding: "2px 6px", borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "white" }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Order meta */}
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label>Worker</label>
                <select value={worker} onChange={(e) => setWorker(e.target.value)} style={{ width: "100%", padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}>
                  <option value="">— Select —</option>
                  {workers.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label>Payment</label>
                <select value={payment} onChange={(e) => setPayment(e.target.value)} style={{ width: "100%", padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}>
                  <option value="">— Select —</option>
                  {paymentMethods.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label>Order Type</label>
                <select
                  value={orderType}
                  onChange={(e) => {
                    const v = e.target.value;
                    setOrderType(v);
                    setDeliveryFee(v === "Delivery" ? defaultDeliveryFee : 0);
                  }}
                  style={{ width: "100%", padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
                >
                  {orderTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label>Delivery Fee</label>
                <input
                  type="number"
                  value={deliveryFee}
                  onChange={(e) => setDeliveryFee(Number(e.target.value || 0))}
                  disabled={orderType !== "Delivery"}
                  style={{ width: "100%", padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
                />
              </div>
              <div style={{ gridColumn: "1 / span 2" }}>
                <label>Note</label>
                <input
                  value={orderNote}
                  onChange={(e) => setOrderNote(e.target.value)}
                  placeholder="Add a note…"
                  style={{ width: "100%", padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
                />
              </div>
            </div>

            {/* Totals + Checkout */}
            <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>Next Order #</div>
                <div style={{ fontWeight: 700 }}>{nextOrderNo}</div>
              </div>
              <div>
                <button
                  onClick={checkout}
                  disabled={isCheckingOut || cart.length === 0}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: `1px solid ${btnBorder}`,
                    background: cart.length ? (dark ? "#2f6" : "#d7ffd7") : (dark ? "#333" : "#eee"),
                    cursor: cart.length ? "pointer" : "not-allowed",
                    minWidth: 120,
                  }}
                >
                  {isCheckingOut ? "Processing…" : "Checkout"}
                </button>
              </div>
            </div>
          </div>

          {/* Live Orders (shift window) */}
          <div style={{ border: `1px solid ${cardBorder}`, borderRadius: 10, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Live Orders</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <label>Sort:</label>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}>
                <option value="date-desc">Date ↓</option>
                <option value="date-asc">Date ↑</option>
                <option value="worker">Worker</option>
                <option value="payment">Payment</option>
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 520, overflow: "auto" }}>
              {getSortedOrders().map((o) => (
                <div key={o.orderNo} style={{ border: `1px solid ${btnBorder}`, borderRadius: 8, padding: 8, background: dark ? "#181818" : softBg }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <div><b>#{o.orderNo}</b> — {o.date.toLocaleString()}</div>
                      <div style={{ fontSize: 12, opacity: 0.85 }}>By {o.worker} • {o.payment} • {o.orderType}</div>
                      {o.note && <div style={{ fontSize: 12, opacity: 0.85 }}>Note: {o.note}</div>}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div><b>E£ {o.total.toFixed(2)}</b></div>
                      {o.deliveryFee ? <div style={{ fontSize: 12, opacity: 0.85 }}>Delivery: E£ {o.deliveryFee.toFixed(2)}</div> : null}
                    </div>
                  </div>

                  <ul style={{ margin: "6px 0 0 0", paddingLeft: 16 }}>
                    {(o.cart || []).map((l, idx) => (
                      <li key={idx}>
                        {l.name} — E£ {Number(l.price || 0).toFixed(2)}
                        {(l.extras || []).map((e, i2) => (
                          <div key={i2} style={{ fontSize: 12, opacity: 0.85 }}>+ {e.name} — E£ {Number(e.price || 0).toFixed(2)}</div>
                        ))}
                      </li>
                    ))}
                  </ul>

                  <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {!o.done && !o.voided && (
                      <button
                        onClick={() => markOrderDone(o.orderNo)}
                        style={{ padding: "4px 8px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: dark ? "#335533" : "#e7ffe7" }}
                      >
                        Mark DONE
                      </button>
                    )}
                    {!o.voided && (
                      <button
                        onClick={() => voidOrderAndRestock(o.orderNo)}
                        style={{ padding: "4px 8px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: dark ? "#553333" : "#ffe7e7" }}
                      >
                        Void & Restock
                      </button>
                    )}
                    <button
                      onClick={() => printThermalTicket(o, Number(preferredPaperWidthMm) || 80, "Kitchen", { autoPrint: true })}
                      style={{ padding: "4px 8px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "white" }}
                    >
                      Print Kitchen
                    </button>
                    <button
                      onClick={() => printThermalTicket(o, Number(preferredPaperWidthMm) || 80, "Customer", { autoPrint: true })}
                      style={{ padding: "4px 8px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "white" }}
                    >
                      Print Customer
                    </button>
                  </div>
                </div>
              ))}
              {getSortedOrders().length === 0 && <div style={{ opacity: 0.7 }}>No orders in the current shift window.</div>}
            </div>
          </div>
        </div>
      )}

      {activeTab === "prices" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ border: `1px solid ${cardBorder}`, borderRadius: 10, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Menu Prices</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {menu.map((m, idx) => (
                <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    value={m.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMenu((arr) => arr.map((x, i) => i === idx ? { ...x, name: v } : x));
                    }}
                    style={{ flex: 1, padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
                  />
                  <input
                    type="number"
                    value={m.price}
                    onChange={(e) => {
                      const v = Number(e.target.value || 0);
                      setMenu((arr) => arr.map((x, i) => i === idx ? { ...x, price: v } : x));
                    }}
                    style={{ width: 110, padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
                  />
                  <button
                    onClick={() => setMenu((arr) => arr.filter((_, i) => i !== idx))}
                    style={{ padding: "4px 8px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: dark ? "#553333" : "#ffe7e7" }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <input
                placeholder="New item name"
                value={newMenuName}
                onChange={(e) => setNewMenuName(e.target.value)}
                style={{ flex: 1, padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
              />
              <input
                type="number"
                placeholder="Price"
                value={newMenuPrice}
                onChange={(e) => setNewMenuPrice(Number(e.target.value || 0))}
                style={{ width: 120, padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
              />
              <button
                onClick={() => {
                  if (!newMenuName.trim()) return;
                  const id = Math.max(0, ...menu.map((x) => x.id)) + 1;
                  setMenu((arr) => [...arr, { id, name: newMenuName.trim(), price: Number(newMenuPrice || 0), uses: {} }]);
                  setNewMenuName(""); setNewMenuPrice(0);
                }}
                style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "#e7ffe7" }}
              >
                Add Item
              </button>
            </div>
            <small style={{ opacity: 0.8, display: "block", marginTop: 8 }}>Changes auto-save to cloud.</small>
          </div>

          <div style={{ border: `1px solid ${cardBorder}`, borderRadius: 10, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Extras Prices</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {extraList.map((m, idx) => (
                <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    value={m.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      setExtraList((arr) => arr.map((x, i) => i === idx ? { ...x, name: v } : x));
                    }}
                    style={{ flex: 1, padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
                  />
                  <input
                    type="number"
                    value={m.price}
                    onChange={(e) => {
                      const v = Number(e.target.value || 0);
                      setExtraList((arr) => arr.map((x, i) => i === idx ? { ...x, price: v } : x));
                    }}
                    style={{ width: 110, padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
                  />
                  <button
                    onClick={() => setExtraList((arr) => arr.filter((_, i) => i !== idx))}
                    style={{ padding: "4px 8px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: dark ? "#553333" : "#ffe7e7" }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <input
                placeholder="New extra name"
                value={newExtraName}
                onChange={(e) => setNewExtraName(e.target.value)}
                style={{ flex: 1, padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
              />
              <input
                type="number"
                placeholder="Price"
                value={newExtraPrice}
                onChange={(e) => setNewExtraPrice(Number(e.target.value || 0))}
                style={{ width: 120, padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
              />
              <button
                onClick={() => {
                  if (!newExtraName.trim()) return;
                  const id = Math.max(100, ...extraList.map((x) => x.id)) + 1;
                  setExtraList((arr) => [...arr, { id, name: newExtraName.trim(), price: Number(newExtraPrice || 0), uses: {} }]);
                  setNewExtraName(""); setNewExtraPrice(0);
                }}
                style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "#e7ffe7" }}
              >
                Add Extra
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "inventory" && (
        <div style={{ border: `1px solid ${cardBorder}`, borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Inventory</h3>
          <div style={{ marginBottom: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={lockInventoryForDay}
              disabled={inventoryLocked}
              style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: inventoryLocked ? (dark ? "#333" : "#eee") : (dark ? "#333" : "#e7ffe7") }}
            >
              Lock as Start-of-Day
            </button>
            <button
              onClick={unlockInventoryWithPin}
              disabled={!inventoryLocked}
              style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: !inventoryLocked ? (dark ? "#333" : "#eee") : (dark ? "#333" : "#ffe7e7") }}
            >
              Unlock (Admin PIN)
            </button>
            <small style={{ opacity: 0.8 }}>
              {inventoryLockedAt ? `Locked at ${new Date(inventoryLockedAt).toLocaleString()}` : "Not locked"}
            </small>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {inventory.map((it, idx) => (
              <div key={it.id} style={{ display: "grid", gridTemplateColumns: "1.5fr 0.8fr 1fr 110px 110px", gap: 8 }}>
                <input
                  value={it.name}
                  disabled={inventoryLocked}
                  onChange={(e) => setInventory((arr) => arr.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                  style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: inventoryLocked ? (dark ? "#222" : "#f3f3f3") : (dark ? "#1b1b1b" : "white") }}
                />
                <input
                  value={it.unit}
                  disabled={inventoryLocked}
                  onChange={(e) => setInventory((arr) => arr.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x))}
                  style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: inventoryLocked ? (dark ? "#222" : "#f3f3f3") : (dark ? "#1b1b1b" : "white") }}
                />
                <input
                  type="number"
                  value={it.qty}
                  disabled={inventoryLocked}
                  onChange={(e) => setInventory((arr) => arr.map((x, i) => i === idx ? { ...x, qty: Number(e.target.value || 0) } : x))}
                  style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: inventoryLocked ? (dark ? "#222" : "#f3f3f3") : (dark ? "#1b1b1b" : "white") }}
                />
                <button
                  disabled={inventoryLocked}
                  onClick={() => setInventory((arr) => arr.filter((_, i) => i !== idx))}
                  style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: inventoryLocked ? (dark ? "#333" : "#eee") : (dark ? "#553333" : "#ffe7e7") }}
                >
                  Remove
                </button>
                <div />
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1.5fr 0.8fr 1fr 140px", gap: 8 }}>
            <input
              placeholder="Item name"
              value={newInvName}
              onChange={(e) => setNewInvName(e.target.value)}
              disabled={inventoryLocked}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: inventoryLocked ? (dark ? "#222" : "#f3f3f3") : (dark ? "#1b1b1b" : "white") }}
            />
            <input
              placeholder="Unit (e.g., g, pcs)"
              value={newInvUnit}
              onChange={(e) => setNewInvUnit(e.target.value)}
              disabled={inventoryLocked}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: inventoryLocked ? (dark ? "#222" : "#f3f3f3") : (dark ? "#1b1b1b" : "white") }}
            />
            <input
              type="number"
              placeholder="Qty"
              value={newInvQty}
              onChange={(e) => setNewInvQty(Number(e.target.value || 0))}
              disabled={inventoryLocked}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: inventoryLocked ? (dark ? "#222" : "#f3f3f3") : (dark ? "#1b1b1b" : "white") }}
            />
            <button
              disabled={inventoryLocked}
              onClick={() => {
                if (!newInvName.trim()) return;
                const id = newInvName.trim().toLowerCase().replace(/\s+/g, "-");
                setInventory((arr) => [...arr, { id, name: newInvName.trim(), unit: newInvUnit || "pcs", qty: Number(newInvQty || 0) }]);
                setNewInvName(""); setNewInvUnit(""); setNewInvQty(0);
              }}
              style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: inventoryLocked ? (dark ? "#333" : "#eee") : (dark ? "#333" : "#e7ffe7") }}
            >
              Add Item
            </button>
          </div>
        </div>
      )}

      {activeTab === "expenses" && (
        <div style={{ border: `1px solid ${cardBorder}`, borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Shift Expenses</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr 0.8fr 1fr 1.2fr 140px", gap: 8 }}>
            <input placeholder="Name" value={newExpName} onChange={(e) => setNewExpName(e.target.value)} style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }} />
            <input placeholder="Unit" value={newExpUnit} onChange={(e) => setNewExpUnit(e.target.value)} style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }} />
            <input type="number" placeholder="Qty" value={newExpQty} onChange={(e) => setNewExpQty(Number(e.target.value || 0))} style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }} />
            <input type="number" placeholder="Unit Price" value={newExpUnitPrice} onChange={(e) => setNewExpUnitPrice(Number(e.target.value || 0))} style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }} />
            <input placeholder="Note" value={newExpNote} onChange={(e) => setNewExpNote(e.target.value)} style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }} />
            <button
              onClick={() => {
                if (!newExpName.trim()) return;
                const e = {
                  id: `exp_${Date.now()}`,
                  name: newExpName.trim(),
                  unit: newExpUnit || "pcs",
                  qty: Number(newExpQty || 0),
                  unitPrice: Number(newExpUnitPrice || 0),
                  date: new Date(),
                  note: newExpNote || "",
                };
                setExpenses((arr) => [e, ...arr]);
                setNewExpName(""); setNewExpUnit("pcs"); setNewExpQty(1); setNewExpUnitPrice(0); setNewExpNote("");
              }}
              style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "#e7ffe7" }}
            >
              Add
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            {expenses.length === 0 && <div style={{ opacity: 0.7 }}>No expenses yet.</div>}
            {expenses.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Name", "Unit", "Qty", "Unit Price", "Total", "Date", "Note", ""].map((h) => (
                      <th key={h} style={{ textAlign: "left", borderBottom: `1px solid ${btnBorder}`, padding: 6 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e, i) => (
                    <tr key={e.id || i}>
                      <td style={{ padding: 6 }}>{e.name}</td>
                      <td style={{ padding: 6 }}>{e.unit}</td>
                      <td style={{ padding: 6 }}>{e.qty}</td>
                      <td style={{ padding: 6 }}>E£ {Number(e.unitPrice || 0).toFixed(2)}</td>
                      <td style={{ padding: 6 }}>E£ {(Number(e.qty || 0) * Number(e.unitPrice || 0)).toFixed(2)}</td>
                      <td style={{ padding: 6 }}>{e.date ? new Date(e.date).toLocaleString() : ""}</td>
                      <td style={{ padding: 6 }}>{e.note || ""}</td>
                      <td style={{ padding: 6 }}>
                        <button
                          onClick={() => setExpenses((arr) => arr.filter((_, idx) => idx !== i))}
                          style={{ padding: "2px 6px", borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#553333" : "#ffe7e7" }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === "bank" && (
        <div style={{ border: `1px solid ${cardBorder}`, borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Bank (Shift savings)</h3>
          <div style={{ marginBottom: 8 }}>
            <b>Balance:</b> E£ {bankBalance.toFixed(2)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 2fr 160px", gap: 8 }}>
            <select
              value={bankForm.type}
              onChange={(e) => setBankForm((f) => ({ ...f, type: e.target.value }))}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
            >
              <option value="deposit">Deposit</option>
              <option value="withdraw">Withdraw</option>
              <option value="adjustUp">Adjust Up</option>
              <option value="adjustDown">Adjust Down</option>
            </select>
            <input
              type="number"
              placeholder="Amount"
              value={bankForm.amount}
              onChange={(e) => setBankForm((f) => ({ ...f, amount: Number(e.target.value || 0) }))}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
            />
            <input
              placeholder="Worker"
              value={bankForm.worker}
              onChange={(e) => setBankForm((f) => ({ ...f, worker: e.target.value }))}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
            />
            <input
              placeholder="Note"
              value={bankForm.note}
              onChange={(e) => setBankForm((f) => ({ ...f, note: e.target.value }))}
              style={{ padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
            />
            <button
              onClick={() => {
                const id = `tx_${Date.now()}`;
                setBankTx((arr) => [{ id, ...bankForm, date: new Date() }, ...arr]);
                setBankForm({ type: "deposit", amount: 0, worker: "", note: "" });
              }}
              style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "#e7ffe7" }}
            >
              Add Tx
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            {bankTx.length === 0 && <div style={{ opacity: 0.7 }}>No transactions yet.</div>}
            {bankTx.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Type", "Amount", "Worker", "Note", "Date"].map((h) => (
                      <th key={h} style={{ textAlign: "left", borderBottom: `1px solid ${btnBorder}`, padding: 6 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bankTx.map((t) => (
                    <tr key={t.id}>
                      <td style={{ padding: 6 }}>{t.type}</td>
                      <td style={{ padding: 6 }}>E£ {Number(t.amount || 0).toFixed(2)}</td>
                      <td style={{ padding: 6 }}>{t.worker || ""}</td>
                      <td style={{ padding: 6 }}>{t.note || ""}</td>
                      <td style={{ padding: 6 }}>{t.date ? new Date(t.date).toLocaleString() : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === "shift" && (
        <div style={{ border: `1px solid ${cardBorder}`, borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Shift</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            <button onClick={startShift} style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "#e7ffe7" }}>
              Start Shift
            </button>
            <button onClick={changeShift} style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "#fff7e7" }}>
              Change Shift
            </button>
            <button onClick={endDay} style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${btnBorder}`, background: dark ? "#553333" : "#ffe7e7" }}>
              End Day (Report + Reset)
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ border: `1px solid ${btnBorder}`, borderRadius: 8, padding: 10 }}>
              <div><b>Started By:</b> {dayMeta.startedBy || "—"}</div>
              <div><b>Started At:</b> {dayMeta.startedAt ? new Date(dayMeta.startedAt).toLocaleString() : "—"}</div>
              <div><b>Ended By:</b> {dayMeta.endedBy || "—"}</div>
              <div><b>Ended At:</b> {dayMeta.endedAt ? new Date(dayMeta.endedAt).toLocaleString() : "—"}</div>
            </div>
            <div style={{ border: `1px solid ${btnBorder}`, borderRadius: 8, padding: 10 }}>
              <div><b>Orders (valid):</b> {orders.filter((o) => !o.voided).length}</div>
              <div><b>Revenue (items only):</b> E£ {totals.revenueTotal.toFixed(2)}</div>
              <div><b>Delivery Fees (sum):</b> E£ {totals.deliveryFeesTotal.toFixed(2)}</div>
              <div><b>Expenses:</b> E£ {totals.expensesTotal.toFixed(2)}</div>
              <div><b>Margin:</b> E£ {totals.margin.toFixed(2)}</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "report" && (
        <div style={{ border: `1px solid ${cardBorder}`, borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Reports</h3>
          <p style={{ marginTop: 0 }}>Generate a full shift PDF report (orders, totals, items, extras, inventory, expenses).</p>
          <button
            onClick={() => generatePDF(false)}
            style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "#e7f3ff" }}
          >
            Download Shift Report PDF
          </button>
        </div>
      )}

      {activeTab === "settings" && (
        <div style={{ border: `1px solid ${cardBorder}`, borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Settings</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div style={{ border: `1px solid ${btnBorder}`, borderRadius: 8, padding: 10 }}>
              <h4 style={{ marginTop: 0 }}>Workers</h4>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <input
                  placeholder="Add worker"
                  value={newWorker}
                  onChange={(e) => setNewWorker(e.target.value)}
                  style={{ flex: 1, padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
                />
                <button
                  onClick={() => {
                    if (!newWorker.trim()) return;
                    setWorkers((arr) => [...arr, newWorker.trim()]);
                    setNewWorker("");
                  }}
                  style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "#e7ffe7" }}
                >
                  Add
                </button>
              </div>
              <ul style={{ paddingLeft: 16, margin: 0 }}>
                {workers.map((w, i) => (
                  <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>{w}</span>
                    <button
                      onClick={() => setWorkers((arr) => arr.filter((_, idx) => idx !== i))}
                      style={{ padding: "2px 6px", borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#553333" : "#ffe7e7" }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ border: `1px solid ${btnBorder}`, borderRadius: 8, padding: 10 }}>
              <h4 style={{ marginTop: 0 }}>Payment Methods</h4>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <input
                  placeholder="Add payment"
                  value={newPayment}
                  onChange={(e) => setNewPayment(e.target.value)}
                  style={{ flex: 1, padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
                />
                <button
                  onClick={() => {
                    if (!newPayment.trim()) return;
                    setPaymentMethods((arr) => [...arr, newPayment.trim()]);
                    setNewPayment("");
                  }}
                  style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "#e7ffe7" }}
                >
                  Add
                </button>
              </div>
              <ul style={{ paddingLeft: 16, margin: 0 }}>
                {paymentMethods.map((p, i) => (
                  <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>{p}</span>
                    <button
                      onClick={() => setPaymentMethods((arr) => arr.filter((_, idx) => idx !== i))}
                      style={{ padding: "2px 6px", borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#553333" : "#ffe7e7" }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ border: `1px solid ${btnBorder}`, borderRadius: 8, padding: 10 }}>
              <h4 style={{ marginTop: 0 }}>Order Types</h4>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <input
                  placeholder="Add order type"
                  value={newMenuName} // reuse field is fine here or create a new one; but let's reuse a temp string
                  onChange={(e) => setNewMenuName(e.target.value)}
                  style={{ flex: 1, padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
                />
                <button
                  onClick={() => {
                    if (!newMenuName.trim()) return;
                    setOrderTypes((arr) => [...arr, newMenuName.trim()]);
                    setNewMenuName("");
                  }}
                  style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${btnBorder}`, background: dark ? "#333" : "#e7ffe7" }}
                >
                  Add
                </button>
              </div>
              <ul style={{ paddingLeft: 16, margin: 0 }}>
                {orderTypes.map((t, i) => (
                  <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>{t}</span>
                    <button
                      onClick={() => setOrderTypes((arr) => arr.filter((_, idx) => idx !== i))}
                      style={{ padding: "2px 6px", borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#553333" : "#ffe7e7" }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 8 }}>
                <label>Default Delivery Fee</label>
                <input
                  type="number"
                  value={defaultDeliveryFee}
                  onChange={(e) => setDefaultDeliveryFee(Number(e.target.value || 0))}
                  style={{ width: "100%", padding: 6, borderRadius: 6, border: `1px solid ${btnBorder}`, background: dark ? "#1b1b1b" : "white" }}
                />
              </div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <small style={{ opacity: 0.8 }}>All settings auto-save when Cloud is ON.</small>
          </div>
        </div>
      )}
    </div>
  );
}

