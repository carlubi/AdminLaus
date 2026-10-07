// Els «updates» de Monday: el fil de comentaris d'un element.
// El mateix calaix serveix per a un prescriptor i per a una subvenció, perquè
// els updates pengen de l'element, no del tauler.
import type { Update } from './tipus.js';
import { $, esc, api, avisa } from './comuns.js';

let itemId: string | null = null;
let updates: Update[] = [];
let responentA: string | null = null;
let connectat = false;
/** Es crida després de crear o esborrar, perquè qui l'ha obert refresqui el seu comptador. */
let alCanviar: ((n: number) => void) | null = null;

const inicials = (nom: string): string =>
  nom.trim().split(/\s+/).slice(0, 2).map(p => p[0] ?? '').join('').toUpperCase() || '?';

/** «fa 3 h», «ahir», «12/05/2026»… */
function quanFa(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'ara mateix';
  if (min < 60) return `fa ${min} min`;
  if (min < 60 * 24) return `fa ${Math.round(min / 60)} h`;
  if (min < 60 * 48) return 'ahir';
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

const avatar = (u: { autor: string; foto?: string }, mida = 'w-8 h-8'): string =>
  u.foto
    ? `<img src="${esc(u.foto)}" alt="" class="${mida} rounded-full object-cover shrink-0">`
    : `<span class="${mida} rounded-full bg-marca-clar text-marca text-[11px] font-bold
         flex items-center justify-center shrink-0">${esc(inicials(u.autor))}</span>`;

function pinta(): void {
  const fil = updates.length ? updates.map(u => `
    <article class="bg-white rounded-xl border border-marca-vora p-3 animate-entra" data-update="${esc(u.id)}">
      <header class="flex items-center gap-2 mb-1.5">
        ${avatar(u)}
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-slate-800 truncate">${esc(u.autor)}</p>
          <p class="text-[11px] text-slate-400">${esc(quanFa(u.quan))}</p>
        </div>
        <button data-esborra-update class="p-1 rounded text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600" title="Esborra">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </header>
      <p class="text-sm text-slate-700 whitespace-pre-wrap break-words">${esc(u.text)}</p>

      ${u.respostes.length ? `<div class="mt-2.5 pl-3 border-l-2 border-marca-clar space-y-2">${u.respostes.map(r => `
        <div>
          <p class="text-xs"><span class="font-semibold text-slate-700">${esc(r.autor)}</span>
             <span class="text-slate-400">· ${esc(quanFa(r.quan))}</span></p>
          <p class="text-sm text-slate-600 whitespace-pre-wrap break-words">${esc(r.text)}</p>
        </div>`).join('')}</div>` : ''}

      <button data-respon class="mt-2 text-xs font-medium text-marca transition-colors hover:text-marca-fosc">Respon</button>
    </article>`).join('')
    : `<p class="text-sm text-slate-400 text-center py-8">Cap comentari encara.<br>Escriu-ne el primer aquí sota.</p>`;

  $('#filUpdates').innerHTML = fil;
  $('#respostaA').innerHTML = responentA
    ? `<span class="text-xs text-marca">Responent a un comentari</span>
       <button id="cancellaResposta" class="text-xs text-slate-400 hover:text-red-600 transition-colors">cancel·la</button>`
    : '';
}

async function carrega(): Promise<void> {
  if (!itemId) return;
  $('#carregantUpdates').classList.remove('hidden');
  try {
    const r = await api<{ updates: Update[] }>(`/api/updates/${itemId}`);
    updates = r.updates;
    alCanviar?.(updates.length);
  } catch (e) {
    avisa(`No s'han pogut llegir els comentaris: ${(e as Error).message}`, 'err');
    updates = [];
  } finally {
    $('#carregantUpdates').classList.add('hidden');
    pinta();
  }
}

function connecta(): void {
  if (connectat) return;
  connectat = true;

  $('#fonsUpdates').addEventListener('click', tanca);
  $('#tancaUpdates').addEventListener('click', tanca);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#calaixUpdates').classList.contains('hidden')) tanca();
  });

  $('#filUpdates').addEventListener('click', async ev => {
    const diana = ev.target as HTMLElement;
    const art = diana.closest<HTMLElement>('[data-update]');
    if (!art) return;

    if (diana.closest('[data-respon]')) {
      responentA = art.dataset.update ?? null;
      pinta();
      $('#nouUpdate').focus();
      return;
    }

    if (diana.closest('[data-esborra-update]')) {
      const id = art.dataset.update;
      if (!id || !confirm('Vols esborrar aquest comentari de Monday? També se n\'aniran les respostes.')) return;
      try {
        await api(`/api/updates/${id}`, { method: 'DELETE' });
        updates = updates.filter(u => u.id !== id);
        alCanviar?.(updates.length);
        pinta();
      } catch (e) { avisa(`No s'ha pogut esborrar: ${(e as Error).message}`, 'err'); }
    }
  });

  $('#respostaA').addEventListener('click', ev => {
    if ((ev.target as HTMLElement).id === 'cancellaResposta') { responentA = null; pinta(); }
  });

  $<HTMLFormElement>('#formUpdate').addEventListener('submit', async ev => {
    ev.preventDefault();
    const camp = $<HTMLTextAreaElement>('#nouUpdate');
    const text = camp.value.trim();
    if (!text || !itemId) return;

    const btn = $<HTMLButtonElement>('#enviaUpdate');
    btn.disabled = true;
    btn.classList.add('opacity-60', 'pointer-events-none');
    try {
      await api(`/api/updates/${itemId}`, { method: 'POST', body: JSON.stringify({ text, pareId: responentA }) });
      camp.value = '';
      responentA = null;
      await carrega();
    } catch (e) {
      avisa(`No s'ha pogut publicar: ${(e as Error).message}`, 'err');
    } finally {
      btn.disabled = false;
      btn.classList.remove('opacity-60', 'pointer-events-none');
    }
  });

  // Ctrl/Cmd + Enter envia, com a Monday.
  $('#nouUpdate').addEventListener('keydown', ev => {
    const e = ev as KeyboardEvent;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      $<HTMLFormElement>('#formUpdate').requestSubmit();
    }
  });
}

export function tanca(): void {
  itemId = null;
  alCanviar = null;
  responentA = null;
  $('#calaixUpdates').classList.add('hidden');
  if (document.querySelectorAll('.fixed.inset-0:not(.hidden)').length === 0) document.body.style.overflow = '';
}

/** Obre el fil de comentaris d'un element de Monday. */
export function obreUpdates(id: string, titol: string, onCanvi?: (n: number) => void): void {
  connecta();
  itemId = id;
  alCanviar = onCanvi ?? null;
  responentA = null;
  updates = [];
  $('#titolUpdates').textContent = titol || 'Comentaris';
  $('#filUpdates').innerHTML = '';
  $<HTMLTextAreaElement>('#nouUpdate').value = '';
  $('#calaixUpdates').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  void carrega();
}
