import axios from "axios";

// Vite convention: import.meta.env (also supports REACT_APP_* via envPrefix in vite.config)
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.REACT_APP_BACKEND_URL ||
  (import.meta.env.DEV ? "http://localhost:8000" : "");

export const API = BACKEND_URL ? `${BACKEND_URL.replace(/\/$/, "")}/api` : "/api";

function _normalizeError(err) {
  if (!err) return new Error("Unknown error");
  if (err.code === "ECONNABORTED") return new Error("Request timed out — please try again.");
  if (err.code === "ERR_NETWORK")
    return new Error("Cannot reach the server. Check your connection and backend URL.");
  const detail = err.response?.data?.detail;
  if (detail) {
    return new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  if (err.response?.status === 429) return new Error("Too many requests — slow down a little.");
  if (err.response?.status === 403) return new Error(err.message || "Request blocked (security policy).");
  if (err.response?.status >= 500) return new Error("Server error — our team has been notified.");
  return err instanceof Error ? err : new Error(err?.message || "Request failed");
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export const api = axios.create({
  baseURL: API,
  timeout: 180000,
  headers: {
    Accept: "application/json",
    "X-Client": "Aryxton Labs-web",
  },
});

api.interceptors.response.use(undefined, async (err) => {
  const config = err.config || {};
  if (!config.__retryCount) config.__retryCount = 0;
  const method = (config.method || "").toLowerCase();
  const isGet = method === "get" || method === "head";
  const transient =
    !err.response || err.response.status >= 500 || err.response.status === 429;
  if (isGet && transient && config.__retryCount < 2) {
    config.__retryCount += 1;
    const backoff = 400 * Math.pow(2, config.__retryCount);
    await _sleep(backoff);
    return api.request(config);
  }
  return Promise.reject(_normalizeError(err));
});

export async function analyzeDomain(domain, maxPages = 8, { signal } = {}) {
  const { data } = await api.post(
    "/analyze",
    { domain, max_pages: maxPages },
    { signal }
  );
  return data;
}

export async function fetchAIInsights(report, { signal } = {}) {
  const { data } = await api.post("/ai-insights", { report }, { signal });
  return data;
}

export async function fetchHistory(limit = 20, { signal } = {}) {
  const { data } = await api.get("/history", { params: { limit }, signal });
  return data.items || [];
}

export async function fetchReport(id, { signal } = {}) {
  const { data } = await api.get(`/report/${id}`, { signal });
  return data;
}

export async function deleteReport(id) {
  const { data } = await api.delete(`/report/${id}`);
  return data;
}

export async function exportExcel(report) {
  if (!report) return;
  const res = await api.post("/export/excel", { report }, { responseType: "blob" });
  let filename = `website-analyser-${report.domain?.domain || "report"}.xlsx`;
  const cd = res.headers["content-disposition"];
  if (cd) {
    const m = cd.match(/filename="?([^"]+)"?/);
    if (m?.[1]) filename = m[1];
  }
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function screenshotUrl(url) {
  if (!url) return "";
  return `${API}/screenshot?url=${encodeURIComponent(url)}`;
}

export function healthcheckUrl() {
  return `${API}/health`;
}
