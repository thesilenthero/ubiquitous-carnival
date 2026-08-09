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

const ICON: Record<Theme, string> = {
  system: "🖥",
  light: "☀",
  dark: "🌙",
};

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
        className="rounded-lg px-2 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
      >
        {ICON[theme]}
      </button>
    );
  }

  return (
    <button
      onClick={cycle}
      title={`Theme: ${LABEL[theme]} (click to change)`}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
    >
      <span aria-hidden>{ICON[theme]}</span>
      <span>Theme: {LABEL[theme]}</span>
    </button>
  );
}
