import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { fetchHistory, deleteReport } from "@/lib/api";
import TopNav from "@/components/TopNav";

export default function History() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("created_at");
  const [sortAsc, setSortAsc] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchHistory(100);
      setItems(data);
    } catch (e) {
      toast.error("Could not load history");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function onDelete(id, domain) {
    const ok = window.confirm(`Delete report for ${domain}? This cannot be undone.`);
    if (!ok) return;
    try {
      await deleteReport(id);
      toast.success("Report deleted");
      setItems((xs) => xs.filter((x) => x.id !== id));
    } catch (e) {
      toast.error("Delete failed");
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = items
    .filter((it) => !q || (it.domain || "").toLowerCase().includes(q) || (it.grade || "").toLowerCase() === q)
    .sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (sortKey === "created_at") {
        return sortAsc ? Date.parse(av) - Date.parse(bv) : Date.parse(bv) - Date.parse(av);
      }
      const an = typeof av === "number" ? av : 0;
      const bn = typeof bv === "number" ? bv : 0;
      return sortAsc ? an - bn : bn - an;
    });

  function toggleSort(k) {
    if (sortKey === k) setSortAsc(!sortAsc);
    else { setSortKey(k); setSortAsc(k === "created_at" ? false : true); }
  }

  return (
    <>
      <TopNav />
      <main className="px-6 lg:px-14 pb-24 max-w-7xl mx-auto">
        <div className="mb-8 fade-in">
          <span className="chip chip-lav mb-3"><i className="fa-regular fa-clock-rotate-left"></i>History</span>
          <h1 className="font-display text-3xl lg:text-4xl text-[#2a2440]">Past audits</h1>
          <p className="text-[#8a84a3] mt-2 text-sm">Every scan is saved so you can return to it anytime.</p>
        </div>

        {/* Search + Sort toolbar */}
        {!loading && items.length > 0 && (
          <div className="glass p-3 mb-6 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <div className="relative flex-1">
              <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-[#8a84a3] pointer-events-none"></i>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by domain or grade (e.g. A+, github)…"
                className="input-glass !py-3 pl-10 bg-transparent border-0 focus:shadow-none"
                aria-label="Search history"
              />
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <span className="text-xs text-[#8a84a3]">Sort:</span>
              {[
                ["created_at", "Date"],
                ["global_score", "Score"],
                ["issues_count", "Issues"],
              ].map(([k, label]) => (
                <button
                  key={k}
                  className={`chip ${sortKey === k ? "chip-lav" : ""}`}
                  onClick={() => toggleSort(k)}
                  aria-pressed={sortKey === k}
                >
                  {label}
                  {sortKey === k && <i className={`fa-solid fa-caret-${sortAsc ? "up" : "down"} ml-1 text-[10px]`}></i>}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass p-5 space-y-3 animate-pulse">
                <div className="flex gap-3 items-start">
                  <div className="w-10 h-10 rounded-full bg-[#e9deff]"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-[#e9deff]/70 rounded w-3/4"></div>
                    <div className="h-3 bg-white/60 rounded w-1/2"></div>
                  </div>
                </div>
                <div className="h-6 bg-white/60 rounded w-full"></div>
                <div className="h-9 bg-white/50 rounded-xl w-full"></div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 && items.length > 0 ? (
          <div className="glass p-10 text-center">
            <i className="fa-regular fa-circle-xmark text-4xl text-[#c8b6ff] mb-4"></i>
            <p className="text-[#5c5577]">No reports match <strong>{query}</strong>.</p>
            <button onClick={() => setQuery("")} className="btn-ghost mt-4 inline-flex"><i className="fa-solid fa-delete-left"></i>Clear search</button>
          </div>
        ) : items.length === 0 ? (
          <div className="glass p-10 text-center" data-testid="history-empty">
            <i className="fa-regular fa-folder-open text-4xl text-[#c8b6ff] mb-4"></i>
            <p className="text-[#5c5577]">No reports yet. Start by analysing a domain.</p>
            <Link to="/" className="btn-primary mt-4 inline-flex" data-testid="start-first-scan">Start a scan</Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 stagger" data-testid="history-grid">
            {filtered.map((it) => (
              <div key={it.id} className="glass p-5 flex flex-col gap-3 group hover:translate-y-[-2px] transition-transform" data-testid={`history-item-${it.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link to={`/report/${it.id}`} className="font-display text-lg text-[#2a2440] truncate block hover:text-[#8b7fd3] transition-colors" title={it.domain}>{it.domain}</Link>
                    <div className="text-xs text-[#8a84a3] mt-0.5"><i className="fa-regular fa-clock text-[10px] mr-1"></i>{new Date(it.created_at).toLocaleString()}</div>
                  </div>
                  <div className={`grade-pill !w-10 !h-10 !text-base shrink-0 grade-${(it.grade || "N").replace("+", "plus")}`} aria-label={`Grade ${it.grade || "—"}`}>{it.grade || "—"}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="chip chip-lav">Score {it.global_score ?? "—"}</span>
                  <span className={it.issues_count > 0 ? "chip sev-Medium" : "chip chip-mint"}>Issues {it.issues_count}</span>
                  <span className="chip">Pages {it.pages_crawled ?? 0}</span>
                </div>
                <div className="flex gap-2 pt-2">
                  <Link to={`/report/${it.id}`} className="btn-ghost flex-1 justify-center" data-testid={`open-${it.id}`}>
                    <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>Open
                  </Link>
                  <button
                    onClick={() => onDelete(it.id, it.domain)}
                    className="btn-ghost hover:!bg-[#ffd8e4] hover:!text-[#8a2c54]"
                    data-testid={`delete-${it.id}`}
                    aria-label={`Delete report for ${it.domain}`}
                    title="Delete report"
                  >
                    <i className="fa-regular fa-trash-can text-xs"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
