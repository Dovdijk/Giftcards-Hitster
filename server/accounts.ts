import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { KV } from './store.js';
import { debouncedSaver } from './store.js';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>;

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string; // salt:hash
  createdAt: number;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  superAdmin: boolean;
}

interface Session {
  userId: string;
  expires: number;
}

const SESSION_DAYS = 30;

export class AuthError extends Error {}

async function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(pw, salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}

async function verifyPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = await scrypt(pw, salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

const normEmail = (e: string) => String(e ?? '').trim().toLowerCase();

export class Accounts {
  users: User[] = [];
  sessions: Record<string, Session> = {};
  private saveUsers;
  private saveSessions;
  private superAdmins: string[];
  private attempts = new Map<string, { n: number; until: number }>();

  constructor(private kv: KV) {
    this.saveUsers = debouncedSaver(kv, 'users', () => this.users, 100);
    this.saveSessions = debouncedSaver(kv, 'sessions', () => this.sessions, 500);
    this.superAdmins = (process.env.SUPERADMIN_EMAIL ?? '').split(',').map(normEmail).filter(Boolean);
  }

  async load() {
    this.users = ((await this.kv.load('users')) as User[] | null) ?? [];
    this.sessions = ((await this.kv.load('sessions')) as Record<string, Session> | null) ?? {};
    const now = Date.now();
    for (const [k, v] of Object.entries(this.sessions)) if (v.expires < now) delete this.sessions[k];
  }

  async flush() {
    await Promise.all([this.saveUsers.flushNow(), this.saveSessions.flushNow()]);
  }

  isSuperAdmin(u: User | null) {
    return !!u && this.superAdmins.includes(u.email);
  }

  publicUser(u: User): PublicUser {
    return { id: u.id, email: u.email, name: u.name, superAdmin: this.isSuperAdmin(u) };
  }

  user(id: string) {
    return this.users.find((u) => u.id === id) ?? null;
  }

  private throttle(key: string) {
    const a = this.attempts.get(key);
    if (a && a.until > Date.now() && a.n >= 8) throw new AuthError('Too many attempts. Wait a minute and try again.');
  }
  private fail(key: string) {
    const a = this.attempts.get(key);
    const fresh = !a || a.until < Date.now();
    this.attempts.set(key, { n: fresh ? 1 : a!.n + 1, until: Date.now() + 60_000 });
  }

  async signup(name: string, email: string, password: string) {
    const e = normEmail(email);
    const n = String(name ?? '').trim().slice(0, 60);
    if (!n) throw new AuthError('Please enter your name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new AuthError('Please enter a valid email address');
    if (String(password ?? '').length < 8) throw new AuthError('Password must be at least 8 characters');
    if (this.users.some((u) => u.email === e)) throw new AuthError('An account with this email already exists. Log in instead.');
    const user: User = { id: crypto.randomBytes(8).toString('base64url'), email: e, name: n, passwordHash: await hashPassword(password), createdAt: Date.now() };
    this.users.push(user);
    this.saveUsers.schedule();
    return user;
  }

  async login(email: string, password: string, ip: string) {
    const e = normEmail(email);
    this.throttle(ip);
    this.throttle(e);
    const u = this.users.find((x) => x.email === e);
    if (!u || !(await verifyPassword(String(password ?? ''), u.passwordHash))) {
      this.fail(ip);
      this.fail(e);
      throw new AuthError('Wrong email or password');
    }
    return u;
  }

  createSession(userId: string) {
    const token = crypto.randomBytes(32).toString('base64url');
    this.sessions[token] = { userId, expires: Date.now() + SESSION_DAYS * 86400_000 };
    this.saveSessions.schedule();
    return token;
  }

  destroySession(token: string | undefined) {
    if (token && this.sessions[token]) {
      delete this.sessions[token];
      this.saveSessions.schedule();
    }
  }

  userFromSession(token: string | undefined): User | null {
    if (!token) return null;
    const s = this.sessions[token];
    if (!s || s.expires < Date.now()) return null;
    return this.user(s.userId);
  }

  async setPassword(userId: string, password: string) {
    const u = this.user(userId);
    if (!u) throw new AuthError('Unknown user');
    if (String(password ?? '').length < 8) throw new AuthError('Password must be at least 8 characters');
    u.passwordHash = await hashPassword(password);
    // log out everywhere
    for (const [k, v] of Object.entries(this.sessions)) if (v.userId === userId) delete this.sessions[k];
    this.saveUsers.schedule();
    this.saveSessions.schedule();
  }

  async changeOwnPassword(userId: string, current: string, next: string) {
    const u = this.user(userId);
    if (!u || !(await verifyPassword(String(current ?? ''), u.passwordHash))) throw new AuthError('Current password is wrong');
    await this.setPassword(userId, next);
  }
}

export const SESSION_COOKIE = 'hitster_sid';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
