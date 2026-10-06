import { Link } from "react-router-dom";

export default function TopNav({ right }) {
  return (
    <header className="w-full px-6 lg:px-14 py-6 flex items-center justify-between fade-in">
      <Link to="/" className="flex items-center gap-3 group" data-testid="top-nav-logo">
        <div className="w-10 h-10 rounded-2xl glass flex items-center justify-center group-hover:rotate-6 transition-transform duration-300">
          <i className="fa-solid fa-wand-magic-sparkles text-[#8b7fd3] text-lg"></i>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-xl text-[#2a2440]">Aryxton Labs</span>
          <span className="text-[11px] uppercase tracking-[0.2em] text-[#8a84a3]">Website Analyser</span>
        </div>
      </Link>
      <div className="flex items-center gap-2">
        <Link to="/history" className="btn-ghost" data-testid="nav-history-btn">
          <i className="fa-regular fa-clock-rotate-left text-sm"></i>
          <span className="hidden sm:inline">History</span>
        </Link>
        {right}
      </div>
    </header>
  );
}
