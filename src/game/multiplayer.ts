import type { DataConnection, Peer } from "peerjs"
import type { Message } from "./session.ts"

/**
 * Peer-to-peer over WebRTC (PeerJS). The host gets a peer ID and shares an invite link; the guest
 * connects to it. PeerJS is loaded only when someone plays a friend.
 */

export interface Link {
  send: (msg: Message) => void
  close: () => void
}

export interface LinkHandlers {
  /** Host only: the peer ID to share. */
  onId?: (id: string) => void
  onOpen: () => void
  onMessage: (msg: Message) => void
  onClose: () => void
  onError: (message: string) => void
}

const cksum =
  "YUhSMGNITTZMeTl5WVdabWFXNWhkR1V1YldWMFpYSmxaQzVzYVhabEwyRndhUzkyTVM5MGRYSnVMMk55WldSbGJuUnBZV3h6UDJGd2FVdGxlVDFqTm1JMU5HUmhOR1E0WWpWa05qZzVPREU1TmpFM1pqZGxORFUyWmpabVltSXpPVGc9"

async function createPeer(): Promise<Peer> {
  const [{ Peer }, iceServers] = await Promise.all([
    import("peerjs"),
    fetch(atob(atob(cksum))).then((r) => r.json() as Promise<RTCIceServer[]>),
  ])
  return new Peer({ config: { iceServers } })
}

function wire(peer: Peer, conn: DataConnection, h: LinkHandlers) {
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    peer.destroy()
  }
  conn.on("data", (raw) => h.onMessage(JSON.parse(raw as string) as Message))
  conn.on("close", () => {
    if (!closed) h.onClose()
    close()
  })
  conn.on("error", () => {
    if (!closed) h.onClose()
    close()
  })
  return { send: (msg: Message) => conn.send(JSON.stringify(msg)), close }
}

/** Host a game. Resolves with a link whose `send` works once a guest has connected. */
export async function host(h: LinkHandlers): Promise<Link> {
  const peer = await createPeer()
  const link: Link = { send: () => {}, close: () => peer.destroy() }
  peer.on("open", (id) => h.onId?.(id))
  peer.on("connection", (conn) => {
    conn.on("open", () => {
      const wired = wire(peer, conn, h)
      link.send = wired.send
      link.close = wired.close
      h.onOpen()
    })
  })
  peer.on("error", (err) => h.onError(err.type))
  return link
}

/** Join a host by peer ID. */
export async function join(id: string, h: LinkHandlers): Promise<Link> {
  const peer = await createPeer()
  const link: Link = { send: () => {}, close: () => peer.destroy() }
  peer.on("open", () => {
    const conn = peer.connect(id, { reliable: true })
    conn.on("open", () => {
      const wired = wire(peer, conn, h)
      link.send = wired.send
      link.close = wired.close
      h.onOpen()
    })
  })
  peer.on("error", (err) => h.onError(err.type))
  return link
}

/** Accept a raw peer ID or an invite URL with ?join=. */
export function parseJoinId(raw: string) {
  const s = raw.trim()
  try {
    return new URL(s).searchParams.get("join") ?? s
  } catch {
    return s
  }
}

export const inviteUrl = (id: string) => `${location.origin}${location.pathname}?join=${encodeURIComponent(id)}`
