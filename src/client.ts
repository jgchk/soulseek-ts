import crypto from 'crypto'
import EventEmitter from 'events'
import net from 'net'
import TypedEventEmitter from 'typed-emitter'

import { Address } from './common'
import { SlskListen, SlskListenEvents } from './listen'
import {
  ConnectionType,
  TransferDirection,
  UserStatus,
} from './messages/common'
import {
  FileSearchResponse,
  FromPeerMessage,
  TransferRequestUpload,
} from './messages/from/peer'
import { PierceFirewall } from './messages/from/peer-init'
import {
  ConnectToPeer,
  FromServerMessage,
  GetPeerAddress,
  Login,
} from './messages/from/server'
import { toPeerMessage } from './messages/to/peer'
import { SlskPeer } from './peer'
import { SlskServer } from './server'

const DEFAULT_LOGIN_TIMEOUT = 10 * 1000
const DEFAULT_SEARCH_TIMEOUT = 10 * 1000
const DEFAULT_GET_PEER_ADDRESS_TIMEOUT = 10 * 1000
const DEFAULT_GET_PEER_BY_USERNAME_TIMEOUT = 10 * 1000
const DEFAULT_DOWNLOAD_TIMEOUT = 60 * 1000

export type SlskPeersEvents = {
  message: (msg: FromPeerMessage, peer: SlskPeer) => void
}
export class SlskClient {
  server: SlskServer
  listen: SlskListen
  peers: Map<string, SlskPeer>
  peerMessages: TypedEventEmitter<SlskPeersEvents>
  username: string | undefined

  constructor({
    serverAddress = {
      host: 'server.slsknet.org',
      port: 2242,
    },
    listenPort = 2234,
  }: { serverAddress?: Address; listenPort?: number } = {}) {
    this.server = new SlskServer(serverAddress)
    this.listen = new SlskListen(listenPort)
    this.peers = new Map()
    this.peerMessages = new EventEmitter() as TypedEventEmitter<SlskPeersEvents>

    this.server.on('message', (msg) => {
      switch (msg.kind) {
        case 'login': {
          this.server.send('sharedFoldersFiles', { dirs: 1, files: 1 })
          this.server.send('haveNoParents', { haveNoParents: true })
          this.server.send('setStatus', { status: UserStatus.Online })
          break
        }
        case 'possibleParents': {
          for (const parent of msg.parents) {
            this.server.send('searchParent', { host: parent.host })
          }
          break
        }
        case 'connectToPeer': {
          switch (msg.type) {
            case ConnectionType.PeerToPeer: {
              const existingPeer = this.peers.get(msg.username)
              if (existingPeer) {
                // We're already connected, ignore
                return
              }

              const peer = new SlskPeer({ host: msg.host, port: msg.port })

              peer.once('connect', () => {
                peer.send('pierceFirewall', { token: msg.token })
              })

              peer.once('error', () => {
                this.server.send('cantConnectToPeer', {
                  token: msg.token,
                  username: msg.username,
                })
              })

              peer.once('close', () => {
                peer.destroy()
                this.peers.delete(msg.username)
              })

              peer.on('message', (msg) =>
                this.peerMessages.emit('message', msg, peer)
              )

              this.peers.set(msg.username, peer)

              break
            }
            case ConnectionType.FileTransfer: {
              // TODO: Download file
              break
            }
            case ConnectionType.Distributed: {
              // TODO: Handle distributed peer
              break
            }
          }
        }
      }
    })

    this.listen.on('message', (msg) => {
      const handler = async () => {
        switch (msg.kind) {
          case 'peerInit': {
            const existingPeer = this.peers.get(msg.username)
            if (existingPeer) {
              // We're already connected, ignore
              return
            }

            const peerAddress = await this.getPeerAddress(msg.username)

            const peer = new SlskPeer({
              host: peerAddress.host,
              port: peerAddress.port,
            })

            peer.once('close', () => {
              peer.destroy()
              this.peers.delete(msg.username)
            })

            peer.on('message', (msg) =>
              this.peerMessages.emit('message', msg, peer)
            )

            this.peers.set(msg.username, peer)

            break
          }
        }
      }

      void handler()
    })
  }

  async getPeerAddress(
    username: string,
    timeout = DEFAULT_GET_PEER_ADDRESS_TIMEOUT
  ) {
    this.server.send('getPeerAddress', { username })

    const result = await new Promise<GetPeerAddress>((resolve, reject) => {
      const timeout_ = setTimeout(() => {
        this.server.off('message', listener)
        reject(new Error('getPeerAddress timed out'))
      }, timeout)

      const listener = (msg: FromServerMessage) => {
        if (msg.kind === 'getPeerAddress' && msg.username === username) {
          clearTimeout(timeout_)
          this.server.off('message', listener)
          resolve(msg)
        }
      }

      this.server.on('message', listener)
    })

    return result
  }

  async login(
    username: string,
    password: string,
    timeout = DEFAULT_LOGIN_TIMEOUT
  ) {
    this.server.send('login', { username, password })

    const loginResult = await new Promise<Login>((resolve, reject) => {
      const timeout_ = setTimeout(() => {
        this.server.off('message', listener)
        reject(new Error('Login timed out'))
      }, timeout)

      const listener = (msg: FromServerMessage) => {
        if (msg.kind === 'login') {
          clearTimeout(timeout_)
          this.server.off('message', listener)
          resolve(msg)
        }
      }

      this.server.on('message', listener)
    })

    if (!loginResult.success) {
      throw new Error(`Login failed: ${loginResult.reason}`)
    }

    this.username = username
  }

  search(
    query: string,
    {
      timeout = DEFAULT_SEARCH_TIMEOUT,
      onResult,
    }: {
      timeout?: number
      onResult?: (result: FileSearchResponse) => void
    } = {}
  ) {
    // generate a token to identify the search
    const token = getRandomToken()

    // send the search request
    this.server.send('fileSearch', { token, query })

    // listen for results. call the onResult callback for each result
    const results: FileSearchResponse[] = []
    const listener = (msg: FromPeerMessage) => {
      if (msg.kind === 'fileSearchResponse' && msg.token === token) {
        onResult?.(msg)
        results.push(msg)
      }
    }
    this.peerMessages.on('message', listener)

    // after the search times out, stop listening for results
    return new Promise<FileSearchResponse[]>((resolve) => {
      setTimeout(() => {
        this.peerMessages.off('message', listener)
        resolve(results)
      }, timeout)
    })
  }

  async download(
    username: string,
    filename: string,
    {
      timeout = DEFAULT_DOWNLOAD_TIMEOUT,
      onData,
    }: {
      timeout?: number
      onData?: (
        data: Buffer,
        metadata: {
          totalBytesReceived: bigint
          totalExpectedBytes: bigint
          progress: number
        }
      ) => void
    } = {}
  ) {
    const peer = await this.getPeerByUsername(username)

    peer.send('queueUpload', { filename })

    const transferRequest = await new Promise<TransferRequestUpload>(
      (resolve, reject) => {
        const timeout_ = setTimeout(() => {
          peer.off('message', listener)
          reject(new Error('Download timed out while requesting file'))
        }, timeout)

        const listener = (msg: FromPeerMessage) => {
          if (
            msg.kind === 'transferRequest' &&
            msg.filename === filename &&
            msg.direction === TransferDirection.Upload
          ) {
            clearTimeout(timeout_)
            peer.off('message', listener)
            resolve(msg)
          }
        }

        peer.on('message', listener)
      }
    )

    peer.send('transferResponse', {
      token: transferRequest.token,
      allowed: true,
    })

    const transferConnection = await new Promise<ConnectToPeer>(
      (resolve, reject) => {
        const timeout_ = setTimeout(() => {
          this.server.off('message', listener)
          reject(new Error('Download timed out while connecting to peer'))
        }, timeout)

        const listener = (msg: FromServerMessage) => {
          if (
            msg.kind === 'connectToPeer' &&
            msg.type === ConnectionType.FileTransfer
          ) {
            clearTimeout(timeout_)
            this.server.off('message', listener)
            resolve(msg)
          }
        }

        this.server.on('message', listener)
      }
    )

    const conn = net.createConnection({
      host: transferConnection.host,
      port: transferConnection.port,
    })

    conn.write(
      toPeerMessage
        .pierceFirewall({ token: transferConnection.token })
        .getBuffer()
    )

    const fileOffset = 0 // TODO: support resuming downloads

    const totalBytesReceived = await new Promise<bigint>((resolve, reject) => {
      let token: string | undefined
      let totalBytesReceived = 0n
      conn.on('data', (data) => {
        if (token === undefined) {
          token = data.toString('hex', 0, 4)

          // send file offset message
          const fileOffsetBuffer = Buffer.alloc(8)
          fileOffsetBuffer.writeBigUInt64LE(BigInt(fileOffset), 0)
          conn.write(fileOffsetBuffer)
        } else {
          totalBytesReceived += BigInt(data.length)

          onData?.(data, {
            totalBytesReceived: totalBytesReceived,
            totalExpectedBytes: transferRequest.size,
            progress:
              Number((totalBytesReceived * 100n) / transferRequest.size) / 100,
          })

          const isComplete = totalBytesReceived >= transferRequest.size
          if (isComplete) {
            conn.end()
          }
        }
      })

      conn.on('close', (hadError) => {
        if (hadError) {
          reject(new Error('Download failed'))
        } else {
          resolve(totalBytesReceived)
        }
      })
    })

    return totalBytesReceived
  }

  async getPeerByUsername(
    username: string,
    timeout = DEFAULT_GET_PEER_BY_USERNAME_TIMEOUT
  ) {
    const existingPeer = this.peers.get(username)
    if (existingPeer) {
      return existingPeer
    }

    const token = getRandomToken()

    const getByConnectToPeer = async () => {
      this.server.send('connectToPeer', {
        token,
        username,
        type: ConnectionType.PeerToPeer,
      })

      const { address } = await new Promise<{
        msg: PierceFirewall
        address: Address
      }>((resolve, reject) => {
        const timeout_ = setTimeout(() => {
          this.listen.off('message', listener)
          reject(new Error('getPeerByUsername timed out'))
        }, timeout)

        const listener: SlskListenEvents['message'] = (msg, address) => {
          if (msg.kind === 'pierceFirewall' && msg.token === token) {
            clearTimeout(timeout_)
            this.listen.off('message', listener)
            resolve({ msg, address })
          }
        }

        this.listen.on('message', listener)
      })

      const peer = new SlskPeer({
        host: address.host,
        port: address.port,
      })

      await new Promise<void>((resolve, reject) => {
        peer.once('connect', () => resolve())
        peer.once('error', () => reject())
      })

      peer.once('close', () => peer.destroy())

      return peer
    }

    const getByPeerInit = async () => {
      const peerAddress = await this.getPeerAddress(username)

      const peer = new SlskPeer({
        host: peerAddress.host,
        port: peerAddress.port,
      })

      peer.once('close', () => peer.destroy())

      await new Promise<void>((resolve, reject) => {
        peer.once('connect', () => {
          if (this.username === undefined) {
            reject(new Error('You are not logged in'))
            return
          }

          peer.send('peerInit', {
            username: this.username,
            type: ConnectionType.PeerToPeer,
            token,
          })

          resolve()
        })
      })

      return peer
    }

    const peer = await Promise.any([getByConnectToPeer(), getByPeerInit()])

    peer.once('close', () => this.peers.delete(username))
    peer.on('message', (msg) => this.peerMessages.emit('message', msg, peer))

    this.peers.set(username, peer)

    return peer
  }

  destroy() {
    this.server.destroy()
    this.listen.destroy()
    for (const peer of this.peers.values()) {
      peer.destroy()
    }
  }
}

const getRandomToken = () => crypto.randomBytes(4).toString('hex')
