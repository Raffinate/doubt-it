import { Button } from "@ui-sdk/solid/button"
import { Field, FieldDescription, FieldLabel } from "@ui-sdk/solid/field"
import { Input } from "@ui-sdk/solid/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
  type ListData,
} from "@ui-sdk/solid/select"
import { createSignal, For, Show } from "solid-js"
import { FRIEND, opponents } from "../game/strategies.ts"
import type { Stats } from "../game/session.ts"
import { buttonClass, Panel } from "./ui.tsx"

export type Phase = "idle" | "loading" | "playing"

const items: ListData = [
  { type: "group", label: "AI opponents", items: opponents.map((o) => ({ value: o.id, label: o.name })) },
  { type: "group", label: "Multiplayer", items: [{ value: FRIEND, label: "A friend, online" }] },
]

const check = (
  <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

const itemClass =
  "flex cursor-default items-center justify-between gap-4 rounded-sm px-2 py-1.5 outline-none data-highlighted:bg-accent"

export function OpponentPanel(props: {
  opponent: string
  phase: Phase
  error: string | null
  canNewSession: boolean
  onOpponent: (id: string) => void
  onStart: () => void
  onStop: () => void
  onNewSession: () => void
}) {
  const blurb = () =>
    props.opponent === FRIEND
      ? "Host a game and send your friend the invite link, or join theirs."
      : opponents.find((o) => o.id === props.opponent)?.blurb
  return (
    <Panel title="Opponent" class="space-y-4">
      <Field>
        <FieldLabel class="sr-only">Opponent</FieldLabel>
        <Select
          items={items}
          value={props.opponent}
          disabled={props.phase !== "idle"}
          onValueChange={(id) => id && props.onOpponent(id as string)}
        >
          <SelectTrigger class="flex h-9 w-full items-center justify-between rounded-md border border-input bg-card px-3 text-left text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/40 data-disabled:opacity-60">
            <SelectValue />
            <svg viewBox="0 0 24 24" class="size-4 opacity-60" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </SelectTrigger>
          <SelectContent class="m-0 overflow-y-auto rounded-md border border-border bg-card p-1 text-sm text-foreground shadow-lg outline-none">
            <SelectGroup>
              <SelectGroupLabel class="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">AI opponents</SelectGroupLabel>
              <For each={opponents}>
                {(o) => (
                  <SelectItem value={o.id} class={itemClass} data-ph-capture-attribute-opponent={o.id}>
                    {o.name}
                    <SelectItemIndicator>{check}</SelectItemIndicator>
                  </SelectItem>
                )}
              </For>
            </SelectGroup>
            <SelectGroup>
              <SelectGroupLabel class="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">Multiplayer</SelectGroupLabel>
              <SelectItem value={FRIEND} class={itemClass} data-ph-capture-attribute-opponent={FRIEND}>
                A friend, online
                <SelectItemIndicator>{check}</SelectItemIndicator>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription class="mt-2 text-sm text-muted-foreground">{blurb()}</FieldDescription>
      </Field>

      <div class="flex flex-wrap gap-2">
        <Show
          when={props.phase === "idle"}
          fallback={
            <Button class={buttonClass.outline} onClick={props.onStop} data-ph-capture-attribute-action="stop">
              Stop
            </Button>
          }
        >
          <Button
            class={buttonClass.primary}
            onClick={props.onStart}
            data-ph-capture-attribute-action="start"
            data-ph-capture-attribute-opponent={props.opponent}
          >
            {props.opponent === FRIEND ? "Host a game" : "Start"}
          </Button>
        </Show>
        <Show when={props.canNewSession}>
          <Button class={buttonClass.ghost} onClick={props.onNewSession} data-ph-capture-attribute-action="new-session">
            New session
          </Button>
        </Show>
      </div>
      <Show when={props.error}>{(e) => <p class="text-sm text-danger">{e()}</p>}</Show>
    </Panel>
  )
}

export function FriendPanel(props: {
  phase: Phase
  inviteUrl: string | null
  status: string
  defaultJoin: string
  onJoin: (raw: string) => void
}) {
  const [joinText, setJoinText] = createSignal(props.defaultJoin)
  const [copied, setCopied] = createSignal(false)
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <Panel title="Play a friend" class="space-y-4">
      <Show when={props.inviteUrl}>
        {(url) => (
          <Field>
            <FieldLabel class="text-sm font-medium">Invite link</FieldLabel>
            <div class="mt-1.5 flex gap-2">
              <Input
                value={url()}
                readonly
                onFocus={(e: FocusEvent) => (e.currentTarget as HTMLInputElement).select()}
                class="h-9 min-w-0 flex-1 rounded-md border border-input bg-muted px-3 font-mono text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              />
              <Button class={buttonClass.outline} onClick={() => copy(url())} data-ph-capture-attribute-action="copy-invite">
                {copied() ? "Copied" : "Copy"}
              </Button>
            </div>
            <FieldDescription class="mt-1.5 text-xs text-muted-foreground">
              Send this to your friend. The game starts when they open it.
            </FieldDescription>
          </Field>
        )}
      </Show>
      <Show when={props.phase === "idle"}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (joinText().trim()) props.onJoin(joinText())
          }}
        >
          <Field>
            <FieldLabel class="text-sm font-medium">Join a game</FieldLabel>
            <div class="mt-1.5 flex gap-2">
              <Input
                value={joinText()}
                onValueChange={(v) => setJoinText(v)}
                placeholder="Invite link or peer ID"
                autocomplete="off"
                class="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
              />
              <Button type="submit" class={buttonClass.outline} disabled={!joinText().trim()} data-ph-capture-attribute-action="join">
                Join
              </Button>
            </div>
          </Field>
        </form>
      </Show>
      <Show when={props.status}>
        <p class="text-sm text-muted-foreground" aria-live="polite">
          {props.status}
        </p>
      </Show>
    </Panel>
  )
}

function Stat(props: { label: string; value: string; sub: string }) {
  return (
    <div class="min-w-0">
      <div class="text-xs text-muted-foreground">{props.label}</div>
      <div class="text-2xl font-semibold tabular-nums tracking-tight">{props.value}</div>
      <div class="text-xs text-muted-foreground tabular-nums">{props.sub}</div>
    </div>
  )
}

/**
 * Being right about a call and surviving the spin are tracked apart: a correct call can still end
 * in death if your own chambers are unlucky.
 */
export function StatsPanel(props: { stats: Stats }) {
  const s = () => props.stats
  const rate = (a: number, b: number) => (a + b ? `${Math.round((100 * a) / (a + b))}%` : "–")
  return (
    <Panel title="This session">
      <div class="grid grid-cols-2 gap-4">
        <Stat
          label="Matches"
          value={`${s().matchWins}–${s().matchLosses}`}
          sub={`won ${rate(s().matchWins, s().matchLosses)}`}
        />
        <Stat
          label="Calls"
          value={`${s().correctCalls}–${s().incorrectCalls}`}
          sub={`right ${rate(s().correctCalls, s().incorrectCalls)}`}
        />
      </div>
    </Panel>
  )
}
