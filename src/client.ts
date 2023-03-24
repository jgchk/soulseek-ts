import crypto from 'crypto'
import EventEmitter from 'events'
import net from 'net'
import stream from 'stream'
import TypedEventEmitter from 'typed-emitter'

import { Address } from './common'
import {
  CompleteDownload,
  ConnectedDownload,
  Download,
  downloadHasToken,
  DownloadingDownload,
  DownloadWithToken,
  makeDownloadStatusData,
  RequestedDownload,
  SlskDownloadEventEmitter,
} from './downloads'
import { SlskListen, SlskListenEvents } from './listen'
import {
  ConnectionType,
  TransferDirection,
  UserStatus,
} from './messages/common'
import { FileSearchResponse, FromPeerMessage } from './messages/from/peer'
import { PierceFirewall } from './messages/from/peer-init'
import {
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

export type SlskPeersEvents = {
  message: (msg: FromPeerMessage, peer: SlskPeer) => void
}
export class SlskClient {
  server: SlskServer
  listen: SlskListen
  peers: Map<string, SlskPeer>
  peerMessages: TypedEventEmitter<SlskPeersEvents>
  fileTransferConnections: net.Socket[]
  username: string | undefined
  downloads: Download[]

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
    this.downloads = []
    this.fileTransferConnections = []

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

              const peer = new SlskPeer(
                {
                  host: msg.host,
                  port: msg.port,
                },
                msg.username
              )

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
              const conn = net.createConnection({
                host: msg.host,
                port: msg.port,
              })

              this.fileTransferConnections.push(conn)

              conn.write(
                toPeerMessage.pierceFirewall({ token: msg.token }).getBuffer()
              )

              let download: DownloadWithToken | undefined
              conn.on('data', (data) => {
                if (download === undefined) {
                  const token = data.toString('hex', 0, 4)
                  const download_ = this.downloads.find(
                    (
                      d
                    ): d is
                      | ConnectedDownload
                      | DownloadingDownload
                      | CompleteDownload =>
                      d.username === msg.username &&
                      downloadHasToken(d) &&
                      d.token === token
                  )
                  if (!download_) {
                    console.error('No download found for', msg)
                    conn.end()
                    return
                  }
                  download = download_
                  download.status = 'downloading'
                  download.events.emit(
                    'status',
                    'downloading',
                    makeDownloadStatusData(download)
                  )

                  // send file offset message
                  const fileOffsetBuffer = Buffer.alloc(8)
                  fileOffsetBuffer.writeBigUInt64LE(download.receivedBytes, 0)
                  conn.write(fileOffsetBuffer)
                } else {
                  download.receivedBytes += BigInt(data.length)

                  download.stream.write(data)
                  download.events.emit('data', data)
                  download.events.emit('progress', {
                    receivedBytes: download.receivedBytes,
                    totalBytes: download.totalBytes,
                    progress:
                      Number(
                        (download.receivedBytes * 100n) / download.totalBytes
                      ) / 100,
                  })

                  const isComplete =
                    download.receivedBytes >= download.totalBytes
                  if (isComplete) {
                    conn.end()
                    download.stream.end()
                    download.status = 'complete'
                    download.events.emit('complete', download.receivedBytes)
                    download.events.emit(
                      'status',
                      'complete',
                      makeDownloadStatusData(download)
                    )

                    // remove from this.downloads
                    this.downloads = this.downloads.filter(
                      (d) => d !== download
                    )
                  }
                }
              })

              conn.on('error', (error) => download?.stream.emit('error', error))
              conn.on('close', () => {
                download?.stream.end()
                this.fileTransferConnections =
                  this.fileTransferConnections.filter((c) => c !== conn)
              })

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

            const peer = new SlskPeer(
              {
                host: peerAddress.host,
                port: peerAddress.port,
              },
              msg.username
            )

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

    this.peerMessages.on('message', (msg, peer) => {
      switch (msg.kind) {
        case 'transferRequest': {
          if (msg.direction === TransferDirection.Upload) {
            const existingDownloadIndex = this.downloads.findIndex(
              (d) => d.username === peer.username && d.filename === msg.filename
            )

            if (existingDownloadIndex === -1) {
              console.error('No download found for', msg)
              return
            }

            this.downloads[existingDownloadIndex] = {
              ...this.downloads[existingDownloadIndex],
              status: 'connected',
              queuePosition: 0,
              token: msg.token,
              totalBytes: msg.size,
            }
            this.downloads[existingDownloadIndex].events.emit(
              'status',
              'connected',
              makeDownloadStatusData(this.downloads[existingDownloadIndex])
            )

            peer.send('transferResponse', {
              token: msg.token,
              allowed: true,
            })
          }

          break
        }
        case 'placeInQueueResponse': {
          const existingDownloadIndex = this.downloads.findIndex(
            (d) => d.username === peer.username && d.filename === msg.filename
          )

          if (existingDownloadIndex === -1) {
            console.error('No download found for', msg)
            return
          }

          const download = this.downloads[existingDownloadIndex]
          if (download.status === 'requested') {
            this.downloads[existingDownloadIndex] = {
              ...download,
              status: 'queued',
              queuePosition: msg.place,
            }
            this.downloads[existingDownloadIndex].events.emit(
              'status',
              'queued',
              makeDownloadStatusData(this.downloads[existingDownloadIndex])
            )
          } else if (download.status === 'queued') {
            this.downloads[existingDownloadIndex] = {
              ...download,
              queuePosition: msg.place,
            }
          }

          break
        }
      }
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
    receivedBytes?: bigint | number
  ) {
    const peer = await this.getPeerByUsername(username)

    peer.send('queueUpload', { filename })

    const download: RequestedDownload = {
      status: 'requested',
      username,
      filename,
      receivedBytes: BigInt(receivedBytes ?? 0),
      stream: new stream.PassThrough(),
      events: new EventEmitter() as SlskDownloadEventEmitter,
      requestQueuePosition: () =>
        peer.send('placeInQueueRequest', { filename }),
    }

    this.downloads.push(download)
    download.events.emit(
      'status',
      'requested',
      makeDownloadStatusData(download)
    )

    peer.send('placeInQueueRequest', { filename })

    return download
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

      const peer = new SlskPeer(
        {
          host: address.host,
          port: address.port,
        },
        username
      )

      await new Promise<void>((resolve, reject) => {
        peer.once('connect', () => resolve())
        peer.once('error', () => reject())
      })

      peer.once('close', () => peer.destroy())

      return peer
    }

    const getByPeerInit = async () => {
      const peerAddress = await this.getPeerAddress(username)

      const peer = new SlskPeer(
        {
          host: peerAddress.host,
          port: peerAddress.port,
        },
        username
      )

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
    for (const fileTransferConnection of this.fileTransferConnections) {
      fileTransferConnection.destroy()
    }
  }
}

const getRandomToken = () => crypto.randomBytes(4).toString('hex')
