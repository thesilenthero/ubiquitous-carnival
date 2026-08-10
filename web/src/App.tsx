import { NavLink, Route, Routes } from "react-router-dom";
import {
  useApplications,
  useContacts,
  useDiscovered,
  useSuggestions,
} from "./api";
import { urgencyOf } from "./lib/format";
import { ThemeToggle } from "./components/ThemeToggle";
import Pipeline from "./pages/Pipeline";
import Detail from "./pages/Detail";
import FollowUps from "./pages/FollowUps";
import Contacts from "./pages/Contacts";
import Analytics from "./pages/Analytics";
import Evaluation from "./pages/Evaluation";
import Discover from "./pages/Discover";
import Guide from "./pages/Guide";

function NavItem({
  to,
  label,
  badge,
}: {
  to: string;
  label: string;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition ${
          isActive
            ? "bg-[var(--accent-soft)] text-[var(--accent)]"
            : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
        }`
      }
    >
      <span>{label}</span>
      {badge ? (
        <span className="rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </NavLink>
  );
}

export default function App() {
  const { data: apps } = useApplications();
  const { data: contacts } = useContacts();
  const { data: suggestions } = useSuggestions();
  const { data: discovered } = useDiscovered("new");
  const due = (d: string | null) =>
    ["overdue", "today", "soon"].includes(urgencyOf(d));
  const dueCount =
    (apps ?? []).filter((a) => !a.archived && a.nextAction && due(a.nextActionDate))
      .length +
    (contacts ?? []).filter((c) => c.nextAction && due(c.nextActionDate)).length +
    (suggestions?.length ?? 0);

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] gap-6 px-4 py-6 md:px-6">
      <aside className="hidden w-56 shrink-0 md:block">
        <div className="sticky top-6">
          <div className="mb-6 px-2">
            <div className="text-lg font-bold tracking-tight">
              Job Tracker
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              Pipeline &amp; live analytics
            </div>
          </div>
          <nav className="flex flex-col gap-1">
            <NavItem to="/" label="Pipeline" />
            <NavItem to="/evaluation" label="Evaluation" />
            <NavItem
              to="/discover"
              label="Discover"
              badge={discovered?.length ?? 0}
            />
            <NavItem to="/follow-ups" label="Follow-ups" badge={dueCount} />
            <NavItem to="/contacts" label="Contacts" />
            <NavItem to="/analytics" label="Analytics" />
            <NavItem to="/guide" label="Guide" />
          </nav>
          <div className="mt-6 border-t border-[var(--border)] pt-4">
            <a
              href="/api/export.csv"
              title="Download everything — all fields, stage history, and job descriptions"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            >
              ↓ Export CSV
            </a>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Mobile top nav */}
      <div className="fixed inset-x-0 top-0 z-20 flex items-center gap-1 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 md:hidden">
        <span className="mr-2 text-sm font-bold">Job Tracker</span>
        <NavItem to="/" label="Pipeline" />
        <NavItem to="/evaluation" label="Evaluation" />
            <NavItem
              to="/discover"
              label="Discover"
              badge={discovered?.length ?? 0}
            />
        <NavItem to="/follow-ups" label="Follow-ups" badge={dueCount} />
        <NavItem to="/contacts" label="Contacts" />
        <NavItem to="/analytics" label="Analytics" />
        <NavItem to="/guide" label="Guide" />
        <div className="ml-auto">
          <ThemeToggle compact />
        </div>
      </div>

      <main className="min-w-0 flex-1 pt-14 md:pt-0">
        <Routes>
          <Route path="/" element={<Pipeline />} />
          <Route path="/evaluation" element={<Evaluation />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/follow-ups" element={<FollowUps />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/application/:id" element={<Detail />} />
        </Routes>
      </main>
    </div>
  );
}
