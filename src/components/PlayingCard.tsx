import { Toggle } from "@ui-sdk/solid/toggle"
import { Repeat, Show } from "solid-js"
import type { Hand } from "../game/rules.ts"

/** Face cards (K) are the truthful claim; Number cards (7) are the bluff. */
export type Kind = "face" | "number"

const size = "h-[4.5rem] w-[3.25rem] shrink-0 rounded-md sm:h-20 sm:w-14"

function Face(props: { kind: Kind; reveal?: boolean }) {
  return (
    <span
      class={[
        "relative flex h-full w-full items-center justify-center rounded-md border bg-white font-card text-2xl font-bold shadow-sm",
        props.kind === "face" ? "text-face" : "text-number",
        props.reveal
          ? props.kind === "face"
            ? "border-truth ring-2 ring-truth/70"
            : "border-lie ring-2 ring-lie/70"
          : "border-neutral-300",
      ]}
    >
      <span class="absolute top-1 left-1.5 text-[0.625rem] leading-none">{props.kind === "face" ? "K" : "7"}</span>
      {props.kind === "face" ? "K" : "7"}
    </span>
  )
}

export function CardBack() {
  return <span class={[size, "card-back block border border-white/20 shadow-sm"]} aria-hidden="true" />
}

/** A row of face-down cards: what everyone sees of a hand or an unrevealed play. */
export function FaceDownRow(props: { count: number; label: string }) {
  return (
    <div class="flex flex-wrap gap-1.5" role="img" aria-label={props.label}>
      <Repeat count={props.count}>{() => <CardBack />}</Repeat>
    </div>
  )
}

/** A challenged play, turned over: each card framed by its own true kind, so a mixed play shows both. */
export function RevealedRow(props: { hand: Hand }) {
  const label = () => `${props.hand.safe} Face, ${props.hand.liar} Number`
  return (
    <div class="flex flex-wrap gap-1.5" role="img" aria-label={`Revealed: ${label()}`}>
      <Repeat count={props.hand.safe}>{() => <span class={size}><Face kind="face" reveal /></span>}</Repeat>
      <Repeat count={props.hand.liar}>{() => <span class={size}><Face kind="number" reveal /></span>}</Repeat>
    </div>
  )
}

/**
 * The human's own hand: Face cards first (indices 0..safe-1), then Number cards. Each card is a
 * toggle; pressing it with the mouse doesn't take focus, so Space still plays the selection.
 */
export function OwnHand(props: {
  hand: Hand
  selected: readonly number[]
  interactive: boolean
  onToggle: (index: number) => void
}) {
  const card = (index: number, kind: () => Kind) => {
    const pressed = () => props.selected.includes(index)
    return (
      <Toggle
        pressed={pressed()}
        disabled={!props.interactive}
        onPressedChange={() => props.onToggle(index)}
        onMouseDown={(e: MouseEvent) => e.preventDefault()}
        aria-label={kind() === "face" ? "Face card" : "Number card"}
        data-ph-capture-attribute-card={kind()}
        class={[
          size,
          "block outline-none transition-transform duration-150 focus-visible:ring-3 focus-visible:ring-ring/60 data-pressed:-translate-y-2.5 motion-reduce:transition-none",
          props.interactive ? "cursor-pointer hover:-translate-y-1 data-pressed:hover:-translate-y-2.5" : "cursor-default",
        ]}
      >
        <span
          class={[
            "block h-full w-full rounded-md",
            pressed() && "shadow-lg ring-2 ring-ring ring-offset-2 ring-offset-felt",
          ]}
        >
          <Face kind={kind()} />
        </span>
      </Toggle>
    )
  }
  return (
    <div class="flex flex-wrap gap-1.5 pt-2.5">
      <Repeat count={props.hand.safe + props.hand.liar}>
        {(i) => card(i, () => (i < props.hand.safe ? "face" : "number"))}
      </Repeat>
      <Show when={props.hand.safe + props.hand.liar === 0}>
        <p class="flex h-[4.5rem] items-center text-sm text-felt-foreground/70 sm:h-20">No cards left</p>
      </Show>
    </div>
  )
}
