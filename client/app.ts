import type { Prescriptor, CampPrescriptor, ValorCamp, Esquema, EtiquetaEstat, AnaliticaPrescriptor } from './tipus.js';
import { $, esc, api, avisa, textSobre, pintaPuntSync } from './comuns.js';
import { iniciaCalendari } from './calendari.js';
import { obreUpdates } from './updates.js';

const DIES = ['diumenge','dilluns','dimarts','dimecres','dijous','divendres','dissabte'] as const;

/** Camps de text lliure: els desem amb una mica de retard per no cridar Monday a cada tecla. */
const CAMPS_TEXT: readonly CampPrescriptor[] = ['empresa','anotacio','contacte','telefon','correu','cif','fee','acord'];

/* ---------- estat de la pàgina ---------- */

let esquema: Esquema = { boardId: '', nomTauler: '', responsables: [], comunitats: [], estats: [], falten: [] };
let elements: Prescriptor[] = [];
let ordre: { camp: CampPrescriptor | null; asc: boolean } = { camp: null, asc: true };

/** Camps amb un desament pendent, per clau `idElement:camp`. */
const bruts = new Map<string, { t: number }>();
let desant = 0;

/** Comunitats triades al formulari de nou prescriptor, que encara no té element a Monday. */
let comunitatsNoves: string[] = [];
let expedientObertId: string | null = null;

/* ---------- utilitats ---------- */

function formatData(iso: string): string {
  if (!iso) return '';
  const [a, m, d] = iso.split('-').map(Number);
  if (!a || !m || !d) return '';
  const dt = new Date(a, m - 1, d);
  return `${DIES[dt.getDay()]} ${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${a}`;
}

function textActualitzacio(iso: string): string {
  if (!iso) return 'Encara no hi ha cap còpia local';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return 'Data d’actualització desconeguda';
  return `Actualitzat ${new Intl.DateTimeFormat('ca-ES', { dateStyle: 'short', timeStyle: 'short' }).format(data)}`;
}

function graficaAnalitica(serie: AnaliticaPrescriptor['serie']): string {
  if (!serie.length) return '<p class="py-8 text-center text-sm text-slate-400">Encara no hi ha activitat atribuïda.</p>';
  const dades = serie.slice(-12);
  const max = Math.max(1, ...dades.flatMap(x => [x.leads, x.sollicituds]));
  const mig = Math.ceil(max / 2);
  const resumAccessible = dades.map(x => `${x.mes}: ${x.leads} leads i ${x.sollicituds} sol·licituds`).join('. ');
  return `<div class="relative mt-5" role="img" aria-label="Evolució mensual. ${esc(resumAccessible)}">
    <div class="absolute top-0 bottom-5 left-0 flex w-7 flex-col justify-between text-right text-[10px] font-medium text-slate-400"><span>${max}</span><span>${mig}</span><span>0</span></div>
    <div class="ml-9 border-b border-marca-vora"><div class="relative h-52"><div class="pointer-events-none absolute inset-0 flex flex-col justify-between"><i class="border-t border-dashed border-marca-vora/80"></i><i class="border-t border-dashed border-marca-vora/80"></i><i class="border-t border-marca-vora"></i></div>
      <div class="relative z-10 grid h-full items-end gap-1.5" style="grid-template-columns:repeat(${dades.length},minmax(0,1fr))">${dades.map(x => `<div class="flex h-full min-w-0 flex-col justify-end items-center">
        <span class="mb-1 whitespace-nowrap text-[10px] font-semibold tabular-nums text-slate-600">${x.leads}<span class="mx-0.5 text-slate-300">/</span>${x.sollicituds}</span>
        <div class="flex h-36 w-full max-w-12 items-end justify-center gap-1"><span class="w-3.5 rounded-t-md bg-marca shadow-sm" style="height:${Math.max(x.leads ? 5 : 0, x.leads / max * 100)}%" title="${x.leads} leads"></span><span class="w-3.5 rounded-t-md bg-emerald-500 shadow-sm" style="height:${Math.max(x.sollicituds ? 5 : 0, x.sollicituds / max * 100)}%" title="${x.sollicituds} sol·licituds"></span></div>
        <span class="mt-2 whitespace-nowrap text-[10px] font-medium text-slate-500">${esc(x.mes === 'Sense data' ? '—' : x.mes.slice(5))}</span></div>`).join('')}</div>
    </div></div>
    <p class="mt-3 text-center text-xs text-slate-500"><span class="font-semibold text-marca">Leads</span> <span class="text-slate-300">/</span> <span class="font-semibold text-emerald-700">Sol·licituds</span> · valors per mes</p>
  </div>`;
}

/** Calcula la sèrie al navegador si una resposta en memòria no inclou l'agrupació del servidor. */
function serieDeSubvencio(a: AnaliticaPrescriptor, subvencio: string): AnaliticaPrescriptor['serie'] {
  const delServidor = a.seriePerSubvencio?.[subvencio];
  if (delServidor?.length) return delServidor;
  const agrupada = a.perSubvencio.find(x => x.subvencio === subvencio)?.items;
  const origen = agrupada?.length ? agrupada : a.registres.filter(x => x.subvencio === subvencio);
  const mesos = new Map<string, { mes: string; leads: number; sollicituds: number }>();
  for (const item of origen) {
    const mes = item.data ? item.data.slice(0, 7) : 'Sense data';
    const valor = mesos.get(mes) || { mes, leads: 0, sollicituds: 0 };
    item.estat === 'lead' ? valor.leads++ : valor.sollicituds++;
    mesos.set(mes, valor);
  }
  return [...mesos.values()].sort((x, y) => x.mes.localeCompare(y.mes));
}

function pintaExpedient(a: AnaliticaPrescriptor): void {
  const files = a.perSubvencio.map((x, index) => {
    const conversio = x.leads ? Math.round(x.sollicituds / x.leads * 1000) / 10 : 0;
    const detallId = `detall-subvencio-${index}`;
    // Compatibilitat amb respostes en memòria d'una versió anterior del servidor:
    // els registres ja contenen els noms dels ítems, encara que no vinguin agrupats.
    const itemsSubvencio = x.items?.length ? x.items : a.registres.filter(item => item.subvencio === x.subvencio);
    const items = itemsSubvencio.map(item => `<tr><td class="px-3 py-2 font-medium text-slate-700">${esc(item.empresa)}</td><td class="px-3 py-2"><span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${item.estat === 'lead' ? 'bg-marca-clar text-marca' : 'bg-emerald-50 text-emerald-700'}">${item.estat === 'lead' ? 'Lead' : 'Conversió'}</span></td><td class="px-3 py-2 text-slate-600">${esc(item.statusExp || 'Sense valor')}</td></tr>`).join('') || '<tr><td colspan="3" class="px-3 py-5 text-center text-sm text-slate-400">No hi ha detalls disponibles.</td></tr>';
    return `<tr><td class="px-3 py-2 font-medium text-slate-700"><button type="button" data-desplega-subvencio aria-expanded="false" aria-controls="${detallId}" class="flex max-w-full items-center gap-2 text-left hover:text-marca focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/40 rounded"><svg data-fletxa class="h-4 w-4 shrink-0 transition-transform duration-200" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6"/></svg><span class="truncate">${esc(x.subvencio)}</span></button></td><td class="px-3 py-2 text-center tabular-nums">${x.leads}</td><td class="px-3 py-2 text-center tabular-nums">${x.sollicituds}</td><td class="px-3 py-2 text-center font-semibold tabular-nums text-amber-700">${conversio}%</td></tr>
      <tr id="${detallId}" class="hidden bg-slate-50"><td colspan="4" class="p-3 sm:p-4"><div class="overflow-x-auto rounded-xl border border-marca-vora bg-white"><table class="w-full min-w-[38rem] text-sm"><thead class="bg-marca-clar text-left text-xs font-semibold text-marca"><tr><th class="px-3 py-2">Ítem</th><th class="px-3 py-2">Tipus</th><th class="px-3 py-2">Status EXP.</th></tr></thead><tbody class="divide-y divide-marca-vora">${items}</tbody></table></div></td></tr>`;
  }).join('') || '<tr><td colspan="4" class="px-3 py-6 text-center text-sm text-slate-400">No s’han trobat coincidències atribuïdes.</td></tr>';
  const percentConversio = Math.max(0, Math.min(100, a.resum.conversio));
  const opcionsSubvencions = a.perSubvencio.map(x => `<option value="${esc(x.subvencio)}">${esc(x.subvencio)}</option>`).join('');
  const estatCache = a.cache?.actualitzant ? ' · Actualitzant dades de Monday…' : a.cache?.desfasada ? ' · S’actualitzarà en segon pla' : '';
  $('#contingutExpedient').innerHTML = `<header class="sticky top-0 z-10 bg-white border-b border-marca-vora"><div class="mx-auto max-w-[1700px] px-5 py-4 flex gap-3"><div class="min-w-0 flex-1"><p class="text-xs font-semibold uppercase tracking-wide text-marca">Expedient de prescriptor</p><h2 class="text-lg font-bold text-slate-800 truncate">${esc(a.prescriptor.empresa)}</h2><p class="text-xs text-slate-500">${esc(a.prescriptor.contacte || 'Sense contacte')}</p></div><button id="tancaExpedient" class="min-h-11 min-w-11 p-2 rounded-lg text-slate-400 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-marca" aria-label="Tanca l'expedient">✕</button></div></header>
    <div class="mx-auto max-w-[1700px] p-5 sm:p-7 space-y-6"><section aria-label="Resum de resultats" class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <article class="relative overflow-hidden rounded-2xl border border-marca-vora bg-white p-5 shadow-sm"><div class="absolute inset-x-0 top-0 h-1 bg-marca"></div><div class="flex items-center justify-between gap-3"><p class="text-sm font-semibold text-slate-600">Total Leads</p><span class="flex h-10 w-10 items-center justify-center rounded-xl bg-marca-clar text-marca" aria-hidden="true"><svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m14-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM6 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg></span></div><p class="mt-5 text-4xl font-bold tracking-tight text-marca tabular-nums">${a.resum.leads.toLocaleString('ca-ES')}</p><p class="mt-1 text-sm text-slate-500">Oportunitats identificades</p></article>
      <article class="relative overflow-hidden rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm"><div class="absolute inset-x-0 top-0 h-1 bg-emerald-500"></div><div class="flex items-center justify-between gap-3"><p class="text-sm font-semibold text-slate-600">Total Conversions</p><span class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700" aria-hidden="true"><svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-3-3v6m6 6H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8l6 6v10a2 2 0 0 1-2 2Z"/></svg></span></div><p class="mt-5 text-4xl font-bold tracking-tight text-emerald-700 tabular-nums">${a.resum.sollicituds.toLocaleString('ca-ES')}</p><p class="mt-1 text-sm text-slate-500">Leads convertits en sol·licitud</p></article>
      <article class="relative overflow-hidden rounded-2xl border border-amber-200 bg-white p-5 shadow-sm"><div class="absolute inset-x-0 top-0 h-1 bg-amber-400"></div><div class="flex items-center justify-between gap-3"><p class="text-sm font-semibold text-slate-600">Conversió (%)</p><span class="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700" aria-hidden="true"><svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m5 15 4-4 3 3 7-7m-5 0h5v5"/></svg></span></div><p class="mt-5 text-4xl font-bold tracking-tight text-amber-700 tabular-nums">${a.resum.conversio}%</p><div class="mt-3 h-2 overflow-hidden rounded-full bg-amber-100" role="progressbar" aria-label="Taxa de conversió" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentConversio}"><span class="block h-full rounded-full bg-amber-400" style="width:${percentConversio}%"></span></div><p class="mt-2 text-sm text-slate-500">Sol·licituds respecte als leads</p></article>
    </section>
    <section class="rounded-2xl border border-marca-vora bg-white p-5 shadow-sm"><div class="flex flex-wrap items-start justify-between gap-4"><div><h3 class="text-base font-bold text-slate-800">Evolució mensual</h3><p id="subtitolEvolucio" class="mt-1 text-sm text-slate-500">Activitat de totes les subvencions als últims ${Math.min(a.serie.length, 12)} mesos</p></div><label class="block text-xs font-semibold text-slate-600">Subvenció<select id="filtreEvolucio" class="camp mt-1 min-w-56 py-2 text-sm"><option value="">Totes les subvencions</option>${opcionsSubvencions}</select></label><div class="flex items-center gap-3 text-xs font-medium"><span class="flex items-center gap-1.5 text-marca"><i class="h-2.5 w-2.5 rounded-sm bg-marca"></i>Leads</span><span class="flex items-center gap-1.5 text-emerald-700"><i class="h-2.5 w-2.5 rounded-sm bg-emerald-500"></i>Conversions</span></div></div><div id="graficEvolucio">${graficaAnalitica(a.serie)}</div></section>
    <section><h3 class="font-semibold text-slate-700 mb-2">Per subvenció</h3><div class="overflow-x-auto rounded-xl border border-marca-vora"><table class="w-full text-sm"><thead class="bg-slate-50 text-left text-xs text-slate-500"><tr><th class="px-3 py-2">Subvenció</th><th class="px-3 py-2 text-center">Leads</th><th class="px-3 py-2 text-center">Conversions</th><th class="px-3 py-2 text-center">Conversió (%)</th></tr></thead><tbody class="divide-y divide-marca-vora">${files}</tbody></table></div></section>
    <div class="flex flex-wrap items-center justify-between gap-3 border-t border-marca-vora pt-4"><p class="text-xs text-slate-400">Coincidències del prescriptor a la columna LEAD de ${a.cobertura.taulers} taulers · ${a.cobertura.coincidencies} registres atribuïts.<br>${esc(textActualitzacio(a.cache?.actualitzada || ''))}${estatCache}</p><button id="actualitzaAnalitiques" type="button" class="btn !py-2 text-sm">Actualitza dades</button></div></div>`;
  $('#tancaExpedient').addEventListener('click', tancaExpedient);
  $('#actualitzaAnalitiques').addEventListener('click', async e => {
    const boto = e.currentTarget as HTMLButtonElement;
    boto.disabled = true;
    boto.textContent = 'Actualitzant…';
    try {
      await api('/api/analitiques/actualitza', { method: 'POST' });
      const dades = await api<AnaliticaPrescriptor>(rutaAnalitiques(a.prescriptor));
      if (expedientObertId === a.prescriptor.id) pintaExpedient(dades);
    } catch (e) {
      boto.disabled = false;
      boto.textContent = 'Torna-ho a provar';
      avisa(`No s’han pogut actualitzar les dades: ${(e as Error).message}`, 'err');
    }
  });
  $('#filtreEvolucio').addEventListener('change', e => {
    const subvencio = (e.currentTarget as HTMLSelectElement).value;
    const serie = subvencio ? serieDeSubvencio(a, subvencio) : a.serie;
    $('#graficEvolucio').innerHTML = graficaAnalitica(serie);
    $('#subtitolEvolucio').textContent = subvencio
      ? `${subvencio} · últims ${Math.min(serie.length, 12)} mesos amb activitat`
      : `Activitat de totes les subvencions als últims ${Math.min(a.serie.length, 12)} mesos`;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-desplega-subvencio]').forEach(boto => {
    boto.addEventListener('click', () => {
      const detall = document.getElementById(boto.getAttribute('aria-controls') || '');
      if (!detall) return;
      const obert = detall.classList.toggle('hidden') === false;
      boto.setAttribute('aria-expanded', String(obert));
      boto.querySelector('[data-fletxa]')?.classList.toggle('rotate-180', obert);
    });
  });
}

const idExpedientDeUrl = (): string | null => /^#prescriptors\/(\d+)$/.exec(location.hash)?.[1] ?? null;
const rutaExpedient = (id: string): string => `#prescriptors/${id}`;
const rutaAnalitiques = (p: Pick<Prescriptor, 'id' | 'empresa' | 'contacte'>): string =>
  `/api/prescriptors/${p.id}/analitiques?empresa=${encodeURIComponent(p.empresa)}&contacte=${encodeURIComponent(p.contacte || '')}`;

function amagaExpedient(): void {
  expedientObertId = null;
  $('#expedientPrescriptor').classList.add('hidden');
  document.body.style.overflow = '';
}

function tancaExpedient(): void {
  const id = idExpedientDeUrl();
  if (id && history.state?.expedientPrescriptor === id) {
    history.back();
    return;
  }
  if (id) history.replaceState(null, '', location.pathname);
  amagaExpedient();
}

async function obreExpedient(p: Prescriptor, desaHistorial = true): Promise<void> {
  if (desaHistorial && location.hash !== rutaExpedient(p.id)) {
    history.pushState({ expedientPrescriptor: p.id }, '', rutaExpedient(p.id));
  }
  expedientObertId = p.id;
  $('#expedientPrescriptor').classList.remove('hidden'); document.body.style.overflow = 'hidden';
  $('#contingutExpedient').innerHTML = `<div class="min-h-full flex items-center justify-center p-6" role="status" aria-live="polite">
    <div class="w-full max-w-md text-center">
      <p class="text-lg font-semibold text-slate-700">Analitzant els taulers de subvencions…</p>
      <p class="mt-2 text-sm text-slate-500">Busquem les coincidències a la columna LEAD.</p>
      <div class="mt-6 h-2 overflow-hidden rounded-full bg-marca-vora" role="progressbar" aria-label="Carregant analítiques" aria-valuetext="Progrés indeterminat">
        <span class="block h-full w-2/5 rounded-full bg-marca animate-progres"></span>
      </div>
    </div>
  </div>`;
  $('#contingutExpedient').focus();
  try {
    const dades = await api<AnaliticaPrescriptor>(rutaAnalitiques(p));
    if (expedientObertId === p.id) pintaExpedient(dades);
  } catch (e) {
    if (expedientObertId === p.id) $('#contingutExpedient').innerHTML = `<div class="mx-auto max-w-[1700px] p-6 text-sm text-red-600">No s’han pogut carregar les analítiques: ${esc((e as Error).message)}</div>`;
  }
}

document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#expedientPrescriptor').classList.contains('hidden')) tancaExpedient(); });

const colorEstat = (nom: string): EtiquetaEstat | undefined => esquema.estats.find(e => e.nom === nom);

/** Monday pot tornar la llista buida o una cadena; ho normalitzem sempre a llista. */
const aLlista = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter(Boolean).map(String)
  : typeof v === 'string' && v ? v.split(',').map(t => t.trim()).filter(Boolean)
  : [];

const mateixaLlista = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const pintaEstatSync = (text: string, mena?: Parameters<typeof pintaPuntSync>[2]): void =>
  pintaPuntSync('#estatSync', text, mena);

/* ---------- selector de comunitats (diverses alhora) ---------- */

let tancaSelector: (() => void) | null = null;

/** Obre el desplegable de comunitats ancorat a un botó i avisa a cada canvi. */
function obreSelector(ancora: HTMLElement, triades: string[], onCanvi: (noves: string[]) => void): void {
  tancaSelector?.();
  let actuals = [...triades];

  const pop = document.createElement('div');
  pop.className = 'fixed z-[70] w-72 bg-white rounded-xl shadow-2xl border border-marca-vora '
                + 'overflow-hidden animate-puja flex flex-col max-h-[22rem]';
  pop.innerHTML = `
    <div class="p-2 border-b border-marca-vora">
      <input type="search" data-cerca placeholder="Filtra comunitats…" class="camp text-sm py-1.5">
    </div>
    <div data-llista class="overflow-y-auto p-1 flex-1"></div>
    <div class="flex items-center gap-2 px-2 py-2 border-t border-marca-vora bg-slate-50">
      <button type="button" data-neteja class="text-xs font-medium text-slate-500 hover:text-red-600 transition-colors px-2 py-1">Neteja</button>
      <span data-compte class="ml-auto text-xs text-slate-500"></span>
      <button type="button" data-fet class="btn btn-ple !px-3 !py-1 text-xs">Fet</button>
    </div>`;
  document.body.append(pop);

  const llista = pop.querySelector<HTMLDivElement>('[data-llista]')!;
  const cerca = pop.querySelector<HTMLInputElement>('[data-cerca]')!;
  const compte = pop.querySelector<HTMLSpanElement>('[data-compte]')!;

  function pintaLlista(): void {
    const q = cerca.value.trim().toLowerCase();
    llista.innerHTML = esquema.comunitats
      .filter(c => !q || c.toLowerCase().includes(q))
      .map(c => `
        <label class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer text-sm
                      transition-colors hover:bg-marca-clar">
          <input type="checkbox" value="${esc(c)}" ${actuals.includes(c) ? 'checked' : ''}
                 class="w-4 h-4 rounded border-marca-vora text-marca focus:ring-marca/40 accent-[#3D6F9F]">
          <span>${esc(c)}</span>
        </label>`).join('')
      || `<p class="px-3 py-4 text-sm text-slate-400 text-center">Cap coincidència</p>`;
    compte.textContent = actuals.length ? `${actuals.length} seleccionades` : '';
  }
  pintaLlista();

  // Col·loquem el desplegable sota el botó, o a sobre si no hi cap.
  const r = ancora.getBoundingClientRect();
  const alt = 340;
  pop.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - 296)}px`;
  pop.style.top = r.bottom + alt > window.innerHeight && r.top > alt
    ? `${r.top - Math.min(alt, r.top - 8)}px`
    : `${r.bottom + 6}px`;

  llista.addEventListener('change', ev => {
    const cb = ev.target as HTMLInputElement;
    actuals = cb.checked ? [...actuals, cb.value] : actuals.filter(c => c !== cb.value);
    // Mantenim sempre l'ordre del desplegable, no l'ordre de clic.
    actuals = esquema.comunitats.filter(c => actuals.includes(c));
    compte.textContent = actuals.length ? `${actuals.length} seleccionades` : '';
    onCanvi([...actuals]);
  });
  cerca.addEventListener('input', pintaLlista);
  pop.querySelector('[data-neteja]')!.addEventListener('click', () => {
    actuals = [];
    pintaLlista();
    onCanvi([]);
  });
  pop.querySelector('[data-fet]')!.addEventListener('click', () => tancaSelector?.());

  const fora = (ev: MouseEvent): void => {
    if (!pop.contains(ev.target as Node) && !ancora.contains(ev.target as Node)) tancaSelector?.();
  };
  const tecla = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') { ev.stopPropagation(); tancaSelector?.(); } };

  tancaSelector = () => {
    document.removeEventListener('mousedown', fora);
    document.removeEventListener('keydown', tecla, true);
    pop.remove();
    tancaSelector = null;
  };
  window.setTimeout(() => document.addEventListener('mousedown', fora), 0);
  document.addEventListener('keydown', tecla, true);
  window.setTimeout(() => cerca.focus(), 60);
}

/** Les comunitats triades, com a etiquetes. En mostrem dues i comptem la resta. */
function xipsComunitats(llista: string[]): string {
  if (!llista.length) return `<span class="text-slate-400 text-sm">— Sense definir —</span>`;
  const xip = (t: string) =>
    `<span class="px-1.5 py-0.5 rounded bg-marca-clar text-marca text-xs font-medium whitespace-nowrap">${esc(t)}</span>`;
  return llista.slice(0, 2).map(xip).join(' ')
       + (llista.length > 2 ? ` ${xip(`+${llista.length - 2}`)}` : '');
}

/** Posa al dia la bombolla de comentaris d'una fila, amb el seu comptador. */
function refrescaBombolla(p: Prescriptor): void {
  const btn = document.querySelector<HTMLElement>(`#cos tr[data-id="${p.id}"] [data-comentaris]`);
  if (!btn) return;
  btn.classList.toggle('text-marca', Boolean(p.comentaris));
  btn.classList.toggle('text-slate-300', !p.comentaris);
  const globus = btn.querySelector('span');
  if (p.comentaris) {
    if (globus) globus.textContent = String(p.comentaris);
    else btn.insertAdjacentHTML('beforeend',
      `<span class="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 rounded-full bg-marca text-white
        text-[10px] font-bold leading-4 text-center">${p.comentaris}</span>`);
  } else globus?.remove();
}

/** Refresca el contingut del botó d'una fila sense tornar a pintar la taula. */
function refrescaXips(id: string, llista: string[]): void {
  const btn = document.querySelector(`#cos tr[data-id="${id}"] [data-multi="comunitats"]`);
  if (btn) btn.innerHTML = xipsComunitats(llista);
}

/* ---------- pintat de la taula ---------- */

function filtrades(): Prescriptor[] {
  const q = $<HTMLInputElement>('#cerca').value.trim().toLowerCase();
  const r = $<HTMLSelectElement>('#filtreResp').value;
  const e = $<HTMLSelectElement>('#filtreEstat').value;
  const ca = $<HTMLSelectElement>('#filtreComunitat').value;
  const llista = elements.filter(p =>
    (!r || p.responsable === r) && (!e || p.estat === e) && (!ca || p.comunitats.includes(ca)) &&
    (!q || [p.empresa, p.contacte, p.cif, p.correu, p.telefon, p.anotacio, p.comunitats.join(' ')]
             .join(' ').toLowerCase().includes(q)));
  const { camp, asc } = ordre;
  if (camp) {
    const clau = (p: Prescriptor): string =>
      camp === 'comunitats' ? p.comunitats.join(', ') : String(p[camp] ?? '');
    llista.sort((a, b) => clau(a).localeCompare(clau(b), 'ca') * (asc ? 1 : -1));
  }
  return llista;
}

const opcionsResponsable = (sel: string): string =>
  `<option value="">— Sense assignar —</option>` +
  esquema.responsables.map(n => `<option ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('');

const opcionsEstat = (sel: string): string =>
  `<option value="">— Sense estat —</option>` +
  esquema.estats.map(e => `<option ${e.nom === sel ? 'selected' : ''}>${esc(e.nom)}</option>`).join('');

function estilEstat(select: HTMLSelectElement, nom: string): void {
  const e = colorEstat(nom);
  select.style.backgroundColor = e ? e.fons : '';
  select.style.color = e ? textSobre(e.fons) : '';
}

function fila(p: Prescriptor): string {
  return `<tr data-id="${esc(p.id)}" class="cursor-pointer transition-colors hover:bg-marca-clar/50 animate-entra" title="Clica una zona buida de la fila per veure les analítiques">
    <td class="w-[28rem] px-1.5 py-1">
      <div class="flex items-center gap-0.5">
        <input class="cel font-medium" data-c="empresa" value="${esc(p.empresa)}" placeholder="Nom de l'empresa">
        <button data-comentaris title="Comentaris de Monday"
                class="relative shrink-0 p-1.5 rounded-lg transition-all hover:bg-marca-clar hover:scale-110 active:scale-95
                       ${p.comentaris ? 'text-marca' : 'text-slate-300'}">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.6-.7L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z"/></svg>
          ${p.comentaris ? `<span class="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 rounded-full bg-marca text-white
                   text-[10px] font-bold leading-4 text-center">${p.comentaris}</span>` : ''}
        </button>
        <button data-expedient title="Obre l'expedient analític" aria-label="Obre l'expedient analític de ${esc(p.empresa)}"
                class="shrink-0 p-1.5 rounded-lg text-slate-400 transition-all hover:bg-marca-clar hover:text-marca hover:scale-110 active:scale-95">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 19V9m5 10V5m5 14v-7m5 7V3"/></svg>
        </button>
      </div>
    </td>
    <td class="px-1.5 py-1"><select class="cel cursor-pointer" data-c="responsable">${opcionsResponsable(p.responsable)}</select></td>
    <td class="px-1.5 py-1"><select class="cel cursor-pointer rounded-full font-semibold text-center" data-c="estat">${opcionsEstat(p.estat)}</select></td>
    <td class="px-1.5 py-1">
      <button type="button" data-multi="comunitats"
              class="cel text-left flex flex-wrap items-center gap-1 min-h-[2rem] cursor-pointer">${xipsComunitats(p.comunitats)}</button>
    </td>
    <td class="px-1.5 py-1"><input class="cel" data-c="contacte" value="${esc(p.contacte)}" placeholder="Nom i cognoms"></td>
    <td class="px-1.5 py-1"><input class="cel" type="tel" data-c="telefon" value="${esc(p.telefon)}" placeholder="600 000 000"></td>
    <td class="px-1.5 py-1"><input class="cel" type="email" data-c="correu" value="${esc(p.correu)}" placeholder="nom@empresa.com"></td>
    <td class="px-1.5 py-1"><input class="cel uppercase" data-c="cif" value="${esc(p.cif)}" placeholder="B12345678"></td>
    <td class="px-1.5 py-1"><input class="cel text-right tabular-nums" type="number" min="0" step="0.01" inputmode="decimal" data-c="fee" value="${esc(p.fee)}" placeholder="0,00" aria-label="Fee en euros"></td>
    <td class="px-1.5 py-1"><input class="cel text-right tabular-nums" type="number" min="0" max="100" step="0.01" inputmode="decimal" data-c="acord" value="${esc(p.acord)}" placeholder="0,00" aria-label="Acord en percentatge"></td>
    <td class="px-1.5 py-1 whitespace-nowrap">
      <input class="cel cursor-pointer" type="date" data-c="dataVisita" value="${esc(p.dataVisita)}">
      <span class="etiqueta block px-2 text-xs text-marca min-h-[1rem]">${esc(formatData(p.dataVisita))}</span>
    </td>
    <td class="px-1 py-1 text-center">
      <button data-esborra class="p-1.5 rounded-lg text-slate-300 transition-all hover:bg-red-50 hover:text-red-600 hover:scale-110 active:scale-95" title="Elimina">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13"/></svg>
      </button>
    </td>
  </tr>`;
}

function pinta(): void {
  const llista = filtrades();
  $('#carregant').classList.add('hidden');
  $('#buit').classList.toggle('hidden', llista.length > 0);
  $('#cos').innerHTML = llista.map(fila).join('');
  $('#cos').querySelectorAll<HTMLSelectElement>('select[data-c="estat"]').forEach(s => estilEstat(s, s.value));
  pintaResum();
}

function pintaResum(): void {
  const xip = (text: string, fons: string, color: string): string =>
    `<span class="px-3 py-1 rounded-full text-xs font-semibold transition-transform hover:scale-105" style="background:${fons};color:${color}">${esc(text)}</span>`;
  let html = xip(`Total: ${elements.length}`, '#3D6F9F', '#fff');
  for (const e of esquema.estats) {
    html += xip(`${e.nom}: ${elements.filter(p => p.estat === e.nom).length}`, e.fons, textSobre(e.fons));
  }
  const sense = elements.filter(p => !p.estat).length;
  if (sense) html += xip(`Sense estat: ${sense}`, '#e2e8f0', '#475569');
  $('#resum').innerHTML = html;
}

/** Refresca els valors sense redibuixar: així no es perd el focus mentre algú escriu. */
function fusiona(nous: Prescriptor[]): void {
  for (const p of nous) p.comunitats = aLlista(p.comunitats);

  const mateixes = nous.length === elements.length
    && nous.every((n, i) => String(n.id) === String(elements[i]?.id));
  const actiu = document.activeElement;
  if (!mateixes || (bruts.size === 0 && !$('#cos').contains(actiu) && !tancaSelector)) {
    elements = nous;
    pinta();
    return;
  }
  elements = nous;
  for (const p of nous) {
    const tr = document.querySelector<HTMLTableRowElement>(`#cos tr[data-id="${p.id}"]`);
    if (!tr) continue;

    if (!bruts.has(`${p.id}:comunitats`)) refrescaXips(p.id, p.comunitats);
    refrescaBombolla(p);

    tr.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-c]').forEach(camp => {
      const c = camp.dataset.c as CampPrescriptor;
      if (camp === actiu || bruts.has(`${p.id}:${c}`)) return;
      const nou = String(p[c] ?? '');
      if (camp.value === nou) return;
      camp.value = nou;
      if (c === 'estat') estilEstat(camp as HTMLSelectElement, nou);
      if (c === 'dataVisita') {
        const et = tr.querySelector('.etiqueta');
        if (et) et.textContent = formatData(nou);
      }
    });
  }
  pintaResum();
}

/* ---------- càrrega i sincronització ---------- */

async function carrega({ silenci = false }: { silenci?: boolean } = {}): Promise<void> {
  try {
    const { elements: nous } = await api<{ elements: Prescriptor[] }>('/api/elements');
    fusiona(nous);
    obreExpedientDesDeUrl();
    if (!desant) pintaEstatSync('Sincronitzat amb Monday', 'ok');
  } catch (e) {
    pintaEstatSync('Sense connexió amb Monday', 'err');
    if (!silenci) avisa(`No s'han pogut llegir les dades: ${(e as Error).message}`, 'err');
    $('#carregant').classList.add('hidden');
  }
}

function desaCamp(id: string, camp: CampPrescriptor, valor: ValorCamp): void {
  const clau = `${id}:${camp}`;
  const pendent = bruts.get(clau);
  if (pendent) window.clearTimeout(pendent.t);

  const t = window.setTimeout(async () => {
    desant++;
    pintaEstatSync('Desant…', 'desa');
    try {
      await api(`/api/elements/${id}`, { method: 'PATCH', body: JSON.stringify({ [camp]: valor }) });
      bruts.delete(clau);
      document.querySelector(`#cos tr[data-id="${id}"] [data-c="${camp}"]`)?.classList.remove('brut');
      document.querySelector(`#cos tr[data-id="${id}"] [data-multi="${camp}"]`)?.classList.remove('brut');
    } catch (e) {
      avisa(`No s'ha pogut desar «${camp}»: ${(e as Error).message}`, 'err');
    } finally {
      desant--;
      pintaEstatSync(desant ? 'Desant…' : 'Sincronitzat amb Monday', desant ? 'desa' : 'ok');
    }
  }, CAMPS_TEXT.includes(camp) ? 700 : 400);

  bruts.set(clau, { t });
}

let eliminacioPendent: { p: Prescriptor; tr: HTMLTableRowElement; origen: HTMLElement } | null = null;

function tancaConfirmacioElimina(restitueixFocus = true): void {
  const origen = eliminacioPendent?.origen;
  eliminacioPendent = null;
  $('#confirmacioElimina').classList.add('hidden');
  document.body.style.overflow = '';
  if (restitueixFocus && origen?.isConnected) origen.focus();
}

function obreConfirmacioElimina(p: Prescriptor, tr: HTMLTableRowElement, origen: HTMLElement): void {
  eliminacioPendent = { p, tr, origen };
  $('#nomElimina').textContent = p.empresa || 'Aquest prescriptor';
  const boto = $<HTMLButtonElement>('#confirmaElimina');
  boto.disabled = false;
  boto.innerHTML = '<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13"/></svg>Elimina';
  $('#confirmacioElimina').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  window.setTimeout(() => $<HTMLButtonElement>('#cancellaElimina').focus(), 20);
}

$('#fonsElimina').addEventListener('click', () => tancaConfirmacioElimina());
$('#cancellaElimina').addEventListener('click', () => tancaConfirmacioElimina());
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#confirmacioElimina').classList.contains('hidden')) tancaConfirmacioElimina();
});
$('#confirmaElimina').addEventListener('click', async () => {
  const pendent = eliminacioPendent;
  if (!pendent) return;
  const boto = $<HTMLButtonElement>('#confirmaElimina');
  boto.disabled = true;
  boto.textContent = 'Eliminant…';
  pendent.tr.style.transition = 'opacity .2s';
  pendent.tr.style.opacity = '.4';
  try {
    await api(`/api/elements/${pendent.p.id}`, { method: 'DELETE' });
    tancaConfirmacioElimina(false);
    elements = elements.filter(x => x !== pendent.p);
    pinta();
    avisa('Prescriptor eliminat.');
  } catch (e) {
    pendent.tr.style.opacity = '1';
    boto.disabled = false;
    boto.innerHTML = '<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13"/></svg>Elimina';
    avisa(`No s'ha pogut eliminar: ${(e as Error).message}`, 'err');
  }
});

/* ---------- interacció amb la taula ---------- */

$('#cos').addEventListener('input', ev => {
  const camp = (ev.target as HTMLElement).closest<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-c]');
  if (!camp) return;
  const c = camp.dataset.c as CampPrescriptor;
  const tr = camp.closest('tr');
  const p = elements.find(x => String(x.id) === tr?.dataset.id);
  if (!p || !tr) return;

  (p[c] as string) = camp.value;
  camp.classList.add('brut');
  if (c === 'estat') { estilEstat(camp as HTMLSelectElement, camp.value); pintaResum(); }
  if (c === 'dataVisita') {
    const et = tr.querySelector('.etiqueta');
    if (et) et.textContent = formatData(camp.value);
  }
  desaCamp(p.id, c, camp.value);
});

$('#cos').addEventListener('click', ev => {
  const diana = ev.target as HTMLElement;

  // Botó de comunitats: obre el desplegable de selecció múltiple.
  const multi = diana.closest<HTMLButtonElement>('[data-multi="comunitats"]');
  if (multi) {
    const p = elements.find(x => String(x.id) === multi.closest('tr')?.dataset.id);
    if (!p) return;
    obreSelector(multi, p.comunitats, noves => {
      if (mateixaLlista(p.comunitats, noves)) return;
      p.comunitats = noves;
      multi.innerHTML = xipsComunitats(noves);
      multi.classList.add('brut');
      desaCamp(p.id, 'comunitats', noves);
    });
    return;
  }

  // Fil de comentaris de Monday.
  const com = diana.closest<HTMLElement>('[data-comentaris]');
  if (com) {
    const p = elements.find(x => String(x.id) === com.closest('tr')?.dataset.id);
    if (p) obreUpdates(p.id, p.empresa || 'Prescriptor', n => { p.comentaris = n; refrescaBombolla(p); });
    return;
  }

  const expedient = diana.closest<HTMLElement>('[data-expedient]');
  if (expedient) {
    const p = elements.find(x => String(x.id) === expedient.closest('tr')?.dataset.id);
    if (p) void obreExpedient(p);
    return;
  }

  const btn = diana.closest<HTMLButtonElement>('[data-esborra]');
  if (!btn) {
    if (diana.closest('input, select, textarea, button')) return;
    const p = elements.find(x => String(x.id) === diana.closest('tr')?.dataset.id);
    if (p) void obreExpedient(p);
    return;
  }
  const tr = btn.closest<HTMLTableRowElement>('tr');
  const p = elements.find(x => String(x.id) === tr?.dataset.id);
  if (!p || !tr) return;
  obreConfirmacioElimina(p, tr, btn);
});

document.querySelectorAll<HTMLTableCellElement>('th.ordena').forEach(th => {
  th.addEventListener('click', () => {
    const c = th.dataset.camp as CampPrescriptor;
    ordre = { camp: c, asc: ordre.camp === c ? !ordre.asc : true };
    pinta();
  });
});

for (const sel of ['#cerca', '#filtreResp', '#filtreEstat', '#filtreComunitat']) {
  $(sel).addEventListener('input', pinta);
}
$('#refresca').addEventListener('click', () => void carrega());

/* ---------- finestra de nou prescriptor ---------- */

const modal = $('#modal');

function obreModal(): void {
  $<HTMLFormElement>('#formNou').reset();
  $('#errEmpresa').classList.add('hidden');
  $('#etiquetaData').textContent = '';
  $('#n_responsable').innerHTML = opcionsResponsable('');   // per defecte, ningú
  $('#n_estat').innerHTML = opcionsEstat('');
  comunitatsNoves = [];
  $('#n_comunitats').innerHTML = xipsComunitats([]);
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  window.setTimeout(() => $('#n_empresa').focus(), 60);
}

function tancaModal(): void {
  tancaSelector?.();
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

$('#afegeix').addEventListener('click', obreModal);
for (const sel of ['#tanca', '#cancella', '#fons']) {
  $(sel).addEventListener('click', tancaModal);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden') && !tancaSelector) tancaModal();
});
$('#n_data').addEventListener('input', ev => {
  $('#etiquetaData').textContent = formatData((ev.target as HTMLInputElement).value);
});
$('#n_comunitats').addEventListener('click', ev => {
  const btn = ev.currentTarget as HTMLElement;
  obreSelector(btn, comunitatsNoves, noves => {
    comunitatsNoves = noves;
    btn.innerHTML = xipsComunitats(noves);
  });
});

$<HTMLFormElement>('#formNou').addEventListener('submit', async ev => {
  ev.preventDefault();
  const camps = Object.fromEntries(new FormData(ev.target as HTMLFormElement)) as Record<string, string>;
  const dades: Record<string, ValorCamp> = { ...camps, comunitats: comunitatsNoves };
  const empresa = (camps['empresa'] ?? '').trim();

  if (!empresa) {
    $('#errEmpresa').classList.remove('hidden');
    $('#n_empresa').classList.add('border-red-500', 'ring-2', 'ring-red-200');
    $('#n_empresa').focus();
    return;
  }

  const btn = $<HTMLButtonElement>('#desa');
  btn.disabled = true;
  btn.classList.add('opacity-60', 'pointer-events-none');
  btn.textContent = 'Desant…';
  try {
    await api('/api/elements', { method: 'POST', body: JSON.stringify(dades) });
    tancaModal();
    await carrega();
    avisa(`«${empresa}» s'ha afegit a Monday.`);
  } catch (e) {
    avisa(`No s'ha pogut crear: ${(e as Error).message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.classList.remove('opacity-60', 'pointer-events-none');
    btn.textContent = 'Desa a Monday';
  }
});

$('#n_empresa').addEventListener('input', ev => {
  $('#errEmpresa').classList.add('hidden');
  (ev.target as HTMLElement).classList.remove('border-red-500', 'ring-2', 'ring-red-200');
});

/* ---------- exportació ---------- */

$('#exporta').addEventListener('click', () => {
  const cap = ['Empresa','Responsable','Estat','Comunitats autònomes','Anotació','Contacte','Telèfon','Correu','CIF','Fee (€)','Acord (%)','Data última visita'];
  const cel = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const files = filtrades().map(p =>
    [p.empresa,p.responsable,p.estat,p.comunitats.join(', '),p.anotacio,p.contacte,p.telefon,p.correu,p.cif,p.fee,p.acord,formatData(p.dataVisita)]
      .map(cel).join(';'));
  // El BOM inicial fa que l'Excel obri el fitxer amb els accents correctes.
  const blob = new Blob(['﻿' + [cap.map(cel).join(';'), ...files].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `prescriptors-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ---------- arrencada ---------- */

async function inicia(): Promise<void> {
  pintaEstatSync('Connectant amb Monday…');
  try {
    esquema = await api<Esquema>('/api/esquema');
    if (esquema.falten.length) {
      $('#avis').classList.remove('hidden');
      $('#avis').innerHTML = `<strong>El tauler de Monday no està preparat.</strong> Falten aquestes columnes: ${esc(esquema.falten.join(', '))}. Executa <code class="px-1.5 py-0.5 bg-amber-100 rounded font-mono text-xs">npm run setup</code> i torna a carregar la pàgina.`;
    }
    for (const n of esquema.responsables) {
      $('#filtreResp').insertAdjacentHTML('beforeend', `<option>${esc(n)}</option>`);
    }
    for (const e of esquema.estats) {
      $('#filtreEstat').insertAdjacentHTML('beforeend', `<option>${esc(e.nom)}</option>`);
    }
    for (const c of esquema.comunitats) {
      $('#filtreComunitat').insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`);
    }
  } catch (e) {
    $('#avis').classList.remove('hidden');
    $('#avis').textContent = `No s'ha pogut connectar amb Monday: ${(e as Error).message}`;
    pintaEstatSync('Sense connexió amb Monday', 'err');
  }

  await carrega();
  // Els canvis fets directament a Monday apareixen aquí sols.
  window.setInterval(() => { if (!document.hidden) void carrega({ silenci: true }); }, 12000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void carrega({ silenci: true }); });
}

/* ---------- pestanyes ---------- */

/** Activa una pestanya. El calendari només carrega dades el primer cop que s'obre. */
function mostraPestanya(quina: string): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-pestanya]')) {
    b.classList.toggle('pestanya-activa', b.dataset.pestanya === quina);
  }
  $('#vistaPrescriptors').classList.toggle('hidden', quina !== 'prescriptors');
  $('#vistaCalendari').classList.toggle('hidden', quina !== 'calendari');
  if (quina === 'calendari') void iniciaCalendari();
}

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-pestanya]')) {
  btn.addEventListener('click', () => {
    const quina = btn.dataset.pestanya ?? 'prescriptors';
    // L'ancoratge fa que la pestanya es pugui enllaçar i sobrevisqui a una recàrrega.
    history.replaceState(null, '', quina === 'prescriptors' ? location.pathname : `#${quina}`);
    mostraPestanya(quina);
  });
}

const pestanyaDeUrl = (): string =>
  location.hash === '#calendari' || location.hash.startsWith('#calendari/') ? 'calendari' : 'prescriptors';

function obreExpedientDesDeUrl(): void {
  const id = idExpedientDeUrl();
  if (!id) {
    amagaExpedient();
    return;
  }
  const prescriptor = elements.find(p => p.id === id);
  if (prescriptor && expedientObertId !== id) void obreExpedient(prescriptor, false);
}

if (pestanyaDeUrl() === 'calendari') mostraPestanya('calendari');
window.addEventListener('popstate', () => {
  mostraPestanya(pestanyaDeUrl());
  obreExpedientDesDeUrl();
});
window.addEventListener('hashchange', () => {
  mostraPestanya(pestanyaDeUrl());
  obreExpedientDesDeUrl();
});

void inicia();
