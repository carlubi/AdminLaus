// Utilitats compartides per la taula de prescriptors i el calendari de subvencions.
import type { MenaAvis, MenaSync } from './tipus.js';

export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`No s'ha trobat l'element ${sel}`);
  return el;
};

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c] as string));

/** Text fosc o clar segons la lluminositat del color que ve de Monday. */
export function textSobre(hex: string): string {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) || 0);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 155 ? '#1f2937' : '#ffffff';
}

export async function api<T>(ruta: string, opcions: RequestInit = {}): Promise<T> {
  const r = await fetch(ruta, {
    headers: opcions.body ? { 'Content-Type': 'application/json' } : {},
    ...opcions,
  });
  const dades = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw new Error(dades.error || `Error ${r.status}`);
  return dades;
}

export function avisa(text: string, mena: MenaAvis = 'ok'): void {
  const colors: Record<MenaAvis, string> = { ok: 'bg-marca text-white', err: 'bg-red-600 text-white' };
  const el = document.createElement('div');
  el.className = `${colors[mena]} px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium animate-llisca max-w-sm`;
  el.textContent = text;
  $('#avisos').append(el);
  window.setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(24px)';
    window.setTimeout(() => el.remove(), 300);
  }, mena === 'err' ? 6000 : 2600);
}

/** Indicador de sincronització: un punt de color i un text curt. */
export function pintaPuntSync(sel: string, text: string, mena: MenaSync = 'neutre'): void {
  const punts: Record<MenaSync, string> = {
    neutre: 'bg-slate-300',
    desa: 'bg-amber-400 animate-pampallugueja',
    ok: 'bg-emerald-500',
    err: 'bg-red-500',
  };
  $(sel).innerHTML = `<span class="w-2 h-2 rounded-full ${punts[mena]}"></span>${esc(text)}`;
}
