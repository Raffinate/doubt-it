import type { Element as JSXElement } from "solid-js"

/** A card section. `flush` drops the padding for content that brings its own. */
export function Panel(props: { title?: string; class?: string; flush?: boolean; children: JSXElement }) {
  return (
    <section class={["rounded-xl border border-border bg-card shadow-xs", !props.flush && "p-4 sm:p-5", props.class]}>
      {props.title && <h2 class="mb-4 text-sm font-semibold">{props.title}</h2>}
      {props.children}
    </section>
  )
}

export function Kbd(props: { children: JSXElement }) {
  return (
    <kbd class="ml-1.5 rounded border border-current/25 px-1 py-px font-sans text-[0.6875rem] leading-none opacity-70">
      {props.children}
    </kbd>
  )
}

const base =
  "inline-flex h-9 items-center justify-center gap-1 rounded-md text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"

export const buttonClass = {
  primary: `${base} bg-primary px-4 text-primary-foreground shadow-xs hover:opacity-90`,
  outline: `${base} border border-input bg-card px-4 text-foreground shadow-xs hover:bg-accent`,
  ghost: `${base} px-3 text-muted-foreground hover:bg-accent hover:text-foreground`,
  danger: `${base} bg-danger px-4 text-white shadow-xs hover:opacity-90`,
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
