const fs = require('fs')
const zlib = require('zlib')
const { ungzip } = require('node-gzip')
const { Int64BE } = require('int64-buffer')

enum TAG {
  END,
  BYTE,
  SHORT,
  INT,
  LONG,
  FLOAT,
  DOUBLE,
  BYTE_ARRAY,
  STRING,
  LIST,
  COMPOUND,
  INT_ARRAY,
  LONG_ARRAY
}

interface TagNode {
  value: any
  left: Buffer
}

interface SerializedNode {
  type: string
  name: string
  value: any
}

class Reader {
  private bindMap = {
    [TAG.BYTE]: this.readByte,
    [TAG.SHORT]: this.readShort,
    [TAG.INT]: this.readInt,
    [TAG.LONG]: this.readLong,
    [TAG.FLOAT]: this.readFloat,
    [TAG.DOUBLE]: this.readDouble,
    [TAG.BYTE_ARRAY]: this.readByteArray,
    [TAG.STRING]: this.readString,
    [TAG.LIST]: this.readList,
    [TAG.COMPOUND]: this.readCompound,
    [TAG.INT_ARRAY]: this.readIntArray,
    [TAG.LONG_ARRAY]: this.readLongArray
  }

  private readNode (
    readFunc: Function,
    offset: number,
    buffer: Buffer
  ): TagNode {
    return {
      value: readFunc.call(buffer, 0),
      left: buffer.slice(offset)
    }
  }

  private readByte (buffer?: Buffer): TagNode {
    return this.readNode(Buffer.prototype.readInt8, 1, buffer)
  }

  private readShort (buffer?: Buffer): TagNode {
    return this.readNode(Buffer.prototype.readInt16BE, 2, buffer)
  }

  private readInt (buffer?: Buffer): TagNode {
    return this.readNode(Buffer.prototype.readInt32BE, 4, buffer)
  }

  private readLong (buffer?: Buffer): TagNode {
    return {
      value: new Int64BE(buffer).toString(),
      left: buffer.slice(8)
    }
  }

  private readFloat (buffer?: Buffer): TagNode {
    return this.readNode(Buffer.prototype.readFloatBE, 4, buffer)
  }

  private readDouble (buffer?: Buffer): TagNode {
    return this.readNode(Buffer.prototype.readDoubleBE, 8, buffer)
  }

  private readByteArray (buffer?: Buffer): TagNode {
    return this.readArray(this.readByte, buffer)
  }

  private readString (buffer?: Buffer): TagNode {
    const { value: size, left } = this.readShort(buffer)
    return {
      value: left.toString('utf8', 0, size),
      left: left.slice(size)
    }
  }

  private readListElems (list, buffer: Buffer, type: string, i: number) {
    if (i === 0) {
      return buffer
    } else {
      const node = this.readTag(buffer, {
        value: {
          type
        }
      })
      list.push(node)
      return this.readListElems(list, node.left, type, i - 1)
    }
  }

  private readList (buffer?: Buffer): TagNode {
    const { value: type, left } = this.readByte(buffer)
    const lengthNode = this.readInt(left)
    const result = []
    const newBuffer = this.readListElems(
      result,
      lengthNode.left,
      type,
      lengthNode.value
    )
    return {
      value: result,
      left: newBuffer
    }
  }

  private readCompoundElems (list, buffer: Buffer) {
    const node = this.readTag(buffer, undefined)
    if (node.type === TAG.END) {
      return node.left
    } else {
      list.push(node)
      return this.readCompoundElems(list, node.left)
    }
  }

  private readCompound (buffer?: Buffer): TagNode {
    const result = []
    const left = this.readCompoundElems(result, buffer)
    return {
      value: result,
      left
    }
  }

  private readIntArray (buffer?: Buffer): TagNode {
    return this.readArray(this.readInt, buffer)
  }

  private readLongArray (buffer?: Buffer): TagNode {
    return this.readArray(this.readLong, buffer)
  }

  private readArrayElems (list, buffer: Buffer, readFunc: Function, i: number) {
    if (i === 0) {
      return buffer
    } else {
      const node = readFunc.call(this, buffer)
      list.push(node)
      return this.readArrayElems(list, node.left, readFunc, i - 1)
    }
  }

  private readArray (readFunc: Function, buffer?: Buffer): TagNode {
    const { value: size, left } = this.readInt(buffer)
    const result = []
    const newBuffer = this.readArrayElems(result, left, readFunc, size)
    return {
      value: result,
      left: newBuffer
    }
  }

  private readName (buffer?: Buffer): TagNode {
    const { value: type, left } = this.readByte(buffer)
    if (type === TAG.END) {
      return {
        value: {
          type,
          name: ''
        },
        left
      }
    } else {
      const str = this.readString(left)
      return {
        value: {
          type,
          name: str.value
        },
        left: str.left
      }
    }
  }

  private readTag (buffer: Buffer, data) {
    let left
    let nameNode
    if (data) {
      nameNode = data
    } else {
      nameNode = this.readName(buffer)
    }
    left = nameNode.left || buffer
    const { type, name } = nameNode.value
    if (type === TAG.END) {
      return {
        type: TAG.END,
        name: '',
        left
      }
    } else {
      const node = this.bindMap[type].call(this, left)
      return {
        type,
        name,
        left: node.left,
        value: node.value
      }
    }
  }

  private prettify (obj) {
    for (let prop in obj) {
      if (prop === 'left') {
        delete obj[prop]
      } else if (prop === 'type') {
        obj[prop] = TAG[obj[prop]]
      } else if (typeof obj[prop] === 'object') {
        this.prettify(obj[prop])
      }
    }
  }

  read (level: Buffer) {
    const obj = this.readTag(level, undefined)
    this.prettify(obj)
    return obj
  }

  parse (level: Buffer, path: String) {
    const json = JSON.stringify(this.read(level))
    fs.writeFileSync(path, json, 'utf8')
    return json
  }
}

// const level: Buffer = zlib.gunzipSync(fs.readFileSync('./src/level2.dat'))

// const reader = new Reader()
// const result = reader.read(level)
// console.log(result)
// reader.parse(level, 'result.json')

class Writer {
  // private bindMap = {
  //   [TAG.BYTE]: this.writeByte,
  //   [TAG.SHORT]: this.writeShort,
  //   [TAG.INT]: this.writeInt,
  //   [TAG.LONG]: this.writeLong,
  //   [TAG.FLOAT]: this.writeFloat,
  //   [TAG.DOUBLE]: this.writeDouble,
  //   [TAG.BYTE_ARRAY]: this.writeByteArray,
  //   [TAG.STRING]: this.writeString,
  //   [TAG.LIST]: this.writeList,
  //   [TAG.COMPOUND]: this.writeCompound,
  //   [TAG.INT_ARRAY]: this.writeIntArray,
  //   [TAG.LONG_ARRAY]: this.writeLongArray
  // }

  // private readNode (readFunc: Function, offset: number, buffer: Buffer): TagNode {
  //   return {
  //     value: readFunc.call(buffer, 0),
  //     left: buffer.slice(offset)
  //   }
  // }

  private writeByte (value: number): Buffer {
    const buffer = new Buffer(1)
    buffer.writeInt8(value, 0)
    return buffer
  }

  private writeShort (value: number): Buffer {
    const buffer = new Buffer(2)
    buffer.writeInt16BE(value, 0)
    return buffer
  }

  private writeInt (value: number): Buffer {
    const buffer = new Buffer(4)
    buffer.writeInt32BE(value, 0)
    return buffer
  }

  private writeLong (value: String): Buffer {
    const buffer = new Buffer(8)
    const big = new Int64BE(value)
    return big.toBuffer()
  }

  private writeFloat (value: number): Buffer {
    const buffer = new Buffer(4)
    buffer.writeFloatBE(value, 0)
    return buffer
  }

  private writeDouble (value: number): Buffer {
    const buffer = new Buffer(8)
    buffer.writeDoubleBE(value, 0)
    return buffer
  }

  private writeByteArray (value: [{ value: number }]): Buffer {
    const buffers: Array<Buffer> = []
    const length = value.length
    buffers.push(new Buffer(this.writeInt(length)))
    const bytes = value.map(item => this.writeByte(item.value))
    return Buffer.concat(buffers.concat(bytes))
  }

  private writeString (value: string) {
    const buffers: Array<Buffer> = []
    const length = value.length
    buffers.push(new Buffer(this.writeShort(length)))
    buffers.push(new Buffer(value, 'utf8'))
    return Buffer.concat(buffers)
  }

  private writeList (value: [], type: TAG) {
    const buffers: Array<Buffer> = []
    // const allEqual = value.value.every((item, k, arr) => item.type === arr[0].type)
    // if (!allEqual) {
    //   throw new NBTFormatError('List elements type not equal')
    // }
    const length = value.length
    buffers.push(new Buffer(this.writeByte(type)))
    buffers.push(new Buffer(this.writeInt(length)))
    // value.map(item => this.writeTag(item.type, undefined))
    // concat
    return Buffer.concat(buffers)
  }

  private writeCompound (value: []) {
    const buffers: Array<Buffer> = []
    // value.map(item => this.writeTag(item.type, item.name))
    return Buffer.concat(buffers)
  }

  private writeIntArray (value) {

  }

  private writeLongArray (value) {

  }
}

class NBTFormatError extends Error {
  constructor (message?: string) {
    super(message)
    this.name = 'NBTFormatError'
    this.stack = (<any>new Error()).stack
  }
}