import React, { useEffect, useMemo, useRef, useState } from "react";
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
} from "firebase/firestore";

/* --------------------------- FIREBASE CONFIG --------------------------- */
// keep your REAL config:
const firebaseConfig = {
  apiKey: "AIzaSyAp1F6t8zgRiJI9xOzFkKJVsCQIT9BWXno",
  authDomain: "tux-cashier-system.firebaseapp.com",
  projectId: "tux-cashier-system",
  storageBucket: "tux-cashier-system.appspot.com",
  messagingSenderId: "978379497015",
  appId: "1:978379497015:web:ea165dcb6873e0c65929b2",
};

// Ensure Firebase is initialized exactly once and return auth/db
function ensureFirebase() {
  const theApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(theApp);
  const db = getFirestore(theApp);
  return { auth, db };
}

/* --------------------------- APP SETTINGS --------------------------- */
// 2) Name your shop (used for collection/doc paths)
const SHOP_ID = "tux"; // change if you manage multiple shops (e.g. "tux-truck-1")
const LOCAL_KEY = `tux-${SHOP_ID}-state-v1`;

// small helper to download text files (JSON backup)
function downloadText(filename, text) {
  try {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (e) {
    alert("Could not download file: " + e);
  }
}

// Pack current state (dates -> ISO) for Firestore/Local
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
    updatedAt: serverTimestamp?.() ?? null, // serverTimestamp for cloud; harmless in local
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

// Unpack from Firestore/Local (ISO -> Date)
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

  // easy fields
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

// Normalize a single order for Firestore orders collection
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

// Convert Firestore doc to local order shape
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
    done: !!d.done,
    voided: !!d.voided,
    note: d.note || "",
    date: asDate(d.date || d.createdAt),
    restockedAt: d.restockedAt ? asDate(d.restockedAt) : undefined,
    cart: Array.isArray(d.cart) ? d.cart : [],
  };
}

/* --------------------------- HELPERS --------------------------- */
// Load a file from /public as a Data URL for jsPDF
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
// Default inventory items
const DEFAULT_INVENTORY = [
  { id: "meat", name: "Meat", unit: "g", qty: 0 },
  { id: "cheese", name: "Cheese", unit: "slices", qty: 0 },
];
// Initial workers & payments (editable in UI)
const BASE_WORKERS = ["Hassan", "Warda", "Ahmed"];
const DEFAULT_PAYMENT_METHODS = ["Cash", "Card", "Instapay"];
// Dine options (editable in Prices)
const DEFAULT_ORDER_TYPES = ["Take-Away", "Dine-in", "Delivery"];
const DEFAULT_DELIVERY_FEE = 20;
// ---- Editor PIN to protect PRICES tab
const EDITOR_PIN = "0512";

// ---------- PIN defaults + helpers ----------
const DEFAULT_ADMIN_PINS = { 1: "1111", 2: "2222", 3: "3333", 4: "4444", 5: "5555", 6: "6666" };
const norm = (v) => String(v ?? "").trim();

// Delete all order docs created between startDate and endDate (inclusive), in chunks
async function purgeOrdersInCloud(db, ordersColRef, startDate, endDate) {
  try {
    const startTs = Timestamp.fromDate(startDate);
    const endTs   = Timestamp.fromDate(endDate);
    // Fetch this shift's orders by createdAt window
    const qy = query(
      ordersColRef,
      where("createdAt", ">=", startTs),
      where("createdAt", "<=", endTs)
    );
    const ss = await getDocs(qy);
    if (ss.empty) return 0;

    const docs = ss.docs;
    let removed = 0;
    // Firestore allows 500 ops per batch; use 400 for headroom
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

export default function App() {
  const [activeTab, setActiveTab] = useState("orders");
  const [dark, setDark] = useState(false);

  const [menu, setMenu] = useState(BASE_MENU);
  const [extraList, setExtraList] = useState(BASE_EXTRAS);

  const [workers, setWorkers] = useState(BASE_WORKERS);
  const [newWorker, setNewWorker] = useState("");
  const [paymentMethods, setPaymentMethods] = useState(DEFAULT_PAYMENT_METHODS);
  const [newPayment, setNewPayment] = useState("");

  // Order Type options & default delivery fee (Editable in Prices)
  const [orderTypes, setOrderTypes] = useState(DEFAULT_ORDER_TYPES);
  const [defaultDeliveryFee, setDefaultDeliveryFee] = useState(DEFAULT_DELIVERY_FEE);

  // Order builder
  const [selectedBurger, setSelectedBurger] = useState(null);
  const [selectedExtras, setSelectedExtras] = useState([]);
  const [cart, setCart] = useState([]);
  const [worker, setWorker] = useState("");
  const [payment, setPayment] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [orderType, setOrderType] = useState(orderTypes[0] || "Take-Away");
  const [deliveryFee, setDeliveryFee] = useState(0);

  // Dynamic inventory
  const [inventory, setInventory] = useState(DEFAULT_INVENTORY);
  const [newInvName, setNewInvName] = useState("");
  const [newInvUnit, setNewInvUnit] = useState("");
  const [newInvQty, setNewInvQty] = useState(0);

  // Inventory lock & snapshot
  const [inventoryLocked, setInventoryLocked] = useState(false);
  const [inventorySnapshot, setInventorySnapshot] = useState([]);
  const [inventoryLockedAt, setInventoryLockedAt] = useState(null);

  // Admin PINs
  const [adminPins, setAdminPins] = useState({ ...DEFAULT_ADMIN_PINS });

  // Prices tab session unlock
  const [pricesUnlocked, setPricesUnlocked] = useState(false);

  // Which admin rows are unlocked for editing (1..6)
  const [adminPinsEditUnlocked, setAdminPinsEditUnlocked] = useState({
    1: false, 2: false, 3: false, 4: false, 5: false, 6: false,
  });

  // Orders
  const [orders, setOrders] = useState([]);
  const [nextOrderNo, setNextOrderNo] = useState(1);

  // Expenses
  const [expenses, setExpenses] = useState([]);
  const [newExpName, setNewExpName] = useState("");
  const [newExpUnit, setNewExpUnit] = useState("pcs");
  const [newExpQty, setNewExpQty] = useState(1);
  const [newExpUnitPrice, setNewExpUnitPrice] = useState(0);
  const [newExpNote, setNewExpNote] = useState("");

  // Bank (admin pin protected)
  const [bankUnlocked, setBankUnlocked] = useState(false);
  const [bankTx, setBankTx] = useState([]);
  const [bankForm, setBankForm] = useState({ type: "deposit", amount: 0, worker: "", note: "" });

  // Shift/day meta
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

  // Reports sorting
  const [sortBy, setSortBy] = useState("date-desc");

  // Live clock
  const [nowStr, setNowStr] = useState(new Date().toLocaleString());
  useEffect(() => {
    const t = setInterval(() => setNowStr(new Date().toLocaleString()), 1000);
    return () => clearInterval(t);
  }, []);

  // ---------- Prices tab local editors ----------
  const [usesEditOpenMenu, setUsesEditOpenMenu] = useState({});
  const [usesEditOpenExtra, setUsesEditOpenExtra] = useState({});
  const [newMenuName, setNewMenuName] = useState("");
  const [newMenuPrice, setNewMenuPrice] = useState(0);
  const [newExtraName, setNewExtraName] = useState("");
  const [newExtraPrice, setNewExtraPrice] = useState(0);

  /* --------------------------- FIREBASE STATE --------------------------- */
  const [fbReady, setFbReady] = useState(false);
  const [fbUser, setFbUser] = useState(null);
  const [cloudEnabled, setCloudEnabled] = useState(true); // autosave to state doc
  const [realtimeOrders, setRealtimeOrders] = useState(true); // live board via orders collection
  const [cloudStatus, setCloudStatus] = useState({ lastSaveAt: null, lastLoadAt: null, error: null });
  const [hydrated, setHydrated] = useState(false); // <-- prevents autosave before initial cloud load

  // Local JSON restore ref
  const restoreInputRef = useRef(null);

  // Init + Anonymous Auth
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

  // Firestore refs
  const db = useMemo(() => (fbReady ? ensureFirebase().db : null), [fbReady]);
  const stateDocRef = useMemo(
    () => (db ? fsDoc(db, "shops", SHOP_ID, "state", "pos") : null),
    [db]
  );
  const ordersColRef = useMemo(
    () => (db ? collection(db, "shops", SHOP_ID, "orders") : null),
    [db]
  );

  // -------- Local backup: PRELOAD from localStorage if present (no autosave yet) --------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const unpacked = unpackStateFromCloud(data, dayMeta);
      if (unpacked.menu) setMenu(unpacked.menu);
      if (unpacked.extraList) setExtraList(unpacked.extraList);
      if (unpacked.orders) setOrders(unpacked.orders);
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
      if (unpacked.dayMeta) setDayMeta((d) => ({ ...d, ...unpacked.dayMeta }));
      if (unpacked.bankTx) setBankTx(unpacked.bankTx);
    } catch (e) {
      console.warn("Local preload failed:", e);
    }
  }, []);

  // -------- Local backup: SAVE to localStorage (debounced) --------
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const body = packStateForCloud({
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
        });
        // strip Firestore sentinel for local backup
        const { updatedAt, ...rest } = body;
        localStorage.setItem(LOCAL_KEY, JSON.stringify(rest));
      } catch (e) {
        console.warn("Local backup failed:", e);
      }
    }, 800);
    return () => clearTimeout(t);
  }, [
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
  ]);

  // One-time initial load from cloud AFTER auth/refs are ready
  useEffect(() => {
    if (!stateDocRef || !fbUser || hydrated) return;

    (async () => {
      try {
        const snap = await getDoc(stateDocRef);
        if (snap.exists()) {
          const data = snap.data() || {};
          const unpacked = unpackStateFromCloud(data, dayMeta);
          if (unpacked.menu) setMenu(unpacked.menu);
          if (unpacked.extraList) setExtraList(unpacked.extraList);
          if (unpacked.orders) setOrders(unpacked.orders);
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
        setHydrated(true); // allow autosave to begin
      }
    })();
  }, [stateDocRef, fbUser, hydrated, dayMeta]); // important: include hydrated

  // Manual cloud load (pull)
  const loadFromCloud = async () => {
    if (!stateDocRef || !fbUser) return alert("Firebase not ready.");
    try {
      const snap = await getDoc(stateDocRef);
      if (!snap.exists()) return alert("No cloud state yet to load.");
      const data = snap.data() || {};
      const unpacked = unpackStateFromCloud(data, dayMeta);
      if (unpacked.menu) setMenu(unpacked.menu);
      if (unpacked.extraList) setExtraList(unpacked.extraList);
      if (unpacked.orders) setOrders(unpacked.orders);
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

  // Autosave to cloud (state doc) — debounced
  useEffect(() => {
    if (!cloudEnabled || !stateDocRef || !fbUser || !hydrated) return;

    const t = setTimeout(async () => {
      try {
        const body = packStateForCloud({
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
    hydrated,            // <-- added
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
  ]);

  // --- Derive simple numbers for effect deps (shift window) ---
  const startedAtMs = dayMeta?.startedAt
    ? new Date(dayMeta.startedAt).getTime()
    : null;

  const endedAtMs = dayMeta?.endedAt
    ? new Date(dayMeta.endedAt).getTime()
    : null;

  // --- Realtime orders stream limited to current shift window ---
  useEffect(() => {
    if (!realtimeOrders || !ordersColRef || !fbUser) return;

    // If shift hasn't started, show no orders and don't listen
    if (!startedAtMs) {
      setOrders([]);
      return;
    }

    const startTs = Timestamp.fromMillis(startedAtMs);
    const constraints = [where("createdAt", ">=", startTs), orderBy("createdAt", "desc")];

    if (endedAtMs) {
      const endTs = Timestamp.fromMillis(endedAtMs);
      constraints.unshift(where("createdAt", "<=", endTs));
    }

    const qy = query(ordersColRef, ...constraints);
    const unsub = onSnapshot(qy, (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push(orderFromCloudDoc(d.id, d.data())));
      setOrders(arr);
    });

    return () => unsub();
  }, [realtimeOrders, ordersColRef, fbUser, startedAtMs, endedAtMs]);

  /* --------------------------- EXISTING APP LOGIC --------------------------- */
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

  // ---- Admin PIN helper & inventory lock/unlock ----
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
      alert(`Admin ${n} has no PIN set; set a PIN in Prices → Admin PINs.`);
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
    if (!window.confirm(
      "Lock current inventory as Start-of-Day? You won't be able to edit until End the Day or admin unlock."
    )) return;

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
    if (!window.confirm(`Admin ${adminNum}: Unlock inventory for editing? Snapshot will be kept.`)) return;
    setInventoryLocked(false);
    alert("Inventory unlocked for editing.");
  };

  // --------- Shift Controls ----------
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

  // RENAMED: End Shift -> Change Shift
  const changeShift = () => {
    if (!dayMeta.startedAt || dayMeta.endedAt) return alert("Start a shift first.");
    const current = window.prompt(`Enter the CURRENT worker name to confirm:`, "");
    if (norm(current) !== norm(dayMeta.startedBy)) {
      return alert(`Only ${dayMeta.startedBy} can hand over the shift.`);
    }
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

  // NEW: End the Day (replaces Reset Day)
  const endDay = async () => {
    if (!dayMeta.startedAt) return alert("Start a shift first.");
    const who = window.prompt("Enter your name to END THE DAY:", "");
    const endBy = norm(who);
    if (!endBy) return alert("Name is required.");

    // Mark end time now for the final PDF
    const endTime = new Date();
    const metaForReport = { ...dayMeta, endedAt: endTime, endedBy: endBy };

    // Download PDF first
    generatePDF(false, metaForReport);

    // Purge this shift's orders from Firestore so the board is clean next time
    if (cloudEnabled && ordersColRef && fbUser && db) {
      try {
        // Prefer the recorded shift start; if missing, derive from earliest order
        const start = dayMeta.startedAt
          ? new Date(dayMeta.startedAt)
          : (orders.length ? new Date(Math.min(...orders.map(o => +o.date))) : endTime);

        const removed = await purgeOrdersInCloud(db, ordersColRef, start, endTime);
        console.log(`Purged ${removed} cloud orders for the shift.`);
      } catch (e) {
        console.warn("Cloud purge on endDay failed:", e);
      }
    }

    // Calculate margin (revenue excl. delivery - expenses)
    const validOrders = orders.filter((o) => !o.voided);
    const revenueExclDelivery = validOrders.reduce(
      (s, o) =>
        s +
        Number(o.itemsTotal != null ? o.itemsTotal : (o.total - (o.deliveryFee || 0))),
      0
    );
    const expensesTotal = expenses.reduce(
      (s, e) => s + Number((e.qty || 0) * (e.unitPrice || 0)),
      0
    );
    const margin = revenueExclDelivery - expensesTotal;

    // Auto add to Bank as next day's initial balance (or adjust down)
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

    // Reset day locally
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
  const addToCart = () => {
    if (!selectedBurger) return alert("Select a burger/item first.");

    const uses = {};
    const prodUses = selectedBurger.uses || {};
    for (const k of Object.keys(prodUses)) uses[k] = (uses[k] || 0) + (prodUses[k] || 0);
    for (const ex of selectedExtras) {
      const exUses = ex.uses || {};
      for (const k of Object.keys(exUses)) uses[k] = (uses[k] || 0) + (exUses[k] || 0);
    }

    const line = {
      ...selectedBurger,
      extras: [...selectedExtras],
      price: selectedBurger.price,
      uses,
    };

    setCart((c) => [...c, line]);
    setSelectedBurger(null);
    setSelectedExtras([]);
  };

  const removeFromCart = (i) => setCart((c) => c.filter((_, idx) => idx !== i));

  const checkout = async () => {
    if (!dayMeta.startedAt || dayMeta.endedAt) {
      return alert("Start a shift first (Shift → Start Shift).");
    }
    if (cart.length === 0) return alert("Cart is empty.");
    if (!worker) return alert("Select worker.");
    if (!payment) return alert("Select payment.");
    if (!orderType) return alert("Select order type.");

    // Sum required inventory across all cart lines
    const required = {};
    for (const line of cart) {
      const uses = line.uses || {};
      for (const k of Object.keys(uses)) {
        required[k] = (required[k] || 0) + (uses[k] || 0);
      }
    }
    // Check stock
    for (const k of Object.keys(required)) {
      const invItem = invById[k];
      if (!invItem) continue;
      if ((invItem.qty || 0) < required[k]) {
        return alert(`Not enough ${invItem.name} in stock. Need ${required[k]} ${invItem.unit}, have ${invItem.qty} ${invItem.unit}.`);
      }
    }
    // Deduct inventory
    setInventory((inv) =>
      inv.map((it) => {
        const need = required[it.id] || 0;
        return need ? { ...it, qty: it.qty - need } : it;
      })
    );

    // Totals
    const baseSubtotal = cart.reduce((s, b) => s + Number(b.price || 0), 0);
    const extrasSubtotal = cart.reduce(
      (s, b) => s + (b.extras || []).reduce((t, e) => t + Number(e.price || 0), 0),
      0
    );
    const itemsTotal = baseSubtotal + extrasSubtotal;
    const delFee = orderType === "Delivery" ? Math.max(0, Number(deliveryFee || 0)) : 0;
    const total = itemsTotal + delFee;

    const order = {
      orderNo: nextOrderNo,
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
    };

    setOrders((o) => [order, ...o]);
    setNextOrderNo((n) => n + 1);

    // Cloud write (orders collection)
    if (cloudEnabled && ordersColRef && fbUser) {
      try {
        const ref = await addDoc(ordersColRef, normalizeOrderForCloud(order));
        // attach cloudId to local order
        setOrders((prev) =>
          prev.map((oo) => (oo.orderNo === order.orderNo ? { ...oo, cloudId: ref.id } : oo))
        );
      } catch (e) {
        console.warn("Cloud order write failed:", e);
      }
    }

    // Print customer receipt (58 mm)
    printThermalTicket(order, 58, "Customer");

    // reset builder
    setCart([]);
    setWorker("");
    setPayment("");
    setOrderNote("");
    setOrderType(orderTypes[0] || "Take-Away");
    setDeliveryFee(orderType === "Delivery" ? defaultDeliveryFee : 0);
  };

  // --------- Order actions ----------
  const markOrderDone = async (orderNo) => {
    setOrders((o) =>
      o.map((ord) => {
        if (ord.orderNo !== orderNo) return ord;
        if (ord.done) return ord;
        return { ...ord, done: true };
      })
    );

    // Cloud update
    try {
      if (!cloudEnabled || !ordersColRef || !fbUser) return;
      let targetId = orders.find((o) => o.orderNo === orderNo)?.cloudId;
      if (!targetId) {
        // best-effort find by orderNo
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
      for (const k of Object.keys(uses)) {
        giveBack[k] = (giveBack[k] || 0) + (uses[k] || 0);
      }
    }
    setInventory((inv) =>
      inv.map((it) => {
        const back = giveBack[it.id] || 0;
        return back ? { ...it, qty: it.qty + back } : it;
      })
    );
    setOrders((o) =>
      o.map((x) => (x.orderNo === orderNo ? { ...x, voided: true, restockedAt: new Date() } : x))
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
      (s, o) => s + Number(o.itemsTotal != null ? o.itemsTotal : (o.total - (o.deliveryFee || 0))),
      0
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
      if (byType[o.orderType] == null) byType[o.orderType] = 0;
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
      prev.count += count;
      prev.revenue += revenue;
      map.set(id, prev);
    };
    for (const o of orders) {
      if (o.voided) continue;
      for (const line of o.cart || []) {
        const base = Number(line.price || 0);
        add(itemMap, line.id, line.name, 1, base);
        for (const ex of line.extras || []) {
          add(extraMap, ex.id, ex.name, 1, Number(ex.price || 0));
        }
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
      for (const p of Object.keys(totals.byPay)) {
        totalsBody.push([`By Payment — ${p} (items only)`, (totals.byPay[p] || 0).toFixed(2)]);
      }
      for (const t of Object.keys(totals.byType)) {
        totalsBody.push([`By Order Type — ${t} (items only)`, (totals.byType[t] || 0).toFixed(2)]);
      }

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
          body: inventoryReportRows.map((r) => [r.name, r.unit, String(r.start), String(r.now), String(r.used)]),
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

  // --------------------------- PDF: THERMAL TICKETS ---------------------------
  const printThermalTicket = async (order, widthMm = 58, copy = "Customer") => {
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
        doc.setFont("helvetica", "normal"); doc.text("NOTE:", margin, y);
        doc.setFont("helvetica", "normal"); y += 5;
        const wrapped = doc.splitTextToSize(safe(order.note), widthMm - margin * 2);
        wrapped.forEach(line => { doc.text(line, margin, y); y += 4; });
        y += 2;
      }

      doc.setFont("helvetica", "normal"); doc.text("Items", margin, y); y += 5;
      doc.setFont("helvetica", "normal");

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
        y += 1; // small gap between items
      });

      // Subtotals
      y += 2;
      doc.line(margin, y, colRight, y); y += 3;

      const baseSubtotal = order.cart.reduce((s, b) => s + Number(b.price || 0), 0);
      const extrasSubtotal = order.cart.reduce(
        (s, b) => s + (b.extras || []).reduce((t, e) => t + Number(e.price || 0), 0),
        0
      );
      const itemsTotal = baseSubtotal + extrasSubtotal;

      doc.text("Items Subtotal", margin, y);
      doc.text(`E£${itemsTotal.toFixed(2)}`, colRight, y, { align: "right" }); y += 5;

      if (order.orderType === "Delivery" && (order.deliveryFee || 0) > 0) {
        doc.text("Delivery Fee", margin, y);
        doc.text(`E£${Number(order.deliveryFee || 0).toFixed(2)}`, colRight, y, { align: "right" }); y += 5;
      }

      doc.setFont("helvetica", "bold");
      doc.text("TOTAL", margin, y);
      doc.text(`E£${Number(order.total || 0).toFixed(2)}`, colRight, y, { align: "right" }); y += 6;
      doc.setFont("helvetica", "normal");

      doc.line(margin, y, colRight, y); y += 4;

      // Footer
      doc.setFontSize(8);
      doc.text("Thank you! Follow us @TUX", margin, y); y += 4;
      doc.text("No returns on food items once served.", margin, y); y += 4;

      // Trim the paper height to content
      const usedHeight = Math.min(y + margin, MAX_H);
      doc.internal.pageSize.setHeight(usedHeight);

      doc.save(`tux_order_${order.orderNo}_${copy.toLowerCase()}.pdf`);
    } catch (err) {
      console.error(err);
      alert("Could not generate receipt. Make sure pop-ups are allowed.");
    }
  };

  /* --------------------------- MINIMAL UI --------------------------- */
  const addExpense = () => {
    const qty = Number(newExpQty || 0);
    const unitPrice = Number(newExpUnitPrice || 0);
    if (!newExpName || qty <= 0) return alert("Enter a valid expense name and qty.");
    setExpenses((e) => [
      {
        id: `exp_${Date.now()}`,
        name: newExpName,
        unit: newExpUnit || "pcs",
        qty,
        unitPrice,
        note: newExpNote || "",
        date: new Date(),
      },
      ...e,
    ]);
    setNewExpName("");
    setNewExpUnit("pcs");
    setNewExpQty(1);
    setNewExpUnitPrice(0);
    setNewExpNote("");
  };

  const addInventoryItem = () => {
    if (!newInvName || !newInvUnit) return alert("Enter inventory name and unit.");
    setInventory((inv) => [
      ...inv,
      { id: newInvName.toLowerCase().replace(/\s+/g, "-"), name: newInvName, unit: newInvUnit, qty: Number(newInvQty || 0) },
    ]);
    setNewInvName("");
    setNewInvUnit("");
    setNewInvQty(0);
  };

  const exportJSON = () => {
    const body = packStateForCloud({
      menu, extraList, orders, inventory, nextOrderNo, dark, workers, paymentMethods,
      inventoryLocked, inventorySnapshot, inventoryLockedAt, adminPins, orderTypes,
      defaultDeliveryFee, expenses, dayMeta, bankTx
    });
    const { updatedAt, ...rest } = body;
    downloadText(`tux_state_${Date.now()}.json`, JSON.stringify(rest, null, 2));
  };

  const importJSONLocal = (file) => {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(String(fr.result || "{}"));
        const unpacked = unpackStateFromCloud(data, dayMeta);
        if (unpacked.menu) setMenu(unpacked.menu);
        if (unpacked.extraList) setExtraList(unpacked.extraList);
        if (unpacked.orders) setOrders(unpacked.orders);
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
        alert("Local JSON imported ✓");
      } catch (e) {
        alert("Invalid JSON file.");
      }
    };
    fr.readAsText(file);
  };

  /* --------------------------- RENDER --------------------------- */
  return (
    <div style={{ fontFamily: "system-ui, Arial", padding: 12, maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>TUX POS</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span>{nowStr}</span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
            Dark
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={cloudEnabled} onChange={(e) => setCloudEnabled(e.target.checked)} />
            Cloud Autosave
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={realtimeOrders} onChange={(e) => setRealtimeOrders(e.target.checked)} />
            Live Board
          </label>
        </div>
      </header>

      <nav style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        {["orders","inventory","expenses","reports","settings"].map((t) => (
          <button key={t}
            onClick={() => setActiveTab(t)}
            style={{ padding: "6px 10px", background: activeTab===t ? "#222" : "#eee", color: activeTab===t ? "#fff" : "#000", border: "1px solid #ccc", borderRadius: 6 }}>
            {t.toUpperCase()}
          </button>
        ))}
      </nav>

      {activeTab === "orders" && (
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
            <h3 style={{ marginTop: 0 }}>Builder</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label>Worker</label>
                <select value={worker} onChange={(e) => setWorker(e.target.value)} style={{ width: "100%" }}>
                  <option value="">—</option>
                  {workers.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label>Payment</label>
                <select value={payment} onChange={(e) => setPayment(e.target.value)} style={{ width: "100%" }}>
                  <option value="">—</option>
                  {paymentMethods.map((p) => <option key={p} value={p}>{p}</option>)}
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
                <input type="number" value={deliveryFee} onChange={(e)=>setDeliveryFee(Number(e.target.value||0))}
                  disabled={orderType!=="Delivery"} style={{ width: "100%" }}/>
              </div>
            </div>

            <div style={{ marginTop: 8 }}>
              <label>Note</label>
              <textarea value={orderNote} on
Change={(e) => setOrderNote(e.target.value)} rows={2} style={{ width: "100%" }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
              <div>
                <h4 style={{ margin: "6px 0" }}>Menu</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, maxHeight: 280, overflow: "auto", border: "1px solid #eee", padding: 6, borderRadius: 6 }}>
                  {menu.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedBurger(m)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 6,
                        border: "1px solid #ccc",
                        background: selectedBurger?.id === m.id ? "#222" : "#f8f8f8",
                        color: selectedBurger?.id === m.id ? "#fff" : "#000",
                        textAlign: "left"
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{m.name}</div>
                      <div style={{ fontSize: 12 }}>E£ {Number(m.price || 0).toFixed(2)}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <h4 style={{ margin: "6px 0" }}>Extras</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, maxHeight: 280, overflow: "auto", border: "1px solid #eee", padding: 6, borderRadius: 6 }}>
                  {extraList.map((ex) => {
                    const on = !!selectedExtras.find((e) => e.id === ex.id);
                    return (
                      <button
                        key={ex.id}
                        onClick={() => toggleExtra(ex)}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 6,
                          border: "1px solid #ccc",
                          background: on ? "#222" : "#f8f8f8",
                          color: on ? "#fff" : "#000",
                          textAlign: "left"
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{ex.name}</div>
                        <div style={{ fontSize: 12 }}>E£ {Number(ex.price || 0).toFixed(2)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 10, borderTop: "1px dashed #ccc", paddingTop: 8 }}>
              <div style={{ marginBottom: 6 }}>
                <strong>Selected:</strong>{" "}
                {selectedBurger ? selectedBurger.name : "—"}{" "}
                {selectedExtras.length ? `(+ ${selectedExtras.length} extras)` : ""}
              </div>
              <button onClick={addToCart} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #888", background: "#28a745", color: "#fff" }}>
                Add to Cart
              </button>
            </div>

            <div style={{ marginTop: 12 }}>
              <h4 style={{ margin: "6px 0" }}>Cart</h4>
              {cart.length === 0 ? (
                <div style={{ color: "#777" }}>Cart is empty.</div>
              ) : (
                <div style={{ border: "1px solid #eee", borderRadius: 6 }}>
                  {cart.map((ci, idx) => (
                    <div key={idx} style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        <div style={{ fontWeight: 600, flex: 1 }}>{ci.name}</div>
                        <div style={{ marginRight: 10 }}>E£ {Number(ci.price || 0).toFixed(2)}</div>
                        <button onClick={() => removeFromCart(idx)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #aaa" }}>
                          remove
                        </button>
                      </div>
                      {(ci.extras || []).length > 0 && (
                        <div style={{ fontSize: 12, marginTop: 4 }}>
                          {(ci.extras || []).map((e, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                              <span>+ {e.name}</span>
                              <span>E£ {Number(e.price || 0).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <div style={{ padding: 8, display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                    <span>Items Total</span>
                    <span>
                      E£{" "}
                      {(
                        cart.reduce((s, b) => s + Number(b.price || 0), 0) +
                        cart.reduce((s, b) => s + (b.extras || []).reduce((t, e) => t + Number(e.price || 0), 0), 0)
                      ).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button onClick={checkout} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #888", background: "#0d6efd", color: "#fff" }}>
                Checkout
              </button>
              <button
                onClick={() => {
                  setCart([]);
                  setOrderNote("");
                }}
                style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #aaa", background: "#eee" }}
              >
                Clear Cart
              </button>
            </div>
          </div>

          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h3 style={{ marginTop: 0, marginBottom: 6, flex: 1 }}>Orders Board</h3>
              <button onClick={startShift} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa", background: "#e8fff2" }}>
                Start Shift
              </button>
              <button onClick={changeShift} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa", background: "#fff9e6" }}>
                Change Shift
              </button>
              <button onClick={endDay} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa", background: "#ffe8e8" }}>
                End Day
              </button>
            </div>

            <div style={{ fontSize: 12, marginBottom: 8, color: "#666" }}>
              Shift: {dayMeta.startedAt ? new Date(dayMeta.startedAt).toLocaleString() : "—"} →{" "}
              {dayMeta.endedAt ? new Date(dayMeta.endedAt).toLocaleString() : "…"} | Worker:{" "}
              {dayMeta.startedBy || "—"}
            </div>

            {orders.length === 0 ? (
              <div style={{ color: "#777" }}>No orders yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 8, maxHeight: 520, overflow: "auto" }}>
                {getSortedOrders().map((o) => (
                  <div key={o.orderNo} style={{ border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>#{o.orderNo}</div>
                      <div style={{ color: "#666", fontSize: 12, flex: 1 }}>{o.date?.toLocaleString?.() || ""}</div>
                      <span style={{ padding: "2px 6px", borderRadius: 6, background: o.done ? "#e8fff2" : "#fff9e6", border: "1px solid #ccc", fontSize: 12 }}>
                        {o.done ? "DONE" : "PENDING"}
                      </span>
                      {o.voided && <span style={{ padding: "2px 6px", borderRadius: 6, background: "#ffe8e8", border: "1px solid #ccc", fontSize: 12 }}>VOIDED</span>}
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4, color: "#333" }}>
                      <div>Worker: {o.worker} | Payment: {o.payment} | Type: {o.orderType}</div>
                      {o.orderType === "Delivery" && <div>Delivery Fee: E£ {Number(o.deliveryFee || 0).toFixed(2)}</div>}
                      {o.note && <div>Note: {o.note}</div>}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 13 }}>
                      {(o.cart || []).map((ci, idx) => (
                        <div key={idx} style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>{ci.name}{(ci.extras || []).length ? ` (+${(ci.extras || []).length} extras)` : ""}</span>
                          <span>E£ {Number(ci.price || 0).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                      <span>Items Total</span>
                      <span>
                        E£{" "}
                        {(
                          (o.itemsTotal != null ? Number(o.itemsTotal) :
                            (o.total - (o.deliveryFee || 0)))
                        ).toFixed(2)}
                      </span>
                    </div>

                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {!o.done && !o.voided && (
                        <button onClick={() => markOrderDone(o.orderNo)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa", background: "#e8fff2" }}>
                          Mark Done
                        </button>
                      )}
                      {!o.voided && !o.done && (
                        <button onClick={() => voidOrderAndRestock(o.orderNo)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa", background: "#ffe8e8" }}>
                          Void & Restock
                        </button>
                      )}
                      {!o.voided && (
                        <>
                          <button onClick={() => printThermalTicket(o, 58, "Customer")} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa" }}>
                            Print Customer
                          </button>
                          {!o.done && (
                            <button onClick={() => printThermalTicket(o, 58, "Kitchen")} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa" }}>
                              Print Kitchen
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === "inventory" && (
        <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <h3 style={{ marginTop: 0, marginBottom: 6, flex: 1 }}>Inventory</h3>
            {!inventoryLocked ? (
              <button onClick={lockInventoryForDay} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa", background: "#fff9e6" }}>
                Lock as Start-of-Day
              </button>
            ) : (
              <button onClick={unlockInventoryWithPin} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa", background: "#ffe8e8" }}>
                Unlock (Admin PIN)
              </button>
            )}
          </div>

          <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
            Locked: {inventoryLocked ? "Yes" : "No"} {inventoryLockedAt ? `at ${new Date(inventoryLockedAt).toLocaleString()}` : ""}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, fontWeight: 700, marginTop: 6 }}>
            <div>Name</div><div>Unit</div><div>Qty</div><div>Actions</div>
          </div>
          <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
            {inventory.map((it, idx) => (
              <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, alignItems: "center" }}>
                <input value={it.name} disabled style={{ width: "100%" }} readOnly />
                <input value={it.unit} disabled style={{ width: "100%" }} readOnly />
                <input
                  type="number"
                  value={it.qty}
                  onChange={(e) => {
                    if (inventoryLocked) return alert("Inventory is locked.");
                    const v = Number(e.target.value || 0);
                    setInventory((inv) => inv.map((x, i) => (i === idx ? { ...x, qty: v } : x)));
                  }}
                  style={{ width: "100%" }}
                  disabled={inventoryLocked}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => {
                      if (inventoryLocked) return alert("Inventory is locked.");
                      setInventory((inv) => inv.map((x, i) => (i === idx ? { ...x, qty: (x.qty || 0) + 1 } : x)));
                    }}
                    style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #aaa" }}
                    disabled={inventoryLocked}
                  >
                    +1
                  </button>
                  <button
                    onClick={() => {
                      if (inventoryLocked) return alert("Inventory is locked.");
                      setInventory((inv) => inv.map((x, i) => (i === idx ? { ...x, qty: Math.max(0, (x.qty || 0) - 1) } : x)));
                    }}
                    style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #aaa" }}
                    disabled={inventoryLocked}
                  >
                    -1
                  </button>
                  <button
                    onClick={() => {
                      if (inventoryLocked) return alert("Inventory is locked.");
                      setInventory((inv) => inv.filter((_, i) => i !== idx));
                    }}
                    style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #aaa" }}
                    disabled={inventoryLocked}
                  >
                    remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, borderTop: "1px dashed #ccc", paddingTop: 8 }}>
            <h4 style={{ margin: "6px 0" }}>Add Inventory Item</h4>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8 }}>
              <input placeholder="Name (e.g., Meat)" value={newInvName} onChange={(e) => setNewInvName(e.target.value)} />
              <input placeholder="Unit (e.g., g, pcs, slices)" value={newInvUnit} onChange={(e) => setNewInvUnit(e.target.value)} />
              <input type="number" placeholder="Qty" value={newInvQty} onChange={(e) => setNewInvQty(Number(e.target.value || 0))} />
              <button onClick={addInventoryItem} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa" }}>
                Add
              </button>
            </div>
          </div>
        </section>
      )}

      {activeTab === "expenses" && (
        <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
          <h3 style={{ marginTop: 0 }}>Expenses</h3>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 2fr auto", gap: 8 }}>
            <input placeholder="Name" value={newExpName} onChange={(e) => setNewExpName(e.target.value)} />
            <input placeholder="Unit" value={newExpUnit} onChange={(e) => setNewExpUnit(e.target.value)} />
            <input type="number" placeholder="Qty" value={newExpQty} onChange={(e) => setNewExpQty(Number(e.target.value || 0))} />
            <input type="number" placeholder="Unit Price" value={newExpUnitPrice} onChange={(e) => setNewExpUnitPrice(Number(e.target.value || 0))} />
            <input placeholder="Note" value={newExpNote} onChange={(e) => setNewExpNote(e.target.value)} />
            <button onClick={addExpense} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa" }}>
              Add
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            {expenses.length === 0 ? (
              <div style={{ color: "#777" }}>No expenses.</div>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 2fr 1fr", gap: 8, fontWeight: 700 }}>
                  <div>Name</div><div>Unit</div><div>Qty</div><div>Unit Price</div><div>Note</div><div>Total</div>
                </div>
                {expenses.map((e) => (
                  <div key={e.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 2fr 1fr", gap: 8 }}>
                    <div>{e.name}</div>
                    <div>{e.unit}</div>
                    <div>{e.qty}</div>
                    <div>E£ {Number(e.unitPrice || 0).toFixed(2)}</div>
                    <div>{e.note || ""}</div>
                    <div>E£ {(Number(e.qty || 0) * Number(e.unitPrice || 0)).toFixed(2)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === "reports" && (
        <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 style={{ marginTop: 0, marginBottom: 6, flex: 1 }}>Reports</h3>
            <button onClick={() => generatePDF(false)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa", background: "#e8fff2" }}>
              Download Shift PDF
            </button>
            <button onClick={exportJSON} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa" }}>
              Export JSON
            </button>
            <button onClick={() => restoreInputRef.current?.click?.()} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa" }}>
              Import JSON
            </button>
            <input
              ref={restoreInputRef}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => importJSONLocal(e.target.files?.[0])}
            />
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <label>Sort Orders:</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="date-desc">Date ↓</option>
              <option value="date-asc">Date ↑</option>
              <option value="worker">Worker</option>
              <option value="payment">Payment</option>
            </select>
          </div>

          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ border: "1px solid #eee", padding: 8, borderRadius: 6 }}>
              <h4 style={{ margin: "6px 0" }}>Totals (excluding voided)</h4>
              <div style={{ display: "grid", gap: 4 }}>
                <div>Revenue (items only): <strong>E£ {totals.revenueTotal.toFixed(2)}</strong></div>
                <div>Delivery Fees: <strong>E£ {totals.deliveryFeesTotal.toFixed(2)}</strong></div>
                <div>Expenses: <strong>E£ {totals.expensesTotal.toFixed(2)}</strong></div>
                <div>Margin: <strong>E£ {totals.margin.toFixed(2)}</strong></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                <div>
                  <h5 style={{ margin: "6px 0" }}>By Payment</h5>
                  {Object.keys(totals.byPay).map((k) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>{k}</span><span>E£ {Number(totals.byPay[k] || 0).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <h5 style={{ margin: "6px 0" }}>By Order Type</h5>
                  {Object.keys(totals.byType).map((k) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>{k}</span><span>E£ {Number(totals.byType[k] || 0).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ border: "1px solid #eee", padding: 8, borderRadius: 6 }}>
              <h4 style={{ margin: "6px 0" }}>Top Items</h4>
              <div style={{ maxHeight: 220, overflow: "auto" }}>
                {salesStats.items.map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{r.name} — {r.count}x</span>
                    <span>E£ {r.revenue.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <h4 style={{ margin: "10px 0 6px" }}>Top Extras</h4>
              <div style={{ maxHeight: 220, overflow: "auto" }}>
                {salesStats.extras.map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{r.name} — {r.count}x</span>
                    <span>E£ {r.revenue.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <h4 style={{ margin: "6px 0" }}>Orders</h4>
            <div style={{ border: "1px solid #eee", borderRadius: 6, maxHeight: 280, overflow: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "70px 160px 1fr 1fr 1fr 120px 90px 70px 70px", gap: 6, padding: 6, fontWeight: 700 }}>
                <div>#</div><div>Date</div><div>Worker</div><div>Payment</div><div>Type</div><div>Delivery (E£)</div><div>Total (E£)</div><div>Done</div><div>Voided</div>
              </div>
              {getSortedOrders().map((o) => (
                <div key={o.orderNo} style={{ display: "grid", gridTemplateColumns: "70px 160px 1fr 1fr 1fr 120px 90px 70px 70px", gap: 6, padding: 6, borderTop: "1px solid #f5f5f5", fontSize: 13 }}>
                  <div>{o.orderNo}</div>
                  <div>{o.date?.toLocaleString?.() || ""}</div>
                  <div>{o.worker}</div>
                  <div>{o.payment}</div>
                  <div>{o.orderType}</div>
                  <div>{Number(o.deliveryFee || 0).toFixed(2)}</div>
                  <div>{Number(o.total || 0).toFixed(2)}</div>
                  <div>{o.done ? "Yes" : "No"}</div>
                  <div>{o.voided ? "Yes" : "No"}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {activeTab === "settings" && (
        <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
          <h3 style={{ marginTop: 0 }}>Settings</h3>

          <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={loadFromCloud} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa" }}>
              Pull From Cloud
            </button>
            <div style={{ fontSize: 12, color: "#666", display: "flex", alignItems: "center", gap: 8 }}>
              <span>Last Load: {cloudStatus.lastLoadAt ? new Date(cloudStatus.lastLoadAt).toLocaleString() : "—"}</span>
              <span>Last Save: {cloudStatus.lastSaveAt ? new Date(cloudStatus.lastSaveAt).toLocaleString() : "—"}</span>
              {cloudStatus.error && <span style={{ color: "crimson" }}>Error: {cloudStatus.error}</span>}
            </div>
          </div>

          <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8, marginBottom: 12 }}>
            <h4 style={{ margin: "6px 0" }}>Workers & Payments</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Workers</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input placeholder="New worker" value={newWorker} onChange={(e) => setNewWorker(e.target.value)} />
                  <button
                    onClick={() => {
                      const v = (newWorker || "").trim();
                      if (!v) return;
                      if (workers.includes(v)) return alert("Already exists.");
                      setWorkers((w) => [...w, v]);
                      setNewWorker("");
                    }}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa" }}
                  >
                    Add
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {workers.map((w) => (
                    <span key={w} style={{ border: "1px solid #ccc", borderRadius: 999, padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {w}
                      <button onClick={() => setWorkers((arr) => arr.filter((x) => x !== w))} style={{ border: "none", background: "transparent", cursor: "pointer" }}>✕</button>
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Payment Methods</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input placeholder="New payment (e.g., Cash)" value={newPayment} onChange={(e) => setNewPayment(e.target.value)} />
                  <button
                    onClick={() => {
                      const v = (newPayment || "").trim();
                      if (!v) return;
                      if (paymentMethods.includes(v)) return alert("Already exists.");
                      setPaymentMethods((p) => [...p, v]);
                      setNewPayment("");
                    }}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa" }}
                  >
                    Add
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {paymentMethods.map((p) => (
                    <span key={p} style={{ border: "1px solid #ccc", borderRadius: 999, padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {p}
                      <button onClick={() => setPaymentMethods((arr) => arr.filter((x) => x !== p))} style={{ border: "none", background: "transparent", cursor: "pointer" }}>✕</button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8, marginBottom: 12 }}>
            <h4 style={{ margin: "6px 0" }}>Order Types</h4>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
              {orderTypes.map((t) => (
                <span key={t} style={{ border: "1px solid #ccc", borderRadius: 999, padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {t}
                  <button onClick={() => setOrderTypes((arr) => arr.filter((x) => x !== t))} style={{ border: "none", background: "transparent", cursor: "pointer" }}>✕</button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input placeholder="Add order type (e.g., Delivery)" onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = e.currentTarget.value.trim();
                  if (!v) return;
                  if (orderTypes.includes(v)) return alert("Already exists.");
                  setOrderTypes((o) => [...o, v]);
                  e.currentTarget.value = "";
                }
              }} />
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <label>Default Delivery Fee</label>
                <input type="number" value={defaultDeliveryFee} onChange={(e) => setDefaultDeliveryFee(Number(e.target.value || 0))} style={{ width: 120 }} />
              </div>
            </div>
          </div>

          {/* Prices (protected by EDITOR_PIN) */}
          <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8, marginBottom: 12 }}>
            <h4 style={{ margin: "6px 0" }}>Prices (PIN protected)</h4>
            {!pricesUnlocked ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="password" placeholder="Enter Editor PIN" onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = e.currentTarget.value.trim();
                    if (val === EDITOR_PIN) {
                      setPricesUnlocked(true);
                      e.currentTarget.value = "";
                    } else {
                      alert("Wrong PIN.");
                    }
                  }
                }} />
                <button onClick={(e) => {
                  const input = e.currentTarget.previousSibling;
                  if (!input?.value) return;
                  if (input.value.trim() === EDITOR_PIN) {
                    setPricesUnlocked(true);
                    input.value = "";
                  } else {
                    alert("Wrong PIN.");
                  }
                }} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa" }}>
                  Unlock
                </button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>Unlocked. You can change prices. (Name editing disabled here.)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 8, fontWeight: 700 }}>
                  <div>Item</div><div>Price (E£)</div><div>Actions</div>
                </div>
                <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
                  {menu.map((m, idx) => (
                    <div key={m.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 8, alignItems: "center" }}>
                      <input value={m.name} readOnly disabled />
                      <input
                        type="number"
                        value={m.price}
                        onChange={(e) => {
                          const v = Number(e.target.value || 0);
                          setMenu((arr) => arr.map((x, i) => (i === idx ? { ...x, price: v } : x)));
                        }}
                      />
                      <div>
                        <button onClick={() => setMenu((arr) => arr.filter((_, i) => i !== idx))} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #aaa" }}>
                          remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 10, borderTop: "1px dashed #ccc", paddingTop: 8 }}>
                  <h5 style={{ margin: "6px 0" }}>Add Menu Item</h5>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 8 }}>
                    <input placeholder="Name" value={newMenuName} onChange={(e) => setNewMenuName(e.target.value)} />
                    <input type="number" placeholder="Price" value={newMenuPrice} onChange={(e) => setNewMenuPrice(Number(e.target.value || 0))} />
                    <button
                      onClick={() => {
                        const nm = (newMenuName || "").trim();
                        if (!nm) return;
                        const id = Math.max(1, ...menu.map((x) => Number(x.id) || 0)) + 1;
                        setMenu((arr) => [...arr, { id, name: nm, price: Number(newMenuPrice || 0), uses: {} }]);
                        setNewMenuName("");
                        setNewMenuPrice(0);
                      }}
                      style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa" }}
                    >
                      Add
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <h5 style={{ margin: "6px 0" }}>Extras</h5>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 8, fontWeight: 700 }}>
                    <div>Extra</div><div>Price (E£)</div><div>Actions</div>
                  </div>
                  <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
                    {extraList.map((ex, idx) => (
                      <div key={ex.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 8, alignItems: "center" }}>
                        <input value={ex.name} readOnly disabled />
                        <input
                          type="number"
                          value={ex.price}
                          onChange={(e) => {
                            const v = Number(e.target.value || 0);
                            setExtraList((arr) => arr.map((x, i) => (i === idx ? { ...x, price: v } : x)));
                          }}
                        />
                        <div>
                          <button onClick={() => setExtraList((arr) => arr.filter((_, i) => i !== idx))} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #aaa" }}>
                            remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: 10, borderTop: "1px dashed #ccc", paddingTop: 8 }}>
                    <h5 style={{ margin: "6px 0" }}>Add Extra</h5>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 8 }}>
                      <input placeholder="Name" value={newExtraName} onChange={(e) => setNewExtraName(e.target.value)} />
                      <input type="number" placeholder="Price" value={newExtraPrice} onChange={(e) => setNewExtraPrice(Number(e.target.value || 0))} />
                      <button
                        onClick={() => {
                          const nm = (newExtraName || "").trim();
                          if (!nm) return;
                          const id = Math.max(100, ...extraList.map((x) => Number(x.id) || 100)) + 1;
                          setExtraList((arr) => [...arr, { id, name: nm, price: Number(newExtraPrice || 0), uses: {} }]);
                          setNewExtraName("");
                          setNewExtraPrice(0);
                        }}
                        style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa" }}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <button onClick={() => setPricesUnlocked(false)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #aaa" }}>
                    Lock Prices
                  </button>
                </div>
              </>
            )}
          </div>

          <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
            <h4 style={{ margin: "6px 0" }}>Admin PINs</h4>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>You can set per-admin PINs (used for unlocking inventory, etc.).</div>
            <div style={{ display: "grid", gridTemplateColumns: "120px 160px auto", gap: 8, fontWeight: 700 }}>
              <div>Admin #</div><div>PIN</div><div>Actions</div>
            </div>
            <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
              {[1,2,3,4,5,6].map((n) => (
                <div key={n} style={{ display: "grid", gridTemplateColumns: "120px 160px auto", gap: 8, alignItems: "center" }}>
                  <div>Admin {n}</div>
                  <input
                    type="password"
                    value={adminPins[n] || ""}
                    onChange={(e) => setAdminPins((p) => ({ ...p, [n]: e.target.value }))}
                    placeholder="4 digits"
                  />
                  <div>
                    <button onClick={() => setAdminPins((p) => ({ ...p, [n]: "" }))} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #aaa" }}>
                      clear
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <footer style={{ marginTop: 16, fontSize: 12, color: "#666" }}>
        <div>© {new Date().getFullYear()} TUX — POS</div>
      </footer>
    </div>
  );
}
