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

module.exports = {
  Reader,
  TAG
}