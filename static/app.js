let currentSettings = null;
let summaryData = null;
let trendData = null;
let currentTrendPeriod = "1Y";
let currentTrendMode = "count"; // 'count' or 'share'
let analyticsIntent = "demand_only";
let selectedPricingSource = "all"; // 'all', 'hiring', 'supply'
let selectedPricingSort = "demand_desc";
let ratioViewLevel = "task"; // 'task' or 'trade'
let ratioDemandType = "total"; // 'total' or 'hiring'
const WORK_TYPE_COLORS = {
  "All Demand": "#60a5fa",
  "Plumbing & Drain": "#38bdf8",
  "Electrical & Lighting": "#fbbf24",
  "Yardwork & Landscaping": "#34d399",
  "Carpentry, Doors & Windows": "#f97316",
  "Painting & Drywall": "#a855f7",
  "Mounting & Furniture Assembly": "#ec4899",
  "Roofing, Siding & Gutters": "#14b8a6",
  "Flooring & Tile": "#818cf8",
  "Appliance & HVAC Repair": "#fb7185",
  "General Handyman & Odd Jobs": "#94a3b8",
};

let activeWorkTypes = new Set(Object.keys(WORK_TYPE_COLORS));
let allFilteredPosts = [];
let currentPage = 1;
let pageSize = 25;
let regionPage = 1;
const REGION_PAGE_SIZE = 6;
let cachedRegionsList = [];
let cachedChannelsList = [];

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url || "") ? url : "#";
}

let searchDebounce = null;
function debouncedLoadPosts() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadPosts, 250);
}

function switchTab(tabName) {
  const leadsEl = document.getElementById("view-leads");
  if (leadsEl) leadsEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncActiveKpiCard(intentVal) {
  const types = ["demand_only", "customer_hiring", "diy_help_needed", "service_provider_ad", "job_posting"];
  types.forEach(t => {
    const el = document.getElementById(`kpi-card-${t}`);
    if (el) el.classList.toggle("active", t === intentVal);
  });
}

function quickSelectIntent(intentVal) {
  analyticsIntent = intentVal || "demand_only";
  syncActiveKpiCard(analyticsIntent);
  loadTrends();
}

function onIntentDropdownChange() {
  loadPosts();
}

let staticSnapshot = null;

function isStaticHost() {
  return window.location.hostname.endsWith("github.io");
}

async function ensureStaticSnapshot(forceRefresh = false) {
  if (staticSnapshot && !forceRefresh) return staticSnapshot;
  const bust = forceRefresh ? `?t=${Date.now()}` : "";
  const resp = await fetch(`./static/snapshot.json${bust}`);
  staticSnapshot = await resp.json();
  return staticSnapshot;
}

function computeStaticSummary(snap, country, province, city_region, date_from, date_to) {
  const posts = (snap.posts || []).filter(p => {
    if (country && country !== "all" && p.country !== country) return false;
    if (province && province !== "all" && p.province !== province) return false;
    if (city_region && city_region !== "all" && p.city_region !== city_region) return false;
    const postDay = String(p.posted_at || "").slice(0, 10);
    if (date_from && postDay < date_from) return false;
    if (date_to && postDay > date_to) return false;
    return true;
  });
  let hiring = 0, diy = 0, supply = 0, jobs = 0;
  const catMap = {};
  const subMap = {};
  const priceCatMap = {};
  const regMap = {};
  const chMap = {};
  const platMap = {};

  const addPrice = (bucket, p) => {
    if (p.intent_type === "job_posting" || p.intent_type === "irrelevant") return;
    const pv = Number(p.price_value || 0);
    if (pv <= 0) return;
    if (p.price_type === "hourly" && pv >= 25 && pv <= 250) {
      bucket.hrVals.push(pv);
      if (p.intent_type === "customer_hiring") bucket.hiringHrVals.push(pv);
      else if (p.intent_type === "service_provider_ad") bucket.supplyHrVals.push(pv);
    } else if (p.price_type === "flat" && pv >= 45 && pv <= 5000) {
      bucket.flatVals.push(pv);
      if (p.intent_type === "customer_hiring") bucket.hiringFlatVals.push(pv);
      else if (p.intent_type === "service_provider_ad") bucket.supplyFlatVals.push(pv);
    }
  };
  const calcStats = arr => ({
    cnt: arr.length,
    avg: arr.length ? Math.round(arr.reduce((a, x) => a + x, 0) / arr.length) : null,
    min: arr.length ? Math.round(Math.min(...arr)) : null,
    max: arr.length ? Math.round(Math.max(...arr)) : null,
  });
  const finalizePrice = b => {
    const hr = calcStats(b.hrVals || []);
    const fl = calcStats(b.flatVals || []);
    const hHr = calcStats(b.hiringHrVals || []);
    const hFl = calcStats(b.hiringFlatVals || []);
    const sHr = calcStats(b.supplyHrVals || []);
    const sFl = calcStats(b.supplyFlatVals || []);
    b.hourly_count = hr.cnt; b.avg_hourly = hr.avg; b.min_hourly = hr.min; b.max_hourly = hr.max;
    b.flat_count = fl.cnt; b.avg_flat = fl.avg; b.min_flat = fl.min; b.max_flat = fl.max;
    b.hiring_hourly_count = hHr.cnt; b.hiring_avg_hourly = hHr.avg; b.hiring_min_hourly = hHr.min; b.hiring_max_hourly = hHr.max;
    b.hiring_flat_count = hFl.cnt; b.hiring_avg_flat = hFl.avg; b.hiring_min_flat = hFl.min; b.hiring_max_flat = hFl.max;
    b.supply_hourly_count = sHr.cnt; b.supply_avg_hourly = sHr.avg; b.supply_min_hourly = sHr.min; b.supply_max_hourly = sHr.max;
    b.supply_flat_count = sFl.cnt; b.supply_avg_flat = sFl.avg; b.supply_min_flat = sFl.min; b.supply_max_flat = sFl.max;
    delete b.hrVals; delete b.flatVals;
    delete b.hiringHrVals; delete b.hiringFlatVals;
    delete b.supplyHrVals; delete b.supplyFlatVals;
    return b;
  };

  posts.forEach(p => {
    if (p.intent_type === "customer_hiring") hiring++;
    else if (p.intent_type === "diy_help_needed") diy++;
    else if (p.intent_type === "service_provider_ad") supply++;
    else if (p.intent_type === "job_posting") jobs++;
    if (p.intent_type === "irrelevant") return;

    const c = p.primary_category || "General Handyman & Odd Jobs";
    const sub = p.sub_service || "General Service";
    if (!catMap[c]) catMap[c] = { primary_category: c, hiring_count: 0, diy_count: 0, total_demand: 0, provider_supply: 0 };
    if (p.intent_type === "customer_hiring") { catMap[c].hiring_count++; catMap[c].total_demand++; }
    else if (p.intent_type === "diy_help_needed") { catMap[c].diy_count++; catMap[c].total_demand++; }
    else if (p.intent_type === "service_provider_ad") catMap[c].provider_supply++;

    if (!priceCatMap[c]) priceCatMap[c] = { primary_category: c, hrVals: [], flatVals: [], hiringHrVals: [], hiringFlatVals: [], supplyHrVals: [], supplyFlatVals: [] };
    addPrice(priceCatMap[c], p);

    const sk = `${c}|||${sub}`;
    if (!subMap[sk]) subMap[sk] = { primary_category: c, sub_service: sub, hiring_count: 0, diy_count: 0, total_demand: 0, provider_supply: 0, latest_posted_at: "", hrVals: [], flatVals: [], hiringHrVals: [], hiringFlatVals: [], supplyHrVals: [], supplyFlatVals: [] };
    if (p.intent_type === "customer_hiring") { subMap[sk].hiring_count++; subMap[sk].total_demand++; }
    else if (p.intent_type === "diy_help_needed") { subMap[sk].diy_count++; subMap[sk].total_demand++; }
    else if (p.intent_type === "service_provider_ad") subMap[sk].provider_supply++;
    if (p.posted_at && (!subMap[sk].latest_posted_at || p.posted_at > subMap[sk].latest_posted_at)) {
      subMap[sk].latest_posted_at = p.posted_at;
    }
    addPrice(subMap[sk], p);

    const r = p.city_region || "National / DIY Forums";
    if (!regMap[r]) regMap[r] = { city_region: r, province: p.province, country: p.country, hiring_count: 0, diy_count: 0, total_demand: 0, provider_supply: 0 };
    if (p.intent_type === "customer_hiring") { regMap[r].hiring_count++; regMap[r].total_demand++; }
    else if (p.intent_type === "diy_help_needed") { regMap[r].diy_count++; regMap[r].total_demand++; }
    else if (p.intent_type === "service_provider_ad") regMap[r].provider_supply++;

    if (p.intent_type === "customer_hiring" || p.intent_type === "diy_help_needed") {
      const ch = p.source_detail || p.platform;
      if (!chMap[ch]) chMap[ch] = { source_detail: ch, platform: p.platform, city_region: r, demand_count: 0, direct_hiring: 0 };
      chMap[ch].demand_count++;
      if (p.intent_type === "customer_hiring") chMap[ch].direct_hiring++;
    }

    const plat = p.platform || "other";
    if (!platMap[plat]) platMap[plat] = { platform: plat, hiring_count: 0, diy_count: 0, provider_supply: 0, total: 0 };
    if (p.intent_type === "customer_hiring") platMap[plat].hiring_count++;
    else if (p.intent_type === "diy_help_needed") platMap[plat].diy_count++;
    else if (p.intent_type === "service_provider_ad") platMap[plat].provider_supply++;
    platMap[plat].total++;
  });
  return {
    kpis: {
      total_posts: posts.length,
      total_demand_leads: hiring + diy,
      direct_hiring_leads: hiring,
      diy_conversion_leads: diy,
      competitor_supply_ads: supply,
      job_postings: jobs,
    },
    categories_list: snap.categories_list || Object.keys(WORK_TYPE_COLORS).filter(k => k !== "All Demand"),
    sub_services_map: snap.sub_services_map || {},
    category_breakdown: Object.values(catMap).sort((a, b) => b.total_demand - a.total_demand),
    sub_service_breakdown: Object.values(subMap).map(finalizePrice).sort((a, b) => b.total_demand - a.total_demand),
    pricing_by_category: Object.values(priceCatMap).map(finalizePrice),
    region_breakdown: Object.values(regMap).sort((a, b) => b.total_demand - a.total_demand),
    platform_breakdown: Object.values(platMap).sort((a, b) => b.total - a.total),
    top_channels: Object.values(chMap).sort((a, b) => b.direct_hiring - a.direct_hiring || b.demand_count - a.demand_count).slice(0, 12),
  };
}

function computeStaticTrends(snap, period, country, province, city_region, intent_type, date_from, date_to) {
  const cats = snap.categories_list || Object.keys(WORK_TYPE_COLORS).filter(k => k !== "All Demand");
  const allKeys = ["All Demand", ...cats];
  const demandPosts = (snap.posts || []).filter(p => {
    if (!intent_type || intent_type === "demand_only") {
      if (p.intent_type !== "customer_hiring" && p.intent_type !== "diy_help_needed") return false;
    } else if (intent_type === "hiring_and_supply") {
      if (p.intent_type !== "customer_hiring" && p.intent_type !== "service_provider_ad") return false;
    } else if (intent_type === "all") {
      if (p.intent_type === "irrelevant") return false;
    } else if (p.intent_type !== intent_type) {
      return false;
    }
    if (country && country !== "all" && p.country !== country) return false;
    if (province && province !== "all" && p.province !== province) return false;
    if (city_region && city_region !== "all" && p.city_region !== city_region) return false;
    return true;
  });

  const monthAbbr = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const todayStr = new Date().toISOString().slice(0, 10);
  let maxDateStr = "";
  let minDateStr = "";
  demandPosts.forEach(p => {
    const d = String(p.posted_at || "").slice(0, 10);
    if (d.length === 10) {
      if (!maxDateStr || d > maxDateStr) maxDateStr = d;
      if (!minDateStr || d < minDateStr) minDateStr = d;
    }
  });
  if (!maxDateStr) maxDateStr = todayStr;
  if (!minDateStr) minDateStr = maxDateStr;

  const maxDt = new Date(maxDateStr + "T00:00:00Z");
  const pNorm = (period || "1Y").toUpperCase();
  const buckets = [];
  const series = {};

  if (pNorm === "YTD" || pNorm === "SEASONALITY") {
    const endYear = maxDt.getUTCFullYear();
    const endMonth = maxDt.getUTCMonth() + 1;
    for (let m = 1; m <= endMonth; m++) buckets.push({ key: String(m).padStart(2, "0"), label: monthAbbr[m - 1] });
    allKeys.forEach(k => { series[k] = new Array(endMonth).fill(0); });
    demandPosts.forEach(p => {
      const yr = parseInt(String(p.posted_at || "").slice(0, 4), 10);
      const m = parseInt(String(p.posted_at || "").slice(5, 7), 10);
      if (yr === endYear && m >= 1 && m <= endMonth) {
        series["All Demand"][m - 1]++;
        if (series[p.primary_category]) series[p.primary_category][m - 1]++;
      }
    });
  } else if (pNorm === "CUSTOM") {
    let sStr = (date_from && date_from.length >= 10) ? date_from.slice(0, 10) : minDateStr;
    let eStr = (date_to && date_to.length >= 10) ? date_to.slice(0, 10) : todayStr;
    if (sStr > eStr) {
      const tmp = sStr;
      sStr = eStr;
      eStr = tmp;
    }
    const startDt = new Date(sStr + "T00:00:00Z");
    const endDt = new Date(eStr + "T00:00:00Z");
    const spanDays = Math.max(1, Math.floor((endDt.getTime() - startDt.getTime()) / 86400000) + 1);

    if (spanDays <= 45) {
      const keyIdx = {};
      for (let i = 0; i < spanDays; i++) {
        const d = new Date(startDt.getTime() + i * 86400000);
        const k = d.toISOString().slice(0, 10);
        keyIdx[k] = i;
        buckets.push({ key: k, label: `${monthAbbr[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")}` });
      }
      allKeys.forEach(k => { series[k] = new Array(spanDays).fill(0); });
      demandPosts.forEach(p => {
        const k = String(p.posted_at || "").slice(0, 10);
        if (keyIdx[k] !== undefined) {
          series["All Demand"][keyIdx[k]]++;
          if (series[p.primary_category]) series[p.primary_category][keyIdx[k]]++;
        }
      });
    } else if (spanDays <= 210) {
      const numWeeks = Math.max(1, Math.ceil(spanDays / 7));
      const startMs = startDt.getTime();
      const endMs = endDt.getTime();
      for (let w = 0; w < numWeeks; w++) {
        const wEndMs = Math.min(endMs, startMs + (w * 7 + 6) * 86400000);
        const wEnd = new Date(wEndMs);
        buckets.push({ key: wEnd.toISOString().slice(0, 10), label: `${monthAbbr[wEnd.getUTCMonth()]} ${String(wEnd.getUTCDate()).padStart(2, "0")}` });
      }
      allKeys.forEach(k => { series[k] = new Array(numWeeks).fill(0); });
      demandPosts.forEach(p => {
        const dStr = String(p.posted_at || "").slice(0, 10);
        if (dStr >= sStr && dStr <= eStr) {
          const dtMs = new Date(dStr + "T00:00:00Z").getTime();
          const wIdx = Math.min(numWeeks - 1, Math.floor((dtMs - startMs) / (7 * 86400000)));
          if (wIdx >= 0) {
            series["All Demand"][wIdx]++;
            if (series[p.primary_category]) series[p.primary_category][wIdx]++;
          }
        }
      });
    } else {
      let y = startDt.getUTCFullYear(), m = startDt.getUTCMonth() + 1;
      const endY = endDt.getUTCFullYear(), endM = endDt.getUTCMonth() + 1;
      const mList = [];
      while (y < endY || (y === endY && m <= endM)) {
        mList.push([y, m]);
        m++;
        if (m > 12) { m = 1; y++; }
      }
      const keyIdx = {};
      mList.forEach(([yy, mm], idx) => {
        const k = `${yy}-${String(mm).padStart(2, "0")}`;
        keyIdx[k] = idx;
        buckets.push({ key: k, label: `${monthAbbr[mm - 1]} '${String(yy).slice(2)}` });
      });
      allKeys.forEach(k => { series[k] = new Array(mList.length).fill(0); });
      demandPosts.forEach(p => {
        const dStr = String(p.posted_at || "").slice(0, 10);
        if (dStr >= sStr && dStr <= eStr) {
          const k = dStr.slice(0, 7);
          if (keyIdx[k] !== undefined) {
            series["All Demand"][keyIdx[k]]++;
            if (series[p.primary_category]) series[p.primary_category][keyIdx[k]]++;
          }
        }
      });
    }
  } else if (pNorm === "7D" || pNorm === "1M") {
    const nDays = pNorm === "7D" ? 7 : 30;
    const keyIdx = {};
    for (let i = 0; i < nDays; i++) {
      const d = new Date(maxDt.getTime() - (nDays - 1 - i) * 86400000);
      const k = d.toISOString().slice(0, 10);
      keyIdx[k] = i;
      buckets.push({ key: k, label: `${monthAbbr[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")}` });
    }
    allKeys.forEach(k => { series[k] = new Array(nDays).fill(0); });
    demandPosts.forEach(p => {
      const k = String(p.posted_at || "").slice(0, 10);
      if (keyIdx[k] !== undefined) {
        series["All Demand"][keyIdx[k]]++;
        if (series[p.primary_category]) series[p.primary_category][keyIdx[k]]++;
      }
    });
  } else if (pNorm === "3M" || pNorm === "6M") {
    const nWeeks = pNorm === "3M" ? 13 : 26;
    const startMs = maxDt.getTime() - (nWeeks * 7 - 1) * 86400000;
    for (let w = 0; w < nWeeks; w++) {
      const wEnd = new Date(startMs + (w * 7 + 6) * 86400000);
      buckets.push({ key: wEnd.toISOString().slice(0, 10), label: `${monthAbbr[wEnd.getUTCMonth()]} ${String(wEnd.getUTCDate()).padStart(2, "0")}` });
    }
    allKeys.forEach(k => { series[k] = new Array(nWeeks).fill(0); });
    demandPosts.forEach(p => {
      const dStr = String(p.posted_at || "").slice(0, 10);
      if (dStr.length === 10) {
        const dtMs = new Date(dStr + "T00:00:00Z").getTime();
        const deltaDays = Math.floor((dtMs - startMs) / 86400000);
        if (deltaDays >= 0 && deltaDays < nWeeks * 7) {
          const wIdx = Math.floor(deltaDays / 7);
          series["All Demand"][wIdx]++;
          if (series[p.primary_category]) series[p.primary_category][wIdx]++;
        }
      }
    });
  } else {
    const nMonths = pNorm === "1Y" ? 12 : 24;
    let y = maxDt.getUTCFullYear(), m = maxDt.getUTCMonth() + 1;
    const mList = [];
    for (let i = 0; i < nMonths; i++) {
      mList.push([y, m]);
      m--;
      if (m === 0) { m = 12; y--; }
    }
    mList.reverse();
    const keyIdx = {};
    mList.forEach(([yy, mm], idx) => {
      const k = `${yy}-${String(mm).padStart(2, "0")}`;
      keyIdx[k] = idx;
      buckets.push({ key: k, label: `${monthAbbr[mm - 1]} '${String(yy).slice(2)}` });
    });
    allKeys.forEach(k => { series[k] = new Array(nMonths).fill(0); });
    demandPosts.forEach(p => {
      const k = String(p.posted_at || "").slice(0, 7);
      if (keyIdx[k] !== undefined) {
        series["All Demand"][keyIdx[k]]++;
        if (series[p.primary_category]) series[p.primary_category][keyIdx[k]]++;
      }
    });
  }

  const totals = {};
  if (pNorm === "ALL") {
    allKeys.forEach(k => { totals[k] = 0; });
    demandPosts.forEach(p => {
      totals["All Demand"]++;
      if (totals[p.primary_category] !== undefined) totals[p.primary_category]++;
    });
  } else {
    allKeys.forEach(k => { totals[k] = (series[k] || []).reduce((a, b) => a + b, 0); });
  }
  return {
    period: pNorm,
    buckets,
    series,
    totals,
    categories: cats,
    min_date: minDateStr,
    max_date: todayStr,
    latest_month_label: monthAbbr[maxDt.getUTCMonth()],
  };
}

let localBridgeAvailable = null;

async function fetchWithTimeout(url, options = {}, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithFallback(url, fallbackFn) {
  if (isStaticHost()) {
    if (localBridgeAvailable !== false) {
      try {
        const resp = await fetchWithTimeout(`http://127.0.0.1:8765${url}`, {}, 900);
        const ctype = resp.headers.get("content-type") || "";
        if (!resp.ok || !ctype.includes("application/json")) throw new Error(`HTTP ${resp.status}`);
        localBridgeAvailable = true;
        return await resp.json();
      } catch (_e) {
        localBridgeAvailable = false;
      }
    }
    const snap = await ensureStaticSnapshot();
    return fallbackFn(snap);
  }

  try {
    const resp = await fetch(url);
    const ctype = resp.headers.get("content-type") || "";
    if (!resp.ok || !ctype.includes("application/json")) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (_e) {
    const snap = await ensureStaticSnapshot();
    return fallbackFn(snap);
  }
}

function getActiveDateBounds() {
  const presetEl = document.getElementById("filter-date-preset");
  const preset = presetEl ? presetEl.value : "all";
  if (preset === "custom") {
    const df = document.getElementById("filter-date-from");
    const dt = document.getElementById("filter-date-to");
    return {
      date_from: df ? df.value : "",
      date_to: dt ? dt.value : "",
    };
  }
  const dayMap = { "7d": 7, "30d": 30, "90d": 90, "6m": 182, "1y": 365 };
  if (dayMap[preset]) {
    const fromDt = new Date(Date.now() - dayMap[preset] * 86400000);
    return {
      date_from: fromDt.toISOString().slice(0, 10),
      date_to: "",
    };
  }
  return { date_from: "", date_to: "" };
}

async function onDatePresetChange() {
  const presetEl = document.getElementById("filter-date-preset");
  const preset = presetEl ? presetEl.value : "all";
  const customRow = document.getElementById("custom-date-row");
  if (customRow) {
    customRow.style.display = preset === "custom" ? "grid" : "none";
  }
  if (preset === "custom") {
    const df = document.getElementById("filter-date-from");
    const dt = document.getElementById("filter-date-to");
    const fallbackToday = new Date().toISOString().slice(0, 10);
    if (df && !df.value && trendData && trendData.min_date) df.value = trendData.min_date;
    if (dt && !dt.value) dt.value = (trendData && trendData.max_date) ? trendData.max_date : fallbackToday;
  }
  await loadPosts();
}

async function onCustomDateChange() {
  await loadPosts();
}

function getAnalyticsDateBounds() {
  const refStr = (trendData && trendData.max_date) || new Date().toISOString().slice(0, 10);
  const refDt = new Date(refStr + "T00:00:00Z");
  const pNorm = (currentTrendPeriod || "1Y").toUpperCase();

  if (pNorm === "7D") {
    return { date_from: new Date(refDt.getTime() - 6 * 86400000).toISOString().slice(0, 10), date_to: "" };
  }
  if (pNorm === "1M") {
    return { date_from: new Date(refDt.getTime() - 29 * 86400000).toISOString().slice(0, 10), date_to: "" };
  }
  if (pNorm === "3M") {
    return { date_from: new Date(refDt.getTime() - (13 * 7 - 1) * 86400000).toISOString().slice(0, 10), date_to: "" };
  }
  if (pNorm === "6M") {
    return { date_from: new Date(refDt.getTime() - (26 * 7 - 1) * 86400000).toISOString().slice(0, 10), date_to: "" };
  }
  if (pNorm === "1Y") {
    let y = refDt.getUTCFullYear();
    let m = refDt.getUTCMonth() + 1 - 11;
    if (m <= 0) { m += 12; y -= 1; }
    return { date_from: `${y}-${String(m).padStart(2, "0")}-01`, date_to: "" };
  }
  if (pNorm === "YTD" || pNorm === "SEASONALITY") {
    return { date_from: `${refDt.getUTCFullYear()}-01-01`, date_to: "" };
  }
  if (pNorm === "CUSTOM") {
    const tFromEl = document.getElementById("trend-date-from");
    const tToEl = document.getElementById("trend-date-to");
    return {
      date_from: tFromEl ? tFromEl.value : "",
      date_to: tToEl ? tToEl.value : "",
    };
  }
  return { date_from: "", date_to: "" };
}

function getAnalyticsTimeLabel() {
  const pNorm = (currentTrendPeriod || "1Y").toUpperCase();
  if (pNorm === "YTD" || pNorm === "SEASONALITY") {
    const mo = (trendData && trendData.latest_month_label) || "Nov";
    return `YTD (Jan-${mo})`;
  }
  if (pNorm === "CUSTOM") {
    const { date_from, date_to } = getAnalyticsDateBounds();
    if (date_from || date_to) return `${date_from || "..."} to ${date_to || "today"}`;
    return "Custom";
  }
  return pNorm;
}

async function refreshSummaryForGeo() {
  const { date_from, date_to } = getAnalyticsDateBounds();
  const paramsObj = { country: "all", province: "all", city_region: "all" };
  if (date_from) paramsObj.date_from = date_from;
  if (date_to) paramsObj.date_to = date_to;
  const qs = new URLSearchParams(paramsObj).toString();
  const [sumRes] = await Promise.all([
    fetchJsonWithFallback(`/api/summary?${qs}`, snap => computeStaticSummary(snap, "all", "all", "all", date_from, date_to)),
    loadTrends(),
  ]);
  summaryData = sumRes;
  renderKPIs(sumRes.kpis);
  renderPricingAndTaskBreakdown();
  renderDemandSupplyRatioChart();
  renderCategoryBars(sumRes.category_breakdown || []);
  renderRegionBars(sumRes.region_breakdown || [], sumRes.top_channels || []);
}

async function loadTrends() {
  const intent_type = analyticsIntent || "demand_only";
  const tFromEl = document.getElementById("trend-date-from");
  const tToEl = document.getElementById("trend-date-to");
  const date_from = (currentTrendPeriod === "CUSTOM" && tFromEl) ? tFromEl.value : "";
  const date_to = (currentTrendPeriod === "CUSTOM" && tToEl) ? tToEl.value : "";

  const paramsObj = {
    period: currentTrendPeriod,
    country: "all",
    province: "all",
    city_region: "all",
    intent_type,
  };
  if (date_from) paramsObj.date_from = date_from;
  if (date_to) paramsObj.date_to = date_to;
  const qs = new URLSearchParams(paramsObj).toString();

  trendData = await fetchJsonWithFallback(`/api/trends?${qs}`, snap =>
    computeStaticTrends(snap, currentTrendPeriod, "all", "all", "all", intent_type, date_from, date_to)
  );

  const ytdBtn = document.getElementById("ytd-period-btn");
  if (ytdBtn && trendData && trendData.latest_month_label) {
    ytdBtn.textContent = `YTD (Jan-${trendData.latest_month_label})`;
  }
  if (trendData && trendData.min_date) {
    if (tFromEl && !tFromEl.value) tFromEl.value = trendData.min_date;
    if (tToEl && !tToEl.value) tToEl.value = trendData.max_date || new Date().toISOString().slice(0, 10);
    const hintEl = document.getElementById("trend-custom-range-hint");
    if (hintEl) hintEl.textContent = `(Data available from ${trendData.min_date} to ${trendData.max_date || new Date().toISOString().slice(0, 10)})`;
  }

  renderTrendPills();
  renderTrendChart();
}

function setTrendMode(mode) {
  currentTrendMode = mode;
  document.querySelectorAll("#trend-mode-tabs .period-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-mode") === mode);
  });
  renderTrendChart();
}

function setTrendPeriod(period) {
  currentTrendPeriod = period;
  document.querySelectorAll("#trend-period-tabs .period-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-period") === period);
  });
  const customBar = document.getElementById("trend-custom-bar");
  if (customBar) {
    customBar.style.display = period === "CUSTOM" ? "flex" : "none";
  }
  if (period === "CUSTOM" && trendData && trendData.min_date) {
    const tFromEl = document.getElementById("trend-date-from");
    const tToEl = document.getElementById("trend-date-to");
    if (tFromEl && !tFromEl.value) tFromEl.value = trendData.min_date;
    if (tToEl && !tToEl.value) tToEl.value = trendData.max_date || new Date().toISOString().slice(0, 10);
  }
  refreshSummaryForGeo();
}

function onTrendCustomDateChange() {
  if (currentTrendPeriod === "CUSTOM") {
    refreshSummaryForGeo();
  }
}

function getAllWorkCategories() {
  return (trendData && trendData.categories && trendData.categories.length)
    ? trendData.categories
    : Object.keys(WORK_TYPE_COLORS).filter(k => k !== "All Demand");
}

function getAnalyticsCategorySelection() {
  const allCats = getAllWorkCategories();
  const selectedCats = allCats.filter(c => activeWorkTypes.has(c));
  return {
    allCats,
    selectedCats,
    isAllCats: allCats.length > 0 && selectedCats.length === allCats.length,
  };
}

function resetAnalyticsCategories() {
  activeWorkTypes = new Set(["All Demand", ...getAllWorkCategories()]);
  renderTrendPills();
  renderTrendChart();
  renderPricingAndTaskBreakdown();
  renderDemandSupplyRatioChart();
}

function toggleWorkTypePill(workType) {
  const allCats = getAllWorkCategories();
  if (workType === "All Demand") {
    const allSelected = allCats.every(c => activeWorkTypes.has(c));
    if (allSelected) {
      // Turn OFF everything
      activeWorkTypes.clear();
    } else {
      // Turn ON all job types
      activeWorkTypes.add("All Demand");
      allCats.forEach(c => activeWorkTypes.add(c));
    }
  } else {
    if (activeWorkTypes.has(workType)) {
      activeWorkTypes.delete(workType);
      activeWorkTypes.delete("All Demand");
    } else {
      activeWorkTypes.add(workType);
      if (allCats.every(c => activeWorkTypes.has(c))) {
        activeWorkTypes.add("All Demand");
      }
    }
  }
  renderTrendPills();
  renderTrendChart();
  renderPricingAndTaskBreakdown();
  renderDemandSupplyRatioChart();
}

function soloWorkType(workType, evt) {
  if (evt) evt.stopPropagation();
  const allCats = getAllWorkCategories();
  activeWorkTypes.clear();
  if (workType === "All Demand") {
    activeWorkTypes.add("All Demand");
    allCats.forEach(c => activeWorkTypes.add(c));
  } else {
    activeWorkTypes.add(workType);
  }
  renderTrendPills();
  renderTrendChart();
  renderPricingAndTaskBreakdown();
  renderDemandSupplyRatioChart();
}

function renderTrendPills() {
  const container = document.getElementById("trend-work-pills");
  if (!container || !trendData) return;
  const totals = trendData.totals || {};
  const allCats = getAllWorkCategories();
  const allSelected = allCats.every(c => activeWorkTypes.has(c));
  const keys = ["All Demand", ...allCats];

  const activeIntent = analyticsIntent || "demand_only";
  const intentLabels = {
    demand_only: "All Demand",
    customer_hiring: "All Direct Hiring",
    diy_help_needed: "All DIY Help",
    service_provider_ad: "All Provider Ads",
    hiring_and_supply: "All Hiring + Supply",
    job_posting: "All Job Postings",
    all: "All Posts",
  };
  const allPillLabel = intentLabels[activeIntent] || "All Demand";

  container.innerHTML = keys.map(k => {
    const isActive = k === "All Demand" ? allSelected : activeWorkTypes.has(k);
    const color = WORK_TYPE_COLORS[k] || "#60a5fa";
    const count = totals[k] || 0;
    const displayName = k === "All Demand" ? allPillLabel : k;
    const borderStyle = isActive ? `border-color:${color};box-shadow:0 0 0 1px ${color}40;` : "";
    const tip = k === "All Demand"
      ? "Click to toggle ALL trade categories on or off"
      : "Click to toggle this trade category on/off (double-click to solo)";
    return `
      <div class="work-pill ${isActive ? 'active' : ''}" style="${borderStyle}" data-wt="${esc(k)}" onclick="toggleWorkTypePill(this.dataset.wt)" ondblclick="soloWorkType(this.dataset.wt, event)" title="${tip}">
        <span class="work-pill-dot" style="background:${color};opacity:${isActive ? 1 : 0.35}"></span>
        <span>${esc(displayName)}</span>
        <span class="work-pill-count">${count}</span>
      </div>
    `;
  }).join("");
}

function renderTrendChart() {
  const svgWrap = document.getElementById("trend-svg-container");
  const statsEl = document.getElementById("trend-stats-summary");
  if (!svgWrap || !trendData) return;

  const buckets = trendData.buckets || [];
  const series = trendData.series || {};
  const activeKeys = [...activeWorkTypes].filter(k => k !== "All Demand" && Array.isArray(series[k]));

  if (!buckets.length || !activeKeys.length) {
    if (statsEl) {
      statsEl.innerHTML = `<span style="color:var(--muted);">All job types toggled off &mdash; click <strong>All Demand</strong> to turn all on, or click individual job types to compare</span>`;
    }
    svgWrap.innerHTML = `<div style="color:var(--muted);padding:64px 20px;text-align:center;border:1px dashed var(--border);border-radius:8px;">All job types are currently toggled off. Click <strong>All Demand</strong> to select all, or click any specific job type pill above to plot its demand trend.</div>`;
    return;
  }

  // Helper to get plotted value at bucket idx (either raw count or % share of bucket total)
  const allDemandVals = series["All Demand"] || [];
  const isShare = currentTrendMode === "share";
  const valAt = (k, idx) => {
    const raw = (series[k] || [])[idx] || 0;
    if (!isShare) return raw;
    const tot = allDemandVals[idx] || 0;
    return tot > 0 ? Math.round((raw / tot) * 1000) / 10 : 0;
  };

  // Compute period summary & peak bucket for the top active series
  const leadKey = activeKeys[0];
  const leadVals = series[leadKey] || [];
  const leadTotal = leadVals.reduce((a, b) => a + b, 0);
  let peakVal = -1;
  let peakLbl = "-";
  leadVals.forEach((_v, idx) => {
    const pv = valAt(leadKey, idx);
    if (pv > peakVal && buckets[idx]) {
      peakVal = pv;
      peakLbl = buckets[idx].label;
    }
  });

  if (statsEl) {
    const latestMo = (trendData && trendData.latest_month_label) ? trendData.latest_month_label : "Nov";
    const tFromVal = document.getElementById("trend-date-from")?.value || (trendData && trendData.min_date) || "";
    const tToVal = document.getElementById("trend-date-to")?.value || (trendData && trendData.max_date) || "";
    const modeLabel = (currentTrendPeriod === "YTD" || currentTrendPeriod === "SEASONALITY")
      ? `Year-to-Date (Jan - ${latestMo})`
      : currentTrendPeriod === "CUSTOM"
      ? `Custom (${tFromVal} to ${tToVal})`
      : `Timeframe: ${currentTrendPeriod}`;
    const peakUnit = isShare ? `${peakVal}% share` : `${peakVal} posts`;
    statsEl.innerHTML = `
      <span style="color:var(--text);font-weight:600;">${esc(modeLabel)}</span>
      &nbsp;&middot;&nbsp;
      <span>Showing <strong>${activeKeys.length}</strong> trade${activeKeys.length > 1 ? "s" : ""} (${isShare ? "% Share of Month" : "Post Count"})</span>
      &nbsp;&middot;&nbsp;
      <span>Peak for <strong style="color:${WORK_TYPE_COLORS[leadKey] || '#60a5fa'}">${esc(leadKey)}</strong>: <strong>${esc(peakLbl)}</strong> (${peakUnit}, ${leadTotal} total posts)</span>
    `;
  }

  const width = Math.max(640, svgWrap.clientWidth || 920);
  const height = 260;
  const padL = 46;
  const padR = 18;
  const padT = 16;
  const padB = 32;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  let maxY = isShare ? 20 : 4;
  activeKeys.forEach(k => {
    buckets.forEach((_b, idx) => {
      const v = valAt(k, idx);
      if (v > maxY) maxY = v;
    });
  });
  const ySteps = 4;
  const stepVal = Math.max(1, Math.ceil(maxY / ySteps));
  const yCeil = stepVal * ySteps;

  const xAt = idx => buckets.length <= 1 ? padL + plotW / 2 : padL + (idx / (buckets.length - 1)) * plotW;
  const yAt = val => padT + plotH - (val / yCeil) * plotH;

  // Grid lines & Y-axis labels
  let gridHtml = "";
  for (let i = 0; i <= ySteps; i++) {
    const v = i * stepVal;
    const y = yAt(v).toFixed(1);
    const yLbl = isShare ? `${v}%` : `${v}`;
    gridHtml += `
      <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="rgba(148,163,184,0.14)" stroke-dasharray="${i === 0 ? 'none' : '3,3'}" />
      <text x="${padL - 8}" y="${Number(y) + 4}" text-anchor="end" fill="#94a3b8" font-size="11">${yLbl}</text>
    `;
  }

  // X-axis labels (avoid crowding on 30-day / 26-week charts)
  const labelStride = Math.max(1, Math.ceil(buckets.length / 12));
  let xLabelsHtml = "";
  buckets.forEach((b, idx) => {
    if (idx % labelStride === 0 || idx === buckets.length - 1) {
      const x = xAt(idx).toFixed(1);
      xLabelsHtml += `<text x="${x}" y="${height - 8}" text-anchor="middle" fill="#94a3b8" font-size="11">${esc(b.label)}</text>`;
    }
  });

  // Defs & lines for each active work type
  let defsHtml = "";
  let pathsHtml = "";
  activeKeys.forEach((k, sIdx) => {
    const vals = buckets.map((_b, idx) => valAt(k, idx));
    const color = WORK_TYPE_COLORS[k] || "#60a5fa";
    const pts = vals.map((v, idx) => `${xAt(idx).toFixed(1)},${yAt(v).toFixed(1)}`);
    const gradId = `trendGrad_${sIdx}`;

    if (activeKeys.length <= 2) {
      defsHtml += `
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.26" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0.0" />
        </linearGradient>
      `;
      const areaPts = `${xAt(0).toFixed(1)},${(padT + plotH).toFixed(1)} ` + pts.join(" ") + ` ${xAt(vals.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)}`;
      pathsHtml += `<polygon points="${areaPts}" fill="url(#${gradId})" />`;
    }

    pathsHtml += `<polyline fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(" ")}" />`;
    vals.forEach((v, idx) => {
      const cx = xAt(idx).toFixed(1);
      const cy = yAt(v).toFixed(1);
      pathsHtml += `<circle cx="${cx}" cy="${cy}" r="3.2" fill="${color}" stroke="#0f172a" stroke-width="1.4" />`;
    });
  });

  svgWrap.innerHTML = `
    <svg id="trend-svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="overflow:visible;cursor:crosshair;"
         onmousemove="onTrendChartHover(event)" onmouseleave="hideTrendTooltip()">
      <defs>${defsHtml}</defs>
      ${gridHtml}
      ${xLabelsHtml}
      ${pathsHtml}
      <line id="trend-crosshair" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3,3" style="display:none;" />
    </svg>
  `;
}

function onTrendChartHover(evt) {
  if (!trendData || !trendData.buckets || !trendData.buckets.length) return;
  const svg = document.getElementById("trend-svg");
  const tooltip = document.getElementById("trend-tooltip");
  const cross = document.getElementById("trend-crosshair");
  const wrap = document.getElementById("trend-chart-wrap");
  if (!svg || !tooltip || !wrap) return;

  const rect = svg.getBoundingClientRect();
  const relX = evt.clientX - rect.left;
  const padL = 42;
  const padR = 18;
  const plotW = rect.width - padL - padR;
  const buckets = trendData.buckets;
  const ratio = Math.max(0, Math.min(1, (relX - padL) / Math.max(1, plotW)));
  const idx = Math.round(ratio * (buckets.length - 1));
  const bucket = buckets[idx];
  if (!bucket) return;

  const xPos = buckets.length <= 1 ? padL + plotW / 2 : padL + (idx / (buckets.length - 1)) * plotW;
  if (cross) {
    cross.setAttribute("x1", xPos.toFixed(1));
    cross.setAttribute("x2", xPos.toFixed(1));
    cross.style.display = "block";
  }

  const activeKeys = [...activeWorkTypes].filter(k => k !== "All Demand" && Array.isArray(trendData.series[k]));
  const allDemandAtIdx = ((trendData.series["All Demand"] || [])[idx]) || 0;
  const isShare = currentTrendMode === "share";
  const rows = activeKeys
    .map(k => {
      const raw = (trendData.series[k] || [])[idx] || 0;
      const pct = allDemandAtIdx > 0 ? Math.round((raw / allDemandAtIdx) * 1000) / 10 : 0;
      return { key: k, raw, pct, sortVal: isShare ? pct : raw, color: WORK_TYPE_COLORS[k] || "#60a5fa" };
    })
    .sort((a, b) => b.sortVal - a.sortVal);
  const bucketTotal = rows.reduce((s, r) => s + r.raw, 0);

  tooltip.innerHTML = `
    <div class="trend-tooltip-title">${esc(bucket.label)} &middot; ${bucketTotal} posts</div>
    ${rows.map(r => `
      <div class="trend-tooltip-row">
        <span style="display:inline-flex;align-items:center;gap:6px;">
          <span class="work-pill-dot" style="background:${r.color}"></span>
          <span>${esc(r.key)}</span>
        </span>
        <strong>${isShare ? `${r.pct}% (${r.raw})` : r.raw}</strong>
      </div>
    `).join("")}
  `;
  tooltip.style.display = "block";

  const wrapRect = wrap.getBoundingClientRect();
  let left = evt.clientX - wrapRect.left + 14;
  if (left + 210 > wrapRect.width) {
    left = evt.clientX - wrapRect.left - 210;
  }
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `42px`;
}

function hideTrendTooltip() {
  const tooltip = document.getElementById("trend-tooltip");
  const cross = document.getElementById("trend-crosshair");
  if (tooltip) tooltip.style.display = "none";
  if (cross) cross.style.display = "none";
}

async function loadDashboard() {
  const [sumRes, setRes, cSumRes] = await Promise.all([
    fetchJsonWithFallback("/api/summary", snap => computeStaticSummary(snap, "all", "all", "all")),
    fetchJsonWithFallback("/api/settings", snap => snap.settings || {}),
    fetchJsonWithFallback("/api/creators/summary", snap => computeStaticCreatorsSummary(snap)),
  ]);
  summaryData = sumRes;
  currentSettings = setRes;
  creatorsSummaryData = cSumRes;
  const countPill = document.getElementById("tab-creators-count");
  if (countPill && cSumRes && cSumRes.kpis) {
    countPill.textContent = cSumRes.kpis.total_creators || 0;
  }

  populateFilterDropdowns(sumRes);
  await refreshSummaryForGeo();
  await loadPosts();
  if (activeMainTab === "creators") {
    renderCreatorsKPIs(cSumRes.kpis || {});
    renderCreatorsCategoryChart(cSumRes.category_breakdown || []);
    await loadCreators();
  }
}

function renderKPIs(kpis) {
  document.getElementById("kpi-total-demand").textContent = kpis.total_demand_leads || 0;
  document.getElementById("kpi-hiring").textContent = kpis.direct_hiring_leads || 0;
  document.getElementById("kpi-diy").textContent = kpis.diy_conversion_leads || 0;
  document.getElementById("kpi-supply").textContent = kpis.competitor_supply_ads || 0;
  document.getElementById("kpi-jobs").textContent = kpis.job_postings || 0;
}

function setPricingSourceFilter(source) {
  selectedPricingSource = source || "all";
  document.querySelectorAll("#pricing-source-tabs .period-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-source") === selectedPricingSource);
  });
  renderPricingAndTaskBreakdown();
}

function formatOpportunityBadge(demandCount, supplyCount) {
  const d = Number(demandCount || 0);
  const s = Number(supplyCount || 0);
  if (d === 0 && s === 0) {
    return `<span style="color:var(--muted);">—</span>`;
  }
  if (s === 0 && d > 0) {
    return `<span class="opp-badge opp-underserved" title="${d} demand posts vs 0 supply ads">${d} : 0 &middot; Underserved</span>`;
  }
  if (d === 0 && s > 0) {
    return `<span class="opp-badge opp-crowded" title="0 demand posts vs ${s} supply ads">0 : ${s} &middot; Supply Heavy</span>`;
  }
  const ratio = (d / s);
  const ratioStr = ratio >= 10 ? `${Math.round(ratio)}:1` : `${ratio.toFixed(1)}:1`;
  if (ratio >= 1.8) {
    return `<span class="opp-badge opp-underserved" title="${d} demand vs ${s} supply ads (${ratioStr})">${ratioStr} &middot; High Demand</span>`;
  }
  if (ratio >= 0.8) {
    return `<span class="opp-badge opp-balanced" title="${d} demand vs ${s} supply ads (${ratioStr})">${ratioStr} &middot; Balanced</span>`;
  }
  return `<span class="opp-badge opp-crowded" title="${d} demand vs ${s} supply ads (${ratioStr})">${ratioStr} &middot; Crowded</span>`;
}

function togglePricingColSort(colKey) {
  if (colKey === "task" || colKey === "trade") {
    selectedPricingSort = selectedPricingSort === "task_asc" ? "task_desc" : "task_asc";
  } else {
    const descKey = `${colKey}_desc`;
    const ascKey = `${colKey}_asc`;
    selectedPricingSort = selectedPricingSort === descKey ? ascKey : descKey;
  }
  renderPricingAndTaskBreakdown();
}

function renderPricingAndTaskBreakdown() {
  const container = document.getElementById("pricing-task-chart");
  if (!container || !summaryData) return;

  const subList = summaryData.sub_service_breakdown || [];
  const subMap = summaryData.sub_services_map || {};

  // Build complete Task Category list so every defined task category for a trade (or all trades) appears
  const existingKeyMap = {};
  subList.forEach(s => {
    existingKeyMap[`${s.primary_category}||${s.sub_service}`] = s;
  });

  const allTaskRows = [...subList];
  Object.entries(subMap).forEach(([cat, taskNames]) => {
    (taskNames || []).forEach(taskName => {
      const k = `${cat}||${taskName}`;
      if (!existingKeyMap[k]) {
        allTaskRows.push({
          primary_category: cat,
          sub_service: taskName,
          total_demand: 0,
          hiring_count: 0,
          diy_count: 0,
          provider_supply: 0,
          latest_posted_at: "",
          hourly_count: 0,
          avg_hourly: null,
          min_hourly: null,
          max_hourly: null,
          flat_count: 0,
          avg_flat: null,
          min_flat: null,
          max_flat: null,
        });
      }
    });
  });

  const pickHr = r => {
    if (selectedPricingSource === "hiring") {
      return { avg: r.hiring_avg_hourly, min: r.hiring_min_hourly, max: r.hiring_max_hourly, cnt: r.hiring_hourly_count || 0 };
    }
    if (selectedPricingSource === "supply") {
      return { avg: r.supply_avg_hourly, min: r.supply_min_hourly, max: r.supply_max_hourly, cnt: r.supply_hourly_count || 0 };
    }
    return { avg: r.avg_hourly, min: r.min_hourly, max: r.max_hourly, cnt: r.hourly_count || 0 };
  };

  const pickFlat = r => {
    if (selectedPricingSource === "hiring") {
      return { avg: r.hiring_avg_flat, min: r.hiring_min_flat, max: r.hiring_max_flat, cnt: r.hiring_flat_count || 0 };
    }
    if (selectedPricingSource === "supply") {
      return { avg: r.supply_avg_flat, min: r.supply_min_flat, max: r.supply_max_flat, cnt: r.supply_flat_count || 0 };
    }
    return { avg: r.avg_flat, min: r.min_flat, max: r.max_flat, cnt: r.flat_count || 0 };
  };

  const getVol = r => {
    if (selectedPricingSource === "hiring") return r.hiring_count || 0;
    if (selectedPricingSource === "supply") return r.provider_supply || 0;
    return r.total_demand || 0;
  };

  const ratioVal = r => ((r.total_demand || 0) + 0.5) / ((r.provider_supply || 0) + 0.5);

  allTaskRows.sort((a, b) => {
    switch (selectedPricingSort) {
      case "demand_asc":
        return getVol(a) - getVol(b) || String(a.sub_service || "").localeCompare(String(b.sub_service || ""));
      case "task_asc":
        return String(a.sub_service || "").localeCompare(String(b.sub_service || ""));
      case "task_desc":
        return String(b.sub_service || "").localeCompare(String(a.sub_service || ""));
      case "trade_asc":
        return String(a.primary_category || "").localeCompare(String(b.primary_category || ""))
          || String(a.sub_service || "").localeCompare(String(b.sub_service || ""));
      case "hourly_desc":
      case "hourly_asc": {
        const va = pickHr(a).avg || 0;
        const vb = pickHr(b).avg || 0;
        if (!va && !vb) return getVol(b) - getVol(a);
        if (!va) return 1;
        if (!vb) return -1;
        return selectedPricingSort === "hourly_desc" ? vb - va : va - vb;
      }
      case "flat_desc":
      case "flat_asc": {
        const va = pickFlat(a).avg || 0;
        const vb = pickFlat(b).avg || 0;
        if (!va && !vb) return getVol(b) - getVol(a);
        if (!va) return 1;
        if (!vb) return -1;
        return selectedPricingSort === "flat_desc" ? vb - va : va - vb;
      }
      case "ratio_desc":
      case "ratio_asc": {
        const aEmpty = !(a.total_demand || a.provider_supply);
        const bEmpty = !(b.total_demand || b.provider_supply);
        if (aEmpty && !bEmpty) return 1;
        if (!aEmpty && bEmpty) return -1;
        return selectedPricingSort === "ratio_desc"
          ? ratioVal(b) - ratioVal(a)
          : ratioVal(a) - ratioVal(b);
      }
      case "date_desc":
      case "date_asc": {
        const da = String(a.latest_posted_at || "");
        const db = String(b.latest_posted_at || "");
        if (!da && !db) return getVol(b) - getVol(a);
        if (!da) return 1;
        if (!db) return -1;
        return selectedPricingSort === "date_desc" ? db.localeCompare(da) : da.localeCompare(db);
      }
      case "demand_desc":
      default:
        return getVol(b) - getVol(a) || (b.provider_supply || 0) - (a.provider_supply || 0);
    }
  });

  const fmtHr = r => {
    const p = pickHr(r);
    if (!p.avg) return `<span style="color:var(--muted);">—</span>`;
    const range = p.min && p.max && p.min !== p.max
      ? `<span class="price-range-sub">($${p.min}–$${p.max}/hr · ${p.cnt})</span>`
      : `<span class="price-range-sub">(${p.cnt} post${p.cnt > 1 ? "s" : ""})</span>`;
    return `<span class="price-pill">$${p.avg}/hr avg</span>${range}`;
  };

  const fmtFlat = r => {
    const p = pickFlat(r);
    if (!p.avg) return `<span style="color:var(--muted);">—</span>`;
    const range = p.min && p.max && p.min !== p.max
      ? `<span class="price-range-sub">($${p.min}–$${p.max} · ${p.cnt})</span>`
      : `<span class="price-range-sub">(${p.cnt} post${p.cnt > 1 ? "s" : ""})</span>`;
    return `<span class="price-pill price-pill-flat">$${p.avg} avg</span>${range}`;
  };

  const arrowFor = keys => {
    if (keys.includes(selectedPricingSort)) {
      return selectedPricingSort.endsWith("_asc")
        ? ` <span style="color:#60a5fa;">&#9650;</span>`
        : ` <span style="color:#60a5fa;">&#9660;</span>`;
    }
    return ` <span style="opacity:0.35;font-size:0.65rem;">&#8693;</span>`;
  };

  const { selectedCats, isAllCats } = getAnalyticsCategorySelection();
  const tasks = isAllCats
    ? allTaskRows
    : allTaskRows.filter(s => activeWorkTypes.has(s.primary_category));

  const rowsHtml = tasks.map(t => {
    const dt = (t.latest_posted_at || "").slice(0, 10) || "—";
    return `
    <tr data-cat="${esc(t.primary_category)}" data-sub="${esc(t.sub_service)}" onclick="filterBySubService(this.dataset.cat, this.dataset.sub)" title="Click to filter Table 2 leads to this Task Category">
      <td>
        <div style="font-weight:600;color:#93c5fd;">${esc(t.sub_service)}</div>
        <div style="font-size:0.74rem;color:var(--muted);">${esc(t.primary_category)}</div>
      </td>
      <td>
        <span style="color:#34d399;font-weight:600;">${t.hiring_count || 0} Hiring</span> &middot;
        <span style="color:#fbbf24;">${t.diy_count || 0} DIY</span> &middot;
        <span style="color:#c084fc;">${t.provider_supply || 0} Supply</span>
      </td>
      <td>${formatOpportunityBadge(t.total_demand, t.provider_supply)}</td>
      <td>${fmtHr(t)}</td>
      <td>${fmtFlat(t)}</td>
      <td style="font-size:0.78rem;color:var(--muted);white-space:nowrap;">${esc(dt)}</td>
      <td style="text-align:right;">
        <button class="secondary" style="padding:4px 10px;font-size:0.76rem;">Filter Posts</button>
      </td>
    </tr>
  `;
  }).join("");

  const sourceLabel = selectedPricingSource === "hiring"
    ? "Customer Hiring Budgets Only"
    : selectedPricingSource === "supply"
    ? "Contractor Supply Ad Rates Only"
    : "All Service Pricing (Hiring + Supply Ads)";

  const tradeLabel = isAllCats
    ? `All Task Categories (${tasks.length})`
    : selectedCats.length === 1
    ? `${tasks.length} Task Categories in ${selectedCats[0]}`
    : `${tasks.length} Task Categories across ${selectedCats.length} Trade Categories`;

  const headerSubtitle = `Showing <strong>${esc(tradeLabel)}</strong> &middot; Timeframe: <strong>${esc(getAnalyticsTimeLabel())}</strong> &middot; Pricing Source: <strong>${sourceLabel}</strong>`;

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
      <div style="font-size:0.84rem;color:var(--text-secondary);">
        ${headerSubtitle}
      </div>
      ${!isAllCats ? `<button class="secondary" style="padding:5px 11px;font-size:0.78rem;" onclick="resetAnalyticsCategories()">Show All Trade Categories</button>` : ""}
    </div>
    <div class="table-wrap" style="max-height:420px;overflow-y:auto;">
      <table class="pricing-table">
        <thead>
          <tr>
            <th style="cursor:pointer;user-select:none;" onclick="togglePricingColSort('task')">Task Category &amp; Trade${arrowFor(['task_asc', 'task_desc', 'trade_asc'])}</th>
            <th style="cursor:pointer;user-select:none;" onclick="togglePricingColSort('demand')">Demand &amp; Supply Volume${arrowFor(['demand_desc', 'demand_asc'])}</th>
            <th style="cursor:pointer;user-select:none;" onclick="togglePricingColSort('ratio')">Demand : Supply Ratio${arrowFor(['ratio_desc', 'ratio_asc'])}</th>
            <th style="cursor:pointer;user-select:none;" onclick="togglePricingColSort('hourly')">Hourly Cost ($/hr)${arrowFor(['hourly_desc', 'hourly_asc'])}</th>
            <th style="cursor:pointer;user-select:none;" onclick="togglePricingColSort('flat')">Flat Fee ($)${arrowFor(['flat_desc', 'flat_asc'])}</th>
            <th style="cursor:pointer;user-select:none;" onclick="togglePricingColSort('date')">Latest Date${arrowFor(['date_desc', 'date_asc'])}</th>
            <th style="text-align:right;">Action</th>
          </tr>
        </thead>
        <tbody>${rowsHtml || `<tr><td colspan="7" style="text-align:center;color:var(--muted);">No trade categories selected in Chart 1 above.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function setRatioViewLevel(level) {
  ratioViewLevel = level || "task";
  document.querySelectorAll("#ratio-level-tabs .period-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-level") === ratioViewLevel);
  });
  renderDemandSupplyRatioChart();
}

function setRatioDemandType(dtype) {
  ratioDemandType = dtype || "total";
  document.querySelectorAll("#ratio-demand-tabs .period-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-dtype") === ratioDemandType);
  });
  renderDemandSupplyRatioChart();
}

function renderDemandSupplyRatioChart() {
  const container = document.getElementById("demand-supply-ratio-chart");
  if (!container || !summaryData) return;

  const isHiringOnly = ratioDemandType === "hiring";
  const demandLabel = isHiringOnly ? "Direct Hiring" : "Total Demand (Hiring + DIY)";

  const { isAllCats } = getAnalyticsCategorySelection();
  let items = [];
  if (ratioViewLevel === "trade") {
    const rawCats = summaryData.category_breakdown || [];
    const filteredCats = isAllCats ? rawCats : rawCats.filter(c => activeWorkTypes.has(c.primary_category));
    items = filteredCats.map(c => ({
      title: c.primary_category,
      subtitle: `${c.hiring_count || 0} Hiring · ${c.diy_count || 0} DIY`,
      primary_category: c.primary_category,
      sub_service: null,
      demand: isHiringOnly ? (c.hiring_count || 0) : (c.total_demand || 0),
      supply: c.provider_supply || 0,
    }));
  } else {
    const rawSubs = summaryData.sub_service_breakdown || [];
    const filteredSubs = isAllCats
      ? rawSubs
      : rawSubs.filter(s => activeWorkTypes.has(s.primary_category));
    items = filteredSubs.map(s => ({
      title: s.sub_service,
      subtitle: s.primary_category,
      primary_category: s.primary_category,
      sub_service: s.sub_service,
      demand: isHiringOnly ? (s.hiring_count || 0) : (s.total_demand || 0),
      supply: s.provider_supply || 0,
    }));
  }

  // Filter out empty items and sort by highest opportunity (Demand - Supply gap & ratio)
  items = items.filter(it => it.demand > 0 || it.supply > 0);
  items.sort((a, b) => {
    const scoreA = (a.demand + 1) / (a.supply + 1) * Math.log2(a.demand + 2);
    const scoreB = (b.demand + 1) / (b.supply + 1) * Math.log2(b.demand + 2);
    return scoreB - scoreA;
  });

  const displayItems = ratioViewLevel === "task" && isAllCats
    ? items.slice(0, 14)
    : items;

  if (!displayItems.length) {
    container.innerHTML = `<p style="color:var(--muted);">No demand or supply data for the active Chart 1 timeframe and trade categories.${!isAllCats ? ` <button class="secondary" style="margin-left:8px;padding:4px 10px;font-size:0.78rem;" onclick="resetAnalyticsCategories()">Show All Trade Categories</button>` : ""}</p>`;
    return;
  }

  const rowsHtml = displayItems.map(it => {
    const total = Math.max(1, it.demand + it.supply);
    const demandPct = Math.round((it.demand / total) * 100);
    const supplyPct = 100 - demandPct;
    const clickAttr = it.sub_service
      ? `data-cat="${esc(it.primary_category)}" data-sub="${esc(it.sub_service)}" onclick="filterBySubService(this.dataset.cat, this.dataset.sub)"`
      : `data-cat="${esc(it.primary_category)}" onclick="filterByCategory(this.dataset.cat)"`;

    return `
      <div class="ratio-row" ${clickAttr} title="Click to filter leads to ${esc(it.title)}">
        <div class="ratio-row-top">
          <div>
            <span style="font-weight:600;color:var(--text);font-size:0.86rem;">${esc(it.title)}</span>
            <span style="font-size:0.75rem;color:var(--muted);margin-left:8px;">${esc(it.subtitle)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span style="font-size:0.77rem;">
              <strong style="color:#34d399;">${it.demand} ${demandLabel}</strong>
              <span style="color:var(--muted);"> vs </span>
              <strong style="color:#c084fc;">${it.supply} Supply Ads</strong>
              <span style="color:var(--muted);margin-left:4px;">(${demandPct}% / ${supplyPct}%)</span>
            </span>
            ${formatOpportunityBadge(it.demand, it.supply)}
          </div>
        </div>
        <div class="ratio-bar-track">
          <div class="ratio-fill-demand" style="width:${demandPct}%"></div>
          <div class="ratio-fill-supply" style="width:${supplyPct}%"></div>
          <div class="ratio-midline" title="1:1 Balance Line (50% Demand / 50% Supply)"></div>
        </div>
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;font-size:0.79rem;color:var(--muted);">
      <div>
        <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#34d399;margin-right:5px;vertical-align:middle;"></span>
        <strong style="color:#34d399;">Customer Demand (${demandLabel})</strong>
        <span style="margin:0 10px;">|</span>
        <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#c084fc;margin-right:5px;vertical-align:middle;"></span>
        <strong style="color:#c084fc;">Contractor Supply Ads (Plumbers / Pros Offering Services)</strong>
      </div>
      <div>White center line = <strong>1:1 Ratio (50% / 50%)</strong> &middot; Green past center = <strong>Underserved</strong></div>
    </div>
    <div style="max-height:420px;overflow-y:auto;padding-right:4px;">
      ${rowsHtml}
    </div>
  `;
}

function renderCategoryBars(cats) {
  const container = document.getElementById("category-chart");
  if (!cats.length) {
    container.innerHTML = `<p style="color:var(--muted)">No categorized posts yet.</p>`;
    return;
  }
  const maxVal = Math.max(1, ...cats.map(c => (c.total_demand || 0) + (c.provider_supply || 0)));

  container.innerHTML = cats.map(c => {
    const hiringPct = ((c.hiring_count || 0) / maxVal) * 100;
    const diyPct = ((c.diy_count || 0) / maxVal) * 100;
    const supPct = ((c.provider_supply || 0) / maxVal) * 100;
    return `
      <div class="bar-row" style="cursor:pointer" data-cat="${esc(c.primary_category)}" onclick="filterByCategory(this.dataset.cat)">
        <div class="bar-label">
          <strong>${esc(c.primary_category)}</strong>
          <span style="color:var(--muted)">
            <span style="color:#34d399">${c.hiring_count} Hiring</span> ·
            <span style="color:#fbbf24">${c.diy_count} DIY</span> ·
            <span style="color:#c084fc">${c.provider_supply} Supply</span>
          </span>
        </div>
        <div class="bar-track">
          <div class="bar-fill-hiring" style="width:${hiringPct}%"></div>
          <div class="bar-fill-diy" style="width:${diyPct}%"></div>
          <div class="bar-fill-supply" style="width:${supPct}%"></div>
        </div>
      </div>
    `;
  }).join("");
}

function renderRegionBars(regions, channels) {
  cachedRegionsList = regions || [];
  cachedChannelsList = channels || [];
  regionPage = 1;
  renderRegionPage();
}

function goToRegionPage(page) {
  const totalPages = Math.max(1, Math.ceil(cachedRegionsList.length / REGION_PAGE_SIZE));
  regionPage = Math.max(1, Math.min(totalPages, page));
  renderRegionPage();
}

function filterByPlatform(plat) {
  const platSel = document.getElementById("filter-platform");
  if (platSel) platSel.value = plat || "all";
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
  switchTab("leads");
  loadPosts();
}

function renderRegionPage() {
  const regEl = document.getElementById("region-chart");
  const pagEl = document.getElementById("region-pagination");
  if (!regEl) return;

  if (!cachedRegionsList.length) {
    regEl.innerHTML = `<p style="color:var(--muted)">No regional data yet.</p>`;
    if (pagEl) pagEl.innerHTML = "";
  } else {
    const maxReg = Math.max(1, ...cachedRegionsList.map(r => (r.total_demand || 0) + (r.provider_supply || 0)));
    const totalPages = Math.max(1, Math.ceil(cachedRegionsList.length / REGION_PAGE_SIZE));
    if (regionPage > totalPages) regionPage = totalPages;

    const startIdx = (regionPage - 1) * REGION_PAGE_SIZE;
    const endIdx = Math.min(startIdx + REGION_PAGE_SIZE, cachedRegionsList.length);
    const pageItems = cachedRegionsList.slice(startIdx, endIdx);

    regEl.innerHTML = pageItems.map(r => {
      const hiringPct = ((r.hiring_count || 0) / maxReg) * 100;
      const diyPct = ((r.diy_count || 0) / maxReg) * 100;
      const supPct = ((r.provider_supply || 0) / maxReg) * 100;
      const displayName = r.city_region === "National / DIY Forums" ? "National / Online Platforms" : r.city_region;
      return `
        <div class="bar-row" style="cursor:pointer" data-reg="${esc(r.city_region)}" onclick="filterByRegion(this.dataset.reg)">
          <div class="bar-label">
            <strong>${esc(displayName)}</strong>
            <span style="color:var(--muted)">
              <span style="color:#34d399">${r.hiring_count} Hiring</span> ·
              <span style="color:#fbbf24">${r.diy_count} DIY</span> ·
              <span style="color:#c084fc">${r.provider_supply} Supply</span>
            </span>
          </div>
          <div class="bar-track">
            <div class="bar-fill-hiring" style="width:${hiringPct}%"></div>
            <div class="bar-fill-diy" style="width:${diyPct}%"></div>
            <div class="bar-fill-supply" style="width:${supPct}%"></div>
          </div>
        </div>
      `;
    }).join("");

    if (pagEl) {
      if (cachedRegionsList.length > REGION_PAGE_SIZE) {
        pagEl.innerHTML = `
          <span>Showing ${startIdx + 1}-${endIdx} of ${cachedRegionsList.length} locations</span>
          <div class="page-controls">
            <button class="page-btn" onclick="goToRegionPage(${regionPage - 1})" ${regionPage <= 1 ? "disabled" : ""}>Prev</button>
            <span style="padding:0 6px;font-weight:600;color:var(--text-secondary);">${regionPage} / ${totalPages}</span>
            <button class="page-btn" onclick="goToRegionPage(${regionPage + 1})" ${regionPage >= totalPages ? "disabled" : ""}>Next</button>
          </div>
        `;
      } else {
        pagEl.innerHTML = "";
      }
    }
  }

  const chEl = document.getElementById("top-channels-list");
  if (chEl) {
    const platNames = { reddit: "Reddit", craigslist: "Craigslist", kijiji: "Kijiji", "51ca": "51.ca", bark: "Bark.com", stackexchange: "StackExchange" };
    const platClasses = { reddit: "b-reddit", craigslist: "b-craigslist", kijiji: "b-kijiji", "51ca": "b-51ca", bark: "b-bark", stackexchange: "b-stackexchange" };
    const platforms = (summaryData && summaryData.platform_breakdown) ? summaryData.platform_breakdown : [];
    const platHtml = [...platforms]
      .sort((a, b) => (b.total || 0) - (a.total || 0))
      .map(pl => {
        const key = String(pl.platform || "").toLowerCase();
        const label = platNames[key] || pl.platform;
        const cls = platClasses[key] || "b-cat";
        return `
          <span class="badge ${cls}" style="cursor:pointer;margin:3px 5px 3px 0;padding:5px 10px;" data-plat="${esc(pl.platform)}" onclick="filterByPlatform(this.dataset.plat)" title="Filter leads table to ${esc(label)}">
            ${esc(label)}: ${pl.total || 0}
          </span>
        `;
      }).join("");
    const channelsHtml = cachedChannelsList.slice(0, 6).map(ch => `
      <span class="badge b-cat" style="margin:3px 4px 3px 0; padding:5px 10px;">
        ${esc(ch.source_detail)}: ${ch.demand_count}
      </span>
    `).join("");
    chEl.innerHTML = (platHtml ? `<div style="margin-bottom:6px;">${platHtml}</div>` : "") + channelsHtml;
  }
}

function populateFilterDropdowns(sumRes) {
  const cats = [...(sumRes.categories_list || [])].sort((a, b) => a.localeCompare(b));
  ["filter-category", "creator-category"].forEach(selId => {
    const catSel = document.getElementById(selId);
    if (!catSel) return;
    const currentCat = catSel.value || "all";
    catSel.innerHTML = `<option value="all">All Trade Categories</option>` +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    catSel.value = currentCat;
  });

  updateSubServiceOptions();
  updateCreatorSubServiceOptions();
  updateProvinceAndCityOptions();
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
}

function _fillSubServiceSelect(catSelectId, subSelectId) {
  const subSel = document.getElementById(subSelectId);
  const catEl = document.getElementById(catSelectId);
  if (!subSel || !catEl) return;
  const cat = catEl.value || "all";
  const prevSub = subSel.value || "all";
  const subMap = (summaryData && summaryData.sub_services_map) ? summaryData.sub_services_map : {};

  let tasks = [];
  if (cat !== "all" && Array.isArray(subMap[cat])) {
    tasks = [...subMap[cat]];
  } else {
    Object.values(subMap).forEach(arr => {
      (arr || []).forEach(t => {
        if (!tasks.includes(t)) tasks.push(t);
      });
    });
  }
  tasks.sort((a, b) => a.localeCompare(b));

  const label = cat !== "all" ? `All Task Categories in ${cat}` : "All Task Categories";
  subSel.innerHTML = `<option value="all">${esc(label)}</option>` +
    tasks.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  subSel.value = tasks.includes(prevSub) ? prevSub : "all";
  if (typeof syncSearchableSelect === "function") syncSearchableSelect(subSelectId);
}

function updateSubServiceOptions() {
  _fillSubServiceSelect("filter-category", "filter-sub-service");
}

function updateCreatorSubServiceOptions() {
  _fillSubServiceSelect("creator-category", "creator-sub-service");
}

function updateProvinceAndCityOptions() {
  const country = document.getElementById("filter-country").value || "all";
  const provSel = document.getElementById("filter-province");
  const regSel = document.getElementById("filter-region");
  const prevProv = provSel.value || "all";
  const prevCity = regSel.value || "all";

  const allRegions = (currentSettings && currentSettings.regions) ? currentSettings.regions : [];
  const caProvs = [...new Set(allRegions.filter(r => r.country === "Canada" && r.province).map(r => r.province))]
    .sort((a, b) => a.localeCompare(b));
  const usStates = [...new Set(allRegions.filter(r => r.country === "United States" && r.province).map(r => r.province))]
    .sort((a, b) => a.localeCompare(b));

  let provOptionsHtml = "";
  let validProvs = [];
  if (country === "Canada") {
    validProvs = caProvs;
    provOptionsHtml = `<option value="all">All Canadian Provinces</option>` +
      caProvs.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
  } else if (country === "United States") {
    validProvs = usStates;
    provOptionsHtml = `<option value="all">All US States</option>` +
      usStates.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
  } else {
    validProvs = [...caProvs, ...usStates];
    provOptionsHtml = `<option value="all">All Provinces / States</option>` +
      `<option disabled value="__sep_ca__">── Canadian Provinces ──</option>` +
      caProvs.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("") +
      `<option disabled value="__sep_us__">── US States ──</option>` +
      usStates.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
  }

  provSel.innerHTML = provOptionsHtml;
  provSel.value = validProvs.includes(prevProv) ? prevProv : "all";

  const activeProv = provSel.value;
  if (activeProv === "all") {
    regSel.innerHTML = `<option value="all">Select a Province / State first</option>`;
    regSel.value = "all";
  } else {
    const matchingCityRegs = allRegions.filter(
      r => (country === "all" || country === "National" || r.country === country) && r.province === activeProv
    );
    const cities = [...new Set(matchingCityRegs.map(r => r.name))].sort((a, b) => a.localeCompare(b));
    regSel.innerHTML = `<option value="all">${esc(`All in ${activeProv}`)}</option>` +
      cities.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    regSel.value = cities.includes(prevCity) ? prevCity : "all";
  }
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
}

async function onCountryChange() {
  document.getElementById("filter-province").value = "all";
  document.getElementById("filter-region").value = "all";
  updateProvinceAndCityOptions();
  await loadPosts();
}

async function onProvinceChange() {
  document.getElementById("filter-region").value = "all";
  updateProvinceAndCityOptions();
  await loadPosts();
}

async function onCityChange() {
  await loadPosts();
}

function onCategoryDropdownChange() {
  const subSel = document.getElementById("filter-sub-service");
  if (subSel) subSel.value = "all";
  updateSubServiceOptions();
  loadPosts();
}

function filterByCategory(cat) {
  document.getElementById("filter-category").value = cat;
  const subSel = document.getElementById("filter-sub-service");
  if (subSel) subSel.value = "all";
  updateSubServiceOptions();
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
  switchTab("leads");
  loadPosts();
}

function filterBySubService(cat, sub) {
  document.getElementById("filter-category").value = cat;
  updateSubServiceOptions();
  const subSel = document.getElementById("filter-sub-service");
  if (subSel) subSel.value = sub;
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
  switchTab("leads");
  loadPosts();
}

async function filterByRegion(reg) {
  const allRegions = (currentSettings && currentSettings.regions) ? currentSettings.regions : [];
  const match = allRegions.find(r => r.name === reg);
  if (match) {
    document.getElementById("filter-country").value = match.country || "all";
    updateProvinceAndCityOptions();
    document.getElementById("filter-province").value = match.province || "all";
    updateProvinceAndCityOptions();
  }
  document.getElementById("filter-region").value = reg;
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
  switchTab("leads");
  await loadPosts();
}

function getFilterQueryString() {
  const subSel = document.getElementById("filter-sub-service");
  const { date_from, date_to } = getActiveDateBounds();
  const paramsObj = {
    platform: document.getElementById("filter-platform").value,
    intent_type: document.getElementById("filter-intent").value,
    category: document.getElementById("filter-category").value,
    sub_service: subSel ? subSel.value : "all",
    country: document.getElementById("filter-country").value,
    province: document.getElementById("filter-province").value,
    city_region: document.getElementById("filter-region").value,
    urgency: document.getElementById("filter-urgency").value,
    search: document.getElementById("filter-search").value,
  };
  if (date_from) paramsObj.date_from = date_from;
  if (date_to) paramsObj.date_to = date_to;
  return new URLSearchParams(paramsObj).toString();
}

async function loadPosts() {
  const qs = getFilterQueryString();

  const res = await fetchJsonWithFallback(`/api/posts?${qs}`, snap => {
    const plat = document.getElementById("filter-platform").value;
    const intent = document.getElementById("filter-intent").value;
    const cat = document.getElementById("filter-category").value;
    const subSel = document.getElementById("filter-sub-service");
    const sub = subSel ? subSel.value : "all";
    const country = document.getElementById("filter-country").value;
    const prov = document.getElementById("filter-province").value;
    const city = document.getElementById("filter-region").value;
    const urg = document.getElementById("filter-urgency").value;
    const q = (document.getElementById("filter-search").value || "").trim().toLowerCase();
    const { date_from, date_to } = getActiveDateBounds();

    const filtered = (snap.posts || []).filter(p => {
      if (plat !== "all" && p.platform !== plat) return false;
      if (intent === "demand_only") {
        if (p.intent_type !== "customer_hiring" && p.intent_type !== "diy_help_needed") return false;
      } else if (intent === "hiring_and_supply") {
        if (p.intent_type !== "customer_hiring" && p.intent_type !== "service_provider_ad") return false;
      } else if (intent !== "all" && p.intent_type !== intent) return false;
      if (cat !== "all" && p.primary_category !== cat) return false;
      if (sub !== "all" && p.sub_service !== sub) return false;
      if (country !== "all" && p.country !== country) return false;
      if (prov !== "all" && p.province !== prov) return false;
      if (city !== "all" && p.city_region !== city) return false;
      if (urg !== "all" && p.urgency !== urg) return false;
      const postDay = String(p.posted_at || "").slice(0, 10);
      if (date_from && postDay < date_from) return false;
      if (date_to && postDay > date_to) return false;
      if (q) {
        const hay = `${p.title || ""} ${p.body || ""} ${p.neighborhood || ""} ${p.source_detail || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return { posts: filtered, count: filtered.length };
  });
  allFilteredPosts = res.posts || [];
  applySortAndRender();
}

function applySortAndRender() {
  const sortEl = document.getElementById("filter-sort");
  const sortBy = sortEl ? sortEl.value : "relevance";
  const urgRank = { high: 3, medium: 2, low: 1 };
  const intentRank = { customer_hiring: 3, diy_help_needed: 2, job_posting: 1, service_provider_ad: 1, irrelevant: 0 };

  allFilteredPosts.sort((a, b) => {
    if (sortBy === "date_desc") {
      return String(b.posted_at || "").localeCompare(String(a.posted_at || ""));
    }
    if (sortBy === "date_asc") {
      return String(a.posted_at || "").localeCompare(String(b.posted_at || ""));
    }
    if (sortBy === "urgency") {
      const uDiff = (urgRank[b.urgency] || 0) - (urgRank[a.urgency] || 0);
      if (uDiff !== 0) return uDiff;
      return (b.intent_score || 0) - (a.intent_score || 0);
    }
    const iDiff = (intentRank[b.intent_type] || 0) - (intentRank[a.intent_type] || 0);
    if (iDiff !== 0) return iDiff;
    const sDiff = (b.intent_score || 0) - (a.intent_score || 0);
    if (sDiff !== 0) return sDiff;
    return String(b.posted_at || "").localeCompare(String(a.posted_at || ""));
  });

  currentPage = 1;
  renderPostsPage();
}

async function resetFilters() {
  document.getElementById("filter-intent").value = "demand_only";
  document.getElementById("filter-platform").value = "all";
  document.getElementById("filter-category").value = "all";
  const subSel = document.getElementById("filter-sub-service");
  if (subSel) subSel.value = "all";
  document.getElementById("filter-country").value = "all";
  document.getElementById("filter-province").value = "all";
  document.getElementById("filter-region").value = "all";
  document.getElementById("filter-urgency").value = "all";
  const datePresetEl = document.getElementById("filter-date-preset");
  if (datePresetEl) datePresetEl.value = "all";
  const dateFromEl = document.getElementById("filter-date-from");
  if (dateFromEl) dateFromEl.value = "";
  const dateToEl = document.getElementById("filter-date-to");
  if (dateToEl) dateToEl.value = "";
  const customDateRow = document.getElementById("custom-date-row");
  if (customDateRow) customDateRow.style.display = "none";
  document.getElementById("filter-sort").value = "relevance";
  document.getElementById("filter-search").value = "";
  updateSubServiceOptions();
  updateProvinceAndCityOptions();
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
  await loadPosts();
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(allFilteredPosts.length / pageSize));
  currentPage = Math.max(1, Math.min(totalPages, page));
  renderPostsPage();
  document.getElementById("posts-tbody").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function changePageSize(newSize) {
  pageSize = Number(newSize) || 25;
  currentPage = 1;
  renderPostsPage();
}

function renderPostsPage() {
  const total = allFilteredPosts.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;

  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const posts = allFilteredPosts.slice(startIdx, endIdx);

  document.getElementById("results-count").textContent =
    total > 0 ? `Showing ${startIdx + 1}-${endIdx} of ${total} matching posts` : "0 matching posts";

  const tbody = document.getElementById("posts-tbody");
  const pagBar = document.getElementById("pagination-bar");
  if (!posts.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:32px;">No posts match your current filters.</td></tr>`;
    if (pagBar) pagBar.innerHTML = "";
    return;
  }

  tbody.innerHTML = posts.map(p => {
    const intentBadge = p.intent_type === "customer_hiring"
      ? `<span class="badge b-hiring">Hiring Pro</span>`
      : p.intent_type === "diy_help_needed"
      ? `<span class="badge b-diy">DIY Help</span>`
      : p.intent_type === "job_posting"
      ? `<span class="badge b-job">Job Posting</span>`
      : p.intent_type === "irrelevant"
      ? `<span class="badge b-cat">Irrelevant</span>`
      : `<span class="badge b-supply">Provider Ad</span>`;

    const platBadge = p.platform === "reddit"
      ? `<span class="badge b-reddit">Reddit</span>`
      : p.platform === "kijiji"
      ? `<span class="badge b-kijiji">Kijiji</span>`
      : p.platform === "51ca"
      ? `<span class="badge b-51ca">51.ca</span>`
      : p.platform === "bark"
      ? `<span class="badge b-bark">Bark.com</span>`
      : p.platform === "stackexchange"
      ? `<span class="badge b-stackexchange">StackExchange</span>`
      : `<span class="badge b-craigslist">Craigslist</span>`;

    const urgBadge = p.urgency === "high"
      ? `<div style="margin-top:5px;"><span class="badge b-high">Urgent</span></div>`
      : "";

    const bodySnippet = (p.body || "").trim();
    const dateStr = (p.posted_at || "").slice(0, 10);
    const deletedDateStr = (p.deleted_at || "").slice(0, 10);
    const deletedBadge = deletedDateStr
      ? `<span style="font-size:0.72rem;color:#fb7185;" title="Estimated removal timestamp (detected missing during scrape)">&middot; Removed ~${esc(deletedDateStr)}</span>`
      : "";

    return `
      <tr>
        <td>
          <a class="post-title" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a>
          ${bodySnippet ? `<div class="post-body">${esc(bodySnippet)}</div>` : ""}
        </td>
        <td>
          <div><span class="badge b-cat">${esc(p.primary_category)}</span></div>
          ${p.sub_service ? `<div><span class="badge b-subtask">${esc(p.sub_service)}</span></div>` : ""}
          ${p.price_mention ? `<div style="color:#34d399;font-size:0.78rem;margin-top:6px;font-weight:600;">${esc(p.price_mention)}</div>` : ""}
        </td>
        <td>
          ${intentBadge}
          ${urgBadge}
        </td>
        <td>
          <div style="font-weight:600;font-size:0.83rem;color:var(--text-secondary);">${esc(p.city_region)}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:5px;flex-wrap:wrap;">
            ${platBadge}
            <span style="font-size:0.75rem;color:var(--muted);">${esc(dateStr)}</span>
            ${deletedBadge}
          </div>
        </td>
        <td style="text-align:right;">
          <a class="btn" style="padding:6px 14px;font-size:0.8rem;" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">Link</a>
        </td>
      </tr>
    `;
  }).join("");

  if (pagBar) {
    pagBar.innerHTML = _buildPaginationHtml(total, currentPage, pageSize, "goToPage", "changePageSize");
  }
}

function _buildPaginationHtml(total, page, sz, goFnName, sizeFnName) {
  const totalPages = Math.max(1, Math.ceil(total / sz));
  const startIdx = (page - 1) * sz;
  const endIdx = Math.min(startIdx + sz, total);
  const pages = [];
  const windowStart = Math.max(1, page - 2);
  const windowEnd = Math.min(totalPages, page + 2);
  if (windowStart > 1) pages.push(1);
  if (windowStart > 2) pages.push("...");
  for (let i = windowStart; i <= windowEnd; i++) pages.push(i);
  if (windowEnd < totalPages - 1) pages.push("...");
  if (windowEnd < totalPages) pages.push(totalPages);

  const pageBtnsHtml = pages.map(pg =>
    pg === "..."
      ? `<span style="padding:0 4px;">...</span>`
      : `<button class="page-btn ${pg === page ? 'active' : ''}" onclick="${goFnName}(${pg})">${pg}</button>`
  ).join("");

  return `
    <div>
      Showing <strong>${startIdx + 1}-${endIdx}</strong> of <strong>${total}</strong>
      &nbsp;·&nbsp;
      Rows:
      <select class="page-size-select" onchange="${sizeFnName}(this.value)">
        ${[10, 25, 50, 100].map(opt => `<option value="${opt}" ${opt === sz ? 'selected' : ''}>${opt}</option>`).join("")}
      </select>
    </div>
    <div class="page-controls">
      <button class="page-btn" onclick="${goFnName}(${page - 1})" ${page <= 1 ? "disabled" : ""}>Previous</button>
      ${pageBtnsHtml}
      <button class="page-btn" onclick="${goFnName}(${page + 1})" ${page >= totalPages ? "disabled" : ""}>Next</button>
    </div>
  `;
}

function _csvCell(val) {
  let s = String(val ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function _downloadCsv(filename, headers, rowArrays) {
  const lines = [headers.map(_csvCell).join(",")];
  rowArrays.forEach(row => lines.push(row.map(_csvCell).join(",")));
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 150);
}

function handleExportCsv(evt) {
  if (evt) evt.preventDefault();
  const rows = allFilteredPosts || [];
  if (!rows.length) {
    alert("No matching posts to export with your current filters.");
    return;
  }
  const headers = [
    "ID", "Platform", "Source / Channel", "Country", "Province / State",
    "City / Region", "Neighborhood", "Intent Type", "Intent Score",
    "Trade Category", "Task Category", "Urgency", "Price Mention",
    "Price Value", "Price Type", "Name", "Phone Number", "Email", "Business Site",
    "Title", "Description", "URL", "Posted At", "Deleted At (Est.)",
  ];
  const rowArrays = rows.map(p => [
    p.external_id, p.platform, p.source_detail, p.country, p.province,
    p.city_region, p.neighborhood, p.intent_type, p.intent_score,
    p.primary_category, p.sub_service, p.urgency, p.price_mention,
    p.price_value, p.price_type,
    p.contact_name || "", p.phone || "", p.email || "", p.website || "",
    p.title, p.body, p.url, p.posted_at,
    p.deleted_at || "",
  ]);
  _downloadCsv("handyman_market_research_leads.csv", headers, rowArrays);
}

function classifyPostClientSide(post) {
  const title = String(post.title || "").trim();
  const body = String(post.body || "").trim();
  const combined = `${title} ${body}`.toLowerCase();
  const src = String(post.source_detail || "").toLowerCase();

  const catRules = [
    ["Plumbing & Drain", ["plumber", "plumbing", "drain", "clog", "toilet", "faucet", "sink", "leak", "pipe", "water heater", "sump pump", "sewer"], "Pipe Leak & Valve Repair"],
    ["Electrical & Lighting", ["electrician", "electrical", "outlet", "breaker", "panel", "light fixture", "ceiling fan", "wiring", "switch", "dimmer", "gfci"], "Outlet, Switch & Dimmer Repair"],
    ["Yardwork & Landscaping", ["landscaping", "lawn", "yardwork", "yard work", "mowing", "weeding", "mulch", "tree trimming", "snow removal", "patio", "sprinkler"], "Lawn Mowing & Yard Cleanup"],
    ["Painting & Drywall", ["drywall", "sheetrock", "painter", "painting", "spackle", "mudding", "plaster", "wallpaper", "patch hole"], "Drywall Patching & Wall Repair"],
    ["Carpentry, Doors & Windows", ["carpenter", "carpentry", "door", "window", "fence", "deck", "porch", "baseboard", "trim", "cabinet", "hinge", "lock"], "Door, Lock & Hinge Repair"],
    ["Mounting & Furniture Assembly", ["mount tv", "tv mount", "ikea", "wayfair", "assemble", "assembly", "shelves", "curtain rod", "blinds"], "IKEA & Furniture Assembly"],
    ["Roofing, Siding & Gutters", ["roof", "roofer", "shingle", "gutter", "downspout", "siding", "chimney", "skylight", "pressure wash"], "Gutter Cleaning & Downspouts"],
    ["Flooring & Tile", ["tile", "tiling", "grout", "hardwood", "laminate", "lvp", "flooring", "carpet", "countertop"], "Tile, Grout & Backsplash"],
    ["Appliance & HVAC Repair", ["hvac", "furnace", "ac unit", "air conditioner", "dishwasher", "washer", "dryer", "fridge", "refrigerator", "oven", "stove", "thermostat"], "AC, Furnace & Thermostat (HVAC)"],
    ["General Handyman & Odd Jobs", ["handyman", "handy man", "odd jobs", "punch list", "home repair", "maintenance", "junk removal"], "Punch List & Multi-Task Repairs"],
  ];

  let primary_category = "General Handyman & Odd Jobs";
  let sub_service = "Punch List & Multi-Task Repairs";
  let bestScore = 0;
  catRules.forEach(([cat, kws, defSub]) => {
    let sc = 0;
    kws.forEach(kw => {
      if (combined.includes(kw)) sc += title.toLowerCase().includes(kw) ? 3 : 1;
    });
    if (sc > bestScore) {
      bestScore = sc;
      primary_category = cat;
      sub_service = defSub;
    }
  });

  const subMap = (staticSnapshot && staticSnapshot.sub_services_map) ? staticSnapshot.sub_services_map : {};
  const candidateSubs = subMap[primary_category] || [];
  for (const sName of candidateSubs) {
    const words = sName.toLowerCase().split(/[\s,&/]+/).filter(w => w.length > 3);
    if (words.some(w => combined.includes(w))) {
      sub_service = sName;
      break;
    }
  }

  let intent_type = "diy_help_needed";
  let intent_score = 62;
  if (/\b(looking for|need a|anyone recommend|recommendations for|hiring|quote for|seeking)\b/i.test(combined)) {
    intent_type = "customer_hiring";
    intent_score = 82;
  } else if (post.platform !== "stackexchange" && bestScore < 1) {
    intent_type = "irrelevant";
    intent_score = 15;
  } else if (src.includes("homeimprovement") || src.includes("diy") || src.includes("plumbing") || post.platform === "stackexchange") {
    intent_type = "diy_help_needed";
    intent_score = 70;
  }

  let urgency = "low";
  if (/\b(urgent|asap|emergency|immediately|today|tonight|flooding|burst|active leak|no power|sparking)\b/i.test(combined)) {
    urgency = "high";
    if (intent_type !== "irrelevant") intent_score = Math.min(99, intent_score + 6);
  } else if (title.includes("?") || intent_type === "customer_hiring") {
    urgency = "medium";
  }

  let price_mention = "";
  let price_value = 0;
  let price_type = "";
  const hrM = combined.match(/\$\s?(\d{2,3})\s?(?:\/hr|per hour|an hour|hr\b)/i);
  if (hrM) {
    const v = Number(hrM[1]);
    if (v >= 25 && v <= 250) {
      price_mention = hrM[0];
      price_value = v;
      price_type = "hourly";
    }
  } else {
    const flM = combined.match(/\$\s?(\d[\d,]*)/);
    if (flM) {
      const v = Number(flM[1].replace(/,/g, ""));
      if (v >= 45 && v <= 5000) {
        price_mention = flM[0];
        price_value = v;
        price_type = "flat";
      }
    }
  }

  const rawText = `${title}\n${body}`;
  const phoneMatches = [...rawText.matchAll(/(?:\+?1[-.\s]?)?(?:\(([2-9]\d{2})\)[-.\s]?|([2-9]\d{2})[-.\s])(\d{3})[-.\s](\d{4})\b/g)]
    .map(m => `${m[1] || m[2]}-${m[3]}-${m[4]}`);
  const phone = [...new Set(phoneMatches)].slice(0, 2).join(", ");
  const emailMatches = (rawText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,10}\b/g) || [])
    .map(e => e.toLowerCase())
    .filter(e => !/(?:51\.ca|craigslist\.org|kijiji\.ca|reddit\.com|example\.com)$/.test(e));
  const email = [...new Set(emailMatches)].slice(0, 2).join(", ");
  let website = "";
  if (intent_type !== "diy_help_needed" && intent_type !== "irrelevant") {
    const urlMatches = rawText.match(/(?:https?:\/\/|www\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,10}(?:\/[^\s)<\]"']*)?/gi) || [];
    const blockedHost = /(reddit\.com|redd\.it|imgur\.com|postimg\.cc|stackexchange\.com|sstatic\.net|craigslist\.org|kijiji\.ca|51\.ca|bark\.com|trustpilot\.com|amazonaws\.com|nextdoor\.com|youtube\.com|youtu\.be|google\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|amazon\.|homedepot\.|lowes\.|wayfair\.|ikea\.|taskrabbit\.com|\.gov$)/i;
    website = (urlMatches.map(u => u.replace(/[.,;:!?)]+$/, "")).find(u => !blockedHost.test(u) && !/\.(jpg|jpeg|png|gif|webp|pdf)$/i.test(u))) || "";
  }
  const nameMatch = rawText.match(/\b(?:[Cc]ontact|[Cc]all or [Tt]ext|[Cc]all\/[Tt]ext|[Aa]sk for|[Mm]y name is|(?:[Hh]i|[Hh]ello),?\s*[Ii]['’]m)\s+([A-Z][a-z]{2,15}(?:\s+[A-Z][a-z]{2,15})?)\b/);
  const contact_name = (nameMatch && !/^(Today|Now|Me|Us|Anytime|Here|For|Free|Quote|Looking|Moving)$/i.test(nameMatch[1])) ? nameMatch[1] : "";

  return {
    ...post,
    contact_name,
    phone,
    email,
    website,
    intent_type,
    intent_score,
    primary_category,
    sub_service,
    urgency,
    price_mention,
    price_value,
    price_type,
    classified_by: "browser_live",
  };
}

async function runBrowserLiveScrape() {
  await ensureStaticSnapshot(true);
  const fetchedRaw = [];
  const nowIso = new Date().toISOString();

  const tasks = [];

  // 1. DIY StackExchange public CORS API
  tasks.push(
    fetchWithTimeout("https://api.stackexchange.com/2.3/questions?order=desc&sort=creation&site=diy&filter=withbody&pagesize=25", {}, 8000)
      .then(r => r.json())
      .then(data => {
        (data.items || []).forEach(q => {
          const cleanBody = String(q.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
          fetchedRaw.push({
            external_id: `se_${q.question_id}`,
            platform: "stackexchange",
            source_detail: "diy.stackexchange.com",
            country: "National",
            province: "",
            city_region: "National / DIY Forums",
            neighborhood: (q.tags || []).slice(0, 3).join(", "),
            title: q.title || "",
            body: cleanBody,
            url: q.link || "",
            author: (q.owner && q.owner.display_name) || "se_user",
            posted_at: q.creation_date ? new Date(q.creation_date * 1000).toISOString() : nowIso,
          });
        });
      })
      .catch(() => {})
  );

  // 2. Reddit public feeds (national DIY + top local subs)
  const redditFeeds = [
    { sub: "HomeImprovement", country: "National", province: "", city_region: "National / DIY Forums" },
    { sub: "DIY", country: "National", province: "", city_region: "National / DIY Forums" },
    { sub: "Plumbing", country: "National", province: "", city_region: "National / DIY Forums" },
    { sub: "askTO", country: "Canada", province: "Ontario", city_region: "Toronto / GTA, ON" },
    { sub: "Austin", country: "United States", province: "Texas", city_region: "Austin, TX" },
    { sub: "AskNYC", country: "United States", province: "New York", city_region: "New York City, NY" },
    { sub: "bayarea", country: "United States", province: "California", city_region: "SF Bay Area, CA" },
  ];
  redditFeeds.forEach(feed => {
    tasks.push(
      fetchWithTimeout(`https://www.reddit.com/r/${feed.sub}/new.json?limit=15`, {}, 6000)
        .then(r => r.json())
        .then(data => {
          const children = (data.data && data.data.children) ? data.data.children : [];
          children.forEach(c => {
            const p = c.data;
            if (!p || !p.id || !p.title) return;
            fetchedRaw.push({
              external_id: `rd_${p.id}`,
              platform: "reddit",
              source_detail: `r/${feed.sub}`,
              country: feed.country,
              province: feed.province,
              city_region: feed.city_region,
              neighborhood: "",
              title: p.title,
              body: String(p.selftext || "").slice(0, 800),
              url: p.permalink ? `https://www.reddit.com${p.permalink}` : (p.url || ""),
              author: p.author || "reddit_user",
              posted_at: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : nowIso,
            });
          });
        })
        .catch(() => {})
    );
  });

  await Promise.allSettled(tasks);

  const snap = staticSnapshot || { posts: [] };
  const existingIds = new Set((snap.posts || []).map(p => p.external_id));
  const newlyAdded = [];
  let demandLeads = 0;

  fetchedRaw.forEach(raw => {
    const classified = classifyPostClientSide(raw);
    if (classified.intent_type === "irrelevant") return;
    if (classified.intent_type === "customer_hiring" || classified.intent_type === "diy_help_needed") {
      demandLeads++;
    }
    if (!existingIds.has(classified.external_id)) {
      existingIds.add(classified.external_id);
      newlyAdded.push(classified);
    }
  });

  snap.posts = [...newlyAdded, ...(snap.posts || [])];
  staticSnapshot = snap;

  return {
    total_fetched: fetchedRaw.length,
    new_stored: newlyAdded.length,
    demand_leads_found: demandLeads,
  };
}

async function isBackendReachable(apiBase) {
  if (!apiBase) return true;
  try {
    const resp = await fetchWithTimeout(`${apiBase}/api/settings`, {}, 900);
    const ctype = resp.headers.get("content-type") || "";
    const ok = resp.ok && ctype.includes("application/json");
    if (isStaticHost()) localBridgeAvailable = ok;
    return ok;
  } catch (_e) {
    if (isStaticHost()) localBridgeAvailable = false;
    return false;
  }
}

async function waitForActiveScrape(apiBase, maxWaitMs = 240000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    try {
      const resp = await fetchWithTimeout(`${apiBase}/api/summary`, {}, 5000);
      if (!resp.ok) continue;
      const sumJson = await resp.json();
      const latestRun = (sumJson.recent_runs && sumJson.recent_runs[0]) || null;
      if (latestRun && latestRun.status !== "running") {
        return latestRun;
      }
    } catch (_e) {
      // Transient fetch hiccup while backend is busy; keep polling
    }
  }
  throw new Error("Timed out waiting for the running scrape to finish.");
}

async function triggerScrape() {
  const btn = document.getElementById("scrape-btn");
  btn.disabled = true;
  let elapsedSec = 0;
  btn.textContent = "Scraping... (0s)";
  const timer = setInterval(() => {
    elapsedSec += 1;
    btn.textContent = `Scraping... (${elapsedSec}s)`;
  }, 1000);

  try {
    const apiBase = isStaticHost() ? "http://127.0.0.1:8765" : "";
    let usedBackend = false;
    let res = null;

    if (await isBackendReachable(apiBase)) {
      let resp = null;
      try {
        resp = await fetchWithTimeout(`${apiBase}/api/scrape`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platforms: ["reddit", "craigslist", "kijiji", "stackexchange", "51ca", "bark"], include_national_reddit: true }),
        }, 240000);
      } catch (_bridgeErr) {
        if (!apiBase) throw _bridgeErr;
      }

      if (resp) {
        const ctype = resp.headers.get("content-type") || "";
        if (resp.status === 409) {
          res = await waitForActiveScrape(apiBase, 240000);
          usedBackend = true;
        } else if (ctype.includes("application/json")) {
          res = await resp.json();
          if (!resp.ok) throw new Error(res.error || `HTTP ${resp.status}`);
          usedBackend = true;
        }
      }
    }

    if (!usedBackend) {
      res = await runBrowserLiveScrape();
    }

    await loadDashboard();
    alert(`Scrape complete! Fetched ${res.total_fetched} posts (${res.new_stored} new stored, ${res.demand_leads_found} demand leads).`);
  } catch (e) {
    alert("Error running scrape: " + e.message);
  } finally {
    clearInterval(timer);
    btn.disabled = false;
    btn.textContent = "Run Live Scrape";
  }
}

async function triggerReclassify() {
  if (!confirm("Re-run classification on all stored posts with the latest rules (and LLM, if configured)?")) return;
  const apiBase = isStaticHost() ? "http://127.0.0.1:8765" : "";
  try {
    if (!(await isBackendReachable(apiBase))) throw new Error("No local backend");
    const resp = await fetchWithTimeout(`${apiBase}/api/reclassify`, { method: "POST" }, 15000);
    const ctype = resp.headers.get("content-type") || "";
    if (!resp.ok || !ctype.includes("application/json")) throw new Error("No local backend");
    const res = await resp.json();
    await loadDashboard();
    alert(`Reclassified ${res.count} posts.`);
  } catch (_e) {
    await ensureStaticSnapshot(true);
    await loadDashboard();
    const cnt = (staticSnapshot && staticSnapshot.posts) ? staticSnapshot.posts.length : 0;
    alert(`Refreshed latest classified cloud dataset (${cnt} posts).`);
  }
}

function openSettingsModal() {
  if (!currentSettings) return;
  const regContainer = document.getElementById("settings-regions");
  regContainer.innerHTML = (currentSettings.regions || []).map((r, i) => `
    <label class="region-item">
      <input type="checkbox" data-reg-idx="${i}" ${r.enabled ? "checked" : ""} />
      <span>${esc(r.name)}</span>
    </label>
  `).join("");

  document.getElementById("settings-keywords").value = (currentSettings.search_keywords || []).join(", ");
  document.getElementById("settings-subs").value = (currentSettings.national_subreddits || []).join(", ");
  document.getElementById("settings-llm-provider").value = (currentSettings.llm_config || {}).provider || "gemini";
  document.getElementById("settings-modal").classList.add("open");
}

function closeSettingsModal() {
  document.getElementById("settings-modal").classList.remove("open");
}

async function saveSettings() {
  const checkboxes = document.querySelectorAll("[data-reg-idx]");
  checkboxes.forEach(cb => {
    const idx = Number(cb.getAttribute("data-reg-idx"));
    if (currentSettings.regions[idx]) {
      currentSettings.regions[idx].enabled = cb.checked;
    }
  });

  const keywords = document.getElementById("settings-keywords").value.split(",").map(s => s.trim()).filter(Boolean);
  const subs = document.getElementById("settings-subs").value.split(",").map(s => s.trim()).filter(Boolean);
  const provider = document.getElementById("settings-llm-provider").value;
  const geminiKey = document.getElementById("settings-gemini-key").value.trim();
  const openaiKey = document.getElementById("settings-openai-key").value.trim();

  const apiBase = isStaticHost() ? "http://127.0.0.1:8765" : "";
  if (await isBackendReachable(apiBase)) {
    await fetchWithTimeout(`${apiBase}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        regions: currentSettings.regions,
        search_keywords: keywords,
        national_subreddits: subs,
        llm_config: {
          provider,
          gemini_api_key: geminiKey,
          openai_api_key: openaiKey,
          enable_llm_enrichment: true,
        },
      }),
    }, 5000);
  } else {
    currentSettings.search_keywords = keywords;
    currentSettings.national_subreddits = subs;
  }
  closeSettingsModal();
  await loadDashboard();
}

const SEARCHABLE_SELECT_IDS = [
  "filter-country",
  "filter-province",
  "filter-region",
  "filter-category",
  "filter-sub-service",
  "filter-platform",
  "filter-intent",
  "filter-urgency",
  "filter-date-preset",
  "filter-sort",
  "creator-category",
  "creator-sub-service",
  "creator-platform",
  "creator-tier",
  "creator-contact",
  "creator-country",
  "creator-province",
  "creator-city",
  "creator-sort",
];

function closeAllSearchableSelects(exceptWrap = null) {
  document.querySelectorAll(".sselect-wrap.open").forEach(w => {
    if (w !== exceptWrap) w.classList.remove("open");
  });
}

function filterSearchableWrapOptions(wrap, query) {
  const q = (query || "").trim().toLowerCase();
  let visibleCount = 0;
  wrap.querySelectorAll(".sselect-option").forEach(el => {
    const match = !q || el.textContent.toLowerCase().includes(q);
    el.style.display = match ? "" : "none";
    if (match) visibleCount++;
  });
  wrap.querySelectorAll(".sselect-divider").forEach(el => {
    el.style.display = q ? "none" : "";
  });
  const emptyEl = wrap.querySelector(".sselect-empty");
  if (emptyEl) emptyEl.style.display = visibleCount === 0 ? "block" : "none";
}

function syncSearchableSelect(selectId) {
  const selectEl = document.getElementById(selectId);
  const wrap = document.getElementById(`sselect-${selectId}`);
  if (!selectEl || !wrap) return;

  const triggerTextEl = wrap.querySelector(".sselect-trigger-text");
  const optionsBox = wrap.querySelector(".sselect-options");
  const searchInput = wrap.querySelector(".sselect-search");

  const opts = Array.from(selectEl.options);
  const selectedOpt = opts.find(o => o.value === selectEl.value && !o.disabled) || opts.find(o => !o.disabled) || opts[0];
  if (triggerTextEl) {
    triggerTextEl.textContent = selectedOpt ? selectedOpt.text : "";
  }

  if (optionsBox) {
    optionsBox.innerHTML = opts.map(opt => {
      if (opt.disabled) {
        return `<div class="sselect-divider">${esc(opt.text)}</div>`;
      }
      const isActive = opt.value === selectEl.value;
      return `<div class="sselect-option${isActive ? " active" : ""}" data-val="${esc(opt.value)}">${esc(opt.text)}</div>`;
    }).join("") + `<div class="sselect-empty" style="display:none;">No matching options</div>`;
  }

  if (searchInput) {
    filterSearchableWrapOptions(wrap, searchInput.value);
  }
}

function syncAllSearchableSelects() {
  SEARCHABLE_SELECT_IDS.forEach(syncSearchableSelect);
}

function initSearchableSelects() {
  SEARCHABLE_SELECT_IDS.forEach(id => {
    const selectEl = document.getElementById(id);
    if (!selectEl || selectEl.dataset.sselectInit === "1") return;
    selectEl.dataset.sselectInit = "1";
    selectEl.style.display = "none";

    const wrap = document.createElement("div");
    wrap.className = "sselect-wrap";
    wrap.id = `sselect-${id}`;
    wrap.innerHTML = `
      <button type="button" class="sselect-trigger" aria-haspopup="listbox">
        <span class="sselect-trigger-text"></span>
        <span class="sselect-arrow">&#9662;</span>
      </button>
      <div class="sselect-menu">
        <div class="sselect-search-wrap">
          <input type="text" class="sselect-search" placeholder="Search options..." autocomplete="off" />
        </div>
        <div class="sselect-options" role="listbox"></div>
      </div>
    `;
    selectEl.parentNode.insertBefore(wrap, selectEl.nextSibling);

    const triggerBtn = wrap.querySelector(".sselect-trigger");
    const searchInput = wrap.querySelector(".sselect-search");
    const optionsBox = wrap.querySelector(".sselect-options");

    triggerBtn.addEventListener("click", evt => {
      evt.stopPropagation();
      const wasOpen = wrap.classList.contains("open");
      closeAllSearchableSelects(wrap);
      if (wasOpen) {
        wrap.classList.remove("open");
      } else {
        wrap.classList.add("open");
        if (searchInput) {
          searchInput.value = "";
          filterSearchableWrapOptions(wrap, "");
          setTimeout(() => searchInput.focus(), 10);
        }
      }
    });

    searchInput.addEventListener("click", evt => evt.stopPropagation());
    searchInput.addEventListener("input", () => {
      filterSearchableWrapOptions(wrap, searchInput.value);
    });
    searchInput.addEventListener("keydown", evt => {
      if (evt.key === "Escape") {
        wrap.classList.remove("open");
        triggerBtn.focus();
      } else if (evt.key === "Enter") {
        evt.preventDefault();
        const firstVisible = Array.from(wrap.querySelectorAll(".sselect-option")).find(
          el => el.style.display !== "none"
        );
        if (firstVisible) {
          firstVisible.click();
        }
      }
    });

    optionsBox.addEventListener("click", evt => {
      evt.stopPropagation();
      const optEl = evt.target.closest(".sselect-option");
      if (!optEl) return;
      const newVal = optEl.getAttribute("data-val");
      const changed = selectEl.value !== newVal;
      selectEl.value = newVal;
      wrap.classList.remove("open");
      syncSearchableSelect(id);
      if (changed) {
        selectEl.dispatchEvent(new Event("change"));
      }
    });

    syncSearchableSelect(id);
  });

  if (!window.__sselectGlobalBound) {
    window.__sselectGlobalBound = true;
    document.addEventListener("click", evt => {
      if (!evt.target.closest(".sselect-wrap")) {
        closeAllSearchableSelects();
      }
    });
    document.addEventListener("keydown", evt => {
      if (evt.key === "Escape") closeAllSearchableSelects();
    });
  }
}

// ==================== Affiliate Creators Tab Logic ====================
let activeMainTab = "listings";
let creatorsLoadedOnce = false;
let creatorsSummaryData = null;
let allFilteredCreators = [];
let creatorsCurrentPage = 1;
let creatorsPageSize = 25;
let creatorSearchDebounce = null;

function debouncedLoadCreators() {
  clearTimeout(creatorSearchDebounce);
  creatorSearchDebounce = setTimeout(loadCreators, 250);
}

async function switchMainTab(tabName) {
  activeMainTab = tabName === "creators" ? "creators" : "listings";
  const listingsEl = document.getElementById("page-listings");
  const creatorsEl = document.getElementById("page-creators");
  const btnListings = document.getElementById("tab-btn-listings");
  const btnCreators = document.getElementById("tab-btn-creators");

  if (listingsEl) listingsEl.classList.toggle("hidden", activeMainTab !== "listings");
  if (creatorsEl) creatorsEl.classList.toggle("hidden", activeMainTab !== "creators");
  if (btnListings) btnListings.classList.toggle("active", activeMainTab === "listings");
  if (btnCreators) btnCreators.classList.toggle("active", activeMainTab === "creators");

  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
  if (activeMainTab === "creators" && !creatorsLoadedOnce) {
    creatorsLoadedOnce = true;
    await Promise.all([loadCreatorsSummary(), loadCreators()]);
  }
}

function computeStaticCreatorsSummary(snap) {
  const creators = snap.creators || [];
  let withEmail = 0, onYt = 0, onIg = 0, onTt = 0, onFb = 0, onX = 0, onTw = 0, onBsky = 0;
  let onOther = 0, microMid = 0, northAm = 0;
  const tierCounts = { nano: 0, micro: 0, mid: 0, macro: 0, mega: 0 };
  const provByCountry = { "United States": new Set(), "Canada": new Set() };
  const cityByCountry = { "United States": new Set(), "Canada": new Set() };
  const cityByProv = {};
  const allProvs = new Set();
  const allCities = new Set();
  const catMap = {};

  creators.forEach(c => {
    const hasEmail = Boolean((c.business_email || "").trim());
    const hasYt = Boolean((c.youtube_url || "").trim());
    const hasIg = Boolean((c.instagram_url || "").trim());
    const hasTt = Boolean((c.tiktok_url || "").trim());
    const hasFb = Boolean((c.facebook_url || "").trim());
    const hasX = Boolean((c.x_url || "").trim());
    const hasTw = Boolean((c.twitch_url || "").trim());
    const hasBsky = Boolean((c.bluesky_url || "").trim());
    const hasOther = hasX || hasFb || hasTw;

    if (hasEmail) withEmail++;
    if (hasYt) onYt++;
    if (hasIg) onIg++;
    if (hasTt) onTt++;
    if (hasFb) onFb++;
    if (hasX) onX++;
    if (hasTw) onTw++;
    if (hasBsky) onBsky++;
    if (hasOther) onOther++;
    if (c.audience_tier === "micro" || c.audience_tier === "mid") microMid++;
    if (Object.prototype.hasOwnProperty.call(tierCounts, c.audience_tier)) {
      tierCounts[c.audience_tier]++;
    }

    const ctry = String(c.country || "").trim();
    const isUsCa = ctry === "Canada" || ctry === "United States";
    if (isUsCa) {
      northAm++;
      const prov = String(c.province_state || "").trim();
      const city = String(c.city || "").trim();
      if (prov) {
        provByCountry[ctry].add(prov);
        allProvs.add(prov);
      }
      if (city) {
        cityByCountry[ctry].add(city);
        allCities.add(city);
        if (prov) {
          if (!cityByProv[prov]) cityByProv[prov] = new Set();
          cityByProv[prov].add(city);
        }
      }
    }

    const cat = c.primary_category || "General Handyman & Odd Jobs";
    if (!catMap[cat]) {
      catMap[cat] = { primary_category: cat, total_creators: 0, with_email: 0, on_instagram: 0, on_tiktok: 0 };
    }
    catMap[cat].total_creators++;
    if (hasEmail) catMap[cat].with_email++;
    if (hasIg) catMap[cat].on_instagram++;
    if (hasTt) catMap[cat].on_tiktok++;
  });

  const sortedSet = s => Array.from(s).sort((a, b) => a.localeCompare(b));
  const citiesByProvOut = {};
  Object.keys(cityByProv).forEach(p => { citiesByProvOut[p] = sortedSet(cityByProv[p]); });

  return {
    kpis: {
      total_creators: creators.length,
      with_email: withEmail,
      on_youtube: onYt,
      on_instagram: onIg,
      on_tiktok: onTt,
      on_facebook: onFb,
      on_x: onX,
      on_twitch: onTw,
      on_bluesky: onBsky,
      on_x_fb_twitch: onOther,
      micro_mid_tier: microMid,
      north_america: northAm,
    },
    tier_counts: tierCounts,
    geo_options: {
      provinces_by_country: {
        "United States": sortedSet(provByCountry["United States"]),
        "Canada": sortedSet(provByCountry["Canada"]),
      },
      cities_by_country: {
        "United States": sortedSet(cityByCountry["United States"]),
        "Canada": sortedSet(cityByCountry["Canada"]),
      },
      cities_by_province: citiesByProvOut,
      all_provinces: sortedSet(allProvs),
      all_cities: sortedSet(allCities),
    },
    category_breakdown: Object.values(catMap).sort((a, b) => b.total_creators - a.total_creators || b.with_email - a.with_email),
    categories_list: snap.categories_list || [],
    sub_services_map: snap.sub_services_map || {},
  };
}

async function loadCreatorsSummary() {
  const res = await fetchJsonWithFallback("/api/creators/summary", snap => computeStaticCreatorsSummary(snap));
  creatorsSummaryData = res;
  const countPill = document.getElementById("tab-creators-count");
  if (countPill && res && res.kpis) {
    countPill.textContent = res.kpis.total_creators || 0;
  }
  renderCreatorsKPIs(res.kpis || {}, res.tier_counts || {});
  updateCreatorGeoOptions(true);
  syncCreatorStripPills();
  renderCreatorsCategoryChart(res.category_breakdown || []);
}

function renderCreatorsKPIs(kpis, tierCounts = {}) {
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v || 0;
  };
  setVal("ckpi-total", kpis.total_creators);
  setVal("ckpi-email", kpis.with_email);
  setVal("ckpi-na", kpis.north_america);
  setVal("ckpi-micro-mid", kpis.micro_mid_tier);

  setVal("splat-count-all", kpis.total_creators);
  setVal("splat-count-youtube", kpis.on_youtube);
  setVal("splat-count-instagram", kpis.on_instagram);
  setVal("splat-count-tiktok", kpis.on_tiktok);
  setVal("splat-count-facebook", kpis.on_facebook);
  setVal("splat-count-x", kpis.on_x);
  setVal("splat-count-twitch", kpis.on_twitch);
  setVal("splat-count-bluesky", kpis.on_bluesky);

  setVal("stier-count-all", kpis.total_creators);
  setVal("stier-count-nano", tierCounts.nano);
  setVal("stier-count-micro", tierCounts.micro);
  setVal("stier-count-mid", tierCounts.mid);
  setVal("stier-count-macro", tierCounts.macro);
  setVal("stier-count-mega", tierCounts.mega);
}

function syncActiveCreatorKpiCard(mode) {
  ["all", "email", "north_america", "micro_mid"].forEach(k => {
    const el = document.getElementById(`ckpi-card-${k}`);
    if (el) el.classList.toggle("active", k === mode);
  });
}

function syncCreatorStripPills() {
  const activePlat = document.getElementById("creator-platform")?.value || "all";
  const activeTier = document.getElementById("creator-tier")?.value || "all";
  document.querySelectorAll("#creator-platform-strip .quick-pill").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-plat") === activePlat);
  });
  document.querySelectorAll("#creator-tier-strip .quick-pill").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-tier") === activeTier);
  });
}

function setCreatorPlatformQuick(plat) {
  const platSel = document.getElementById("creator-platform");
  if (platSel) platSel.value = plat || "all";
  syncActiveCreatorKpiCard("");
  syncCreatorStripPills();
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
  loadCreators();
}

function onCreatorPlatformSelectChange() {
  syncCreatorStripPills();
  loadCreators();
}

function setCreatorTierQuick(tier) {
  const tierSel = document.getElementById("creator-tier");
  if (tierSel) tierSel.value = tier || "all";
  syncActiveCreatorKpiCard(tier === "micro_mid" ? "micro_mid" : "");
  syncCreatorStripPills();
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
  loadCreators();
}

function onCreatorTierSelectChange() {
  const val = document.getElementById("creator-tier")?.value || "all";
  syncActiveCreatorKpiCard(val === "micro_mid" ? "micro_mid" : "");
  syncCreatorStripPills();
  loadCreators();
}

function updateCreatorGeoOptions(preserveSelections = true) {
  const geo = (creatorsSummaryData && creatorsSummaryData.geo_options) || {};
  const country = document.getElementById("creator-country")?.value || "all";
  const provSel = document.getElementById("creator-province");
  const citySel = document.getElementById("creator-city");
  if (!provSel || !citySel) return;

  const prevProv = preserveSelections ? (provSel.value || "all") : "all";
  const prevCity = preserveSelections ? (citySel.value || "all") : "all";

  if (country === "Other") {
    provSel.innerHTML = `<option value="all">US &amp; Canada only</option>`;
    provSel.value = "all";
    citySel.innerHTML = `<option value="all">US &amp; Canada only</option>`;
    citySel.value = "all";
  } else {
    let provs = [];
    if (country === "United States") {
      provs = (geo.provinces_by_country && geo.provinces_by_country["United States"]) || [];
    } else if (country === "Canada") {
      provs = (geo.provinces_by_country && geo.provinces_by_country["Canada"]) || [];
    } else {
      provs = geo.all_provinces || [];
    }
    const provLabel = country === "United States" ? "All US States" : country === "Canada" ? "All Canadian Provinces" : "All States & Provinces";
    provSel.innerHTML = `<option value="all">${provLabel}</option>` +
      provs.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
    provSel.value = provs.includes(prevProv) ? prevProv : "all";

    const chosenProv = provSel.value || "all";
    let cities = [];
    if (chosenProv !== "all") {
      cities = (geo.cities_by_province && geo.cities_by_province[chosenProv]) || [];
    } else if (country === "United States" || country === "Canada") {
      cities = (geo.cities_by_country && geo.cities_by_country[country]) || [];
    } else {
      cities = geo.all_cities || [];
    }
    citySel.innerHTML = `<option value="all">All Cities</option>` +
      cities.map(ci => `<option value="${esc(ci)}">${esc(ci)}</option>`).join("");
    citySel.value = cities.includes(prevCity) ? prevCity : "all";
  }

  if (typeof syncSearchableSelect === "function") {
    syncSearchableSelect("creator-province");
    syncSearchableSelect("creator-city");
  }
}

function onCreatorCountryChange() {
  const provSel = document.getElementById("creator-province");
  const citySel = document.getElementById("creator-city");
  if (provSel) provSel.value = "all";
  if (citySel) citySel.value = "all";
  updateCreatorGeoOptions(false);
  loadCreators();
}

function onCreatorProvinceChange() {
  const citySel = document.getElementById("creator-city");
  if (citySel) citySel.value = "all";
  updateCreatorGeoOptions(true);
  loadCreators();
}

function quickFilterCreators(mode) {
  syncActiveCreatorKpiCard(mode);
  const platSel = document.getElementById("creator-platform");
  const tierSel = document.getElementById("creator-tier");
  const contactSel = document.getElementById("creator-contact");
  const countrySel = document.getElementById("creator-country");
  const provSel = document.getElementById("creator-province");
  const citySel = document.getElementById("creator-city");
  if (platSel) platSel.value = "all";
  if (tierSel) tierSel.value = "all";
  if (contactSel) contactSel.value = "all";
  if (countrySel) countrySel.value = "all";
  if (provSel) provSel.value = "all";
  if (citySel) citySel.value = "all";

  if (mode === "email" && contactSel) contactSel.value = "has_email";
  else if (mode === "north_america" && countrySel) countrySel.value = "North America";
  else if (mode === "micro_mid" && tierSel) tierSel.value = "micro_mid";

  updateCreatorGeoOptions(false);
  syncCreatorStripPills();
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
  loadCreators();
}

function renderCreatorsCategoryChart(cats) {
  const container = document.getElementById("creators-category-chart");
  if (!container) return;
  if (!cats.length) {
    container.innerHTML = `<p style="color:var(--muted);">No DIY creators scraped yet. Click <strong>Scrape DIY Creators</strong> above to collect public profiles &amp; business emails.</p>`;
    return;
  }
  const maxVal = Math.max(1, ...cats.map(c => c.total_creators || 0));
  container.innerHTML = cats.map(c => {
    const emailPct = ((c.with_email || 0) / maxVal) * 100;
    const otherPct = Math.max(0, (((c.total_creators || 0) - (c.with_email || 0)) / maxVal) * 100);
    return `
      <div class="bar-row" style="cursor:pointer" data-cat="${esc(c.primary_category)}" onclick="filterCreatorsByCategory(this.dataset.cat)">
        <div class="bar-label">
          <strong>${esc(c.primary_category)}</strong>
          <span style="color:var(--muted)">
            <span style="color:#34d399">${c.with_email || 0} With Email</span> ·
            <span style="color:#f472b6">${c.on_instagram || 0} IG</span> ·
            <span style="color:#2dd4bf">${c.on_tiktok || 0} TikTok</span> ·
            <strong>${c.total_creators || 0} Total</strong>
          </span>
        </div>
        <div class="bar-track">
          <div class="bar-fill-hiring" style="width:${emailPct}%"></div>
          <div class="bar-fill-diy" style="width:${otherPct}%"></div>
        </div>
      </div>
    `;
  }).join("");
}

function filterCreatorsByCategory(cat) {
  const catSel = document.getElementById("creator-category");
  if (catSel) catSel.value = cat;
  const subSel = document.getElementById("creator-sub-service");
  if (subSel) subSel.value = "all";
  updateCreatorSubServiceOptions();
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
  loadCreators();
}

function onCreatorCategoryChange() {
  const subSel = document.getElementById("creator-sub-service");
  if (subSel) subSel.value = "all";
  updateCreatorSubServiceOptions();
  loadCreators();
}

async function loadCreators() {
  const category = document.getElementById("creator-category")?.value || "all";
  const sub_service = document.getElementById("creator-sub-service")?.value || "all";
  const social_platform = document.getElementById("creator-platform")?.value || "all";
  const tier = document.getElementById("creator-tier")?.value || "all";
  const contact_filter = document.getElementById("creator-contact")?.value || "all";
  const country = document.getElementById("creator-country")?.value || "all";
  const province_state = document.getElementById("creator-province")?.value || "all";
  const city = document.getElementById("creator-city")?.value || "all";
  const search = document.getElementById("creator-search")?.value || "";

  const qs = new URLSearchParams({
    category, sub_service, social_platform, tier, contact_filter, country, province_state, city, search,
  }).toString();

  const res = await fetchJsonWithFallback(`/api/creators?${qs}`, snap => {
    const q = search.trim().toLowerCase();
    const platColMap = {
      instagram: "instagram_url", tiktok: "tiktok_url", youtube: "youtube_url",
      facebook: "facebook_url", x: "x_url", twitch: "twitch_url", bluesky: "bluesky_url",
    };
    const filtered = (snap.creators || []).filter(c => {
      if (category !== "all" && c.primary_category !== category) return false;
      if (sub_service !== "all" && c.sub_service !== sub_service) return false;
      if (social_platform !== "all") {
        const col = platColMap[social_platform];
        if (!col || !String(c[col] || "").trim()) return false;
      }
      if (tier === "micro_mid") {
        if (c.audience_tier !== "micro" && c.audience_tier !== "mid") return false;
      } else if (tier !== "all" && c.audience_tier !== tier) {
        return false;
      }
      if (contact_filter === "has_email" && !String(c.business_email || "").trim()) return false;
      if (contact_filter === "has_contact" && !String(c.business_email || "").trim() && !String(c.website || "").trim()) return false;
      if (country === "Other") {
        if (c.country === "Canada" || c.country === "United States") return false;
      } else if (country === "North America") {
        if (c.country !== "Canada" && c.country !== "United States") return false;
      } else if (country !== "all" && c.country !== country) {
        return false;
      }
      if (province_state !== "all" && c.province_state !== province_state) return false;
      if (city !== "all" && c.city !== city) return false;
      if (q) {
        const hay = `${c.name || ""} ${c.handle || ""} ${c.bio || ""} ${c.business_email || ""} ${c.website || ""} ${c.country || ""} ${c.province_state || ""} ${c.city || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return { creators: filtered, count: filtered.length };
  });

  allFilteredCreators = res.creators || [];
  applyCreatorsSortAndRender();
}

function applyCreatorsSortAndRender() {
  const sortBy = document.getElementById("creator-sort")?.value || "email_first";
  allFilteredCreators.sort((a, b) => {
    if (sortBy === "audience_desc") {
      return (b.audience_count || 0) - (a.audience_count || 0);
    }
    if (sortBy === "audience_asc") {
      return (a.audience_count || 0) - (b.audience_count || 0);
    }
    if (sortBy === "name_asc") {
      return String(a.name || "").localeCompare(String(b.name || ""));
    }
    const ea = String(a.business_email || "").trim() ? 0 : 1;
    const eb = String(b.business_email || "").trim() ? 0 : 1;
    if (ea !== eb) return ea - eb;
    return (b.audience_count || 0) - (a.audience_count || 0);
  });
  creatorsCurrentPage = 1;
  renderCreatorsPage();
}

function goToCreatorsPage(page) {
  const totalPages = Math.max(1, Math.ceil(allFilteredCreators.length / creatorsPageSize));
  creatorsCurrentPage = Math.max(1, Math.min(totalPages, page));
  renderCreatorsPage();
  const tb = document.getElementById("creators-tbody");
  if (tb) tb.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function changeCreatorsPageSize(newSize) {
  creatorsPageSize = Number(newSize) || 25;
  creatorsCurrentPage = 1;
  renderCreatorsPage();
}

function copyCreatorEmail(email, btn) {
  if (!email) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(email).catch(() => {});
  }
  if (btn) {
    const prev = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = prev; }, 1200);
  }
}

function formatCreatorLocationText(c) {
  if (!c) return "";
  const ctry = String(c.country || "").trim();
  if (ctry === "United States" || ctry === "Canada") {
    return [c.city, c.province_state, ctry].map(v => String(v || "").trim()).filter(Boolean).join(", ");
  }
  return ctry;
}

function renderCreatorsPage() {
  const total = allFilteredCreators.length;
  const totalPages = Math.max(1, Math.ceil(total / creatorsPageSize));
  if (creatorsCurrentPage > totalPages) creatorsCurrentPage = totalPages;

  const startIdx = (creatorsCurrentPage - 1) * creatorsPageSize;
  const endIdx = Math.min(startIdx + creatorsPageSize, total);
  const rows = allFilteredCreators.slice(startIdx, endIdx);

  const countEl = document.getElementById("creators-results-count");
  if (countEl) {
    countEl.textContent = total > 0 ? `Showing ${startIdx + 1}-${endIdx} of ${total} matching creators` : "0 matching creators";
  }

  const tbody = document.getElementById("creators-tbody");
  const pagBar = document.getElementById("creators-pagination-bar");
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:32px;">No creators match your current filters.</td></tr>`;
    if (pagBar) pagBar.innerHTML = "";
    return;
  }

  const socialLinkSpecs = [
    ["youtube_url", "YouTube", "sp-yt"],
    ["instagram_url", "Instagram", "sp-ig"],
    ["tiktok_url", "TikTok", "sp-tt"],
    ["facebook_url", "Facebook", "sp-fb"],
    ["x_url", "X", "sp-x"],
    ["twitch_url", "Twitch", "sp-tw"],
    ["bluesky_url", "Bluesky", "sp-bsky"],
  ];

  tbody.innerHTML = rows.map(c => {
    const tier = String(c.audience_tier || "micro").toLowerCase();
    const tierCls = tier === "mega" ? "tier-mega" : tier === "macro" ? "tier-macro" : tier === "mid" ? "tier-mid" : tier === "nano" ? "tier-nano" : "tier-micro";
    const tierLabel = tier === "mega" ? "Mega (1M+)" : tier === "macro" ? "Macro (500K–1M)" : tier === "mid" ? "Mid-Tier" : tier === "nano" ? "Nano" : "Micro";
    const audLabel = c.audience_text || (c.audience_count ? `${Number(c.audience_count).toLocaleString()} followers` : "Creator");
    const locLabel = formatCreatorLocationText(c);

    const socialHtml = socialLinkSpecs
      .filter(([field]) => String(c[field] || "").trim())
      .map(([field, label, cls]) => `<a class="social-pill ${cls}" href="${esc(safeUrl(c[field]))}" target="_blank" rel="noopener noreferrer">${label}</a>`)
      .join("");

    const emailStr = String(c.business_email || "").trim();
    const firstEmail = emailStr ? emailStr.split(",")[0].trim() : "";
    const siteStr = String(c.website || "").trim();
    const emailBlock = emailStr
      ? `<div class="email-copy-row">
           <a href="mailto:${esc(firstEmail)}" style="color:#34d399;font-size:0.8rem;font-weight:600;word-break:break-all;text-decoration:none;">${esc(emailStr)}</a>
           <button type="button" class="email-copy-btn" data-email="${esc(firstEmail)}" onclick="copyCreatorEmail(this.dataset.email, this)">Copy</button>
           <button type="button" class="email-copy-btn" data-creator-id="${esc(c.creator_id)}" onclick="openEmailDraftForCreator(this.dataset.creatorId)">Draft Email</button>
         </div>`
      : `<div class="email-copy-row">
           <span style="color:var(--muted);font-size:0.78rem;">No direct email listed</span>
           <button type="button" class="email-copy-btn" data-creator-id="${esc(c.creator_id)}" onclick="openEmailDraftForCreator(this.dataset.creatorId)">Draft Outreach</button>
         </div>`;
    const siteBlock = siteStr
      ? `<div style="margin-top:5px;"><a href="${esc(safeUrl(siteStr))}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa;font-size:0.77rem;word-break:break-all;">${esc(siteStr)}</a></div>`
      : "";

    return `
      <tr>
        <td>
          <a class="post-title" href="${esc(safeUrl(c.profile_url))}" target="_blank" rel="noopener noreferrer">${esc(c.name)}</a>
          <span style="font-size:0.76rem;color:var(--muted);margin-left:6px;">${esc(c.handle || "")}${locLabel ? ` · ${esc(locLabel)}` : ""}</span>
          ${c.bio ? `<div class="post-body">${esc(c.bio)}</div>` : ""}
        </td>
        <td>
          <div><span class="badge b-cat">${esc(c.primary_category)}</span></div>
          ${c.sub_service ? `<div><span class="badge b-subtask">${esc(c.sub_service)}</span></div>` : ""}
        </td>
        <td>
          <span class="badge ${tierCls}">${tierLabel}</span>
          <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:5px;font-weight:600;">${esc(audLabel)}</div>
        </td>
        <td>
          <div class="social-pills">${socialHtml || `<span style="color:var(--muted);font-size:0.78rem;">—</span>`}</div>
        </td>
        <td>
          ${emailBlock}
          ${siteBlock}
        </td>
      </tr>
    `;
  }).join("");

  if (pagBar) {
    pagBar.innerHTML = _buildPaginationHtml(total, creatorsCurrentPage, creatorsPageSize, "goToCreatorsPage", "changeCreatorsPageSize");
  }
}

async function resetCreatorFilters() {
  ["creator-category", "creator-sub-service", "creator-platform", "creator-tier", "creator-contact", "creator-country", "creator-province", "creator-city"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "all";
  });
  const sEl = document.getElementById("creator-search");
  if (sEl) sEl.value = "";
  const sortEl = document.getElementById("creator-sort");
  if (sortEl) sortEl.value = "email_first";
  syncActiveCreatorKpiCard("all");
  updateCreatorSubServiceOptions();
  updateCreatorGeoOptions(false);
  syncCreatorStripPills();
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
  await loadCreators();
}

function handleExportCreatorsCsv(evt) {
  if (evt) evt.preventDefault();
  const rows = allFilteredCreators || [];
  if (!rows.length) {
    alert("No matching creators to export with your current filters.");
    return;
  }
  const headers = [
    "Creator ID", "Name", "Handle", "Primary Platform", "City", "Province / State", "Country",
    "Audience Count", "Audience Tier", "Trade Category", "Task Category",
    "Business Email", "Website / Link Hub", "YouTube URL", "Instagram URL",
    "TikTok URL", "Facebook URL", "X / Twitter URL", "Twitch URL", "Bluesky URL", "Bio",
  ];
  const rowArrays = rows.map(c => {
    const isUsOrCa = c.country === "United States" || c.country === "Canada";
    return [
      c.creator_id, c.name, c.handle, c.primary_platform,
      isUsOrCa ? (c.city || "") : "",
      isUsOrCa ? (c.province_state || "") : "",
      c.country || "",
      c.audience_count, c.audience_tier, c.primary_category, c.sub_service,
      c.business_email || "", c.website || "", c.youtube_url || "", c.instagram_url || "",
      c.tiktok_url || "", c.facebook_url || "", c.x_url || "", c.twitch_url || "", c.bluesky_url || "",
      c.bio || "",
    ];
  });
  _downloadCsv("diy_affiliate_creators.csv", headers, rowArrays);
}

// ==================== Affiliate Outreach Email Template Modal ====================
const AFFILIATE_TEMPLATE_STORAGE_KEY = "diy_affiliate_email_template_v1";
const DEFAULT_AFFILIATE_TEMPLATE = {
  brand: "Our Home Services Marketplace",
  commission: "20% recurring commission on booked home service jobs",
  sender: "Partnerships Team",
  subject: "Affiliate Partnership Idea for {{creator_name}} ({{trade_category}})",
  body:
    "Hi {{creator_name}},\n\n" +
    "I've been following your {{trade_category}} videos — especially your tips on {{task_category}} — and love how clearly you help homeowners tackle projects.\n\n" +
    "When viewers realize a project is bigger than a weekend DIY fix, {{your_brand}} matches them with vetted local pros. We'd love to invite you into our creator affiliate program offering {{commission_offer}} on every homeowner booking from your audience.\n\n" +
    "Would you be open to a quick chat or me sending over partner details this week?\n\n" +
    "Best regards,\n{{sender_name}}\n{{your_brand}}",
};
let activeDraftCreator = null;

function _loadSavedEmailTemplate() {
  try {
    const raw = localStorage.getItem(AFFILIATE_TEMPLATE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AFFILIATE_TEMPLATE };
    return { ...DEFAULT_AFFILIATE_TEMPLATE, ...JSON.parse(raw) };
  } catch (_) {
    return { ...DEFAULT_AFFILIATE_TEMPLATE };
  }
}

function _populateTemplateInputs(tpl) {
  const setV = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v || "";
  };
  setV("tpl-brand-name", tpl.brand);
  setV("tpl-commission", tpl.commission);
  setV("tpl-sender-name", tpl.sender);
  setV("tpl-subject", tpl.subject);
  setV("tpl-body", tpl.body);
}

function openEmailDraftForCreator(creatorId) {
  const creator = (allFilteredCreators || []).find(c => String(c.creator_id) === String(creatorId)) || null;
  openEmailTemplateModal(creator);
}

function openEmailTemplateModal(creator = null) {
  activeDraftCreator = creator;
  _populateTemplateInputs(_loadSavedEmailTemplate());
  const titleEl = document.getElementById("email-modal-title");
  const recEl = document.getElementById("email-modal-recipient");
  if (titleEl) {
    titleEl.textContent = creator ? `Draft Outreach Email: ${creator.name}` : "Affiliate Outreach Email Template";
  }
  if (recEl) {
    const em = creator ? String(creator.business_email || "").split(",")[0].trim() : "";
    recEl.textContent = creator
      ? (em ? `Drafting personalized email for ${creator.name} (${em})` : `Drafting DM / outreach copy for ${creator.name} (no direct email listed)`)
      : "Edit merge tags & copy below — saved automatically for all creator rows";
  }
  renderEmailDraftPreview();
  const modal = document.getElementById("email-template-modal");
  if (modal) modal.classList.add("open");
}

function closeEmailTemplateModal() {
  const modal = document.getElementById("email-template-modal");
  if (modal) modal.classList.remove("open");
}

function _applyEmailMergeTags(text, creator, tpl) {
  const sample = creator || (allFilteredCreators && allFilteredCreators[0]) || {
    name: "Creator Name",
    primary_category: "Carpentry, Doors & Windows",
    sub_service: "Door & trim repair",
    city: "Austin",
    province_state: "Texas",
    country: "United States",
  };
  const loc = formatCreatorLocationText(sample) || "your area";
  return String(text || "")
    .replaceAll("{{creator_name}}", sample.name || "there")
    .replaceAll("{{trade_category}}", sample.primary_category || "DIY & Home Improvement")
    .replaceAll("{{task_category}}", sample.sub_service || "home repair projects")
    .replaceAll("{{location}}", loc)
    .replaceAll("{{your_brand}}", tpl.brand || DEFAULT_AFFILIATE_TEMPLATE.brand)
    .replaceAll("{{commission_offer}}", tpl.commission || DEFAULT_AFFILIATE_TEMPLATE.commission)
    .replaceAll("{{sender_name}}", tpl.sender || DEFAULT_AFFILIATE_TEMPLATE.sender);
}

function _readTemplateInputs() {
  return {
    brand: document.getElementById("tpl-brand-name")?.value || "",
    commission: document.getElementById("tpl-commission")?.value || "",
    sender: document.getElementById("tpl-sender-name")?.value || "",
    subject: document.getElementById("tpl-subject")?.value || "",
    body: document.getElementById("tpl-body")?.value || "",
  };
}

function renderEmailDraftPreview() {
  const tpl = _readTemplateInputs();
  const sample = activeDraftCreator || (allFilteredCreators && allFilteredCreators[0]) || null;
  const renderedSubj = _applyEmailMergeTags(tpl.subject, sample, tpl);
  const renderedBody = _applyEmailMergeTags(tpl.body, sample, tpl);

  const subjEl = document.getElementById("draft-preview-subject");
  const bodyEl = document.getElementById("draft-preview-body");
  const toEl = document.getElementById("draft-preview-to");
  const mailtoEl = document.getElementById("draft-mailto-link");

  if (subjEl) subjEl.textContent = renderedSubj;
  if (bodyEl) bodyEl.textContent = renderedBody;

  const toEmail = activeDraftCreator
    ? String(activeDraftCreator.business_email || "").split(",")[0].trim()
    : (sample ? String(sample.business_email || "").split(",")[0].trim() : "");
  if (toEl) {
    toEl.textContent = activeDraftCreator
      ? (toEmail ? `To: ${toEmail}` : "No direct email on profile — copy to DM")
      : (sample ? `Sample preview using ${sample.name}` : "Sample preview");
  }
  if (mailtoEl) {
    const mailtoHref = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(renderedSubj)}&body=${encodeURIComponent(renderedBody)}`;
    mailtoEl.href = mailtoHref;
  }
}

function insertTemplateTag(tag) {
  const bodyEl = document.getElementById("tpl-body");
  if (!bodyEl) return;
  const start = typeof bodyEl.selectionStart === "number" ? bodyEl.selectionStart : bodyEl.value.length;
  const end = typeof bodyEl.selectionEnd === "number" ? bodyEl.selectionEnd : bodyEl.value.length;
  bodyEl.value = bodyEl.value.slice(0, start) + tag + bodyEl.value.slice(end);
  bodyEl.focus();
  if (typeof bodyEl.setSelectionRange === "function") {
    bodyEl.setSelectionRange(start + tag.length, start + tag.length);
  }
  renderEmailDraftPreview();
}

function saveEmailTemplate() {
  const tpl = _readTemplateInputs();
  try {
    localStorage.setItem(AFFILIATE_TEMPLATE_STORAGE_KEY, JSON.stringify(tpl));
  } catch (_) {}
  const btn = document.getElementById("tpl-save-btn");
  if (btn) {
    const prev = btn.textContent;
    btn.textContent = "Saved!";
    setTimeout(() => { btn.textContent = prev; }, 1400);
  }
}

function resetEmailTemplate() {
  try {
    localStorage.removeItem(AFFILIATE_TEMPLATE_STORAGE_KEY);
  } catch (_) {}
  _populateTemplateInputs({ ...DEFAULT_AFFILIATE_TEMPLATE });
  renderEmailDraftPreview();
}

function copyRenderedDraft(includeSubject) {
  const subj = document.getElementById("draft-preview-subject")?.textContent || "";
  const body = document.getElementById("draft-preview-body")?.textContent || "";
  const payload = includeSubject ? `Subject: ${subj}\n\n${body}` : body;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(payload).catch(() => {});
  }
  const btn = document.getElementById(includeSubject ? "draft-copy-all-btn" : "draft-copy-btn");
  if (btn) {
    const prev = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = prev; }, 1400);
  }
}

async function triggerCreatorsScrape() {
  const btn = document.getElementById("scrape-creators-btn");
  if (!btn) return;
  btn.disabled = true;
  let elapsedSec = 0;
  btn.textContent = "Scraping Creators... (0s)";
  const timer = setInterval(() => {
    elapsedSec += 1;
    btn.textContent = `Scraping Creators... (${elapsedSec}s)`;
  }, 1000);

  try {
    const apiBase = isStaticHost() ? "http://127.0.0.1:8765" : "";
    if (!(await isBackendReachable(apiBase))) {
      alert("Creator scraping requires the local Python server running on http://127.0.0.1:8765 (or an automated cloud snapshot update). Showing archived creators.");
      return;
    }
    const resp = await fetchWithTimeout(`${apiBase}/api/scrape-creators`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ max_new_profiles: 85 }),
    }, 240000);
    const res = await resp.json();
    if (!resp.ok) throw new Error(res.error || `HTTP ${resp.status}`);
    await Promise.all([loadCreatorsSummary(), loadCreators()]);
    alert(`Creator scrape complete! Processed ${res.total_fetched} DIY creators (${res.new_stored} newly added, ${res.with_email} with business emails).`);
  } catch (e) {
    alert("Error scraping creators: " + e.message);
  } finally {
    clearInterval(timer);
    btn.disabled = false;
    btn.textContent = "Scrape DIY Creators";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  initSearchableSelects();
  const emailModal = document.getElementById("email-template-modal");
  if (emailModal) {
    emailModal.addEventListener("click", evt => {
      if (evt.target === emailModal) closeEmailTemplateModal();
    });
  }
  loadDashboard();
});
