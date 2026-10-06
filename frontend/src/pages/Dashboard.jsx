import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { fetchReport, fetchAIInsights, exportExcel, screenshotUrl } from "@/lib/api";
import TopNav from "@/components/TopNav";

function Metric({ label, value, tint = "chip-lav", icon, progress }) {
  const pct = typeof progress === "number" ? Math.max(0, Math.min(100, progress)) : null;
  return (
    <div className="glass p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className={`chip ${tint}`}>{icon && <i className={icon}></i>}{label}</span>
      </div>
      <div className="font-display text-3xl text-[#2a2440] leading-none tabular-nums">{value}</div>
      {pct !== null && (
        <div className="w-full h-1.5 rounded-full bg-white/60 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} progress`}>
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-out"
            style={{
              width: `${pct}%`,
              background: tint.includes("mint") ? "linear-gradient(90deg,#a7e8c3,#56b98a)"
                : tint.includes("peach") ? "linear-gradient(90deg,#ffc3a0,#ff9a7a)"
                : tint.includes("rose") ? "linear-gradient(90deg,#ffb4cc,#ff8aac)"
                : "linear-gradient(90deg,#c8b6ff,#8b7fd3)",
            }}
          />
        </div>
      )}
    </div>
  );
}

/* Safe, XSS-free markdown renderer. Builds real React nodes — no innerHTML. */
function inlineFormat(text) {
  const out = [];
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  tokens.forEach((tok, i) => {
    if (tok.startsWith("**") && tok.endsWith("**")) {
      out.push(<strong key={i}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`") && tok.endsWith("`")) {
      out.push(<code key={i}>{tok.slice(1, -1)}</code>);
    } else {
      out.push(<span key={i}>{tok}</span>);
    }
  });
  return out.length === 1 ? out[0] : out;
}

function RenderMarkdownLite({ text }) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m = line.match(/^###\s+(.+)$/);
    if (m) { blocks.push(<h3 key={key++}>{inlineFormat(m[1])}</h3>); i++; continue; }
    m = line.match(/^##?\s+(.+)$/);
    if (m) { blocks.push(<h2 key={key++}>{inlineFormat(m[1])}</h2>); i++; continue; }
    if (/^-\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(inlineFormat(lines[i].replace(/^-\s+/, "")));
        i++;
      }
      blocks.push(
        <ul key={key++}>
          {items.map((it, k) => (<li key={k}>{it}</li>))}
        </ul>
      );
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(inlineFormat(lines[i].replace(/^\d+\.\s+/, "")));
        i++;
      }
      blocks.push(
        <ol key={key++}>
          {items.map((it, k) => (<li key={k}>{it}</li>))}
        </ol>
      );
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|-\s|\d+\.\s)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) blocks.push(<p key={key++}>{inlineFormat(para.join(" "))}</p>);
  }
  return <div className="prose-ai" role="article" aria-label="AI-generated audit insights">{blocks}</div>;
}

export default function Dashboard() {
  const { id } = useParams();
  const [report, setReport] = useState(null);
  const [tab, setTab] = useState("overview");
  const [aiLoading, setAiLoading] = useState(false);
  const [ai, setAi] = useState(null);
  const [aiAbort, setAiAbort] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [screenshotOk, setScreenshotOk] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const cached = sessionStorage.getItem(`report:${id}`);
    if (cached) {
      try {
        if (!cancelled) setReport(JSON.parse(cached));
        return;
      } catch (_) {}
    }
    fetchReport(id, { signal: controller.signal })
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e) => {
        if (e?.name !== "Canceled") toast.error(e?.message || "Could not load report");
      });
    return () => { cancelled = true; controller.abort(); };
  }, [id]);

  async function onCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      toast.success("Report link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch { toast.error("Copy failed"); }
  }

  function onKeyTab(e, k) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTab(k); }
  }

  async function onGenerateAI() {
    if (!report) return;
    if (aiAbort) aiAbort.abort();
    const ctrl = new AbortController();
    setAiAbort(ctrl);
    setAiLoading(true);
    setAi(null);
    const t = toast.loading("AI analysing data…");
    try {
      const data = await fetchAIInsights(report, { signal: ctrl.signal });
      toast.dismiss(t);
      if (!data.ok) {
        toast.error(data.error || "AI request failed");
      } else {
        toast.success("AI insights ready");
      }
      setAi(data);
    } catch (e) {
      toast.dismiss(t);
      if (e?.name !== "Canceled") toast.error(e?.message || "AI request failed");
    } finally {
      setAiLoading(false);
      setAiAbort(null);
    }
  }

  async function onExport() {
    if (!report) return;
    setExporting(true);
    try {
      await exportExcel(report);
      toast.success("Excel downloaded");
    } catch (e) {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }

  if (!report) {
    return (
      <>
        <TopNav />
        <div className="px-6 lg:px-14 pb-24 max-w-7xl mx-auto">
          <div className="glass p-10 flex items-center gap-4 fade-in">
            <span className="flex gap-1.5"><span className="pulse-dot"></span><span className="pulse-dot"></span><span className="pulse-dot"></span></span>
            <div className="text-[#5c5577]">Loading report…</div>
          </div>
        </div>
      </>
    );
  }

  const d = report.domain || {};
  const seo = report.seo || {};
  const cyber = report.cyber || {};
  const audits = seo.audits || [];
  const avgLoad = audits.length ? (audits.reduce((s, a) => s + (a.load_time_sec || 0), 0) / audits.length).toFixed(2) : "—";
  const avgLCP = audits.length ? (audits.reduce((s, a) => s + (a.lcp_sec || 0), 0) / audits.length).toFixed(2) : "—";

  const grade = cyber.grade || "N/A";
  const gradeClass = grade === "A+" ? "grade-Aplus" : `grade-${grade.replace("+", "plus")}`;

  const tabs = [
    { k: "overview", label: "Overview", icon: "fa-solid fa-chart-pie" },
    { k: "seo", label: "SEO Issues", icon: "fa-solid fa-list-check" },
    { k: "security", label: "Security", icon: "fa-solid fa-shield-halved" },
    { k: "pages", label: "Pages", icon: "fa-solid fa-layer-group" },
    { k: "ai", label: "AI Insights", icon: "fa-solid fa-brain" },
  ];

  return (
    <>
      <TopNav
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className="btn-ghost"
              onClick={onCopyLink}
              disabled={!report}
              aria-label="Copy report link"
              title="Share this report"
              data-testid="copy-link-btn"
            >
              <i className={copied ? "fa-solid fa-check text-[#56b98a]" : "fa-regular fa-share-nodes"}></i>
              <span className="hidden sm:inline">{copied ? "Copied" : "Share"}</span>
            </button>
            <button
              className="btn-primary !py-2.5 !px-5 !text-sm"
              onClick={onExport}
              disabled={exporting || !report}
              data-testid="export-btn"
              aria-label="Export report to Excel"
            >
              <i className="fa-regular fa-file-excel"></i>
              {exporting ? "Exporting…" : "Export Excel"}
            </button>
          </div>
        }
      />
      <main className="px-6 lg:px-14 pb-24 max-w-7xl mx-auto">
        {/* Hero summary */}
        <section className="glass p-6 lg:p-8 flex flex-col lg:flex-row gap-6 lg:items-center fade-in" data-testid="dashboard-hero">
          <div className={`grade-pill ${gradeClass}`} data-testid="grade-pill">{grade}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="chip chip-lav">{cyber.rating || "Audited"}</span>
              <span className="chip">{(d.ssl_status) || "SSL —"}</span>
              <span className="chip">{seo.audits?.length || 0} pages</span>
              <span className="chip">{seo.issues?.length || 0} issues</span>
            </div>
            <h1 className="font-display text-3xl lg:text-4xl mt-3 text-[#2a2440] truncate" data-testid="report-domain">{d.domain || "Unknown"}</h1>
            <p className="text-sm text-[#8a84a3] mt-1">
              Reported {new Date(report.created_at).toLocaleString()} · Registrar: <span className="text-[#5c5577]">{d.registrar || "N/A"}</span>
            </p>
          </div>
          {screenshotOk && d.domain && (
           <div className="w-full lg:w-72 aspect-video rounded-2xl overflow-hidden border border-white/70 shadow">
  <img
    src={screenshotUrl(d.domain)}
    alt="site preview"
    className="w-full h-full object-contain"
    onError={() => setScreenshotOk(false)}
    data-testid="site-preview"
  />
</div>
          )}
        </section>

        {/* Metrics with progress bars for visual UX */}
        <section className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4 stagger" data-testid="metrics-grid">
          <Metric label="Security Score" value={`${cyber.global_score ?? "—"}`} icon="fa-solid fa-shield-halved" tint="chip-lav" progress={cyber.global_score} />
          <Metric label="SEO Issues" value={seo.issues?.length ?? 0} icon="fa-solid fa-triangle-exclamation" tint="chip-peach" progress={Math.max(0, 100 - (seo.issues?.length || 0) * 5)} />
          <Metric label="Avg Load" value={`${avgLoad}s`} icon="fa-solid fa-gauge-high" tint="chip-mint" progress={Math.max(0, 100 - Number(avgLoad || 0) * 20)} />
          <Metric label="Avg LCP" value={`${avgLCP}s`} icon="fa-solid fa-bolt" tint="chip-rose" progress={Math.max(0, 100 - Number(avgLCP || 0) * 30)} />
        </section>

        {/* Tabs — accessible with keyboard navigation + ARIA */}
        <nav
          className="mt-8 flex gap-2 overflow-x-auto pb-1"
          role="tablist"
          aria-label="Report sections"
          data-testid="tabs-nav"
        >
          {tabs.map((t) => (
            <button
              key={t.k}
              role="tab"
              aria-selected={tab === t.k}
              aria-controls={`panel-${t.k}`}
              tabIndex={tab === t.k ? 0 : -1}
              onClick={() => setTab(t.k)}
              onKeyDown={(e) => onKeyTab(e, t.k)}
              className={`chip ${tab === t.k ? "chip-lav" : ""} whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-[#c8b6ff]/70`}
              style={tab === t.k ? { fontWeight: 600 } : {}}
              data-testid={`tab-${t.k}`}
            >
              <i className={t.icon} aria-hidden="true"></i>
              {t.label}
            </button>
          ))}
        </nav>

        {/* AI cancel button (visible when AI is loading) */}
        {aiLoading && tab === "ai" && (
          <div className="mt-4 flex justify-end">
            <button className="btn-ghost" onClick={() => aiAbort?.abort()}>
              <i className="fa-solid fa-stop"></i> Cancel
            </button>
          </div>
        )}

        <section className="mt-5 fade-in" key={tab}>
          {tab === "overview" && (
            <div className="grid lg:grid-cols-2 gap-5">
              <div className="glass p-6">
                <h3 className="font-display text-xl text-[#2a2440] mb-4">Domain intelligence</h3>
                <dl className="space-y-2 text-sm">
                  {[
                    ["Registrar", d.registrar],
                    ["Creation", d.creation_date],
                    ["Expiration", d.expiration_date],
                    ["Nameservers", d.name_servers],
                    ["MX records", d.mx_records],
                    ["A records", d.a_records],
                    ["SSL", d.ssl_status],
                    ["robots.txt", d.robots_txt],
                    ["sitemap.xml", d.sitemap_xml],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 py-1 border-b border-white/40 last:border-0">
                      <dt className="text-[#8a84a3]">{k}</dt>
                      <dd className="text-[#2a2440] text-right break-all max-w-[60%]">{v || "N/A"}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="glass p-6">
                <h3 className="font-display text-xl text-[#2a2440] mb-4">Security snapshot</h3>
                <dl className="space-y-2 text-sm">
                  {[
                    ["Grade", cyber.grade],
                    ["Rating", cyber.rating],
                    ["Headers score", cyber.headers_score],
                    ["Phishing score", cyber.phishing_score],
                    ["Malware score", cyber.malware_score],
                    ["TLS", cyber.ssl_info?.tls_version],
                    ["Cipher", cyber.ssl_info?.cipher],
                    ["SSL Expiry", cyber.ssl_info?.expiry_date],
                    ["Days left", cyber.ssl_info?.days_left],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 py-1 border-b border-white/40 last:border-0">
                      <dt className="text-[#8a84a3]">{k}</dt>
                      <dd className="text-[#2a2440] text-right">{v ?? "N/A"}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-5">
                  <div className="text-xs uppercase tracking-wider text-[#8a84a3] mb-2">Recommendations</div>
                  <ul className="space-y-2 text-sm">
                    {(cyber.recommendations || []).slice(0, 6).map((r, i) => (
                      <li key={i} className="flex gap-2 text-[#5c5577]"><i className="fa-solid fa-circle-check text-[#a7e8c3] mt-1"></i><span>{r}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {tab === "seo" && (
            <div className="glass p-6" data-testid="seo-panel">
              <h3 className="font-display text-xl text-[#2a2440] mb-4">SEO Issues · {seo.issues?.length || 0}</h3>
              {(seo.issues?.length || 0) === 0 ? (
                <p className="text-[#5c5577]">No SEO issues detected. Beautiful.</p>
              ) : (
                <div className="space-y-3">
                  {seo.issues.map((i, idx) => (
                    <div key={idx} className="glass-soft p-4" data-testid={`issue-${idx}`}>
                      <div className="flex flex-wrap gap-2 items-center">
                        <span className={`chip sev-${i.severity}`}>{i.severity}</span>
                        <span className="chip">{i.category}</span>
                        <span className="font-medium text-[#2a2440]">{i.issue}</span>
                      </div>
                      <p className="text-sm text-[#5c5577] mt-2">{i.description}</p>
                      <p className="text-sm mt-1"><strong className="text-[#4a3b7a]">Fix:</strong> <span className="text-[#5c5577]">{i.fix}</span></p>
                      <p className="text-xs text-[#8a84a3] mt-2 break-all font-mono">{i.url}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "security" && (
            <div className="glass p-6" data-testid="security-panel">
              <h3 className="font-display text-xl text-[#2a2440] mb-4">HTTP security headers</h3>
              <div className="space-y-2">
                {(cyber.header_findings || []).map((f, i) => (
                  <div key={i} className="flex items-start gap-3 glass-soft p-3">
                    <span className={`chip sev-${f.severity}`}>{f.status}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[#2a2440]">{f.header}</div>
                      <div className="text-xs text-[#8a84a3]">{f.desc}</div>
                      {f.value && f.value !== "N/A" && <div className="text-xs font-mono text-[#5c5577] mt-1 break-all">{f.value}</div>}
                    </div>
                  </div>
                ))}
              </div>
              {(cyber.phishing_reasons?.length || 0) > 0 && (
                <>
                  <h3 className="font-display text-xl text-[#2a2440] mt-6 mb-3">Phishing heuristics</h3>
                  <ul className="space-y-1 text-sm text-[#5c5577] list-disc pl-5">
                    {cyber.phishing_reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </>
              )}
              {(cyber.malware_reasons?.length || 0) > 0 && (
                <>
                  <h3 className="font-display text-xl text-[#2a2440] mt-6 mb-3">Malware signals</h3>
                  <ul className="space-y-1 text-sm text-[#5c5577] list-disc pl-5">
                    {cyber.malware_reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </>
              )}
            </div>
          )}

          {tab === "pages" && (
            <div className="glass p-6 overflow-x-auto" data-testid="pages-panel">
              <h3 className="font-display text-xl text-[#2a2440] mb-4">Pages crawled · {seo.pages?.length || 0}</h3>
              <table className="w-full text-sm pages-table">
                <thead>
                  <tr className="text-left text-[#8a84a3] text-xs uppercase tracking-wider">
                    <th className="pb-3">URL</th>
                    <th className="pb-3">Title</th>
                    <th className="pb-3 text-center">Status</th>
                    <th className="pb-3 text-right">Load</th>
                    <th className="pb-3 text-right">LCP</th>
                    <th className="pb-3 text-right">Speed</th>
                  </tr>
                </thead>
                <tbody>
                  {(seo.pages || []).map((p, i) => {
                    const a = (seo.audits || []).find((x) => x.url === p.url) || {};
                    return (
                      <tr key={i} className="border-t border-white/40">
                        <td data-label="URL" className="py-3 font-mono text-xs text-[#5c5577] break-all max-w-[220px]">{p.url}</td>
                        <td data-label="Title" className="py-3 text-[#2a2440] truncate max-w-[220px]">{p.title}</td>
                        <td data-label="Status" className="py-3 text-center"><span className={`chip ${p.status < 400 ? "chip-mint" : "sev-High"}`}>{p.status}</span></td>
                        <td data-label="Load" className="py-3 text-right text-[#5c5577]">{a.load_time_sec ?? "—"}s</td>
                        <td data-label="LCP" className="py-3 text-right text-[#5c5577]">{a.lcp_sec ?? "—"}s</td>
                        <td data-label="Speed" className="py-3 text-right text-[#5c5577]">{a.page_speed_score ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tab === "ai" && (
            <div className="glass p-6" data-testid="ai-panel">
              <div className="flex items-center justify-between mb-4 gap-3">
                <h3 className="font-display text-xl text-[#2a2440]">AI commentary</h3>
                <button className="btn-primary !py-2.5 !px-5 !text-sm" onClick={onGenerateAI} disabled={aiLoading} data-testid="ai-generate-btn">
                  {aiLoading ? "Thinking…" : (ai ? "Regenerate" : "Generate insights")}
                  <i className={aiLoading ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-wand-sparkles"}></i>
                </button>
              </div>
              {!ai && !aiLoading && (
                <p className="text-[#5c5577] text-sm">Press <em>Generate insights</em> to get a prioritised plain-English action plan generated by the Apodex model.</p>
              )}
              {ai && !ai.ok && <p className="text-[#8a2c54] text-sm">{ai.error}</p>}
              {ai && ai.ok && <RenderMarkdownLite text={ai.insights} />}
              {ai && ai.ok && <p className="text-xs text-[#8a84a3] mt-4 italic">model: {ai.model}</p>}
            </div>
          )}
        </section>

        <div className="mt-10 text-center">
          <Link to="/" className="btn-ghost" data-testid="back-home-btn">
            <i className="fa-solid fa-arrow-left"></i>
            Scan another domain
          </Link>
        </div>
      </main>
    </>
  );
}
