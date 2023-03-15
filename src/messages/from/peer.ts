import { MessageParser } from '../message-parser'
import zlib from 'zlib'
import { TransferDirection } from '../common'

export type FromPeerMessage = ReturnType<
  typeof fromPeerMessage[keyof typeof fromPeerMessage]
>

export type SharedFileListRequest = {
  kind: 'sharedFileListRequest'
}

export type FileSearchResponse = {
  kind: 'fileSearchResponse'
  username: string
  token: string
  results: {
    filename: string
    size: number
    attrs: { [attr: number]: number }
  }[]
  slotsFree: number
  avgSpeed: number
  queueLength: number
}

export type TransferRequest =
  | {
      kind: 'transferRequest'
      direction: 0
      token: string
      filename: string
    }
  | {
      kind: 'transferRequest'
      direction: 1
      token: string
      filename: string
      size: number
    }

export type TransferResponse =
  | {
      kind: 'transferResponse'
      token: string
      allowed: true
    }
  | {
      kind: 'transferResponse'
      token: string
      allowed: false
      reason: string
    }

export type UploadFailed = { kind: 'uploadFailed'; filename: string }

export const fromPeerMessage = {
  sharedFileListRequest: (msg: MessageParser): SharedFileListRequest => {
    return { kind: 'sharedFileListRequest' }
  },
  fileSearchResponse: (msg_: MessageParser): FileSearchResponse => {
    const content = msg_.data.slice(msg_.pointer)
    const buffer = zlib.unzipSync(content)

    const msg = new MessageParser(buffer)
    const username = msg.str()
    const token = msg.rawHexStr(4)

    const numResults = msg.int32()
    const results: FileSearchResponse['results'] = []
    for (let i = 0; i < numResults; i++) {
      msg.int8() // code
      const filename = msg.str()
      const size = msg.int32()
      msg.int32() // filesize2
      msg.str() // ext
      const numAttrs = msg.int32()
      const attrs: FileSearchResponse['results'][number]['attrs'] = {}
      for (let attrib = 0; attrib < numAttrs; attrib++) {
        attrs[msg.int32()] = msg.int32()
      }

      results.push({
        filename,
        size,
        attrs,
      })
    }
    const slotsFree = msg.int8()
    const avgSpeed = msg.int32()
    const queueLength = msg.int32()

    return {
      kind: 'fileSearchResponse',
      username,
      token,
      results,
      slotsFree,
      avgSpeed,
      queueLength,
    }
  },
  transferRequest: (msg: MessageParser): TransferRequest => {
    const direction = msg.int32()
    const token = msg.rawHexStr(4)
    const filename = msg.str()

    if (direction === TransferDirection.Download) {
      return { kind: 'transferRequest', direction, token, filename }
    } else if (direction === TransferDirection.Upload) {
      const size = msg.int32()
      return { kind: 'transferRequest', direction, token, filename, size }
    } else {
      throw new Error(`Unknown transfer direction: ${direction}`)
    }
  },
  transferResponse: (msg: MessageParser): TransferResponse => {
    const token = msg.rawHexStr(4)
    const allowed = msg.int8()

    if (allowed === 0) {
      const reason = msg.str()
      return { kind: 'transferResponse', token, allowed: false, reason }
    } else {
      return { kind: 'transferResponse', token, allowed: true }
    }
  },
  uploadFailed: (msg: MessageParser): UploadFailed => {
    const filename = msg.str()
    return { kind: 'uploadFailed', filename }
  },
}

export const fromPeerMessageParser = (msg: MessageParser) => {
  const size = msg.int32()
  if (size <= 4) return

  const code = msg.int32()
  switch (code) {
    case 4:
      return fromPeerMessage.sharedFileListRequest(msg)
    case 9:
      return fromPeerMessage.fileSearchResponse(msg)
    case 40:
      return fromPeerMessage.transferRequest(msg)
    case 41:
      return fromPeerMessage.transferResponse(msg)
    case 46:
      return fromPeerMessage.uploadFailed(msg)
  }
}
