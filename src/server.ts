import { EventEmitter } from 'events'
import net, { Socket } from 'net'
import type TypedEventEmitter from 'typed-emitter'

import {
  FromServerMessage,
  fromServerMessageParser,
} from './messages/from/server'
import { MessageParser } from './messages/message-parser'
import { MessageStream } from './messages/message-stream'
import { toServerMessage } from './messages/to/server'

export type SlskServerEvents = {
  message: (msg: FromServerMessage) => void
  error: (error: Error) => void
}

export type ServerAddress = {
  host: string
  port: number
}

export class SlskServer extends (EventEmitter as new () => TypedEventEmitter<SlskServerEvents>) {
  conn: Socket
  msgs: MessageStream

  constructor(serverAddress: ServerAddress) {
    super()
    this.conn = net.createConnection(serverAddress)

    this.msgs = new MessageStream()

    this.conn.on('error', (error) => {
      this.emit('error', error)
    })

    this.conn.on('data', (data) => {
      this.msgs.write(data)
    })

    this.msgs.on('message', (msg: MessageParser) => {
      const data = fromServerMessageParser(msg)
      if (data) {
        this.emit('message', data)
      }
    })
  }

  send<K extends keyof typeof toServerMessage>(
    message: K,
    ...args: Parameters<typeof toServerMessage[K]>
  ) {
    // @ts-ignore
    const result = toServerMessage[message](...args)
    this.conn.write(result.getBuffer())
  }

  destroy() {
    this.conn.destroy()
  }
}
