import { useEffect } from "react";
import { Link } from "react-router-dom";
import "@/App.css";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import History from "@/pages/History";
import TopNav from "@/components/TopNav";
import { Toaster } from "sonner";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" in window ? "instant" : "auto" });
  }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <>
      <TopNav />
      <main className="px-6 lg:px-14 pb-24 max-w-7xl mx-auto min-h-[60vh] flex items-center justify-center">
        <div className="glass p-10 max-w-lg text-center fade-in">
          <div className="font-display text-7xl text-[#c8b6ff] mb-2">404</div>
          <h1 className="font-display text-3xl text-[#2a2440] mb-3">Page not found</h1>
          <p className="text-[#5c5577] mb-6">The page you’re looking for doesn’t exist or has been moved.</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link to="/" className="btn-primary"><i className="fa-solid fa-house"></i>Home</Link>
            <Link to="/history" className="btn-ghost"><i className="fa-regular fa-clock-rotate-left"></i>History</Link>
          </div>
        </div>
      </main>
    </>
  );
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/report/:id" element={<Dashboard />} />
          <Route path="/history" element={<History />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      <Toaster
        position="top-right"
        richColors
        closeButton
        pauseWhenPageIsHidden
        toastOptions={{
          style: {
            background: "rgba(255,255,255,0.78)",
            backdropFilter: "blur(16px) saturate(140%)",
            WebkitBackdropFilter: "blur(16px) saturate(140%)",
            border: "1px solid rgba(255,255,255,0.75)",
            color: "#2a2440",
            borderRadius: "18px",
            boxShadow: "0 12px 40px -14px rgba(140,110,200,0.35)",
          },
          className: "font-[Outfit]",
        }}
      />
    </div>
  );
}

export default App;
