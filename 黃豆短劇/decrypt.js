// 独立解密验证：读取 samples/capture.json 样本，验证解密过程
// key = HMAC-SHA256(requestIdHex解码, MASTER_KEY) → AES-128-CBC(iv+密文) → gzip 解压 → JSON
const fs = require('fs')
const crypto = require('crypto')
const { decryptCBCPkcs7Hex } = require('./crypto-js.js')
const pako = require('./pako.min.js')

const MASTER_KEY = '7961beb44246e3012ce228d6b5ced05a'

function deriveKeyHex(requestId) {
  return crypto.createHmac('sha256', Buffer.from(MASTER_KEY, 'utf8'))
    .update(Buffer.from(requestId.replace(/-/g, ''), 'hex'))
    .digest('hex')
}

// node 原生 AES-CBC 解密（交叉验证；key 为 32 字节 → AES-256）
function decryptNative(cipherHex, keyHex, ivHex) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(keyHex, 'hex'), Buffer.from(ivHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()])
}

function unzipIfNeeded(buf) {
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return Buffer.from(pako.ungzip(new Uint8Array(buf)))
  }
  return buf
}

function main() {
  const raw = fs.readFileSync('samples/capture.json', 'utf8')
  const lines = raw.trim().split('\n').filter(Boolean)
  let ok = 0
  for (const line of lines) {
    const s = JSON.parse(line)
    try {
      const keyHex = deriveKeyHex(s.requestId)
      // 响应格式: [16字节响应iv][AES密文]——响应 iv 在响应体头部，与请求 iv 无关
      const ivHex = s.rawHex.slice(0, 32)
      const cipherHex = s.rawHex.slice(32)

      // 1) 项目 crypto-js 解密
      const plainHex = decryptCBCPkcs7Hex(cipherHex, keyHex, ivHex)
      const bufA = unzipIfNeeded(Buffer.from(plainHex, 'hex'))
      const jsonA = JSON.parse(bufA.toString('utf8'))

      // 2) node 原生交叉验证
      const bufB = unzipIfNeeded(decryptNative(cipherHex, keyHex, ivHex))
      const jsonB = JSON.parse(bufB.toString('utf8'))

      const same = JSON.stringify(jsonA) === JSON.stringify(jsonB)
      console.log(`[${s.label}] ${s.path} → ✓ 解密成功 ${same ? '(crypto-js == node原生)' : '(两实现不一致!)'} status=${jsonA.status} err=${jsonA.error || '-'}`)
      console.log(`   data: ${JSON.stringify(jsonA.data ?? jsonA).slice(0, 220)}`)
      ok++
    } catch (e) {
      console.log(`[${s.label}] ${s.path} → ✗ 解密失败: ${e.message}`)
    }
  }
  console.log(`\n结果: ${ok}/${lines.length} 样本解密成功`)
  if (ok !== lines.length) process.exit(1)
}

main()
