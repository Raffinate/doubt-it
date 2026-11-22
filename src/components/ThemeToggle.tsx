import { Button } from "@ui-sdk/solid/button"
import { createSignal, Show } from "solid-js"

type Theme = "light" | "dark"

/** Shares the "theme" localStorage key with the raffinate.github.io blog; index.html applies it before paint. */
export function ThemeToggle() {
  const [theme, setTheme] = createSignal<Theme>(document.documentElement.dataset.theme === "light" ? "light" : "dark")
  const toggle = () => {
    const next: Theme = theme() === "dark" ? "light" : "dark"
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem("theme", next)
    } catch {}
    setTheme(next)
  }
  return (
    <Button
      onClick={toggle}
      aria-label={theme() === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      data-ph-capture-attribute-action="toggle-theme"
      class="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
        <Show
          when={theme() === "dark"}
          fallback={<path d="M12 3a6.5 6.5 0 0 0 9 9 9 9 0 1 1-9-9Z" />}
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </Show>
      </svg>
    </Button>
  )
}
