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
  value: any,
  left: Buffer
}

// interface BindMap {
//   [tag: number]: string
// }

// function bindTag (tag: TAG) {
//   return function (target: Reader, propertyKey: string, descriptor: PropertyDescriptor) {
//     target.bindMap[+tag] = propertyKey
//   }
// }

class Reader {
  // private buffer: Buffer
  private bindMap = {
    // [TAG.END] = 'readEnd',
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

  // constructor (buffer: Buffer) {
  //   this.buffer = buffer
  // }

  private readNode (readFunc: Function, offset: number, buffer: Buffer): TagNode {
    // console.log('readNode', buffer);
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
      left: (buffer).slice(8)
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

  private readListElems (list, buffer: Buffer, type, i: number) {
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
    // const result = []
    // for (let i = 0; i < lengthNode.value; i++) {
    //   const node = this.readTag(lengthNode.left, {
    //     value: {
    //       type
    //     }
    //   })
    //   result.push(node)
    //   buffer = node.left
    // }

    // const result = []
    // const buffer = Array(length).reduce((a, b) => {
    //   const node = this.readTag(lengthNode.left, {
    //     value: {
    //       type
    //     }
    //   })
    //   result.push(node)
    //   return node.left
    // }, lengthNode.left)
    const result = []
    const newBuffer = this.readListElems(result, lengthNode.left, type, lengthNode.value)
    return {
      value: result,
      left: newBuffer
    }
  }

  private readCompoundElems (list, buffer: Buffer) {
    const node = this.readTag(buffer, undefined)
    console.log(buffer);
    if (node.type === TAG.END) {
      return node.left
    } else {
      list.push(node)
      return this.readCompoundElems(list, node.left)
    }
  }

  private readCompound (buffer?: Buffer): TagNode {
    const result = []
    // while (true) {
    //   const node = this.readTag(buffer, undefined)
    //   buffer = node.left
    //   if (node.type === TAG.END) {
    //     break
    //   } else {
    //     result.push(node)
    //   }
    // }
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
    // console.log('readArray', buffer);
    const { value: size, left } = this.readInt(buffer)
    // buffer = left
    // const result = []
    // for (let i = 0; i < size; i++) {
    //   const node = readFunc.call(this, buffer)
    //   result.push(node)
    //   buffer = node.left
    // }
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
    // console.log('readTag', buffer)
    // if (type === TAG.END) {
    //   return {
    //     type: TAG.END,
    //     name: '',
    //     left: left
    //   }
    // } else if (type === TAG.BYTE) {
    //   const node = this.readByte(left)
    //   return {
    //     type: TAG.BYTE,
    //     name,
    //     left: node.left,
    //     value: node.value
    //   }
    // } else if (type === TAG.SHORT) {
    //   const node = this.readShort(left)
    //   return {
    //     type: TAG.SHORT,
    //     name,
    //     left: node.left,
    //     value: node.value
    //   }
    // } else if (type === TAG.INT) {
    //   const node = this.readInt(left)
    //   return {
    //     type: TAG.INT,
    //     name,
    //     left: node.left,
    //     value: node.value
    //   }
    // } else if (type === TAG.LONG) {
    //   const node = this.readLong(left)
    //   return {
    //     type: TAG.LONG,
    //     name,
    //     left: node.left,
    //     value: node.value
    //   }
    // } else if (type === TAG.FLOAT) {
    //   const node = this.readFloat(left)
    //   return {
    //     type: TAG.FLOAT,
    //     name,
    //     left: node.left,
    //     value: node.value
    //   }
    // } else if (type === TAG.DOUBLE) {
    //   const node = this.readDouble(left)
    //   return {
    //     type: TAG.DOUBLE,
    //     name,
    //     left: node.left,
    //     value: node.value
    //   }
    // } else if (type === TAG.BYTE_ARRAY) {
    //   const node = this.readByteArray(left)
    //   return {
    //     type: TAG.BYTE_ARRAY,
    //     name,
    //     left: node.left,
    //     value: node.value
    //   }
    // } else if (type === TAG.STRING) {
    //   const node = this.readString(left)
    //   return {
    //     type: TAG.STRING,
    //     name,
    //     left: node.left,
    //     value: node.value
    //   } 
    // } else if (type === TAG.LIST) {
    //   const node = this.readList(left)
    //   return {
    //     type: TAG.LIST,
    //     name,
    //     left: node.left,
    //     value: node.value
    //   }
    // } else if (type === TAG.COMPOUND) {
    //   const node = this.readCompound(left)
    //   return {
    //     type: TAG.COMPOUND,
    //     name,
    //     left: node.left,
    //     value: node.value
    //   }
    // } else if (type === TAG.INT_ARRAY) {
    //   const node = this.readIntArray(left)
    //   return {
    //     type: TAG.INT_ARRAY,
    //     name,
    //     left: node.left,
    //     value: node.value
    //   }
    // } else if (type === TAG.LONG_ARRAY) {
    //   const node = this.readLongArray(left)
    //   return {
    //     type: TAG.LONG_ARRAY,
    //     name,
    //     left: node.left,
    //     value: node.value
    //   }
    // }

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

  read (level: Buffer) {
    const obj = this.readTag(level, undefined)
    this.prettify(obj)
    return obj
  }

  parse (level:Buffer, path: String) {
    const json = JSON.stringify(this.read(level))
    fs.writeFileSync(path, json, 'utf8')
    return json
  }
}

const level: Buffer = zlib.gunzipSync(fs.readFileSync('./src/level.dat'))

const reader = new Reader()
const result = reader.read(level)
console.log(result)
reader.parse(level, 'result.json')