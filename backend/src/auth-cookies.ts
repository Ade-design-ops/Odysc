import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from './errors.js';

export const AUTH_COOKIE_NAMES = {
  flow: 'odysc_auth_flow', session: 'odysc_session', recovery: 'odysc_recovery',
} as const;

/** Auth material stays encrypted and authenticated, including on the browser. */
export class AuthCookieService {
  private readonly key: Buffer;

  constructor(secret: string, private readonly secure: boolean) {
    if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('AUTH_COOKIE_SECRET must contain at least 32 bytes.');
    this.key = createHash('sha256').update(secret).digest();
  }

  read(request: FastifyRequest, name: string): unknown | null {
    const header = request.headers.cookie;
    if (!header || header.length > 24_576) return null;
    const values = header.split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
    if (values.length !== 1) return null;
    const value = values[0]!.slice(name.length + 1);
    if (value.length > 4096 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) return null;
    try {
      const [iv, ciphertext, tag] = value.split('.').map(part => Buffer.from(part, 'base64url'));
      if (!iv || iv.length !== 12 || !ciphertext || !tag || tag.length !== 16) return null;
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAAD(Buffer.from(`odysc:v1:${name}`));
      decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
    } catch {
      return null;
    }
  }

  write(reply: FastifyReply, name: string, value: unknown, maxAge: number): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`odysc:v1:${name}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const sealed = [iv, ciphertext, cipher.getAuthTag()].map(part => part.toString('base64url')).join('.');
    this.append(reply, `${name}=${sealed}; Max-Age=${Math.max(0, Math.floor(maxAge))}; Path=/; HttpOnly; SameSite=Lax${this.secure ? '; Secure' : ''}`);
  }

  clear(reply: FastifyReply, name: string): void {
    this.append(reply, `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${this.secure ? '; Secure' : ''}`);
  }

  private append(reply: FastifyReply, cookie: string): void {
    if (Buffer.byteLength(cookie, 'utf8') > 4096) {
      throw new HttpError(502, 'The sign-in session could not be stored safely. Please try signing in again.', 'SUPABASE_RESPONSE_ERROR');
    }
    // Fastify appends Set-Cookie headers itself. Re-sending its existing array
    // duplicates earlier cookies on every write/clear in the same response.
    reply.header('set-cookie', cookie);
  }
}
