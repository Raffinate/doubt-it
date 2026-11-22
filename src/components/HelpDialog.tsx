import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/solid/dialog"
import { For, type Element as JSXElement } from "solid-js"
import { opponents } from "../game/strategies.ts"

function H(props: { children: JSXElement }) {
  return <h3 class="mt-5 mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase first:mt-0">{props.children}</h3>
}

function Rows(props: { rows: [string, string][] }) {
  return (
    <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
      <For each={props.rows}>
        {([k, v]) => (
          <>
            <dt class="font-medium">{k}</dt>
            <dd class="text-muted-foreground">{v}</dd>
          </>
        )}
      </For>
    </dl>
  )
}

export function HelpDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => props.onOpenChange(open)}>
      <DialogBackdrop class="fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <DialogContent
        initialFocus="content"
        class="fixed inset-0 z-50 m-auto flex h-fit max-h-[calc(100dvh-2rem)] w-[min(38rem,calc(100%-2rem))] flex-col rounded-xl border border-border bg-card text-foreground shadow-xl outline-none transition-[opacity,scale] duration-150 data-ending-style:scale-97 data-ending-style:opacity-0 data-starting-style:scale-97 data-starting-style:opacity-0 motion-reduce:transition-none"
      >
        <div class="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <DialogTitle class="text-base font-semibold">How to play</DialogTitle>
            <DialogDescription class="mt-0.5 text-sm text-muted-foreground">
              A bluffing card game where whoever's wrong spins the revolver.
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close"
            class="-mr-1 rounded-md p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </DialogClose>
        </div>
        <div class="overflow-y-auto px-5 py-4 text-sm leading-relaxed">
          <H>The deck</H>
          <p>
            20 cards, and only one thing about a card matters: is it a <strong>Face card</strong> (K or Q, 8 in the
            deck) or a <strong>Number card</strong> (6, 7 or 8, 12 in the deck)? Each round both players get 5 fresh
            cards.
          </p>

          <H>A round</H>
          <ol class="list-decimal space-y-1 pl-5">
            <li>On your turn, play 1–3 cards face down, claiming they're all Face cards, or call Doubt on the last play.</li>
            <li>Number cards in a play make it a lie. You may mix kinds; the AI never does, since it never pays.</li>
            <li>The first play of a round can't be challenged: nothing's been played yet.</li>
            <li>If your opponent just played their last card, calling Doubt is your only move.</li>
            <li>Round 1 of a match opens by coin flip. After that, whoever didn't spin last round opens.</li>
          </ol>

          <H>The call</H>
          <p>
            Calling Doubt turns the last play over. If it held any Number card, whoever played it lied and spins.
            Otherwise the caller was wrong and spins. The spinner spins <strong>alone</strong>, once: with{" "}
            <em>n</em> chambers left, the spin is fatal 1 time in <em>n</em>. Die and the match is over. Survive and
            your revolver drops a chamber, so the next spin is worse, and a new round is dealt. Both revolvers start
            with 6 chambers; only the spinner's ever changes.
          </p>
          <p class="mt-2 text-muted-foreground">
            Being right about a call and surviving are counted apart. A correct call can still end in a loss if your
            chambers run low, the way winning an all-in doesn't make the shove right.
          </p>

          <H>Keys</H>
          <Rows
            rows={[
              ["Click a card", "Select it for your play (Enter on a focused card does too)"],
              ["Space", "Play the selection, spin the revolver, or deal the next round"],
              ["C", "Call Doubt"],
            ]}
          />

          <H>Opponents</H>
          <Rows rows={opponents.map((o) => [o.name, o.blurb])} />
          <p class="mt-2 text-muted-foreground">
            Strategies are solved or scripted by the{" "}
            <a class="underline underline-offset-2 hover:text-foreground" href="https://github.com/Raffinate/holdem_solver">
              holdemsolver
            </a>{" "}
            project and shipped as lookup tables. The Dealer is a CFR solution; the Trapper is the exact best response
            to the Nit.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
