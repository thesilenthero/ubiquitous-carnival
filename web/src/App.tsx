import { Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import {
  useApplications,
  useContacts,
  useNextSteps,
  useSuggestions,
} from "./api";
import { urgencyOf } from "./lib/format";
import { ThemeToggle } from "./components/ThemeToggle";
import Pipeline from "./pages/Pipeline";
import Detail from "./pages/Detail";
import NextSteps from "./pages/NextSteps";
import Contacts from "./pages/Contacts";
import Analytics from "./pages/Analytics";
import Evaluation from "./pages/Evaluation";
import Discover from "./pages/Discover";
import Guide from "./pages/Guide";

function NavItem({
  to,
  label,
  badge,
  accentBadge,
}: {
  to: string;
  label: string;
  badge?: number;
  /** Draw attention to the count (things that are actually due). */
  accentBadge?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        // The active row is marked by weight and a hairline rail, not a block
        // of accent — colour is reserved for things that need acting on.
        `group relative flex items-center justify-between gap-2 whitespace-nowrap rounded-[var(--radius-md)] px-3 py-1.5 text-[13px] transition-colors duration-150 ${
          isActive
            ? "bg-[var(--surface-2)] font-medium text-[var(--text)]"
            : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              aria-hidden
              className="absolute left-0 top-1/2 hidden h-4 w-0.5 -translate-y-1/2 rounded-full bg-[var(--accent)] md:block"
            />
          )}
          <span>{label}</span>
          {badge ? (
            <span
              className={`pill px-1.5 tabular ${
                accentBadge
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "pill-muted"
              }`}
            >
              {badge}
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

export default function App() {
  const { data: apps } = useApplications();
  const { data: contacts } = useContacts();
  const { data: suggestions } = useSuggestions();
  const { data: steps } = useNextSteps();
  const due = (d: string | null) =>
    ["overdue", "today", "soon"].includes(urgencyOf(d));
  const dueCount =
    (apps ?? []).filter((a) => !a.archived && a.nextAction && due(a.nextActionDate))
      .length +
    (contacts ?? []).filter((c) => c.nextAction && due(c.nextActionDate)).length +
    (suggestions?.length ?? 0) +
    (steps?.length ?? 0);

  // One list, rendered twice — the sidebar and the mobile strip stay in step.
  const navItems = (
    <>
      <NavItem to="/" label="Pipeline" />
      <NavItem to="/next-steps" label="Next steps" badge={dueCount} accentBadge />
      <NavItem to="/contacts" label="Contacts" />
      <NavItem to="/analytics" label="Analytics" />
      <NavItem to="/guide" label="Guide" />
    </>
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] gap-6 px-4 py-6 md:px-6">
      <aside className="hidden w-56 shrink-0 md:block">
        <div className="sticky top-6">
          <Link
            to="/"
            aria-label="Job Tracker — go to pipeline"
            className="mb-6 flex items-center gap-2.5 rounded-[var(--radius-md)] px-2 py-1 transition-colors duration-150 hover:bg-[var(--surface-2)]"
          >
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-fill)] text-[13px] font-semibold text-[var(--on-accent)]"
            >
              J
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold tracking-tight">
                Job Tracker
              </div>
              <div className="text-[11px] text-[var(--text-muted)]">
                Pipeline &amp; live analytics
              </div>
            </div>
          </Link>
          <nav className="flex flex-col gap-0.5">{navItems}</nav>
          <div className="mt-6 border-t border-[var(--border)] pt-4">
            <a
              href="/api/export.zip"
              title="Download everything — applications, stage history, interviews, and engagements"
              className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-1.5 text-[13px] text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            >
              <span aria-hidden>↓</span> Export data
            </a>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Mobile top nav — scrolls sideways rather than cramming every item. */}
      <div className="fixed inset-x-0 top-0 z-20 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] backdrop-blur-md md:hidden">
        <div className="flex items-center gap-1 px-3 py-1.5">
          <Link to="/" className="mr-1 shrink-0 text-[13px] font-semibold">
            Job Tracker
          </Link>
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {navItems}
          </div>
          <div className="shrink-0">
            <ThemeToggle compact />
          </div>
        </div>
      </div>

      <main className="min-w-0 flex-1 pt-12 md:pt-0">
        <Routes>
          <Route path="/" element={<Pipeline />} />
          <Route path="/evaluation" element={<Evaluation />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/next-steps" element={<NextSteps />} />
          {/* The old path stays live — bookmarks and the sheet's links use it. */}
          <Route path="/follow-ups" element={<Navigate to="/next-steps" replace />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/application/:id" element={<Detail />} />
        </Routes>
      </main>
    </div>
  );
}
