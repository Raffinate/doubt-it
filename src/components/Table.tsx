import { Button } from "@ui-sdk/solid/button"
import { Match, Show, Switch, type Element as JSXElement } from "solid-js"
import { MAX_PLAY, type Hand } from "../game/rules.ts"
import { canContinue, canTriggerSpin, humanToAct, mustCall, type View } from "../game/session.ts"
import { FaceDownRow, OwnHand, RevealedRow } from "./PlayingCard.tsx"
import { Revolver } from "./Revolver.tsx"
import { buttonClass, Kbd, plural } from "./ui.tsx"

function Seat(props: { label: string; name?: string; chambers: number; turn: boolean; children: JSXElement }) {
  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 text-sm">
          <span
            class={["size-2 rounded-full transition-colors", props.turn ? "bg-amber-300" : "bg-felt-foreground/25"]}
            aria-hidden="true"
          />
          <span class="font-semibold text-white">{props.label}</span>
          <Show when={props.name}>
            <span class="text-felt-foreground/80">{props.name}</span>
          </Show>
          <Show when={props.turn}>
            <span class="sr-only">(to act)</span>
          </Show>
        </div>
        <Revolver chambers={props.chambers} />
      </div>
      {props.children}
    </div>
  )
}

/** The felt: opponent across the table, the last play in the middle, you at the bottom. */
export function Table(props: {
  view: View
  opponentName: string
  selected: readonly number[]
  onToggle: (index: number) => void
}) {
  const v = () => props.view
  const opp = () => (1 - v().human) as 0 | 1
  const turn = () => (v().starter + v().roundHistory.length) % 2
  const live = () => !v().pendingSpin && !v().result
  const revealed = () => v().result?.revealedHand ?? v().pendingSpin?.revealedHand ?? null

  return (
    <div class="rounded-xl bg-felt p-4 text-felt-foreground shadow-inner sm:p-6">
      <Seat label="Opponent" name={props.opponentName} chambers={v().chambers![opp()]} turn={live() && turn() === opp()}>
        <div class="min-h-[4.5rem] sm:min-h-20">
          <FaceDownRow count={v().remaining[opp()]} label={`Opponent holds ${plural(v().remaining[opp()], "card")}`} />
        </div>
      </Seat>

      <div class="my-5 rounded-lg border border-dashed border-felt-foreground/25 px-3 py-3 sm:my-6">
        <div class="mb-2 text-xs font-medium tracking-wide text-felt-foreground/70 uppercase">
          <Switch fallback="Pile">
            <Match when={revealed()}>Called, turned over</Match>
            <Match when={v().lastPlay}>
              {(lp) => `Last play: ${lp().player === v().human ? "yours" : "opponent's"}, claimed all Face cards`}
            </Match>
          </Switch>
        </div>
        <div class="flex min-h-[4.5rem] items-center sm:min-h-20">
          <Switch fallback={<p class="text-sm text-felt-foreground/70">Nothing played yet this round.</p>}>
            <Match when={revealed()}>{(h) => <RevealedRow hand={h()} />}</Match>
            <Match when={v().lastPlay}>
              {(lp) => <FaceDownRow count={lp().size} label={`${plural(lp().size, "card")} face down`} />}
            </Match>
          </Switch>
        </div>
      </div>

      <Seat label="You" chambers={v().chambers![v().human]} turn={live() && turn() === v().human}>
        <OwnHand
          hand={v().hand ?? { safe: 0, liar: 0 }}
          selected={props.selected}
          interactive={humanToAct(v()) && !mustCall(v())}
          onToggle={props.onToggle}
        />
      </Seat>
    </div>
  )
}

const playLabel = (hand: Hand | null) => {
  if (!hand) return `Select 1–${MAX_PLAY} cards`
  const n = hand.safe + hand.liar
  return `Play ${plural(n, "card")}`
}

/** What just happened, whose move it is, and the buttons for it. */
export function ActionBar(props: {
  view: View
  opponentName: string
  selection: Hand | null
  onCall: () => void
  onPlay: () => void
  onSpin: () => void
  onContinue: () => void
}) {
  const v = () => props.view
  const them = () => (v().mode === "solo" ? props.opponentName : "Your friend")
  const position = () => (v().starter === v().human ? "you opened" : "you responded")
  const youSpin = () => v().pendingSpin?.spinner === v().human || v().result?.spinner === v().human

  const move = () => {
    const m = v().opponentMove
    if (!m) return null
    return m.type === "call" ? `${them()} called Doubt.` : `${them()} played ${plural(m.size, "card")} face down.`
  }

  const prompt = () => {
    if (!humanToAct(v())) return v().mode === "solo" ? null : `Waiting for ${them().toLowerCase()}…`
    if (mustCall(v())) return `${them()} has no cards left: you have to call.`
    const pick = props.selection
      ? `${plural(props.selection.safe, "Face card")} and ${plural(props.selection.liar, "Number card")} selected.`
      : `Select 1–${MAX_PLAY} cards to play face down as Face cards`
    return v().lastPlay ? `${pick}${props.selection ? "" : ", or call Doubt."}` : `${pick}${props.selection ? "" : "."}`
  }

  return (
    <div class="space-y-3" aria-live="polite">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Round {v().round} of this match · {position()}
        </span>
        <Show when={move()}>{(m) => <span class="font-medium text-foreground">{m()}</span>}</Show>
      </div>

      <Switch>
        <Match when={v().pendingSpin}>
          {(p) => (
            <div>
              <p class="text-lg font-semibold">
                {youSpin() ? "You must face your fate." : `${them()} must face their fate.`}
              </p>
              <p class="mt-0.5 text-sm text-muted-foreground">
                {p().revealedHand.liar > 0 ? "The play was a lie." : "The play was the truth."}{" "}
                {canTriggerSpin(v())
                  ? youSpin()
                    ? `Spin at 1 in ${v().chambers![p().spinner]}.`
                    : `Spin it for them at 1 in ${v().chambers![p().spinner]}.`
                  : v().spinTriggered
                    ? "Spinning…"
                    : `Waiting for ${them().toLowerCase()} to spin…`}
              </p>
            </div>
          )}
        </Match>
        <Match when={v().result}>
          {(r) => (
            <div>
              <p class="text-sm text-muted-foreground">
                {youSpin() ? "You spin" : `${them()} spins`} the revolver…{" "}
                {r().died ? <strong class="text-loss">BANG.</strong> : "click. Survived, one chamber closer."}
              </p>
              <p
                class={[
                  "mt-0.5 text-lg font-semibold",
                  r().matchOver && (youSpin() ? "text-loss" : "text-win"),
                ]}
              >
                {r().matchOver ? (youSpin() ? "You lost the match." : "You won the match!") : "The match goes on."}
              </p>
            </div>
          )}
        </Match>
        <Match when={prompt()}>{(p) => <p class="text-sm">{p()}</p>}</Match>
      </Switch>

      <div class="flex min-h-9 flex-wrap gap-2">
        <Switch>
          <Match when={v().pendingSpin}>
            <Show when={canTriggerSpin(v())}>
              <Button class={buttonClass.danger} onClick={props.onSpin} data-ph-capture-attribute-action="spin">
                Spin the revolver <Kbd>Space</Kbd>
              </Button>
            </Show>
          </Match>
          <Match when={v().result}>
            {(r) => (
              <Show when={canContinue(v())} fallback={<p class="self-center text-sm text-muted-foreground">Waiting for the host…</p>}>
                <Button class={buttonClass.primary} onClick={props.onContinue} data-ph-capture-attribute-action="continue">
                  {r().matchOver ? "New match" : "Next round"} <Kbd>Space</Kbd>
                </Button>
              </Show>
            )}
          </Match>
          <Match when={humanToAct(v())}>
            <Show when={!mustCall(v())}>
              <Button
                class={buttonClass.primary}
                disabled={!props.selection}
                onClick={props.onPlay}
                data-ph-capture-attribute-action="play"
              >
                {playLabel(props.selection)} <Kbd>Space</Kbd>
              </Button>
            </Show>
            <Show when={v().lastPlay}>
              <Button class={buttonClass.outline} onClick={props.onCall} data-ph-capture-attribute-action="call">
                Call Doubt <Kbd>C</Kbd>
              </Button>
            </Show>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
