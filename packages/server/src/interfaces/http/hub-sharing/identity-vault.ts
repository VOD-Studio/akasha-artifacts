import type { HubIdentityStore } from '../../../domain/hub-sharing.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

/** 签名与密文统一采用无填充的 URL 安全编码。 */
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/** 解码结果可直接交给 Web Crypto 验签或解密。 */
export function decodeBase64url(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
    c.charCodeAt(0),
  )
}

/** 同一 Hub 的副本共享根密钥；令牌绑定 origin 与账号，邮箱索引使用独立子密钥。 */
export function createIdentityVault(store: HubIdentityStore, secret: string, origin: string) {
  const root = crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
  const context = (purpose: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: encoder.encode(origin),
    info: encoder.encode(`akasha/hub/identity/v1/${purpose}`),
  })
  const cipher = root.then((key) =>
    crypto.subtle.deriveKey(context('token'), key, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]),
  )
  const index = root.then((key) =>
    crypto.subtle.deriveKey(
      context('email'),
      key,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign'],
    ),
  )
  const emailKey = async (email: string) => {
    const signature = await crypto.subtle.sign(
      'HMAC',
      await index,
      encoder.encode(email.toLowerCase()),
    )
    return base64url(new Uint8Array(signature))
  }
  const save = async (id: string, token: string, emails: readonly string[]) => {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(id) },
      await cipher,
      encoder.encode(token),
    )
    await store.saveIdentitySecret(
      id,
      `v1.${base64url(iv)}.${base64url(new Uint8Array(sealed))}`,
      await Promise.all(emails.map(emailKey)),
    )
  }
  const open = async (id: string) => {
    const record = await store.getIdentitySecret(id)
    if (!record) return
    const [version, iv, sealed, extra] = record.split('.')
    if (version !== 'v1' || !iv || !sealed || extra !== undefined) return
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decodeBase64url(iv), additionalData: encoder.encode(id) },
      await cipher,
      decodeBase64url(sealed),
    )
    return decoder.decode(plaintext)
  }
  const find = async (email: string) => store.findIdentityByEmailKey(await emailKey(email))
  return { save, open, find }
}
