export class MessageBuilder {
  data: Buffer

  constructor() {
    this.data = Buffer.alloc(0)
  }

  int8(value: number) {
    const b = Buffer.alloc(1)
    b.writeUInt8(value, 0)
    this.data = Buffer.concat([this.data, b])
    return this
  }

  int32(value: number) {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(value, 0)
    this.data = Buffer.concat([this.data, b])
    return this
  }

  str(value: string) {
    // convert to buff
    let b = Buffer.from(value, 'utf8')
    const s = Buffer.alloc(4)
    s.writeUInt32LE(b.length, 0)
    // write length
    b = Buffer.concat([s, b])
    // write text
    this.data = Buffer.concat([this.data, b])
    return this
  }

  rawHexStr(value: string) {
    const b = Buffer.from(value, 'hex')
    this.data = Buffer.concat([this.data, b])
    return this
  }

  buffer(value: Buffer) {
    this.data = Buffer.concat([this.data, value])
    return this
  }

  getBuffer() {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(this.data.length, 0)
    return Buffer.concat([b, this.data])
  }
}
