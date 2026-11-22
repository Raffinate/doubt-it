import { For } from "solid-js"
import { FULL_CHAMBERS } from "../game/rules.ts"

const slots = Array.from({ length: FULL_CHAMBERS }, (_, i) => {
  const a = (i / FULL_CHAMBERS) * 2 * Math.PI - Math.PI / 2
  return { i, x: 14 + 8.5 * Math.cos(a), y: 14 + 8.5 * Math.sin(a) }
})

/**
 * A revolver cylinder: one filled hole per chamber still in play. One of them is loaded, so the next
 * spin is fatal with probability 1 in `chambers`.
 */
export function Revolver(props: { chambers: number }) {
  const odds = () => (props.chambers > 0 ? `1 in ${props.chambers}` : "Dead")
  return (
    <div class="flex items-center gap-2" title={`${props.chambers} of ${FULL_CHAMBERS} chambers left`}>
      <svg viewBox="0 0 28 28" class="size-7" aria-hidden="true">
        <circle cx="14" cy="14" r="13" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5" />
        <circle cx="14" cy="14" r="2" fill="currentColor" fill-opacity="0.35" />
        <For each={slots}>
          {(s) => (
            <circle
              cx={s.x}
              cy={s.y}
              r="3"
              fill={s.i < props.chambers ? "currentColor" : "none"}
              stroke="currentColor"
              stroke-opacity={s.i < props.chambers ? 1 : 0.4}
              stroke-width="1.2"
            />
          )}
        </For>
      </svg>
      <div class="text-xs leading-tight">
        <div class="font-medium tabular-nums">{odds()}</div>
        <div class="opacity-70">{props.chambers > 0 ? "next spin" : "no chambers"}</div>
      </div>
    </div>
  )
}
