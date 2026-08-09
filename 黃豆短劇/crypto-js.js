/* eslint-disable */
// Minimal CryptoJS bundle: AES-128 + ECB + Pkcs7 + Utf8/Base64
// Adapted from CryptoJS 3.1.x official source (MIT). Trimmed to only what 糖心 API needs.
// Public API:
//   import { AES, enc, mode, pad } from "./crypto-js"
//   AES.encrypt(plaintextWordArray, keyWordArray, { mode: mode.ECB, padding: pad.Pkcs7 }).toString()
//   AES.decrypt(base64String, keyWordArray, { mode: mode.ECB, padding: pad.Pkcs7 }).toString(enc.Utf8)
//   enc.Utf8.parse(str) / .stringify(wa)
//   enc.Base64.parse(str) / .stringify(wa)

// ---------------- WordArray ----------------
function WordArray(words, sigBytes) {
  this.words = words || []
  this.sigBytes = sigBytes != null ? sigBytes : this.words.length * 4
}
WordArray.prototype.clone = function () {
  return new WordArray(this.words.slice(0), this.sigBytes)
}
WordArray.prototype.concat = function (wa) {
  var thisWords = this.words
  var thatWords = wa.words
  var thisSigBytes = this.sigBytes
  var thatSigBytes = wa.sigBytes
  this.clamp()
  if (thisSigBytes % 4) {
    for (var i = 0; i < thatSigBytes; i++) {
      var b = (thatWords[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
      thisWords[(thisSigBytes + i) >>> 2] |= b << (24 - ((thisSigBytes + i) % 4) * 8)
    }
  } else {
    for (var j = 0; j < thatSigBytes; j += 4) {
      thisWords[(thisSigBytes + j) >>> 2] = thatWords[j >>> 2]
    }
  }
  this.sigBytes = thisSigBytes + thatSigBytes
  return this
}
WordArray.prototype.clamp = function () {
  this.words[this.sigBytes >>> 2] &= 0xffffffff << (32 - (this.sigBytes % 4) * 8)
  this.words.length = Math.ceil(this.sigBytes / 4)
}
WordArray.prototype.toString = function (encoder) {
  return (encoder || Hex).stringify(this)
}

// ---------------- Hex encoder ----------------
var Hex = {
  stringify: function (wa) {
    var words = wa.words
    var sig = wa.sigBytes
    var out = []
    for (var i = 0; i < sig; i++) {
      var b = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
      out.push((b >>> 4).toString(16))
      out.push((b & 0x0f).toString(16))
    }
    return out.join("")
  },
  parse: function (hex) {
    var len = hex.length
    var words = []
    for (var i = 0; i < len; i += 2) {
      words[i >>> 3] |= (parseInt(hex.substr(i, 2), 16)) << (24 - (i % 8) * 4)
    }
    return new WordArray(words, len / 2)
  },
}

// ---------------- Utf8 encoder ----------------
var Utf8 = {
  stringify: function (wa) {
    var words = wa.words
    var sig = wa.sigBytes
    var bytes = []
    for (var i = 0; i < sig; i++) {
      bytes.push((words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff)
    }
    // bytes -> utf-8 string
    var s = ""
    for (var k = 0; k < bytes.length; ) {
      var c = bytes[k]
      if (c < 0x80) {
        s += String.fromCharCode(c)
        k += 1
      } else if (c < 0xe0) {
        s += String.fromCharCode(((c & 0x1f) << 6) | (bytes[k + 1] & 0x3f))
        k += 2
      } else if (c < 0xf0) {
        s += String.fromCharCode(
          ((c & 0x0f) << 12) | ((bytes[k + 1] & 0x3f) << 6) | (bytes[k + 2] & 0x3f)
        )
        k += 3
      } else {
        var cp =
          ((c & 0x07) << 18) |
          ((bytes[k + 1] & 0x3f) << 12) |
          ((bytes[k + 2] & 0x3f) << 6) |
          (bytes[k + 3] & 0x3f)
        cp -= 0x10000
        s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
        k += 4
      }
    }
    return s
  },
  parse: function (str) {
    var bytes = []
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i)
      if (c < 0x80) bytes.push(c)
      else if (c < 0x800) {
        bytes.push(0xc0 | (c >> 6))
        bytes.push(0x80 | (c & 0x3f))
      } else if (c >= 0xd800 && c <= 0xdbff) {
        var lo = str.charCodeAt(++i)
        var cp = 0x10000 + (((c & 0x3ff) << 10) | (lo & 0x3ff))
        bytes.push(0xf0 | (cp >> 18))
        bytes.push(0x80 | ((cp >> 12) & 0x3f))
        bytes.push(0x80 | ((cp >> 6) & 0x3f))
        bytes.push(0x80 | (cp & 0x3f))
      } else {
        bytes.push(0xe0 | (c >> 12))
        bytes.push(0x80 | ((c >> 6) & 0x3f))
        bytes.push(0x80 | (c & 0x3f))
      }
    }
    var words = []
    for (var j = 0; j < bytes.length; j++) {
      words[j >>> 2] |= (bytes[j] & 0xff) << (24 - (j % 4) * 8)
    }
    return new WordArray(words, bytes.length)
  },
}

// ---------------- Base64 encoder ----------------
var B64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
var Base64 = {
  stringify: function (wa) {
    var words = wa.words
    var sig = wa.sigBytes
    wa.clamp()
    var out = []
    for (var i = 0; i < sig; i += 3) {
      var b1 = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
      var b2 = (words[(i + 1) >>> 2] >>> (24 - ((i + 1) % 4) * 8)) & 0xff
      var b3 = (words[(i + 2) >>> 2] >>> (24 - ((i + 2) % 4) * 8)) & 0xff
      var triplet = (b1 << 16) | (b2 << 8) | b3
      for (var j = 0; j < 4 && i + j * 0.75 < sig; j++) {
        out.push(B64_MAP.charAt((triplet >>> (6 * (3 - j))) & 0x3f))
      }
    }
    while (out.length % 4) out.push("=")
    return out.join("")
  },
  parse: function (str) {
    var len = str.length
    if (!Base64._rev) {
      Base64._rev = []
      for (var k = 0; k < B64_MAP.length; k++) Base64._rev[B64_MAP.charCodeAt(k)] = k
    }
    var rev = Base64._rev
    var pad = str.indexOf("=")
    if (pad === -1) pad = len
    var words = []
    var nBytes = 0
    for (var i = 0; i < pad; i++) {
      if (i % 4) {
        var b1 = rev[str.charCodeAt(i - 1)] << ((i % 4) * 2)
        var b2 = rev[str.charCodeAt(i)] >>> (6 - (i % 4) * 2)
        words[nBytes >>> 2] |= ((b1 | b2) & 0xff) << (24 - (nBytes % 4) * 8)
        nBytes++
      }
    }
    return new WordArray(words, nBytes)
  },
}

// ---------------- AES algorithm ----------------
// Round constants and S-boxes, computed once.
var SBOX = []
var INV_SBOX = []
var SUB_MIX_0 = []
var SUB_MIX_1 = []
var SUB_MIX_2 = []
var SUB_MIX_3 = []
var INV_SUB_MIX_0 = []
var INV_SUB_MIX_1 = []
var INV_SUB_MIX_2 = []
var INV_SUB_MIX_3 = []

;(function () {
  var d = []
  for (var i = 0; i < 256; i++) d[i] = i < 128 ? i << 1 : (i << 1) ^ 0x11b
  var x = 0
  var xi = 0
  for (var j = 0; j < 256; j++) {
    var sx = xi ^ (xi << 1) ^ (xi << 2) ^ (xi << 3) ^ (xi << 4)
    sx = (sx >>> 8) ^ (sx & 0xff) ^ 0x63
    SBOX[x] = sx
    INV_SBOX[sx] = x
    var x2 = d[x]
    var x4 = d[x2]
    var x8 = d[x4]
    var t = (d[sx] * 0x101) ^ (sx * 0x1010100)
    SUB_MIX_0[x] = (t << 24) | (t >>> 8)
    SUB_MIX_1[x] = (t << 16) | (t >>> 16)
    SUB_MIX_2[x] = (t << 8) | (t >>> 24)
    SUB_MIX_3[x] = t
    var u = (x8 * 0x1010101) ^ (x4 * 0x10001) ^ (x2 * 0x101) ^ (x * 0x1010100)
    INV_SUB_MIX_0[sx] = (u << 24) | (u >>> 8)
    INV_SUB_MIX_1[sx] = (u << 16) | (u >>> 16)
    INV_SUB_MIX_2[sx] = (u << 8) | (u >>> 24)
    INV_SUB_MIX_3[sx] = u
    if (!x) {
      x = xi = 1
    } else {
      x = x2 ^ d[d[d[x8 ^ x2]]]
      xi ^= d[d[xi]]
    }
  }
})()
var RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]

function AESCipher(keyWA) {
  var key = keyWA.words
  var keySize = keyWA.sigBytes / 4
  var nRounds = keySize + 6
  var ksRows = (nRounds + 1) * 4
  var keySchedule = []
  for (var i = 0; i < ksRows; i++) {
    if (i < keySize) {
      keySchedule[i] = key[i]
    } else {
      var t = keySchedule[i - 1]
      if (!(i % keySize)) {
        t = (t << 8) | (t >>> 24)
        t =
          (SBOX[(t >>> 24) & 0xff] << 24) |
          (SBOX[(t >>> 16) & 0xff] << 16) |
          (SBOX[(t >>> 8) & 0xff] << 8) |
          SBOX[t & 0xff]
        t ^= RCON[(i / keySize) | 0] << 24
      } else if (keySize > 6 && i % keySize === 4) {
        t =
          (SBOX[(t >>> 24) & 0xff] << 24) |
          (SBOX[(t >>> 16) & 0xff] << 16) |
          (SBOX[(t >>> 8) & 0xff] << 8) |
          SBOX[t & 0xff]
      }
      keySchedule[i] = keySchedule[i - keySize] ^ t
    }
  }
  var invKeySchedule = []
  for (var inv = 0; inv < ksRows; inv++) {
    var idx = ksRows - inv
    var w = inv % 4 ? keySchedule[idx] : keySchedule[idx - 4]
    if (inv < 4 || idx <= 4) {
      invKeySchedule[inv] = w
    } else {
      invKeySchedule[inv] =
        INV_SUB_MIX_0[SBOX[(w >>> 24) & 0xff]] ^
        INV_SUB_MIX_1[SBOX[(w >>> 16) & 0xff]] ^
        INV_SUB_MIX_2[SBOX[(w >>> 8) & 0xff]] ^
        INV_SUB_MIX_3[SBOX[w & 0xff]]
    }
  }
  this.nRounds = nRounds
  this.keySchedule = keySchedule
  this.invKeySchedule = invKeySchedule
}

AESCipher.prototype._cryptBlock = function (M, offset, ks, SUB0, SUB1, SUB2, SUB3, SBX) {
  var nRounds = this.nRounds
  var s0 = M[offset] ^ ks[0]
  var s1 = M[offset + 1] ^ ks[1]
  var s2 = M[offset + 2] ^ ks[2]
  var s3 = M[offset + 3] ^ ks[3]
  var ksRow = 4
  for (var round = 1; round < nRounds; round++) {
    var t0 =
      SUB0[(s0 >>> 24) & 0xff] ^
      SUB1[(s1 >>> 16) & 0xff] ^
      SUB2[(s2 >>> 8) & 0xff] ^
      SUB3[s3 & 0xff] ^
      ks[ksRow++]
    var t1 =
      SUB0[(s1 >>> 24) & 0xff] ^
      SUB1[(s2 >>> 16) & 0xff] ^
      SUB2[(s3 >>> 8) & 0xff] ^
      SUB3[s0 & 0xff] ^
      ks[ksRow++]
    var t2 =
      SUB0[(s2 >>> 24) & 0xff] ^
      SUB1[(s3 >>> 16) & 0xff] ^
      SUB2[(s0 >>> 8) & 0xff] ^
      SUB3[s1 & 0xff] ^
      ks[ksRow++]
    var t3 =
      SUB0[(s3 >>> 24) & 0xff] ^
      SUB1[(s0 >>> 16) & 0xff] ^
      SUB2[(s1 >>> 8) & 0xff] ^
      SUB3[s2 & 0xff] ^
      ks[ksRow++]
    s0 = t0
    s1 = t1
    s2 = t2
    s3 = t3
  }
  var u0 =
    ((SBX[(s0 >>> 24) & 0xff] << 24) |
      (SBX[(s1 >>> 16) & 0xff] << 16) |
      (SBX[(s2 >>> 8) & 0xff] << 8) |
      SBX[s3 & 0xff]) ^
    ks[ksRow++]
  var u1 =
    ((SBX[(s1 >>> 24) & 0xff] << 24) |
      (SBX[(s2 >>> 16) & 0xff] << 16) |
      (SBX[(s3 >>> 8) & 0xff] << 8) |
      SBX[s0 & 0xff]) ^
    ks[ksRow++]
  var u2 =
    ((SBX[(s2 >>> 24) & 0xff] << 24) |
      (SBX[(s3 >>> 16) & 0xff] << 16) |
      (SBX[(s0 >>> 8) & 0xff] << 8) |
      SBX[s1 & 0xff]) ^
    ks[ksRow++]
  var u3 =
    ((SBX[(s3 >>> 24) & 0xff] << 24) |
      (SBX[(s0 >>> 16) & 0xff] << 16) |
      (SBX[(s1 >>> 8) & 0xff] << 8) |
      SBX[s2 & 0xff]) ^
    ks[ksRow++]
  M[offset] = u0
  M[offset + 1] = u1
  M[offset + 2] = u2
  M[offset + 3] = u3
}

AESCipher.prototype.encryptBlock = function (M, offset) {
  this._cryptBlock(M, offset, this.keySchedule, SUB_MIX_0, SUB_MIX_1, SUB_MIX_2, SUB_MIX_3, SBOX)
}
AESCipher.prototype.decryptBlock = function (M, offset) {
  // swap s1 and s3 trick (CryptoJS source). Apply by passing inv tables and then swapping.
  var t = M[offset + 1]
  M[offset + 1] = M[offset + 3]
  M[offset + 3] = t
  this._cryptBlock(
    M,
    offset,
    this.invKeySchedule,
    INV_SUB_MIX_0,
    INV_SUB_MIX_1,
    INV_SUB_MIX_2,
    INV_SUB_MIX_3,
    INV_SBOX
  )
  t = M[offset + 1]
  M[offset + 1] = M[offset + 3]
  M[offset + 3] = t
}

// ---------------- Pkcs7 padding ----------------
var Pkcs7 = {
  pad: function (data, blockSize) {
    var blockSizeBytes = blockSize * 4
    var nPaddingBytes = blockSizeBytes - (data.sigBytes % blockSizeBytes)
    var paddingWord = (nPaddingBytes << 24) | (nPaddingBytes << 16) | (nPaddingBytes << 8) | nPaddingBytes
    var paddingWords = []
    for (var i = 0; i < nPaddingBytes; i += 4) paddingWords.push(paddingWord)
    data.concat(new WordArray(paddingWords, nPaddingBytes))
  },
  unpad: function (data) {
    var nPaddingBytes = data.words[(data.sigBytes - 1) >>> 2] & 0xff
    data.sigBytes -= nPaddingBytes
  },
}

// ---------------- ECB mode ----------------
var ECB = {
  encryptBlocks: function (cipher, words, offset) {
    cipher.encryptBlock(words, offset)
  },
  decryptBlocks: function (cipher, words, offset) {
    cipher.decryptBlock(words, offset)
  },
}

// ---------------- Cipher core ----------------
var BLOCK_SIZE = 4 // 32-bit words per AES block (16 bytes)

function _processBlocks(words, sigBytes, mode, cipher, encrypting) {
  // pad first if encrypting (caller handles), then loop blocks
  var nBlocks = sigBytes / (BLOCK_SIZE * 4)
  for (var i = 0; i < nBlocks; i++) {
    if (encrypting) mode.encryptBlocks(cipher, words, i * BLOCK_SIZE)
    else mode.decryptBlocks(cipher, words, i * BLOCK_SIZE)
  }
}

// CipherParams: a value object that knows how to .toString() (Base64)
function CipherParams(props) {
  Object.assign(this, props)
}
CipherParams.prototype.toString = function (formatter) {
  return (formatter || OpenSSLFormatter).stringify(this)
}

// We don't generate OpenSSL salt header for raw AES; default toString returns ciphertext base64.
var OpenSSLFormatter = {
  stringify: function (cipherParams) {
    return cipherParams.ciphertext.toString(Base64)
  },
  parse: function (str) {
    return new CipherParams({ ciphertext: Base64.parse(str) })
  },
}

var AES = {
  encrypt: function (plaintext, keyWA, cfg) {
    cfg = cfg || {}
    var modeImpl = cfg.mode || ECB
    var padding = cfg.padding || Pkcs7
    var dataWA = plaintext.clone ? plaintext.clone() : Utf8.parse(String(plaintext))
    padding.pad(dataWA, BLOCK_SIZE)
    var cipher = new AESCipher(keyWA)
    _processBlocks(dataWA.words, dataWA.sigBytes, modeImpl, cipher, true)
    return new CipherParams({
      ciphertext: dataWA,
      key: keyWA,
      algorithm: "AES",
      mode: modeImpl,
      padding: padding,
      blockSize: BLOCK_SIZE,
    })
  },
  decrypt: function (ciphertext, keyWA, cfg) {
    cfg = cfg || {}
    var modeImpl = cfg.mode || ECB
    var padding = cfg.padding || Pkcs7
    // ciphertext can be a Base64 string or a CipherParams object
    var ctParams
    if (typeof ciphertext === "string") {
      ctParams = OpenSSLFormatter.parse(ciphertext)
    } else if (ciphertext.ciphertext) {
      ctParams = ciphertext
    } else {
      ctParams = new CipherParams({ ciphertext: ciphertext })
    }
    var dataWA = ctParams.ciphertext.clone()
    var cipher = new AESCipher(keyWA)
    _processBlocks(dataWA.words, dataWA.sigBytes, modeImpl, cipher, false)
    padding.unpad(dataWA)
    return dataWA
  },
}

// ---------------- CBC helpers ----------------
function encryptCBCPkcs7Hex(plaintextHex, keyHex, ivHex) {
  var data = Hex.parse(plaintextHex)
  var key = Hex.parse(keyHex)
  var iv = Hex.parse(ivHex)
  Pkcs7.pad(data, BLOCK_SIZE)
  var cipher = new AESCipher(key)
  var previous = iv.words.slice(0, BLOCK_SIZE)
  for (var offset = 0; offset < data.sigBytes / 4; offset += BLOCK_SIZE) {
    for (var i = 0; i < BLOCK_SIZE; i++) data.words[offset + i] ^= previous[i]
    cipher.encryptBlock(data.words, offset)
    previous = data.words.slice(offset, offset + BLOCK_SIZE)
  }
  return data.toString(Hex)
}

function decryptCBCPkcs7Hex(ciphertextHex, keyHex, ivHex) {
  var data = Hex.parse(ciphertextHex)
  var key = Hex.parse(keyHex)
  var iv = Hex.parse(ivHex)
  var cipher = new AESCipher(key)
  var previous = iv.words.slice(0, BLOCK_SIZE)
  for (var offset = 0; offset < data.sigBytes / 4; offset += BLOCK_SIZE) {
    var current = data.words.slice(offset, offset + BLOCK_SIZE)
    cipher.decryptBlock(data.words, offset)
    for (var i = 0; i < BLOCK_SIZE; i++) data.words[offset + i] ^= previous[i]
    previous = current
  }
  Pkcs7.unpad(data)
  return data.toString(Hex)
}

// ---------------- exports ----------------
var enc = { Utf8: Utf8, Base64: Base64, Hex: Hex }
var mode = { ECB: ECB }
var pad = { Pkcs7: Pkcs7 }

module.exports = { AES: AES, enc: enc, mode: mode, pad: pad, WordArray: WordArray, encryptCBCPkcs7Hex: encryptCBCPkcs7Hex, decryptCBCPkcs7Hex: decryptCBCPkcs7Hex }
module.exports.AES = AES
module.exports.enc = enc
module.exports.mode = mode
module.exports.pad = pad
module.exports.WordArray = WordArray
module.exports.encryptCBCPkcs7Hex = encryptCBCPkcs7Hex
module.exports.decryptCBCPkcs7Hex = decryptCBCPkcs7Hex
