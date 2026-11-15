import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Loading, Nav, Toast } from "./components/ui";
import Auth from "./pages/Auth";
import { AuthError, CheckEmail, ForgotPassword, ResetPassword } from "./pages/AuthFlows";
import ClubPage from "./pages/ClubPage";
import Calendar from "./pages/Calendar";
import ClubFinder from "./components/ClubFinder";
import Dashboard from "./pages/Dashboard";
import Landing from "./pages/Landing";
import MyClubs from "./pages/MyClubs";
import OrgDashboard from "./pages/OrgDashboard";
import Profile from "./pages/Profile";
import Search from "./pages/Search";
import { useApp } from "./store";

export default function App() {
  const { pathname } = useLocation();
  const { account, profile, resume, ready, loadError, mutationError, clearMutationError, refresh } = useApp();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  useEffect(() => {
    document.body.classList.toggle("signed-in", !!account);
  }, [account]);

  if (pathname === "/check-email") return <CheckEmail />;
  if (pathname === "/forgot-password") return <ForgotPassword />;
  if (pathname === "/reset-password") return <ResetPassword />;
  if (pathname === "/auth/error") return <AuthError />;
  if (!ready) return <div className="shell"><main className="container"><Loading /></main></div>;
  if (loadError) return <div className="shell"><Nav /><main className="container page-fade"><div className="card panel"><p className="field-error" role="alert">{loadError}</p><button className="btn primary" onClick={() => { void refresh().catch(() => {}); }}>Try again</button></div></main></div>;

  // Sign in / sign up get their own full-page scene (no app nav or footer).
  if (pathname === "/signin" || pathname === "/signup" || pathname === "/start") {
    return account ? <Navigate to="/" replace /> : <Auth />;
  }

  const role = account?.role;
  const landing = !account && pathname === "/";
  const student = (el: JSX.Element) => (role === "student" ? el : role === "officer" ? <Navigate to="/org" replace /> : <Navigate to="/" replace />);

  return (
    <div className="shell">
      <a href="#main" className="sr-only" onClick={(event) => { event.preventDefault(); const main = document.getElementById("main"); main?.focus(); main?.scrollIntoView(); }}>Skip to content</a>
      <Nav />
      <main id="main" tabIndex={-1} className={`container page-fade ${landing ? "is-landing" : ""}`} key={pathname.split("/")[1] || "home"}>
        <Routes>
          <Route path="/" element={!account ? <Landing /> : role === "officer" ? <Navigate to="/org" replace /> : <Dashboard />} />
          <Route path="/profile" element={student(<Profile />)} />
          <Route path="/student" element={<Navigate to="/profile" replace />} />
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
        </div>
      </footer>}
      {role === "student" && <ClubFinder key={`${profile.id}:${resume?.id ?? "none"}`} />}
      <Toast message={mutationError} onDone={clearMutationError} />
    </div>
  );
}
