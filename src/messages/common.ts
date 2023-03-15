export type ConnectionType = typeof ConnectionType[keyof typeof ConnectionType]
export const ConnectionType = {
  PeerToPeer: 'P',
  FileTransfer: 'F',
  Distributed: 'D',
} as const

export type UserStatus = typeof UserStatus[keyof typeof UserStatus]
export const UserStatus = {
  Offline: 0,
  Away: 1,
  Online: 2,
} as const

export type TransferDirection =
  typeof TransferDirection[keyof typeof TransferDirection]
export const TransferDirection = {
  Download: 0,
  Upload: 1,
} as const
