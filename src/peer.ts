import { EventEmitter } from 'events'
import type { Socket } from 'net'
import net from 'net'
import type TypedEventEmitter from 'typed-emitter'

import type { Address } from './common'
import type { FromPeerMessage } from './messages/from/peer'
import { fromPeerMessageParser } from './messages/from/peer'
import type { MessageParser } from './messages/message-parser'
import { MessageStream } from './messages/message-stream'
import { toPeerMessage } from './messages/to/peer'

export type SlskPeerEvents = {
  connect: () => void
  error: (error: Error) => void
  close: (hadError: boolean) => void
  end: () => void
  message: (msg: FromPeerMessage) => void
}

export class SlskPeer extends (EventEmitter as new () => TypedEventEmitter<SlskPeerEvents>) {
  conn: Socket
  msgs: MessageStream
  username: string

  constructor(address: Address, username: string) {
    super()
    this.username = username
    this.conn = net.createConnection(address)

    this.msgs = new MessageStream()

    this.conn.on('connect', () => this.emit('connect'))
    this.conn.on('error', (error) => this.emit('error', error))
    this.conn.on('close', (hadError) => this.emit('close', hadError))
    this.conn.on('end', () => this.emit('end'))

    this.conn.on('data', (data) => {
      this.msgs.write(data)
    })

    this.msgs.on('message', (msg: MessageParser) => {
      try {
        const data = fromPeerMessageParser(msg)
        if (data) {
          this.emit('message', data)
        }
      } catch (error) {
        console.error('Failed to parse peer message', error)
      }
    })
  }

  send<K extends keyof typeof toPeerMessage>(
    message: K,
    ...args: Parameters<(typeof toPeerMessage)[K]>
  ) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const result = toPeerMessage[message](...args)
    this.conn.write(result.getBuffer())
  }

  destroy() {
    this.conn.destroy()
  }
}
