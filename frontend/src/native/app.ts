/**
 * Bridge to the ShowUp mobile app (mobile/ - a Capacitor shell that loads this
 * site). Capacitor injects `window.Capacitor` into the page, so plugins are used
 * through it and the website needs no native npm packages. In a normal browser
 * every function here is a no-op.
 */
import { fetchWithAuth } from '../utils/fetchWithAuth';

const TOKEN_KEY = 'push_token';

function cap(): any {
  return (window as any).Capacitor;
}

export function isNativeApp(): boolean {
  return !!cap()?.isNativePlatform?.();
}

function pushPlugin(): any {
  return isNativeApp() ? cap().Plugins?.PushNotifications : undefined;
}

/** Open a push's deep link: `/guests?event=<id>` selects that event first. */
function openFromPush(url?: string) {
  if (!url || !url.startsWith('/')) return;
  const [path, query = ''] = url.split('?');
  const eventId = new URLSearchParams(query).get('event');
  if (eventId) localStorage.setItem('selected_event_id', eventId);
  window.location.href = path;
}

let tapsArmed = false;

/** At startup, logged in or not: a tap on a notification opens its page. */
export function armPushTaps() {
  const P = pushPlugin();
  if (!P || tapsArmed) return;
  tapsArmed = true;
  P.addListener('pushNotificationActionPerformed', (e: any) => openFromPush(e?.notification?.data?.url));
}

let registering = false;

/** After login: ask permission once, register, hand the token to the server. */
export async function registerForPush() {
  const P = pushPlugin();
  if (!P || registering) return;
  registering = true;
  try {
    await P.addListener('registration', async (t: { value: string }) => {
      localStorage.setItem(TOKEN_KEY, t.value);
      await fetchWithAuth('/api/push/devices', {
        method: 'POST',
        body: JSON.stringify({ token: t.value, platform: cap().getPlatform?.() === 'ios' ? 'ios' : 'android' }),
      });
    });
    let perm = await P.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await P.requestPermissions();
    if (perm.receive !== 'granted') return;
    if (cap().getPlatform?.() === 'android') {
      await P.createChannel({ id: 'showup', name: 'עדכונים על האירוע', importance: 4, sound: 'default', vibration: true });
    }
    await P.register();
  } catch (e) {
    console.warn('push registration failed', e);
    registering = false;
  }
}

/** On logout: this phone stops getting the account's notifications. */
export function forgetPushDevice() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token || !isNativeApp()) return;
  localStorage.removeItem(TOKEN_KEY);
  fetchWithAuth('/api/push/devices/remove', { method: 'POST', body: JSON.stringify({ token }) }).catch(() => {});
}

const REFRESHED_KEY = 'session_refreshed_at';

/** The app stays signed in for a month: every open swaps the token for a fresh
 *  one (at most every few hours). A 401 means the account is gone/suspended -
 *  the stale token is left to expire and the normal login flow takes over. */
export async function renewAppSession() {
  if (!isNativeApp()) return;
  const token = localStorage.getItem('access_token') || localStorage.getItem('token');
  if (!token) return;
  const last = Number(localStorage.getItem(REFRESHED_KEY) || 0);
  if (Date.now() - last < 6 * 3600 * 1000) return;
  try {
    const res = await fetchWithAuth('/api/auth/refresh', { method: 'POST' });
    if (!res.ok) return;
    const { access_token } = await res.json();
    if (access_token) {
      localStorage.setItem('access_token', access_token);
      localStorage.setItem(REFRESHED_KEY, String(Date.now()));
    }
  } catch {
    /* offline - try again next open */
  }
}

/** Renew now and whenever the app comes back to the foreground. */
export function armSessionRenewal() {
  if (!isNativeApp()) return;
  renewAppSession();
  cap().Plugins?.App?.addListener?.('resume', () => renewAppSession());
}

// ---- Phone contacts (guest list from the address book) ----------------------------

export interface PhoneContact {
  id: string;
  name: string;
  phone: string;      // the number we'd add (mobile first)
  phones: string[];   // every number on the card
}

function contactsPlugin(): any {
  return isNativeApp() ? cap().Plugins?.Contacts : undefined;
}

/** True inside an app build that has the contacts plugin (older APKs don't). */
export function canReadContacts(): boolean {
  return !!contactsPlugin();
}

const digits = (s: string) => (s || '').replace(/\D/g, '');
const isMobile = (n: string) => /^(05|9725)/.test(digits(n));

/** 'granted' | 'denied' | 'prompt' */
export async function contactsPermission(ask: boolean): Promise<string> {
  const C = contactsPlugin();
  if (!C) return 'denied';
  let p = await C.checkPermissions();
  if (ask && p.contacts !== 'granted' && p.contacts !== 'denied') p = await C.requestPermissions();
  if (ask && p.contacts === 'denied') p = await C.requestPermissions(); // Android may still ask once more
  return p.contacts === 'granted' ? 'granted' : p.contacts === 'denied' ? 'denied' : 'prompt';
}

/** Names + phone numbers only, read on the phone; nothing is uploaded here. */
export async function readPhoneContacts(): Promise<PhoneContact[]> {
  const C = contactsPlugin();
  if (!C) return [];
  const { contacts } = await C.getContacts({ projection: { name: true, phones: true } });
  const seen = new Set<string>();
  const out: PhoneContact[] = [];
  for (const c of contacts || []) {
    const phones: string[] = (c.phones || []).map((p: any) => String(p.number || '').trim()).filter((n: string) => digits(n).length >= 9);
    if (!phones.length) continue;
    const phone = phones.find(isMobile) || phones[0];
    const key = digits(phone).replace(/^972/, '0');
    if (seen.has(key)) continue;
    seen.add(key);
    const n = c.name || {};
    const name = (n.display || [n.given, n.family].filter(Boolean).join(' ') || '').trim();
    out.push({ id: String(c.contactId), name: name || phone, phone, phones });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'he'));
}
