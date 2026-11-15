import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Nav } from "./components/ui";
import { USE_MOCKS } from "./api";
import Auth from "./pages/Auth";
import ClubPage from "./pages/ClubPage";
import Calendar from "./pages/Calendar";
import Dashboard from "./pages/Dashboard";
import Landing from "./pages/Landing";
import MyClubs from "./pages/MyClubs";
import OrgDashboard from "./pages/OrgDashboard";
import Profile from "./pages/Profile";
import Search from "./pages/Search";
import { useApp } from "./store";

export default function App() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const { account, reset, signIn } = useApp();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  useEffect(() => {
    document.body.classList.toggle("signed-in", !!account);
  }, [account]);

  // Sign in / sign up get their own full-page scene (no app nav or footer).
  if (pathname === "/signin" || pathname === "/signup" || pathname === "/start") {
    return account ? <Navigate to="/" replace /> : <Auth />;
  }

  const role = account?.role;
  const landing = !account && pathname === "/";
  const student = (el: JSX.Element) => (role === "student" ? el : role === "officer" ? <Navigate to="/org" replace /> : <Navigate to="/" replace />);

  return (
    <div className="shell">
      <a href="#main" className="sr-only">Skip to content</a>
      <Nav />
      <main id="main" className={`container page-fade ${landing ? "is-landing" : ""}`} key={pathname.split("/")[1] || "home"}>
        <Routes>
          <Route path="/" element={!account ? <Landing /> : role === "officer" ? <Navigate to="/org" replace /> : <Dashboard />} />
          <Route path="/profile" element={student(<Profile />)} />
          <Route path="/search" element={student(<Search />)} />
          <Route path="/search/:slug" element={student(<ClubPage />)} />
          <Route path="/my-clubs" element={student(<MyClubs />)} />
          <Route path="/my-clubs/:slug" element={student(<MyClubs />)} />
          <Route path="/calendar" element={student(<Calendar />)} />
          <Route path="/org" element={role === "officer" ? <OrgDashboard /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!landing && <footer className="footer">
        <div className="container row between wrap">
          <span>
            OdySC · built on Replit for USC Trojans · Photos from{" "}
            <a className="text-link" href="https://www.pexels.com" target="_blank" rel="noreferrer">Pexels</a>
          </span>
          {USE_MOCKS && (
            <span className="row" style={{ gap: 12 }}>
              Prototype · demo data
              {role !== "officer" && (
                <button className="link-btn" onClick={() => { signIn("membership@nsbe.example.com"); nav("/org"); }}>
                  Demo: club officer view
                </button>
              )}
              <button className="link-btn" onClick={() => { reset(); nav("/"); }}>Reset demo</button>
            </span>
          )}
        </div>
      </footer>}
    </div>
  );
}
