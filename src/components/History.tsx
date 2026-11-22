import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/solid/collapsible"
import { For, Show } from "solid-js"
import type { HistoryEntry } from "../game/session.ts"
import { Panel, plural } from "./ui.tsx"

function Entry(props: { h: HistoryEntry }) {
  const h = () => props.h
  const youSpun = () => h().spinner === h().human
  const outcome = () => (!h().matchOver ? "spinner survived" : youSpun() ? "match lost" : "match won")
  const plays = () => (h().roundHistory.length ? h().roundHistory.join(", ") : "none")
  return (
    <li class="grid grid-cols-[4.5rem_1fr] gap-x-3 border-t border-border py-2 text-sm first:border-t-0">
      <span class="text-muted-foreground tabular-nums">Round {h().round}</span>
      <div>
        <span class={h().matchOver ? (youSpun() ? "font-medium text-loss" : "font-medium text-win") : ""}>
          {h().correct === h().human ? "You were right" : "You were wrong"} · {outcome()}
        </span>
        <div class="text-xs text-muted-foreground tabular-nums">
          Plays [{plays()}] · {h().revealedBy === h().human ? "your" : "their"} play was{" "}
          {h().revealedHand.liar > 0 ? "a lie" : "the truth"}
        </div>
      </div>
    </li>
  )
}

export function History(props: { entries: readonly HistoryEntry[] }) {
  return (
    <Panel flush>
      <Collapsible>
        <CollapsibleTrigger
          class="group flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/40 sm:px-5"
          data-ph-capture-attribute-action="toggle-history"
        >
          <span>
            Hand history{" "}
            <span class="font-normal text-muted-foreground">({plural(props.entries.length, "call")})</span>
          </span>
          <svg
            viewBox="0 0 24 24"
            class="size-4 opacity-60 transition-transform group-data-open:rotate-180"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </CollapsibleTrigger>
        <CollapsiblePanel class="px-4 pb-3 sm:px-5">
          <Show when={props.entries.length} fallback={<p class="text-sm text-muted-foreground">No calls yet.</p>}>
            <ol>
              <For each={props.entries}>{(h) => <Entry h={h} />}</For>
            </ol>
          </Show>
        </CollapsiblePanel>
      </Collapsible>
    </Panel>
  )
}
