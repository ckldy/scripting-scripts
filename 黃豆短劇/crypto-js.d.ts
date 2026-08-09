// Type declarations for the local minimal crypto-js bundle (AES-ECB-Pkcs7)

export interface WordArray {
  words: number[]
  sigBytes: number
  clone(): WordArray
  concat(wa: WordArray): WordArray
  clamp(): void
  toString(encoder?: Encoder): string
}

export interface Encoder {
  parse(str: string): WordArray
  stringify(wa: WordArray): string
}

export interface BlockCipherMode {
  encryptBlocks(cipher: any, words: number[], offset: number): void
  decryptBlocks(cipher: any, words: number[], offset: number): void
}

export interface Padding {
  pad(data: WordArray, blockSize: number): void
  unpad(data: WordArray): void
}

export interface CipherConfig {
  mode?: BlockCipherMode
  padding?: Padding
}

export interface CipherParams {
  ciphertext: WordArray
  toString(formatter?: { stringify(p: CipherParams): string }): string
}

export interface AESStatic {
  encrypt(plaintext: WordArray | string, key: WordArray, cfg?: CipherConfig): CipherParams
  decrypt(ciphertext: string | CipherParams, key: WordArray, cfg?: CipherConfig): WordArray
}

export const AES: AESStatic
export const enc: { Utf8: Encoder; Base64: Encoder; Hex: Encoder }
export const mode: { ECB: BlockCipherMode }
export const pad: { Pkcs7: Padding }
export const WordArray: { new (words?: number[], sigBytes?: number): WordArray }
export function encryptCBCPkcs7Hex(plaintextHex: string, keyHex: string, ivHex: string): string
export function decryptCBCPkcs7Hex(ciphertextHex: string, keyHex: string, ivHex: string): string
