export class MessageParser {
  data: Buffer
  pointer: number

  constructor(data: Buffer) {
    this.data = data
    this.pointer = 0
  }

  int8() {
    const value = this.data.readUInt8(this.pointer)
    this.pointer += 1
    return value
  }

  int32() {
    const value = this.data.readUInt32LE(this.pointer)
    this.pointer += 4
    return value
  }

  int64() {
    const value = this.data.readBigUInt64LE(this.pointer)
    this.pointer += 8
    return value
  }

  str() {
    const size = this.data.readUInt32LE(this.pointer)
    this.pointer += 4
    const str = this.data.toString('utf8', this.pointer, this.pointer + size)
    this.pointer += size
    return str
  }

  rawHexStr(size: number) {
    const str = this.data.toString('hex', this.pointer, this.pointer + size)
    this.pointer += size
    return str
  }
}
