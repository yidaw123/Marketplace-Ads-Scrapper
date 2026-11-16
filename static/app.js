let currentSettings = null;
let summaryData = null;
let trendData = null;
let currentTrendPeriod = "1Y";
let currentTrendMode = "count"; // 'count' or 'share'
let selectedPricingTrade = "all";
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
  document.getElementById("filter-intent").value = intentVal;
  if (intentVal === "demand_only") {
    document.getElementById("filter-category").value = "all";
    const subSel = document.getElementById("filter-sub-service");
    if (subSel) subSel.value = "all";
    updateSubServiceOptions();
  }
  syncActiveKpiCard(intentVal);
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
  loadTrends();
  loadPosts();
}

function onIntentDropdownChange() {
  const val = document.getElementById("filter-intent").value;
  syncActiveKpiCard(val);
  loadTrends();
  loadPosts();
}

let staticSnapshot = null;

async function ensureStaticSnapshot() {
  if (staticSnapshot) return staticSnapshot;
  const resp = await fetch("./static/snapshot.json");
  staticSnapshot = await resp.json();
  return staticSnapshot;
}

function computeStaticSummary(snap, country, province, city_region) {
  const posts = (snap.posts || []).filter(p => {
    if (country && country !== "all" && p.country !== country) return false;
    if (province && province !== "all" && p.province !== province) return false;
    if (city_region && city_region !== "all" && p.city_region !== city_region) return false;
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

function computeStaticTrends(snap, period, country, province, city_region, intent_type) {
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
  let maxDateStr = "2026-11-09";
  demandPosts.forEach(p => {
    const d = String(p.posted_at || "").slice(0, 10);
    if (d.length === 10 && d > maxDateStr) maxDateStr = d;
  });
  const maxDt = new Date(maxDateStr + "T00:00:00Z");
  const pNorm = (period || "1Y").toUpperCase();
  const buckets = [];
  const series = {};

  if (pNorm === "SEASONALITY") {
    for (let m = 1; m <= 12; m++) buckets.push({ key: String(m).padStart(2, "0"), label: monthAbbr[m - 1] });
    allKeys.forEach(k => { series[k] = new Array(12).fill(0); });
    demandPosts.forEach(p => {
      const m = parseInt(String(p.posted_at || "").slice(5, 7), 10);
      if (m >= 1 && m <= 12) {
        series["All Demand"][m - 1]++;
        if (series[p.primary_category]) series[p.primary_category][m - 1]++;
      }
    });
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
  allKeys.forEach(k => { totals[k] = (series[k] || []).reduce((a, b) => a + b, 0); });
  return { period: pNorm, buckets, series, totals, categories: cats };
}

async function fetchJsonWithFallback(url, fallbackFn) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (_e) {
    const snap = await ensureStaticSnapshot();
    return fallbackFn(snap);
  }
}

async function refreshSummaryForGeo() {
  const country = document.getElementById("filter-country").value || "all";
  const province = document.getElementById("filter-province").value || "all";
  const city = document.getElementById("filter-region").value || "all";
  const qs = new URLSearchParams({ country, province, city_region: city }).toString();
  const [sumRes] = await Promise.all([
    fetchJsonWithFallback(`/api/summary?${qs}`, snap => computeStaticSummary(snap, country, province, city)),
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
  const country = document.getElementById("filter-country").value || "all";
  const province = document.getElementById("filter-province").value || "all";
  const city = document.getElementById("filter-region").value || "all";
  const intentEl = document.getElementById("filter-intent");
  const intent_type = intentEl ? intentEl.value : "demand_only";
  const qs = new URLSearchParams({
    period: currentTrendPeriod,
    country,
    province,
    city_region: city,
    intent_type,
  }).toString();
  trendData = await fetchJsonWithFallback(`/api/trends?${qs}`, snap =>
    computeStaticTrends(snap, currentTrendPeriod, country, province, city, intent_type)
  );
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
  loadTrends();
}

function getAllWorkCategories() {
  return (trendData && trendData.categories && trendData.categories.length)
    ? trendData.categories
    : Object.keys(WORK_TYPE_COLORS).filter(k => k !== "All Demand");
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
}

function renderTrendPills() {
  const container = document.getElementById("trend-work-pills");
  if (!container || !trendData) return;
  const totals = trendData.totals || {};
  const allCats = getAllWorkCategories();
  const allSelected = allCats.every(c => activeWorkTypes.has(c));
  const keys = ["All Demand", ...allCats];

  container.innerHTML = keys.map(k => {
    const isActive = k === "All Demand" ? allSelected : activeWorkTypes.has(k);
    const color = WORK_TYPE_COLORS[k] || "#60a5fa";
    const count = totals[k] || 0;
    const borderStyle = isActive ? `border-color:${color};box-shadow:0 0 0 1px ${color}40;` : "";
    const tip = k === "All Demand"
      ? "Click to toggle ALL job types on or off"
      : "Click to toggle this job type on/off (double-click to solo)";
    return `
      <div class="work-pill ${isActive ? 'active' : ''}" style="${borderStyle}" data-wt="${esc(k)}" onclick="toggleWorkTypePill(this.dataset.wt)" ondblclick="soloWorkType(this.dataset.wt, event)" title="${tip}">
        <span class="work-pill-dot" style="background:${color};opacity:${isActive ? 1 : 0.35}"></span>
        <span>${esc(k)}</span>
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
    const modeLabel = currentTrendPeriod === "SEASONALITY"
      ? "Seasonal Monthly Aggregation (Jan - Dec)"
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
  const [sumRes, setRes] = await Promise.all([
    fetchJsonWithFallback("/api/summary", snap => computeStaticSummary(snap, "all", "all", "all")),
    fetchJsonWithFallback("/api/settings", snap => snap.settings || {}),
  ]);
  summaryData = sumRes;
  currentSettings = setRes;

  populateFilterDropdowns(sumRes);
  await refreshSummaryForGeo();
  await loadPosts();
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
  const intentEl = document.getElementById("filter-intent");
  if (intentEl) {
    if (selectedPricingSource === "hiring") intentEl.value = "customer_hiring";
    else if (selectedPricingSource === "supply") intentEl.value = "service_provider_ad";
    else intentEl.value = "hiring_and_supply";
    syncActiveKpiCard(intentEl.value);
    if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
    loadTrends();
    loadPosts();
  }
  renderPricingAndTaskBreakdown();
}

function onPricingTradeSelect(trade) {
  selectedPricingTrade = trade || "all";
  const sel = document.getElementById("pricing-trade-select");
  if (sel && sel.value !== selectedPricingTrade) sel.value = selectedPricingTrade;
  const catSel = document.getElementById("filter-category");
  if (catSel && catSel.value !== selectedPricingTrade) {
    catSel.value = selectedPricingTrade;
    const subSel = document.getElementById("filter-sub-service");
    if (subSel) subSel.value = "all";
    updateSubServiceOptions();
    loadPosts();
  }
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
  renderPricingAndTaskBreakdown();
  renderDemandSupplyRatioChart();
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

function onPricingSortChange(sortVal) {
  selectedPricingSort = sortVal || "demand_desc";
  const sSel = document.getElementById("pricing-sort-select");
  if (sSel && sSel.value !== selectedPricingSort) sSel.value = selectedPricingSort;
  if (typeof syncSearchableSelect === "function") syncSearchableSelect("pricing-sort-select");
  renderPricingAndTaskBreakdown();
}

function togglePricingColSort(colKey) {
  if (colKey === "task" || colKey === "trade") {
    selectedPricingSort = selectedPricingSort === "task_asc" ? "task_desc" : "task_asc";
  } else {
    const descKey = `${colKey}_desc`;
    const ascKey = `${colKey}_asc`;
    selectedPricingSort = selectedPricingSort === descKey ? ascKey : descKey;
  }
  const sSel = document.getElementById("pricing-sort-select");
  if (sSel) sSel.value = selectedPricingSort;
  if (typeof syncSearchableSelect === "function") syncSearchableSelect("pricing-sort-select");
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

  const tasks = selectedPricingTrade === "all"
    ? allTaskRows
    : allTaskRows.filter(s => s.primary_category === selectedPricingTrade);

  const rowsHtml = tasks.map(t => {
    const dt = (t.latest_posted_at || "").slice(0, 10) || "—";
    return `
    <tr data-cat="${esc(t.primary_category)}" data-sub="${esc(t.sub_service)}" onclick="filterBySubService(this.dataset.cat, this.dataset.sub)" title="Click to filter leads table to this Task Category">
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

  const headerSubtitle = selectedPricingTrade === "all"
    ? `Showing <strong>All Task Categories (${tasks.length})</strong> &middot; Pricing Source: <strong>${sourceLabel}</strong>`
    : `Showing <strong>${tasks.length} Task Categories</strong> in <strong>${esc(selectedPricingTrade)}</strong> &middot; Pricing Source: <strong>${sourceLabel}</strong>`;

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
      <div style="font-size:0.84rem;color:var(--text-secondary);">
        ${headerSubtitle}
      </div>
      ${selectedPricingTrade !== "all" ? `<button class="secondary" style="padding:5px 11px;font-size:0.78rem;" onclick="onPricingTradeSelect('all')">Show All Trade Categories</button>` : ""}
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
        <tbody>${rowsHtml || `<tr><td colspan="7" style="text-align:center;color:var(--muted);">No task categories found for this trade.</td></tr>`}</tbody>
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

  let items = [];
  if (ratioViewLevel === "trade") {
    items = (summaryData.category_breakdown || []).map(c => ({
      title: c.primary_category,
      subtitle: `${c.hiring_count || 0} Hiring · ${c.diy_count || 0} DIY`,
      primary_category: c.primary_category,
      sub_service: null,
      demand: isHiringOnly ? (c.hiring_count || 0) : (c.total_demand || 0),
      supply: c.provider_supply || 0,
    }));
  } else {
    const rawSubs = summaryData.sub_service_breakdown || [];
    const filteredSubs = selectedPricingTrade === "all"
      ? rawSubs
      : rawSubs.filter(s => s.primary_category === selectedPricingTrade);
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

  const displayItems = ratioViewLevel === "task" && selectedPricingTrade === "all"
    ? items.slice(0, 14)
    : items;

  if (!displayItems.length) {
    container.innerHTML = `<p style="color:var(--muted);">No demand or supply data for the current filter.</p>`;
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
    const platNames = { reddit: "Reddit", craigslist: "Craigslist", kijiji: "Kijiji", "51ca": "51.ca", stackexchange: "StackExchange" };
    const platClasses = { reddit: "b-reddit", craigslist: "b-craigslist", kijiji: "b-kijiji", "51ca": "b-51ca", stackexchange: "b-stackexchange" };
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
  const catSel = document.getElementById("filter-category");
  const currentCat = catSel.value || "all";
  const cats = [...(sumRes.categories_list || [])].sort((a, b) => a.localeCompare(b));
  catSel.innerHTML = `<option value="all">All Trade Categories</option>` +
    cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  catSel.value = currentCat;

  const pSel = document.getElementById("pricing-trade-select");
  if (pSel) {
    pSel.innerHTML = `<option value="all">All Trade Categories (Show All Task Categories)</option>` +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    pSel.value = selectedPricingTrade;
  }

  updateSubServiceOptions();
  updateProvinceAndCityOptions();
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
}

function updateSubServiceOptions() {
  const subSel = document.getElementById("filter-sub-service");
  if (!subSel) return;
  const cat = document.getElementById("filter-category").value || "all";
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
  if (typeof syncSearchableSelect === "function") syncSearchableSelect("filter-sub-service");
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
  await refreshSummaryForGeo();
  await loadPosts();
}

async function onProvinceChange() {
  document.getElementById("filter-region").value = "all";
  updateProvinceAndCityOptions();
  await refreshSummaryForGeo();
  await loadPosts();
}

async function onCityChange() {
  await refreshSummaryForGeo();
  await loadPosts();
}

function onCategoryDropdownChange() {
  const cat = document.getElementById("filter-category").value;
  const subSel = document.getElementById("filter-sub-service");
  if (subSel) subSel.value = "all";
  updateSubServiceOptions();
  if (cat && cat !== "all") {
    activeWorkTypes.add(cat);
    renderTrendPills();
    renderTrendChart();
    onPricingTradeSelect(cat);
  } else {
    onPricingTradeSelect("all");
  }
  loadPosts();
}

function filterByCategory(cat) {
  document.getElementById("filter-category").value = cat;
  const subSel = document.getElementById("filter-sub-service");
  if (subSel) subSel.value = "all";
  updateSubServiceOptions();
  if (cat && cat !== "all") {
    activeWorkTypes.add(cat);
    renderTrendPills();
    renderTrendChart();
    onPricingTradeSelect(cat);
  }
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
  await refreshSummaryForGeo();
  await loadPosts();
}

function getFilterQueryString() {
  const subSel = document.getElementById("filter-sub-service");
  const params = new URLSearchParams({
    platform: document.getElementById("filter-platform").value,
    intent_type: document.getElementById("filter-intent").value,
    category: document.getElementById("filter-category").value,
    sub_service: subSel ? subSel.value : "all",
    country: document.getElementById("filter-country").value,
    province: document.getElementById("filter-province").value,
    city_region: document.getElementById("filter-region").value,
    urgency: document.getElementById("filter-urgency").value,
    search: document.getElementById("filter-search").value,
  });
  return params.toString();
}

async function loadPosts() {
  const qs = getFilterQueryString();
  document.getElementById("export-btn").href = `/api/export.csv?${qs}`;

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
  document.getElementById("filter-sort").value = "relevance";
  document.getElementById("filter-search").value = "";
  selectedPricingTrade = "all";
  selectedPricingSource = "all";
  selectedPricingSort = "demand_desc";
  document.querySelectorAll("#pricing-source-tabs .period-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-source") === "all");
  });
  const pSel = document.getElementById("pricing-trade-select");
  if (pSel) pSel.value = "all";
  const pSortSel = document.getElementById("pricing-sort-select");
  if (pSortSel) pSortSel.value = "demand_desc";
  syncActiveKpiCard("demand_only");
  updateSubServiceOptions();
  updateProvinceAndCityOptions();
  if (typeof syncAllSearchableSelects === "function") syncAllSearchableSelects();
  await refreshSummaryForGeo();
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
      : p.platform === "stackexchange"
      ? `<span class="badge b-stackexchange">StackExchange</span>`
      : `<span class="badge b-craigslist">Craigslist</span>`;

    const urgBadge = p.urgency === "high"
      ? `<div style="margin-top:5px;"><span class="badge b-high">Urgent</span></div>`
      : "";

    const bodySnippet = (p.body || "").trim();
    const dateStr = (p.posted_at || "").slice(0, 10);

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
          </div>
        </td>
        <td style="text-align:right;">
          <a class="btn" style="padding:6px 14px;font-size:0.8rem;" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">Link</a>
        </td>
      </tr>
    `;
  }).join("");

  if (pagBar) {
    const pages = [];
    const windowStart = Math.max(1, currentPage - 2);
    const windowEnd = Math.min(totalPages, currentPage + 2);
    if (windowStart > 1) pages.push(1);
    if (windowStart > 2) pages.push("...");
    for (let i = windowStart; i <= windowEnd; i++) pages.push(i);
    if (windowEnd < totalPages - 1) pages.push("...");
    if (windowEnd < totalPages) pages.push(totalPages);

    const pageBtnsHtml = pages.map(pg =>
      pg === "..."
        ? `<span style="padding:0 4px;">...</span>`
        : `<button class="page-btn ${pg === currentPage ? 'active' : ''}" onclick="goToPage(${pg})">${pg}</button>`
    ).join("");

    pagBar.innerHTML = `
      <div>
        Showing <strong>${startIdx + 1}-${endIdx}</strong> of <strong>${total}</strong>
        &nbsp;·&nbsp;
        Rows:
        <select class="page-size-select" onchange="changePageSize(this.value)">
          ${[10, 25, 50, 100].map(sz => `<option value="${sz}" ${sz === pageSize ? 'selected' : ''}>${sz}</option>`).join("")}
        </select>
      </div>
      <div class="page-controls">
        <button class="page-btn" onclick="goToPage(${currentPage - 1})" ${currentPage <= 1 ? "disabled" : ""}>Previous</button>
        ${pageBtnsHtml}
        <button class="page-btn" onclick="goToPage(${currentPage + 1})" ${currentPage >= totalPages ? "disabled" : ""}>Next</button>
      </div>
    `;
  }
}

async function triggerScrape() {
  const btn = document.getElementById("scrape-btn");
  btn.disabled = true;
  btn.textContent = "Scraping...";
  try {
    const resp = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platforms: ["reddit", "craigslist", "kijiji", "stackexchange", "51ca"], include_national_reddit: true }),
    });
    const res = await resp.json();
    if (!resp.ok) throw new Error(res.error || `HTTP ${resp.status}`);
    await loadDashboard();
    alert(`Scrape complete! Fetched ${res.total_fetched} posts (${res.new_stored} new stored, ${res.demand_leads_found} demand leads).`);
  } catch (e) {
    alert("Error running scrape: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Run Live Scrape";
  }
}

async function triggerReclassify() {
  if (!confirm("Re-run classification on all stored posts with the latest rules (and LLM, if configured)?")) return;
  const res = await fetch("/api/reclassify", { method: "POST" }).then(r => r.json());
  await loadDashboard();
  alert(`Reclassified ${res.count} posts.`);
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

  await fetch("/api/settings", {
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
  });
  closeSettingsModal();
  await loadDashboard();
}

const SEARCHABLE_SELECT_IDS = [
  "pricing-trade-select",
  "pricing-sort-select",
  "filter-country",
  "filter-province",
  "filter-region",
  "filter-category",
  "filter-sub-service",
  "filter-platform",
  "filter-intent",
  "filter-urgency",
  "filter-sort",
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

window.addEventListener("DOMContentLoaded", () => {
  initSearchableSelects();
  loadDashboard();
});
