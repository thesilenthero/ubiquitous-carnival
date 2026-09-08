import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

function currentTheme(): Theme {
  const t = localStorage.getItem("theme");
  return t === "light" || t === "dark" ? t : "system";
}

function apply(theme: Theme) {
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem("theme");
  } else {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }
}

const NEXT: Record<Theme, Theme> = {
  system: "light",
  light: "dark",
  dark: "system",
};

// Inline so the shell carries no icon dependency. currentColor keeps them in
// step with the button's hover state.
function Icon({ theme }: { theme: Theme }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (theme === "light")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  if (theme === "dark")
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

const LABEL: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

// Cycles System → Light → Dark. "System" follows the OS via the CSS media query.
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  function cycle() {
    const next = NEXT[theme];
    apply(next);
    setTheme(next);
  }

  if (compact) {
    return (
      <button
        onClick={cycle}
        title={`Theme: ${LABEL[theme]} (click to change)`}
        aria-label={`Theme: ${LABEL[theme]}`}
        className="btn btn-ghost btn-sm px-2"
      >
        <Icon theme={theme} />
      </button>
    );
  }

  return (
    <button
      onClick={cycle}
      title={`Theme: ${LABEL[theme]} (click to change)`}
      className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-1.5 text-[13px] text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
    >
      <Icon theme={theme} />
      <span>Theme: {LABEL[theme]}</span>
    </button>
  );
}
