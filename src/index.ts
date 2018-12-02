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

class Reader {
  private buffer: Buffer

  constructor (buffer: Buffer) {
    this.buffer = buffer
  }

  private readEnd (buffer: Buffer) {
    return {
      value: '',
      left: buffer
    }
  }

  private readByte (buffer: Buffer) {
    return {
      value: buffer.readInt8(0),
      left: buffer.slice(1)
    }
  }

  private readShort (buffer: Buffer) {
    return {
      value: buffer.readInt16BE(0),
      left: buffer.slice(2)
    }
  }

  private readInt (buffer: Buffer) {
    return {
      value: buffer.readInt32BE(0),
      left: buffer.slice(4)
    }
  }

  private readLong (buffer: Buffer) {
    return {
      value: new Int64BE(buffer).toString(),
      left: buffer.slice(8)
    }
  }

  private readFloat (buffer: Buffer) {
    return {
      value: buffer.readFloatBE(0),
      left: buffer.slice(4)
    }
  }

  private readDouble (buffer: Buffer) {
    return {
      value: buffer.readDoubleBE(0),
      left: buffer.slice(8)
    }
  }

  private readByteArray (buffer: Buffer) {
    return this.readArray(buffer, this.readByte)
  }

  private readString (buffer: Buffer) {
    const { value: size, left } = this.readShort(buffer)
    buffer = left
    return {
      value: buffer.toString('utf8', 0, size),
      left: buffer.slice(size)
    }
  }

  private readList (buffer: Buffer) {
    const { value: type, left } = this.readByte(buffer)
    buffer = left
    const elem = this.readInt(buffer)
    buffer = elem.left
    const result = []
    for (let i = 0; i < elem.value; i++) {
      const node = this.readTag(buffer, {
        value: {
          type
        }
      })
      result.push(node)
      buffer = node.left
    }
    return {
      value: result,
      left: buffer
    }
  }

  private readCompound (buffer: Buffer) {
    const result = []
    while (true) {
      const node = this.readTag(buffer, undefined)
      buffer = node.left
      if (node.type === TAG.END) {
        break
      } else {
        result.push(node)
      }
    }
    return {
      value: result,
      left: buffer
    }
  }

  private readIntArray (buffer: Buffer) {
    return this.readArray(buffer, this.readInt)
  }

  private readLongArray (buffer: Buffer) {
    return this.readArray(buffer, this.readLong)
  }

  private readArray (buffer: Buffer, readFunc: Function) {
    const { value: size, left } = this.readInt(buffer)
    buffer = left
    const result = []
    for (let i = 0; i < size; i++) {
      const node = readFunc.call(this, buffer)
      result.push(node)
      buffer = node.left
    }
    return {
      value: result,
      left: buffer
    }
  }

  private readName (buffer: Buffer) {
    const { value: type, left } = this.readByte(buffer)
    buffer = left
    if (type === TAG.END) {
      return {
        value: {
          type,
          name: ''
        },
        left: buffer
      }
    } else {
      const str = this.readString(buffer)
      buffer = str.left
      return {
        value: {
          type,
          name: str.value
        },
        left: buffer
      }
    }
  }

  private readTag (buffer: Buffer, data) {
    let d
    if (data) {
      d = data
    } else {
      d = this.readName(buffer)
      buffer = d.left
    }
    const { type, name } = d.value
    switch (type) {
      case TAG.END:
        return {
          type: TAG.END,
          name: '',
          left: buffer
        }
      case TAG.BYTE:
        const byte = this.readByte(buffer)
        buffer = byte.left
        return {
          type: TAG.BYTE,
          name,
          left: buffer,
          value: byte.value
        }
      case TAG.SHORT:
        const short = this.readShort(buffer)
        buffer = short.left
        return {
          type: TAG.SHORT,
          name,
          left: buffer,
          value: short.value
        }
      case TAG.INT:
        const int = this.readInt(buffer)
        buffer = int.left
        return {
          type: TAG.INT,
          name,
          left: buffer,
          value: int.value
        }
      case TAG.LONG:
        const long = this.readLong(buffer)
        buffer = long.left
        return {
          type: TAG.LONG,
          name,
          left: buffer,
          value: long.value
        }
      case TAG.FLOAT:
        const float = this.readFloat(buffer)
        buffer = float.left
        return {
          type: TAG.FLOAT,
          name,
          left: buffer,
          value: float.value
        }
      case TAG.DOUBLE:
        const double = this.readDouble(buffer)
        buffer = double.left
        return {
          type: TAG.DOUBLE,
          name,
          left: buffer,
          value: double.value
        }
      case TAG.BYTE_ARRAY:
        const bytes = this.readByteArray(buffer)
        buffer = bytes.left
        return {
          type: TAG.BYTE_ARRAY,
          name,
          left: buffer,
          value: bytes.value
        }
      case TAG.STRING:
        const string = this.readString(buffer)
        buffer = string.left
        return {
          type: TAG.STRING,
          name,
          left: buffer,
          value: string.value
        }
      case TAG.LIST:
        const list = this.readList(buffer)
        buffer = list.left
        return {
          type: TAG.LIST,
          name,
          left: buffer,
          value: list.value
        }
      case TAG.COMPOUND:
        const compound = this.readCompound(buffer)
        buffer = compound.left
        return {
          type: TAG.COMPOUND,
          name,
          left: buffer,
          value: compound.value
        }
      case TAG.INT_ARRAY:
        const ints = this.readIntArray(buffer)
        buffer = ints.left
        return {
          type: TAG.INT_ARRAY,
          name,
          left: buffer,
          value: ints.value
        }
      case TAG.LONG_ARRAY:
        const longs = this.readLongArray(buffer)
        buffer = longs.left
        return {
          type: TAG.LONG_ARRAY,
          name,
          left: buffer,
          value: longs.value
        }
    }
  }

  private prettify (obj) {
    for(let prop in obj) {
      if (prop === 'left') {
        delete obj[prop]
      } else if (prop === 'type') {
        obj[prop] = TAG[obj[prop]]
      } else if (typeof obj[prop] === 'object') {
        this.prettify(obj[prop])
      }
    }
  }

  read () {
    const obj = this.readTag(this.buffer, undefined)
    this.prettify(obj)
    return obj
  }

  parse (path: String) {
    const json = JSON.stringify(this.read())
    fs.writeFileSync(path, json, 'utf8')
    return json
  }
}

const level: Buffer = zlib.gunzipSync(fs.readFileSync('./src/level.dat'))

const reader = new Reader(level)
const result = reader.read()
console.log(result)
reader.parse('result.json')