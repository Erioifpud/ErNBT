const fs = require('fs')
const { ungzip } = require('node-gzip')

const level = fs.readFileSync('./src/level.dat')

ungzip(level).then(decompressed => {
  console.log(decompressed)
})

