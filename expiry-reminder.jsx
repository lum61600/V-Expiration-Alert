import { useState, useMemo, useEffect, useRef } from "react";

const DEFAULT_CATEGORIES = [
  { id: "food", label: "食品" },
  { id: "daily", label: "日用品" },
  { id: "medicine", label: "藥品" },
  { id: "cosmetic", label: "化妝品" },
  { id: "other", label: "其他" },
];

const CATEGORY_ICONS = {
  food: { emoji: "🥛", bg: "#FFE9C7" },
  daily: { emoji: "🧻", bg: "#D9F2FF" },
  medicine: { emoji: "💊", bg: "#FFD9E0" },
  cosmetic: { emoji: "💄", bg: "#F3D9FF" },
  other: { emoji: "📦", bg: "#E5E5EA" },
};

const CUSTOM_ICON_POOL = [
  { emoji: "🍎", bg: "#FFE2D6" },
  { emoji: "🧃", bg: "#D9FFEA" },
  { emoji: "🐾", bg: "#FFF3D6" },
  { emoji: "🧸", bg: "#E4D9FF" },
  { emoji: "🧴", bg: "#D6F0FF" },
  { emoji: "🌿", bg: "#E1FFD9" },
];

const LABEL_ICON_OVERRIDES = {
  寵物用品: { emoji: "🐱", bg: "#FFF3D6" },
};

function categoryVisual(id, label) {
  if (CATEGORY_ICONS[id]) return CATEGORY_ICONS[id];
  if (label && LABEL_ICON_OVERRIDES[label]) return LABEL_ICON_OVERRIDES[label];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CUSTOM_ICON_POOL[hash % CUSTOM_ICON_POOL.length];
}

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function statusOf(dateStr, threshold = 7) {
  const d = daysUntil(dateStr);
  if (d < 0) return { key: "expired", label: "已過期", color: "#FF3B30", bg: "#FFF1F0" };
  if (d <= threshold) return { key: "soon", label: "即將到期", color: "#FF9500", bg: "#FFF7E6" };
  return { key: "safe", label: "安全", color: "#34C759", bg: "#EAFBEF" };
}

function fmtDay(d) {
  if (d < 0) return `已過期 ${Math.abs(d)} 天`;
  if (d === 0) return "今天到期";
  return `剩 ${d} 天`;
}

const STORAGE_KEY = "expiry-reminder-data";

const seed = [
  { id: 1, name: "牛奶", category: "food", purchaseDate: "2026-08-01", expiryDate: "2026-08-10", quantity: 1, note: "" },
  { id: 2, name: "感冒藥", category: "medicine", purchaseDate: "2026-05-01", expiryDate: "2026-08-06", quantity: 1, note: "退燒用" },
  { id: 3, name: "防曬乳", category: "cosmetic", purchaseDate: "2026-03-15", expiryDate: "2027-01-20", quantity: 1, note: "" },
];

function exportCSV(items, categories) {
  const header = ["商品名稱", "分類", "購買日期", "到期日期", "數量", "備註"];
  const rows = items.map((it) => {
    const catLabel = categories.find((c) => c.id === it.category)?.label ?? "其他";
    return [it.name, catLabel, it.purchaseDate, it.expiryDate, it.quantity, it.note ?? ""];
  });
  const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const today = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `到期提醒清單_${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ExpiryReminder() {
  const [items, setItems] = useState(seed);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const [threshold, setThreshold] = useState(7);
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [syncState, setSyncState] = useState("idle");
  const notifiedIds = useRef(new Set());
  const [form, setForm] = useState({
    name: "",
    category: "food",
    purchaseDate: "",
    expiryDate: "",
    quantity: 1,
    note: "",
  });
  const [errors, setErrors] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await window.storage.get(STORAGE_KEY, false);
        if (cancelled) return;
        if (result && result.value) {
          const data = JSON.parse(result.value);
          if (Array.isArray(data.items)) setItems(data.items);
          if (Array.isArray(data.categories)) setCategories(data.categories);
          if (typeof data.threshold === "number") setThreshold(data.threshold);
          if (typeof data.sortAsc === "boolean") setSortAsc(data.sortAsc);
          if (typeof data.filter === "string") setFilter(data.filter);
          if (typeof data.categoryFilter === "string") setCategoryFilter(data.categoryFilter);
        }
      } catch (err) {
        // 尚未有儲存過的資料，使用預設值即可
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    setSyncState("saving");
    const payload = JSON.stringify({ items, categories, threshold, sortAsc, filter, categoryFilter });
    const timer = setTimeout(async () => {
      try {
        const result = await window.storage.set(STORAGE_KEY, payload, false);
        setSyncState(result ? "saved" : "error");
      } catch (err) {
        setSyncState("error");
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [items, categories, threshold, sortAsc, filter, categoryFilter, isLoaded]);

  const sorted = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    return [...items].sort((a, b) => dir * (daysUntil(a.expiryDate) - daysUntil(b.expiryDate)));
  }, [items, sortAsc]);

  const urgentItems = useMemo(() => {
    return sorted.filter((it) => statusOf(it.expiryDate, threshold).key !== "safe");
  }, [sorted, threshold]);

  const filtered = useMemo(() => {
    let list = sorted;
    if (filter !== "all") list = list.filter((it) => statusOf(it.expiryDate, threshold).key === filter);
    if (categoryFilter !== "all") list = list.filter((it) => it.category === categoryFilter);
    return list;
  }, [sorted, filter, categoryFilter, threshold]);

  const categoryCounts = useMemo(() => {
    const c = {};
    categories.forEach((cat) => (c[cat.id] = 0));
    items.forEach((it) => {
      c[it.category] = (c[it.category] ?? 0) + 1;
    });
    return c;
  }, [items, categories]);

  function addCategory() {
    const name = newCategoryName.trim();
    if (!name) {
      setCategoryError("請輸入分類名稱");
      return;
    }
    if (categories.some((c) => c.label === name)) {
      setCategoryError("這個分類已經存在");
      return;
    }
    const id = `custom_${Date.now()}`;
    setCategories((list) => [...list, { id, label: name }]);
    setNewCategoryName("");
    setCategoryError("");
  }

  function deleteCategory(id) {
    if (id === "other") return;
    setCategories((list) => list.filter((c) => c.id !== id));
    setItems((list) => list.map((it) => (it.category === id ? { ...it, category: "other" } : it)));
    if (categoryFilter === id) setCategoryFilter("all");
    if (form.category === id) updateField("category", "other");
  }

  const counts = useMemo(() => {
    const c = { expired: 0, soon: 0, safe: 0 };
    items.forEach((it) => c[statusOf(it.expiryDate, threshold).key]++);
    return c;
  }, [items, threshold]);

  useEffect(() => {
    if (!notifyEnabled || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    urgentItems.forEach((it) => {
      if (notifiedIds.current.has(it.id)) return;
      const d = daysUntil(it.expiryDate);
      new Notification("商品即將到期", {
        body: `${it.name} ${d < 0 ? `已過期 ${Math.abs(d)} 天` : d === 0 ? "今天到期" : `剩 ${d} 天到期`}`,
      });
      notifiedIds.current.add(it.id);
    });
  }, [notifyEnabled, urgentItems]);

  function toggleNotify() {
    if (typeof Notification === "undefined") {
      setNotifyEnabled((v) => !v);
      return;
    }
    if (!notifyEnabled) {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") setNotifyEnabled(true);
      });
    } else {
      setNotifyEnabled(false);
    }
  }

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = "請輸入商品名稱";
    if (!form.purchaseDate) e.purchaseDate = "請選擇購買日期";
    if (!form.expiryDate) e.expiryDate = "請選擇到期日期";
    if (form.purchaseDate && form.expiryDate && form.expiryDate < form.purchaseDate) {
      e.expiryDate = "到期日期不能早於購買日期";
    }
    if (!form.quantity || form.quantity < 1) e.quantity = "數量至少為 1";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(ev) {
    ev.preventDefault();
    if (!validate()) {
      setSubmitAttempted(true);
      return;
    }
    if (editingId !== null) {
      setItems((list) =>
        list.map((it) =>
          it.id === editingId ? { ...form, id: editingId, quantity: Number(form.quantity) } : it
        )
      );
    } else {
      setItems((list) => [
        ...list,
        { ...form, id: Date.now(), quantity: Number(form.quantity) },
      ]);
    }
    setForm({ name: "", category: "food", purchaseDate: "", expiryDate: "", quantity: 1, note: "" });
    setSubmitAttempted(false);
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(it) {
    setForm({
      name: it.name,
      category: it.category,
      purchaseDate: it.purchaseDate,
      expiryDate: it.expiryDate,
      quantity: it.quantity,
      note: it.note ?? "",
    });
    setEditingId(it.id);
    setErrors({});
    setSubmitAttempted(false);
    setShowForm(true);
  }

  function removeItem(id) {
    setItems((list) => list.filter((it) => it.id !== id));
  }

  if (!isLoaded) {
    return (
      <div
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang TC", "Helvetica Neue", sans-serif',
          background: "#F5F5F7",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#86868B",
          fontSize: 15,
        }}
      >
        載入資料中…
      </div>
    );
  }

  return (
    <div
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang TC", "Helvetica Neue", sans-serif',
        background:
          "linear-gradient(135deg, #FDF0E6 0%, #FCEAF1 20%, #F1E9FA 40%, #E7F0FB 60%, #E4F6F0 80%, #F5F5F7 100%)",
        minHeight: "100vh",
        padding: "0 0 80px",
        color: "#1D1D1F",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "relative", zIndex: 1 }}>
      <div style={{ padding: "48px 24px 24px", maxWidth: 560, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 34, fontWeight: 700, margin: 0, letterSpacing: -0.5, display: "flex", alignItems: "center", gap: 10 }}>
              到期提醒
              <svg
                aria-hidden="true"
                width="64"
                height="50"
                viewBox="-6 -6 104 86"
                style={{ flexShrink: 0 }}
              >
                <style>{`
                  @keyframes tailCurl {
                    0%, 100% { transform: rotate(0deg); }
                    50% { transform: rotate(-16deg); }
                  }
                `}</style>
                <ellipse cx="50" cy="66" rx="34" ry="4" fill="#000000" opacity="0.06" />
                <rect x="16" y="54" width="9" height="20" rx="4.5" fill="#AEAEB2" />
                <rect x="30" y="56" width="9" height="20" rx="4.5" fill="#AEAEB2" />
                <rect x="60" y="56" width="9" height="20" rx="4.5" fill="#AEAEB2" />
                <rect x="72" y="54" width="9" height="20" rx="4.5" fill="#AEAEB2" />
                <path d="M17 60 Q19 58 21 60 Q23 62 25 60" stroke="#6E6E73" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                <path d="M31 62 Q33 60 35 62 Q37 64 39 62" stroke="#6E6E73" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                <path d="M61 62 Q63 60 65 62 Q67 64 69 62" stroke="#6E6E73" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                <path d="M73 60 Q75 58 77 60 Q79 62 81 60" stroke="#6E6E73" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                <ellipse cx="50" cy="48" rx="28" ry="16" fill="#AEAEB2" />
                <ellipse cx="30" cy="40" rx="10" ry="10" fill="#AEAEB2" />
                <path d="M34 38 Q36 35 38 38 Q40 41 42 38 Q44 35 46 38" stroke="#6E6E73" strokeWidth="2.2" fill="none" strokeLinecap="round" />
                <path d="M32 46 Q34 43 36 46 Q38 49 40 46 Q42 43 44 46" stroke="#6E6E73" strokeWidth="2.2" fill="none" strokeLinecap="round" />
                <path d="M44 34 Q46 31 48 34 Q50 37 52 34 Q54 31 56 34" stroke="#6E6E73" strokeWidth="2.2" fill="none" strokeLinecap="round" />
                <path d="M46 52 Q48 49 50 52 Q52 55 54 52 Q56 49 58 52" stroke="#6E6E73" strokeWidth="2.2" fill="none" strokeLinecap="round" />
                <path d="M58 38 Q60 35 62 38 Q64 41 66 38 Q68 35 70 38" stroke="#6E6E73" strokeWidth="2.2" fill="none" strokeLinecap="round" />
                <path d="M60 48 Q62 45 64 48 Q66 51 68 48 Q70 45 72 48" stroke="#6E6E73" strokeWidth="2.2" fill="none" strokeLinecap="round" />
                <path d="M40 58 Q42 55 44 58 Q46 61 48 58" stroke="#6E6E73" strokeWidth="2.2" fill="none" strokeLinecap="round" />
                <path d="M56 58 Q58 55 60 58 Q62 61 64 58" stroke="#6E6E73" strokeWidth="2.2" fill="none" strokeLinecap="round" />
                <g style={{ transformOrigin: "74px 40px", animation: "tailCurl 2.4s ease-in-out infinite" }}>
                  <path d="M74 40 Q90 36 92 18 Q92 8 83 5" stroke="#AEAEB2" strokeWidth="8" fill="none" strokeLinecap="round" />
                  <line x1="84" y1="30" x2="90" y2="26" stroke="#6E6E73" strokeWidth="2.2" strokeLinecap="round" />
                  <line x1="88" y1="18" x2="93" y2="14" stroke="#6E6E73" strokeWidth="2.2" strokeLinecap="round" />
                </g>
                <ellipse cx="20" cy="33" rx="18" ry="16" fill="#AEAEB2" />
                <ellipse cx="6" cy="38" rx="5.5" ry="5" fill="#AEAEB2" />
                <ellipse cx="34" cy="37" rx="5.5" ry="5" fill="#AEAEB2" />
                <path d="M4 23 L5 5 L15 16 Z" fill="#AEAEB2" stroke="#6E6E73" strokeWidth="1" />
                <path d="M19 21 L27 3 L33 14 Z" fill="#AEAEB2" stroke="#6E6E73" strokeWidth="1" />
                <path d="M6 18 L7 9 L12 15 Z" fill="#F3C9C0" />
                <path d="M21 17 L26 6 L30 13 Z" fill="#F3C9C0" />
                <path d="M3 30 Q11 25 19 30" stroke="#4A3222" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                <path d="M21 29 Q29 24 37 29" stroke="#4A3222" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                <path d="M5 33 Q11 30.5 17 33 Q11 35.5 5 33 Z" fill="#FFFFFF" />
                <path d="M23 32 Q29 29.5 35 32 Q29 34.5 23 32 Z" fill="#FFFFFF" />
                <ellipse cx="11" cy="33" rx="1.6" ry="2.2" fill="#4A3222" />
                <ellipse cx="29" cy="32" rx="1.6" ry="2.2" fill="#4A3222" />
                <path d="M18 38 L20 40 L22 38" fill="#C97B63" />
                <path d="M15 40 Q20 47 25 40" stroke="#6E4A2E" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                <path d="M19 44 L20 48 L21 44 Z" fill="#F08C9B" />
                <line x1="5" y1="36" x2="-6" y2="33" stroke="#8E8E93" strokeWidth="0.8" />
                <line x1="5" y1="39" x2="-6" y2="40" stroke="#8E8E93" strokeWidth="0.8" />
                <line x1="5" y1="42" x2="-6" y2="47" stroke="#8E8E93" strokeWidth="0.8" />
              </svg>
            </h1>
            <p style={{ fontSize: 15, color: "#86868B", margin: "4px 0 0" }}>
              追蹤家中商品的保存期限
            </p>
            <p style={{ fontSize: 12, color: "#C7C7CC", margin: "6px 0 0" }}>
              {syncState === "saving" ? "儲存中…" : syncState === "error" ? "同步失敗，資料僅存在本機畫面" : "已同步"}
            </p>
          </div>
          <button
            onClick={() => {
              setForm({ name: "", category: "food", purchaseDate: "", expiryDate: "", quantity: 1, note: "" });
              setEditingId(null);
              setSubmitAttempted(false);
              setErrors({});
              setShowForm(true);
            }}
            aria-label="新增商品"
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "none",
              background: "#0071E3",
              color: "#fff",
              fontSize: 24,
              fontWeight: 300,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 14px rgba(0,113,227,0.35)",
              flexShrink: 0,
            }}
          >
            +
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 24, flexWrap: "wrap" }}>
          {[
            { key: "all", label: `全部 ${items.length}` },
            { key: "expired", label: `已過期 ${counts.expired}` },
            { key: "soon", label: `即將到期 ${counts.soon}` },
            { key: "safe", label: `安全 ${counts.safe}` },
          ].map((p) => (
            <button
              key={p.key}
              onClick={() => setFilter(p.key)}
              style={{
                padding: "8px 16px",
                borderRadius: 20,
                border: filter === p.key ? "none" : "1px solid #E5E5EA",
                background: filter === p.key ? "#1D1D1F" : "#fff",
                color: filter === p.key ? "#fff" : "#1D1D1F",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => setCategoryFilter("all")}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              border: categoryFilter === "all" ? "none" : "1px solid #E5E5EA",
              background: categoryFilter === "all" ? "#0071E3" : "#fff",
              color: categoryFilter === "all" ? "#fff" : "#6E6E73",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            全部分類
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryFilter(c.id)}
              style={{
                padding: "6px 14px",
                borderRadius: 20,
                border: categoryFilter === c.id ? "none" : "1px solid #E5E5EA",
                background: categoryFilter === c.id ? "#0071E3" : "#fff",
                color: categoryFilter === c.id ? "#fff" : "#6E6E73",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {categoryVisual(c.id, c.label).emoji} {c.label} {categoryCounts[c.id] > 0 ? categoryCounts[c.id] : ""}
            </button>
          ))}
          <button
            onClick={() => setShowCategoryManager((v) => !v)}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              border: "1px dashed #C7C7CC",
              background: "transparent",
              color: "#86868B",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {showCategoryManager ? "完成" : "管理分類"}
          </button>
        </div>

        {showCategoryManager && (
          <div
            style={{
              marginTop: 10,
              padding: "14px 16px",
              background: "#fff",
              borderRadius: 14,
              border: "1px solid #E5E5EA",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {categories.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 6px 5px 12px",
                    borderRadius: 20,
                    background: "#F5F5F7",
                    fontSize: 12,
                    color: "#1D1D1F",
                  }}
                >
                  {categoryVisual(c.id, c.label).emoji} {c.label}
                  {c.id !== "other" && (
                    <button
                      onClick={() => deleteCategory(c.id)}
                      aria-label={`刪除分類 ${c.label}`}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        border: "none",
                        background: "#E5E5EA",
                        color: "#6E6E73",
                        fontSize: 11,
                        lineHeight: "18px",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => {
                  setNewCategoryName(e.target.value);
                  setCategoryError("");
                }}
                placeholder="新增分類名稱，例如：寵物用品"
                style={{ ...inputStyle(categoryError), flex: 1 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCategory();
                  }
                }}
              />
              <button
                onClick={addCategory}
                style={{
                  padding: "0 18px",
                  borderRadius: 12,
                  border: "none",
                  background: "#0071E3",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                新增
              </button>
            </div>
            {categoryError && (
              <div style={{ fontSize: 12, color: "#FF3B30", marginTop: 6 }}>{categoryError}</div>
            )}
            <div style={{ fontSize: 11, color: "#AEAEB2", marginTop: 8 }}>
              刪除分類後，該分類下的商品會自動歸類到「其他」。
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
          <button
            onClick={() => setSortAsc((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              border: "none",
              background: "transparent",
              color: "#0071E3",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              padding: 0,
            }}
          >
            依到期日排序：{sortAsc ? "由近到遠" : "由遠到近"}
            <span style={{ fontSize: 11 }}>{sortAsc ? "↓" : "↑"}</span>
          </button>
          <button
            onClick={() => exportCSV(sorted, categories)}
            style={{
              border: "none",
              background: "transparent",
              color: "#0071E3",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              padding: 0,
            }}
          >
            匯出清單 (CSV)
          </button>
        </div>

      </div>

      {urgentItems.length > 0 && (
        <div style={{ maxWidth: 560, margin: "16px auto 0", padding: "0 24px" }}>
          <style>{`
            @keyframes clockShake {
              0%, 100% { transform: rotate(0deg); }
              10% { transform: rotate(-14deg); }
              20% { transform: rotate(12deg); }
              30% { transform: rotate(-10deg); }
              40% { transform: rotate(8deg); }
              50% { transform: rotate(-6deg); }
              60% { transform: rotate(4deg); }
              70% { transform: rotate(-2deg); }
              80%, 100% { transform: rotate(0deg); }
            }
          `}</style>
          <div
            style={{
              background: "#FFF7E6",
              border: "1px solid #FFE2AD",
              borderRadius: 16,
              padding: "14px 18px",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <span
              style={{
                fontSize: 18,
                lineHeight: "20px",
                display: "inline-block",
                transformOrigin: "50% 20%",
                animation: "clockShake 1.4s ease-in-out infinite",
              }}
            >
              ⏰
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#8A5A00" }}>
                {counts.expired > 0
                  ? `有 ${counts.expired} 項已過期，${counts.soon} 項即將到期`
                  : `有 ${counts.soon} 項商品即將到期`}
              </div>
              <div style={{ fontSize: 13, color: "#9A6B00", marginTop: 4, lineHeight: 1.5 }}>
                {urgentItems.slice(0, 3).map((it) => it.name).join("、")}
                {urgentItems.length > 3 ? ` 等 ${urgentItems.length} 項` : ""}
                ，請盡快處理。
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 560, margin: "0 auto", padding: "8px 24px" }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#86868B", fontSize: 15 }}>
            這裡還沒有商品，點右上角「+」新增一筆。
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((it) => {
            const s = statusOf(it.expiryDate, threshold);
            const d = daysUntil(it.expiryDate);
            const catLabel = categories.find((c) => c.id === it.category)?.label ?? "其他";
            const visual = categoryVisual(it.category, catLabel);
            return (
              <div
                key={it.id}
                style={{
                  background: "#fff",
                  borderRadius: 18,
                  padding: "18px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: 1 }}>
                  <div
                    aria-hidden="true"
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 14,
                      background: visual.bg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 22,
                      flexShrink: 0,
                    }}
                  >
                    {visual.emoji}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontSize: 17,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {it.name}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: "#86868B",
                          background: "#F5F5F7",
                          padding: "2px 8px",
                          borderRadius: 8,
                          flexShrink: 0,
                        }}
                      >
                        {catLabel}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "#86868B", marginTop: 4 }}>
                      購買於 {it.purchaseDate} ・ 到期 {it.expiryDate}
                      {it.quantity > 1 ? ` ・ 數量 ${it.quantity}` : ""}
                    </div>
                    {it.note && (
                      <div style={{ fontSize: 13, color: "#AEAEB2", marginTop: 2 }}>{it.note}</div>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: s.color,
                      background: s.bg,
                      padding: "4px 10px",
                      borderRadius: 12,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fmtDay(d)}
                  </span>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() => startEdit(it)}
                      aria-label="編輯"
                      style={{ border: "none", background: "transparent", color: "#0071E3", fontSize: 12, fontWeight: 500, cursor: "pointer", padding: 0 }}
                    >
                      編輯
                    </button>
                    <button
                      onClick={() => removeItem(it.id)}
                      aria-label="刪除"
                      style={{ border: "none", background: "transparent", color: "#C7C7CC", fontSize: 12, cursor: "pointer", padding: 0 }}
                    >
                      刪除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showForm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => {
            setShowForm(false);
            setEditingId(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              width: "100%",
              maxWidth: 560,
              borderRadius: "24px 24px 0 0",
              padding: "12px 24px 32px",
              maxHeight: "85vh",
              overflowY: "auto",
            }}
          >
            <div style={{ width: 36, height: 5, background: "#E5E5EA", borderRadius: 3, margin: "0 auto 20px" }} />
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 20px" }}>
              {editingId !== null ? "編輯商品" : "新增消費"}
            </h2>

            {submitAttempted && Object.keys(errors).length > 0 && (
              <div
                style={{
                  background: "#FFF1F0",
                  border: "1px solid #FFC7C2",
                  color: "#C0271B",
                  borderRadius: 12,
                  padding: "10px 14px",
                  fontSize: 13,
                  fontWeight: 500,
                  marginBottom: 16,
                }}
              >
                請完成下方標示為紅色的必填欄位再儲存。
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <Field label="商品名稱" error={errors.name}>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="例如：鮮奶、感冒藥"
                  style={inputStyle(errors.name)}
                />
              </Field>

              <Field label="分類">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {categories.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => updateField("category", c.id)}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 20,
                        border: form.category === c.id ? "none" : "1px solid #E5E5EA",
                        background: form.category === c.id ? "#1D1D1F" : "#fff",
                        color: form.category === c.id ? "#fff" : "#1D1D1F",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      {categoryVisual(c.id, c.label).emoji} {c.label}
                    </button>
                  ))}
                </div>
              </Field>

              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <Field label="購買日期" error={errors.purchaseDate}>
                    <input
                      type="date"
                      value={form.purchaseDate}
                      onChange={(e) => updateField("purchaseDate", e.target.value)}
                      style={inputStyle(errors.purchaseDate)}
                    />
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="到期日期" error={errors.expiryDate}>
                    <input
                      type="date"
                      value={form.expiryDate}
                      onChange={(e) => updateField("expiryDate", e.target.value)}
                      style={inputStyle(errors.expiryDate)}
                    />
                  </Field>
                </div>
              </div>

              <Field label="數量" error={errors.quantity}>
                <input
                  type="number"
                  min="1"
                  value={form.quantity}
                  onChange={(e) => updateField("quantity", e.target.value)}
                  style={{ ...inputStyle(errors.quantity), width: 100 }}
                />
              </Field>

              <Field label="備註（選填）">
                <input
                  type="text"
                  value={form.note}
                  onChange={(e) => updateField("note", e.target.value)}
                  placeholder="例如：放冰箱冷藏"
                  style={inputStyle()}
                />
              </Field>

              <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                  }}
                  style={{
                    flex: 1,
                    padding: "13px 0",
                    borderRadius: 14,
                    border: "1px solid #E5E5EA",
                    background: "#fff",
                    color: "#1D1D1F",
                    fontSize: 15,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  style={{
                    flex: 1,
                    padding: "13px 0",
                    borderRadius: 14,
                    border: "none",
                    background: "#0071E3",
                    color: "#fff",
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {editingId !== null ? "更新" : "儲存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function Field({ label, error, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#6E6E73", marginBottom: 6 }}>
        {label}
      </label>
      {children}
      {error && <div style={{ fontSize: 12, color: "#FF3B30", marginTop: 4 }}>{error}</div>}
    </div>
  );
}

function inputStyle(error) {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 14px",
    borderRadius: 12,
    border: `1px solid ${error ? "#FF3B30" : "#E5E5EA"}`,
    fontSize: 15,
    fontFamily: "inherit",
    color: "#1D1D1F",
    background: "#FAFAFA",
    outline: "none",
  };
}
