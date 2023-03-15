import { ConnectionType } from '../common'
import { MessageBuilder } from '../message-builder'

export type ToPeerMessage = Parameters<
  typeof toPeerMessage[keyof typeof toPeerMessage]
>[0]

export type PierceFirewall = {
  token: string
}

export type PeerInit = {
  username: string
  type: ConnectionType
  token: string
}

export const toPeerMessage = {
  pierceFirewall: (msg: PierceFirewall) =>
    new MessageBuilder().int8(0).rawHexStr(msg.token),
  peerInit: (msg: PeerInit) =>
    new MessageBuilder()
      .int8(1)
      .str(msg.username)
      .str(msg.type)
      .rawHexStr(msg.token),
}
