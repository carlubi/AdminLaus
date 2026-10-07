// Calendari trimestral de subvencions: any → trimestre → mes → setmana → dia.
// Les dades viuen al tauler «Agile - Roadmap» de Monday (grups Q1–Q4).
import type {
  Subvencio, Accio, EsquemaCalendari, EtiquetaEstat, Periode,
} from './tipus.js';
import { $, esc, api, avisa, textSobre } from './comuns.js';
import { obreUpdates } from './updates.js';

const MESOS = ['gener','febrer','març','abril','maig','juny',
               'juliol','agost','setembre','octubre','novembre','desembre'] as const;
const DIES_CURT = ['dl','dt','dc','dj','dv','ds','dg'] as const;
const DIES_SETMANA = ['Dl','Dt','Dc','Dj','Dv','Ds','Dg'] as const;
type VistaCalendari = 'navegacio' | 'trimestres' | 'kanban' | 'mensual';

let esquema: EsquemaCalendari = {
  boardId: '', nomTauler: '', taulerSub: null, falten: [],
  grups: [], probabilitats: [], estats: [], estatsSub: [],
};
let subvencions: Subvencio[] = [];
let any = new Date().getFullYear();
/** El camí que hem seguit avall. El primer element sempre és l'any. */
let cami: Periode[] = [];
let obertaId: string | null = null;
let iniciat = false;
let vista: VistaCalendari = 'navegacio';
let mesVista = new Date().getMonth();
let arrossegantId: string | null = null;
let darrerArrossegament = 0;
/** Cel·la triada amb un clic simple: en mostrem el contingut sense entrar-hi. */
let seleccionat: number | null = null;
/** Deixa passar un moment abans de previsualitzar, per si arriba el segon clic. */
let clicPendent: number | null = null;

/* ---------- dates ---------- */

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const data = (s: string): Date => {
  const [a, m, d] = s.split('-').map(Number);
  return new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1);
};

/** Dilluns de la setmana on cau una data. */
function dilluns(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

const suma = (d: Date, dies: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + dies);
  return x;
};

const periodeAny = (a: number): Periode =>
  ({ nivell: 'any', etiqueta: String(a), inici: `${a}-01-01`, fi: `${a}-12-31` });

function periodeTrimestre(a: number, t: number): Periode {
  const m0 = (t - 1) * 3;
  const fi = new Date(a, m0 + 3, 0);
  return {
    nivell: 'trimestre',
    etiqueta: `T${t}`,
    inici: iso(new Date(a, m0, 1)),
    fi: iso(fi),
  };
}

function periodeMes(a: number, m: number): Periode {
  return {
    nivell: 'mes',
    etiqueta: MESOS[m] ?? '',
    inici: iso(new Date(a, m, 1)),
    fi: iso(new Date(a, m + 1, 0)),
  };
}

function periodeSetmana(dl: Date): Periode {
  const dg = suma(dl, 6);
  const mateixMes = dl.getMonth() === dg.getMonth();
  const etiqueta = mateixMes
    ? `${dl.getDate()}–${dg.getDate()} ${MESOS[dl.getMonth()]}`
    : `${dl.getDate()} ${MESOS[dl.getMonth()]} – ${dg.getDate()} ${MESOS[dg.getMonth()]}`;
  return { nivell: 'setmana', etiqueta, inici: iso(dl), fi: iso(dg) };
}

const periodeDia = (d: Date): Periode => ({
  nivell: 'dia',
  etiqueta: `${DIES_CURT[(d.getDay() + 6) % 7]} ${d.getDate()}`,
  inici: iso(d), fi: iso(d),
});

const avui = iso(new Date());

/** Primera lletra en majúscula. Ho fem al codi i no amb CSS perquè surti sempre igual. */
const majuscula = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** Dies sencers entre dues dates ISO. */
const diesEntre = (a: string, b: string): number =>
  Math.round((data(b).getTime() - data(a).getTime()) / 86400000);

/** Durada d'un període en dies, comptant-hi el primer i l'últim. */
const durada = (p: Periode): number => diesEntre(p.inici, p.fi) + 1;

/** Posició d'una data dins d'un període, en tant per cent. */
const posicio = (p: Periode, d: string): number =>
  Math.max(0, Math.min(100, (diesEntre(p.inici, d) / durada(p)) * 100));

/** Les marques verticals del cronograma, segons el nivell que s'ensenya. */
function marques(p: Periode): { etiqueta: string; pos: number }[] {
  const fora: { etiqueta: string; pos: number }[] = [];
  const d0 = data(p.inici);

  if (p.nivell === 'any') {
    for (let m = 0; m < 12; m++) {
      fora.push({ etiqueta: majuscula((MESOS[m] ?? '').slice(0, 3)), pos: posicio(p, iso(new Date(d0.getFullYear(), m, 1))) });
    }
  } else if (p.nivell === 'trimestre') {
    for (let i = 0; i < 3; i++) {
      const m = new Date(d0.getFullYear(), d0.getMonth() + i, 1);
      fora.push({ etiqueta: majuscula(MESOS[m.getMonth()] ?? ''), pos: posicio(p, iso(m)) });
    }
  } else if (p.nivell === 'mes') {
    let d = dilluns(d0);
    if (iso(d) < p.inici) d = suma(d, 7);
    while (iso(d) <= p.fi) { fora.push({ etiqueta: String(d.getDate()), pos: posicio(p, iso(d)) }); d = suma(d, 7); }
  } else if (p.nivell === 'setmana') {
    for (let i = 0; i < 7; i++) {
      const d = suma(d0, i);
      fora.push({ etiqueta: `${DIES_CURT[(d.getDay() + 6) % 7]} ${d.getDate()}`, pos: posicio(p, iso(d)) });
    }
  }
  return fora;
}

/* ---------- què cau dins d'un període ---------- */

/** Cert si la subvenció té dates i el seu interval toca el període. */
function tocaPeriode(s: Subvencio, p: Periode): boolean {
  if (!s.inici && !s.fi) return false;
  const a = s.inici || s.fi;
  const b = s.fi || s.inici;
  return a <= p.fi && b >= p.inici;
}

const accionsDins = (s: Subvencio, p: Periode): Accio[] =>
  s.accions.filter(x => x.data && x.data >= p.inici && x.data <= p.fi);

/** Subvencions que s'han de veure en un període: per dates, o per trimestre si no en tenen. */
function subvencionsDe(p: Periode): { amb: Subvencio[]; sense: Subvencio[] } {
  const amb = subvencions.filter(s => tocaPeriode(s, p) || accionsDins(s, p).length > 0);
  // Les que encara no tenen dates només es mostren a l'any i al seu trimestre.
  const sense = subvencions.filter(s => {
    if (s.inici || s.fi) return false;
    if (p.nivell === 'any') return true;
    if (p.nivell === 'trimestre') return `T${s.trimestre}` === p.etiqueta;
    return false;
  });
  return { amb, sense };
}

const colorProb = (nom: string): EtiquetaEstat | undefined => esquema.probabilitats.find(p => p.nom === nom);
const colorEstat = (nom: string): EtiquetaEstat | undefined => esquema.estats.find(p => p.nom === nom);
const colorEstatSub = (nom: string): EtiquetaEstat | undefined => esquema.estatsSub.find(p => p.nom === nom);

function pastilla(nom: string, et: EtiquetaEstat | undefined): string {
  if (!nom) return '';
  const fons = et?.fons || '#e2e8f0';
  return `<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
    style="background:${fons};color:${textSobre(fons)}">${esc(nom)}</span>`;
}

/* ---------- camí de navegació ---------- */

const periodeActual = (): Periode => cami[cami.length - 1] ?? periodeAny(any);

/** Ruta navegable del calendari, dins de l'àncora per no trencar les recàrregues. */
function rutaCalendari(): string {
  const parts = cami.map(p => {
    if (p.nivell === 'any') return p.etiqueta;
    if (p.nivell === 'trimestre') return p.etiqueta.toLowerCase();
    if (p.nivell === 'mes') return `m${data(p.inici).getMonth() + 1}`;
    if (p.nivell === 'setmana') return `w${p.inici}`;
    return `d${p.inici}`;
  });
  return `#calendari/${parts.join('/')}`;
}

function desaRuta(reemplaça = false): void {
  const mètode = reemplaça ? 'replaceState' : 'pushState';
  history[mètode](null, '', rutaCalendari());
}

/** Recupera el camí del calendari des de l'URL, si n'hi ha un. */
function restauraRuta(): boolean {
  const hash = location.hash.replace(/^#/, '');
  if (!hash.startsWith('calendari/')) return false;
  const parts = hash.slice('calendari/'.length).split('/').filter(Boolean);
  const anyRuta = Number(parts.shift());
  if (!Number.isInteger(anyRuta) || anyRuta < 2000 || anyRuta > 3000) return false;

  const nouCami: Periode[] = [periodeAny(anyRuta)];
  for (const part of parts) {
    const pare = nouCami[nouCami.length - 1]!;
    if (pare.nivell === 'any' && /^t[1-4]$/.test(part)) {
      nouCami.push(periodeTrimestre(anyRuta, Number(part.slice(1))));
    } else if (pare.nivell === 'trimestre' && /^m(?:[1-9]|1[0-2])$/.test(part)) {
      const mes = Number(part.slice(1)) - 1;
      const primerMes = (Number(pare.etiqueta.slice(1)) - 1) * 3;
      if (mes < primerMes || mes > primerMes + 2) return false;
      nouCami.push(periodeMes(anyRuta, mes));
    } else if (pare.nivell === 'mes' && /^w\d{4}-\d{2}-\d{2}$/.test(part)) {
      const setmana = data(part.slice(1));
      const p = periodeSetmana(setmana);
      if (p.fi < pare.inici || p.inici > pare.fi) return false;
      nouCami.push(p);
    } else if (pare.nivell === 'setmana' && /^d\d{4}-\d{2}-\d{2}$/.test(part)) {
      const dia = data(part.slice(1));
      const p = periodeDia(dia);
      if (p.inici < pare.inici || p.inici > pare.fi) return false;
      nouCami.push(p);
    } else {
      return false;
    }
  }

  any = anyRuta;
  cami = nouCami;
  seleccionat = null;
  return true;
}

function pintaCami(): void {
  $('#anyActual').textContent = String(any);
  $('#camiCal').innerHTML = cami.map((p, i) => {
    const ultim = i === cami.length - 1;
    const nom = p.nivell === 'any' ? `Any ${p.etiqueta}` : p.etiqueta;
    return `${i ? '<span class="text-slate-300">›</span>' : ''}
      <button data-nivell="${i}" ${ultim ? 'disabled' : ''}
        class="px-2 py-1 rounded-md font-medium transition-colors ${ultim
          ? 'text-marca bg-marca-clar cursor-default'
          : 'text-slate-500 hover:text-marca hover:bg-marca-clar'}">${esc(nom)}</button>`;
  }).join('');
}

/* ---------- graella de períodes ---------- */

/** Els períodes en què es divideix el que estem mirant ara. */
function subPeriodes(): { llista: Periode[]; columnes: string } {
  const p = periodeActual();
  switch (p.nivell) {
    case 'any':
      return { llista: [1, 2, 3, 4].map(t => periodeTrimestre(any, t)), columnes: 'sm:grid-cols-2 lg:grid-cols-4' };
    case 'trimestre': {
      const m0 = (Number(p.etiqueta.slice(1)) - 1) * 3;
      return { llista: [0, 1, 2].map(i => periodeMes(any, m0 + i)), columnes: 'sm:grid-cols-3' };
    }
    case 'mes': {
      const llista: Periode[] = [];
      let d = dilluns(data(p.inici));
      while (iso(d) <= p.fi) { llista.push(periodeSetmana(d)); d = suma(d, 7); }
      return { llista, columnes: 'sm:grid-cols-2 lg:grid-cols-3' };
    }
    case 'setmana': {
      const llista: Periode[] = [];
      for (let i = 0; i < 7; i++) llista.push(periodeDia(suma(data(p.inici), i)));
      return { llista, columnes: 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7' };
    }
    default:
      return { llista: [], columnes: '' };
  }
}

function pintaGraella(): void {
  const graella = $('#graelaCal');

  if (vista === 'trimestres') {
    pintaTaulerTrimestres(graella);
    return;
  }
  if (vista === 'kanban') {
    pintaKanban(graella);
    return;
  }
  if (vista === 'mensual') {
    pintaMes(graella);
    return;
  }

  const { llista, columnes } = subPeriodes();
  graella.className = `grid gap-3 mb-5 ${columnes}`;

  if (!llista.length) { graella.innerHTML = ''; return; }

  graella.innerHTML = llista.map((p, i) => {
    const { amb } = subvencionsDe(p);
    const accions = subvencions.flatMap(s => accionsDins(s, p));
    const avuiHi = avui >= p.inici && avui <= p.fi;
    const titol = p.nivell === 'trimestre'
      ? `${p.etiqueta} <span class="font-normal text-slate-400 text-xs">${majuscula(MESOS[(Number(p.etiqueta.slice(1)) - 1) * 3] ?? '')}–${majuscula(MESOS[(Number(p.etiqueta.slice(1)) - 1) * 3 + 2] ?? '')}</span>`
      : esc(majuscula(p.etiqueta));

    const mostra = amb.slice(0, 3).map(s => `
      <div class="flex items-center gap-1.5 text-xs text-slate-600 truncate">
        <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:${colorProb(s.probabilitat)?.fons || '#cbd5e1'}"></span>
        <span class="truncate">${esc(s.titol)}</span>
      </div>`).join('');

    const triat = seleccionat === i;
    return `<button class="targeta ${triat ? 'ring-2 ring-marca border-marca bg-marca-clar/40' : avuiHi ? 'ring-2 ring-marca/40 border-marca' : ''}"
      data-periode="${i}" title="Un clic per veure'n el contingut · doble clic per entrar-hi">
      <div class="flex items-baseline gap-2 mb-2">
        <span class="font-bold text-marca capitalize">${titol}</span>
        ${avuiHi ? '<span class="text-[10px] font-bold uppercase text-marca bg-marca-clar px-1.5 py-0.5 rounded">ara</span>' : ''}
      </div>
      <div class="flex items-center gap-3 text-xs text-slate-500 mb-2">
        <span><strong class="text-slate-700">${amb.length}</strong> tasques</span>
        <span><strong class="text-slate-700">${accions.length}</strong> accions</span>
      </div>
      <div class="space-y-1">${mostra || '<p class="text-xs text-slate-300">Res previst</p>'}</div>
      ${amb.length > 3 ? `<p class="text-[11px] text-slate-400 mt-1">+${amb.length - 3} més</p>` : ''}
    </button>`;
  }).join('');
}

function dataTauler(dataIso: string): string {
  if (!dataIso) return 'Sense data';
  const d = data(dataIso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function datesMogudes(s: Subvencio, destinacio: string): { inici: string; fi: string } {
  if (!s.inici || !s.fi) return { inici: destinacio, fi: destinacio };
  const desplaçament = diesEntre(s.inici, destinacio);
  return { inici: destinacio, fi: iso(suma(data(s.fi), desplaçament)) };
}

function netejaDestinsArrossegament(): void {
  document.querySelectorAll<HTMLElement>('[data-dest-trimestre], [data-dest-estat], [data-dest-data]').forEach(el => {
    el.classList.remove('ring-2', 'ring-marca', 'bg-marca-clar/40');
  });
}

async function aplicaArrossegament(id: string, desti: HTMLElement): Promise<void> {
  const s = subvencions.find(x => x.id === id);
  if (!s) return;

  try {
    if (desti.dataset.destTrimestre !== undefined) {
      const trimestre = Number(desti.dataset.destTrimestre);
      const grup = esquema.grups.find(g => g.trimestre === trimestre);
      if (!grup || s.grupId === grup.id) return;
      await api(`/api/calendari/subvencions/${s.id}`, { method: 'PATCH', body: JSON.stringify({ grupId: grup.id }) });
      s.grupId = grup.id;
      s.grupTitol = grup.titol;
      s.trimestre = trimestre;
      avisa(`Tasca moguda a T${trimestre}.`);
    } else if (desti.dataset.destEstat !== undefined) {
      const estat = desti.dataset.destEstat;
      if (s.estat === estat) return;
      await api(`/api/calendari/subvencions/${s.id}`, { method: 'PATCH', body: JSON.stringify({ estat }) });
      s.estat = estat;
      avisa(estat ? 'Estat actualitzat.' : 'Estat eliminat.');
    } else if (desti.dataset.destData) {
      const dates = datesMogudes(s, desti.dataset.destData);
      if (s.inici === dates.inici && s.fi === dates.fi) return;
      await api(`/api/calendari/subvencions/${s.id}`, { method: 'PATCH', body: JSON.stringify(dates) });
      s.inici = dates.inici;
      s.fi = dates.fi;
      avisa('Data actualitzada.');
    } else {
      return;
    }
    pinta();
  } catch (e) {
    avisa(`No s'ha pogut actualitzar la tasca: ${(e as Error).message}`, 'err');
  }
}

function pintaTaulerTrimestres(graella: HTMLElement): void {
  graella.className = 'space-y-4 mb-5';
  const trimestres = [1, 2, 3, 4].map(t => {
    const tasques = subvencions.filter(s => s.trimestre === t);
    return { t, tasques };
  });

  graella.innerHTML = trimestres.map(({ t, tasques }) => {
    const inici = (t - 1) * 3;
    const titol = `T${t}`;
    const mesos = `${majuscula(MESOS[inici] ?? '')}–${majuscula(MESOS[inici + 2] ?? '')}`;
    const files = tasques.length
      ? tasques.map(s => `<tr data-subvencio="${esc(s.id)}" data-arrossega-subvencio="${esc(s.id)}" draggable="true" tabindex="0" role="button"
          aria-label="Obre la tasca ${esc(s.titol)}" class="cursor-grab transition-colors hover:bg-marca-clar/60 active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-inset focus:ring-marca">
          <td class="px-3 py-2.5 font-medium text-slate-700">${esc(s.titol)}</td>
          <td class="px-3 py-2.5 text-slate-500">${esc(s.responsable || '—')}</td>
          <td class="px-3 py-2.5 text-slate-500 tabular-nums">${s.inici || s.fi ? `${esc(dataTauler(s.inici || s.fi))}${s.inici && s.fi && s.inici !== s.fi ? ` → ${esc(dataTauler(s.fi))}` : ''}` : 'Sense data'}</td>
          <td class="px-3 py-2.5">${pastilla(s.estat, colorEstat(s.estat)) || '<span class="text-slate-400">—</span>'}</td>
          <td class="px-3 py-2.5 text-slate-500">${s.accions.length ? `${s.accions.length} accions` : '—'}</td>
        </tr>`).join('')
      : `<tr><td colspan="5" class="px-3 py-6 text-center text-sm text-slate-400">No hi ha tasques en aquest trimestre.</td></tr>`;

    return `<section data-dest-trimestre="${t}" class="bg-white rounded-xl border border-marca-vora overflow-hidden shadow-sm transition-colors" title="Arrossega-hi una tasca per canviar-la de trimestre">
      <div class="flex items-center gap-2 px-4 py-3 border-l-4 border-marca bg-slate-50/70">
        <h3 class="font-bold text-marca">${titol}</h3>
        <span class="text-xs text-slate-400">${mesos}</span>
        <span class="ml-auto text-xs text-slate-500"><strong class="text-slate-700">${tasques.length}</strong> tasques</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[700px] text-left text-sm">
          <thead class="border-y border-marca-vora bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr><th class="px-3 py-2 font-semibold">Tasca</th><th class="px-3 py-2 font-semibold">Responsable</th><th class="px-3 py-2 font-semibold">Timeline</th><th class="px-3 py-2 font-semibold">Estat</th><th class="px-3 py-2 font-semibold">Accions</th></tr>
          </thead>
          <tbody class="divide-y divide-marca-vora/70">${files}</tbody>
        </table>
      </div>
    </section>`;
  }).join('');
}

function subvencionsAnyActual(): Subvencio[] {
  const periode = periodeAny(any);
  return subvencions.filter(s => tocaPeriode(s, periode) || accionsDins(s, periode).length > 0 || (!s.inici && !s.fi && s.trimestre !== null));
}

function pintaKanban(graella: HTMLElement): void {
  const tasques = subvencionsAnyActual();
  const estats = [
    ...esquema.estats.map(e => e.nom),
    ...tasques.map(s => s.estat).filter(e => e && !esquema.estats.some(x => x.nom === e)),
  ];
  if (tasques.some(s => !s.estat)) estats.push('Sense estat');
  if (!estats.length) estats.push('Sense estat');

  graella.className = 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 mb-5';
  graella.innerHTML = estats.map(estat => {
    const llista = tasques.filter(s => estat === 'Sense estat' ? !s.estat : s.estat === estat);
    const etiqueta = estat === 'Sense estat' ? undefined : colorEstat(estat);
    return `<section data-dest-estat="${esc(estat === 'Sense estat' ? '' : estat)}" class="rounded-xl border border-marca-vora bg-slate-50/70 overflow-hidden min-h-40 transition-colors" title="Arrossega-hi una tasca per canviar-ne l'estat">
      <div class="flex items-center gap-2 px-3 py-2.5 border-b border-marca-vora bg-white">
        ${etiqueta ? pastilla(estat, etiqueta) : '<span class="text-sm font-semibold text-slate-500">Sense estat</span>'}
        <span class="ml-auto text-xs text-slate-500 tabular-nums">${llista.length}</span>
      </div>
      <div class="p-2 space-y-2">${llista.length ? llista.map(s => `<button data-subvencio="${esc(s.id)}" data-arrossega-subvencio="${esc(s.id)}" draggable="true"
          class="w-full cursor-grab text-left rounded-lg border border-marca-vora bg-white p-3 transition-all hover:border-marca hover:shadow-sm active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-marca/40"
          aria-label="Obre la tasca ${esc(s.titol)}">
          <p class="font-medium text-sm text-slate-700">${esc(s.titol)}</p>
          <div class="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>${s.inici || s.fi ? `${esc(dataTauler(s.inici || s.fi))}${s.inici && s.fi && s.inici !== s.fi ? ` → ${esc(dataTauler(s.fi))}` : ''}` : 'Sense data'}</span>
            ${s.responsable ? `<span>${esc(s.responsable)}</span>` : ''}
            ${s.accions.length ? `<span>${s.accions.length} accions</span>` : ''}
          </div>
        </button>`).join('') : '<p class="px-2 py-5 text-center text-xs text-slate-400">Cap tasca.</p>'}</div>
    </section>`;
  }).join('');
}

function pintaMes(graella: HTMLElement): void {
  const primer = new Date(any, mesVista, 1);
  const inici = dilluns(primer);
  const dies = Array.from({ length: 42 }, (_, i) => suma(inici, i));

  const cel·la = (d: Date): string => {
    const p = periodeDia(d);
    const dinsMes = d.getMonth() === mesVista;
    const iniciatives = subvencions.filter(s => tocaPeriode(s, p));
    const accions = subvencions.flatMap(s => accionsDins(s, p).map(a => ({ a, s })));
    const elements = [
      ...iniciatives.map(s => ({ id: s.id, titol: s.titol, color: colorProb(s.probabilitat)?.fons || '#94a3b8', arrossegable: true })),
      ...accions.map(({ a, s }) => ({ id: s.id, titol: a.titol, color: colorEstatSub(a.estat)?.fons || '#3D6F9F', arrossegable: false })),
    ];
    const visibles = elements.slice(0, 3);
    return `<div data-dest-data="${p.inici}" class="min-h-28 border-b border-r border-marca-vora p-1.5 transition-colors ${dinsMes ? 'bg-white' : 'bg-slate-50/70 text-slate-400'}" title="Arrossega-hi una tasca per canviar-ne la data">
      <span class="inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-medium ${p.inici === avui ? 'bg-marca text-white' : ''}">${d.getDate()}</span>
      <div class="mt-1 space-y-1">${visibles.map(e => `<button data-subvencio="${esc(e.id)}" ${e.arrossegable ? `data-arrossega-subvencio="${esc(e.id)}" draggable="true"` : ''} title="${esc(e.titol)}"
          class="block w-full ${e.arrossegable ? 'cursor-grab active:cursor-grabbing' : ''} truncate rounded px-1.5 py-1 text-left text-[11px] font-medium text-slate-700 transition-colors hover:bg-marca-clar"
          style="border-left:3px solid ${e.color}">${esc(e.titol)}</button>`).join('')}
        ${elements.length > 3 ? `<p class="px-1.5 text-[11px] text-slate-400">+${elements.length - 3} més</p>` : ''}
      </div>
    </div>`;
  };

  graella.className = 'mb-5 overflow-x-auto rounded-xl border border-marca-vora bg-white';
  graella.innerHTML = `<div class="flex items-center justify-between gap-3 px-3 py-3 border-b border-marca-vora">
      <button data-mou-mes="-1" class="btn !px-3 !py-1.5" aria-label="Mes anterior">‹</button>
      <h3 class="font-bold text-marca capitalize">${majuscula(MESOS[mesVista] ?? '')} ${any}</h3>
      <button data-mou-mes="1" class="btn !px-3 !py-1.5" aria-label="Mes següent">›</button>
    </div>
    <div class="grid min-w-[700px] grid-cols-7">
      ${DIES_SETMANA.map(d => `<div class="border-b border-r border-marca-vora bg-slate-50 px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">${d}</div>`).join('')}
      ${dies.map(cel·la).join('')}
    </div>`;
}

/* ---------- detall del període ---------- */

function targetaSubvencio(s: Subvencio, p: Periode): string {
  const acc = accionsDins(s, p);
  return `<button data-subvencio="${esc(s.id)}"
    class="w-full text-left bg-white rounded-xl border border-marca-vora p-3.5 transition-all duration-200
           hover:border-marca hover:shadow-md focus:outline-none focus:ring-2 focus:ring-marca/40">
    <div class="flex items-start gap-2 mb-1.5">
      <span class="font-semibold text-slate-800 flex-1">${esc(s.titol)}</span>
      ${pastilla(s.probabilitat, colorProb(s.probabilitat))}
      ${pastilla(s.estat, colorEstat(s.estat))}
    </div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
      <span class="font-medium text-marca">${esc(s.grupTitol)}</span>
      ${s.inici || s.fi
        ? `<span>${esc(s.inici || '?')} → ${esc(s.fi || '?')}</span>`
        : '<span class="text-amber-600 font-medium">sense dates</span>'}
      ${s.accions.length ? `<span>${s.accions.length} accions${acc.length ? `, ${acc.length} en aquest tram` : ''}</span>` : ''}
    </div>
    ${s.comentari ? `<p class="mt-1.5 text-xs text-slate-400 line-clamp-2">${esc(s.comentari)}</p>` : ''}
    ${acc.length ? `<div class="mt-2 pt-2 border-t border-marca-vora/70 space-y-1">${acc.map(a => `
      <div class="flex items-center gap-2 text-xs">
        <span class="text-slate-400 tabular-nums shrink-0">${esc(a.data)}</span>
        <span class="text-slate-600 truncate flex-1">${esc(a.titol)}</span>
        ${pastilla(a.estat, colorEstatSub(a.estat))}
      </div>`).join('')}</div>` : ''}
  </button>`;
}

/** El tram que s'està ensenyant a sota: el de la cel·la triada, o el del nivell on som. */
function periodeMostrat(): { p: Periode; previsualitza: boolean } {
  if (seleccionat !== null) {
    const p = subPeriodes().llista[seleccionat];
    if (p) return { p, previsualitza: true };
  }
  return { p: periodeActual(), previsualitza: false };
}

/** Una barra per subvenció i un rombe per cada acció, sobre una escala de temps. */
function cronograma(p: Periode, llista: Subvencio[]): string {
  const tics = marques(p);
  const graella = tics.map(t =>
    `<div class="absolute top-0 bottom-0 border-l border-marca-vora/60" style="left:${t.pos}%"></div>`).join('');
  const capçalera = tics.map(t =>
    `<span class="absolute text-[11px] text-slate-400 whitespace-nowrap pl-1" style="left:${t.pos}%">${esc(t.etiqueta)}</span>`).join('');
  const linia = avui >= p.inici && avui <= p.fi
    ? `<div class="absolute top-0 bottom-0 w-px bg-red-400 z-10" style="left:${posicio(p, avui)}%"></div>` : '';

  const files = llista.map(s => {
    const acc = accionsDins(s, p);
    const a = s.inici || s.fi;
    const b = s.fi || s.inici;
    let barra = '';
    if (a && b && a <= p.fi && b >= p.inici) {
      const esq = posicio(p, a < p.inici ? p.inici : a);
      const dreta = posicio(p, b > p.fi ? p.fi : b) + (100 / durada(p));
      const fons = colorProb(s.probabilitat)?.fons || '#94a3b8';
      barra = `<div class="absolute top-1/2 -translate-y-1/2 h-3.5 rounded-full shadow-sm transition-all group-hover:h-5"
                style="left:${esq}%;width:${Math.max(dreta - esq, 1.5)}%;background:${fons}"
                title="${esc(s.titol)} · ${esc(a)} → ${esc(b)}${s.probabilitat ? ` · ${esc(s.probabilitat)}` : ''}"></div>`;
    }
    const rombes = acc.map(x => `
      <div class="absolute top-1/2 w-2.5 h-2.5 -translate-y-1/2 -translate-x-1/2 rotate-45 border border-white z-20
                  transition-transform hover:scale-150"
           style="left:${posicio(p, x.data) + (100 / durada(p)) / 2}%;background:${colorEstatSub(x.estat)?.fons || '#3D6F9F'}"
           title="${esc(x.data)} · ${esc(x.titol)}${x.estat ? ` · ${esc(x.estat)}` : ''}"></div>`).join('');

    return `<div class="group grid grid-cols-[13rem_1fr] items-stretch border-b border-marca-vora/50 last:border-0">
      <button data-subvencio="${esc(s.id)}"
              class="text-left px-2 py-2 text-xs truncate transition-colors hover:text-marca hover:bg-marca-clar/60"
              title="${esc(s.titol)}">
        <span class="font-medium text-slate-700">${esc(s.titol)}</span>
        ${acc.length ? `<span class="text-slate-400"> · ${acc.length}</span>` : ''}
      </button>
      <div class="relative h-9">${graella}${linia}${barra}${rombes}</div>
    </div>`;
  }).join('');

  return `<div class="bg-white rounded-xl border border-marca-vora overflow-hidden mb-4">
    <div class="grid grid-cols-[13rem_1fr] border-b border-marca-vora bg-slate-50/70">
      <span class="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-marca">Subvenció</span>
      <div class="relative h-7">${capçalera}</div>
    </div>
    ${files || '<p class="px-3 py-8 text-sm text-slate-400 text-center">Res previst en aquest tram.</p>'}
  </div>`;
}

function pintaDetall(): void {
  const { p, previsualitza } = periodeMostrat();
  const { amb } = subvencionsDe(p);
  const accions = subvencions.flatMap(s => accionsDins(s, p).map(a => ({ a, s })));
  const nom = p.nivell === 'any' ? `l'any ${p.etiqueta}` : p.etiqueta;

  const capçalera = previsualitza
    ? `<div class="flex flex-wrap items-center gap-2 mb-3">
         <span class="text-[11px] font-bold uppercase tracking-wide text-marca bg-marca-clar px-2 py-0.5 rounded">Vista prèvia</span>
         <h3 class="text-sm font-bold text-slate-700">${esc(majuscula(nom))}</h3>
         <button id="entraPeriode" class="btn !py-1 !px-3 text-xs">Entra-hi</button>
         <span class="text-xs text-slate-400">o fes doble clic a la targeta</span>
       </div>`
    : `<h3 class="text-sm font-bold text-marca mb-3">Subvencions en ${esc(nom)}</h3>`;

  const resum = `<p class="text-xs text-slate-400 mb-3">
      <strong class="text-slate-600">${amb.length}</strong> subvencions ·
      <strong class="text-slate-600">${accions.length}</strong> accions en aquest tram</p>`;

  // Un dia no dona per fer cronograma: allà ensenyem les fitxes directament.
  const grafic = p.nivell === 'dia' ? '' : cronograma(p, amb);

  // En previsualitzar només mostrem el cronograma; en entrar-hi, també les fitxes.
  const fitxes = previsualitza || !amb.length ? '' :
    `<div class="grid gap-2 sm:grid-cols-2 mb-5">${amb.map(x => targetaSubvencio(x, p)).join('')}</div>`;

  const llistaDia = p.nivell === 'dia'
    ? (accions.length
        ? `<div class="grid gap-1.5 sm:grid-cols-2 mb-4">${accions.map(({ a, s: sv }) => `
            <div class="flex items-center gap-2 bg-white rounded-lg border border-marca-vora px-3 py-2">
              <div class="min-w-0 flex-1">
                <p class="text-sm text-slate-700 truncate">${esc(a.titol)}</p>
                <p class="text-[11px] text-slate-400 truncate">${esc(sv.titol)}</p>
              </div>
              ${pastilla(a.estat, colorEstatSub(a.estat))}
            </div>`).join('')}</div>`
        : '')
    : '';

  $('#detallCal').innerHTML = capçalera + resum + grafic + llistaDia
    + (p.nivell === 'dia' && !amb.length && !accions.length
        ? '<p class="text-sm text-slate-400 mb-4">Res previst aquest dia.</p>' : '')
    + fitxes;
}

/** Totes les subvencions que encara no tenen dates, vagin al trimestre que vagin. */
const senseDates = (): Subvencio[] => subvencions.filter(s => !s.inici && !s.fi);

function pintaSenseDates(): void {
  const llista = senseDates();
  $('#compteSenseDates').textContent = llista.length ? String(llista.length) : '';
  $('#botoSenseDates').classList.toggle('hidden', llista.length === 0);

  const perTrimestre = [1, 2, 3, 4].map(t => ({ t, llista: llista.filter(s => s.trimestre === t) }));
  const soltes = llista.filter(s => !s.trimestre);

  const grup = (titol: string, items: Subvencio[]) => items.length ? `
    <h3 class="text-sm font-bold text-marca mt-4 mb-2 first:mt-0">${esc(titol)}</h3>
    <div class="grid gap-2">${items.map(s => `
      <button data-subvencio="${esc(s.id)}" class="w-full text-left bg-white rounded-xl border border-marca-vora p-3
              transition-all hover:border-marca hover:shadow-md focus:outline-none focus:ring-2 focus:ring-marca/40">
        <div class="flex items-start gap-2">
          <span class="font-semibold text-slate-800 flex-1">${esc(s.titol)}</span>
          ${pastilla(s.probabilitat, colorProb(s.probabilitat))}
          ${pastilla(s.estat, colorEstat(s.estat))}
        </div>
        ${s.accions.length ? `<p class="text-xs text-slate-400 mt-1">${s.accions.length} accions</p>` : ''}
      </button>`).join('')}</div>` : '';

  $('#llistaSenseDates').innerHTML =
    perTrimestre.map(({ t, llista: l }) => grup(`T${t}`, l)).join('')
    + grup('Sense trimestre', soltes)
    || '<p class="text-sm text-slate-400 py-6 text-center">Totes les subvencions tenen dates. 🎉</p>';
}

function pinta(): void {
  $('#carregantCal').classList.add('hidden');
  pintaCami();
  pintaGraella();
  const vistaAlternativa = vista !== 'navegacio';
  $('#ajudaCalendari').classList.toggle('hidden', vistaAlternativa);
  $('#detallCal').classList.toggle('hidden', vistaAlternativa);
  pintaDetall();
  pintaSenseDates();
}

/* ---------- calaix de detall ---------- */

function opcions(llista: EtiquetaEstat[], sel: string, buit: string): string {
  return `<option value="">${esc(buit)}</option>` +
    llista.map(e => `<option ${e.nom === sel ? 'selected' : ''}>${esc(e.nom)}</option>`).join('');
}

function pintaCalaix(): void {
  const s = subvencions.find(x => x.id === obertaId);
  if (!s) { tancaCalaix(); return; }

  $('#contingutCalaix').innerHTML = `
    <div class="sticky top-0 bg-white border-b border-marca-vora px-5 py-4 flex items-start gap-3 z-10">
      <div class="flex-1 min-w-0">
        <input data-c="titol" value="${esc(s.titol)}"
               class="w-full text-lg font-bold text-marca bg-transparent border border-transparent rounded-md px-2 py-1
                      transition-all hover:border-marca-vora focus:outline-none focus:border-marca focus:bg-white focus:ring-2 focus:ring-marca/25">
        <p class="px-2 text-xs text-slate-400 mt-0.5">${esc(s.grupTitol)}</p>
      </div>
      <button id="tancaCalaix" class="p-1.5 rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" aria-label="Tanca">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    </div>

    <div class="px-5 py-4 grid grid-cols-2 gap-3">
      <div><label class="etiqueta-camp">Trimestre</label>
        <select data-c="grupId" class="camp">${esquema.grups.map(g =>
          `<option value="${esc(g.id)}" ${g.id === s.grupId ? 'selected' : ''}>${esc(g.titol)}</option>`).join('')}</select></div>
      <div><label class="etiqueta-camp">Probabilitat</label>
        <select data-c="probabilitat" class="camp">${opcions(esquema.probabilitats, s.probabilitat, '— Sense definir —')}</select></div>
      <div><label class="etiqueta-camp">Obertura prevista</label>
        <input type="date" data-c="inici" value="${esc(s.inici)}" class="camp"></div>
      <div><label class="etiqueta-camp">Tancament previst</label>
        <input type="date" data-c="fi" value="${esc(s.fi)}" class="camp"></div>
      <div class="col-span-2"><label class="etiqueta-camp">Estat</label>
        <select data-c="estat" class="camp">${opcions(esquema.estats, s.estat, '— Sense estat —')}</select></div>
      <div class="col-span-2"><label class="etiqueta-camp">Comentari</label>
        <textarea data-c="comentari" rows="3" class="camp resize-y"
          placeholder="Organisme, requisits, què cal preparar…">${esc(s.comentari)}</textarea></div>
    </div>

    <div class="px-5 pb-5">
      <h3 class="text-sm font-bold text-marca mb-2">Accions de preparació</h3>
      <div class="space-y-1.5 mb-3">${s.accions.length ? s.accions.map(a => `
        <div class="flex items-center gap-2 bg-slate-50 rounded-lg p-1.5" data-accio="${esc(a.id)}">
          <input data-ca="titol" value="${esc(a.titol)}"
                 class="flex-1 min-w-0 bg-transparent border border-transparent rounded-md px-2 py-1 text-sm
                        transition-all hover:border-marca-vora focus:outline-none focus:border-marca focus:bg-white">
          <input type="date" data-ca="data" value="${esc(a.data)}"
                 class="bg-transparent border border-transparent rounded-md px-1.5 py-1 text-xs tabular-nums
                        transition-all hover:border-marca-vora focus:outline-none focus:border-marca focus:bg-white">
          <select data-ca="estat" class="bg-transparent border border-transparent rounded-md px-1 py-1 text-xs max-w-[9rem]
                        transition-all hover:border-marca-vora focus:outline-none focus:border-marca focus:bg-white">
            ${opcions(esquema.estatsSub, a.estat, '—')}</select>
          <button data-esborra-accio class="p-1 rounded text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600" aria-label="Elimina l'acció">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>`).join('') : '<p class="text-sm text-slate-400">Cap acció encara.</p>'}
      </div>
      <form id="formAccio" class="flex gap-2">
        <input name="titol" placeholder="Nova acció: buscar leads, contactar prescriptors…"
               class="camp flex-1 text-sm" autocomplete="off" required>
        <input name="data" type="date" class="camp w-auto text-sm">
        <button type="submit" class="btn btn-ple !px-3">Afegeix</button>
      </form>
    </div>

    <div class="px-5 pb-4 pt-2 border-t border-marca-vora">
      <button id="comentarisSubvencio" class="btn w-full justify-center">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.6-.7L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z"/></svg>
        Comentaris${s.comentaris ? ` (${s.comentaris})` : ''}
      </button>
    </div>

    <div class="px-5 pb-6">
      <button id="esborraSubvencio" class="text-sm font-medium text-red-600 transition-colors hover:text-red-700">
        Elimina aquesta subvenció de Monday
      </button>
    </div>`;
}

function obreCalaix(id: string): void {
  obertaId = id;
  $('#calaix').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  pintaCalaix();
}

function tancaCalaix(): void {
  obertaId = null;
  $('#calaix').classList.add('hidden');
  document.body.style.overflow = '';
}

/* ---------- desament ---------- */

const pendents = new Map<string, number>();

function desa(ruta: string, clau: string, cos: Record<string, unknown>, espera = 600): void {
  const t = pendents.get(clau);
  if (t) window.clearTimeout(t);
  pendents.set(clau, window.setTimeout(async () => {
    try {
      await api(ruta, { method: 'PATCH', body: JSON.stringify(cos) });
      pendents.delete(clau);
    } catch (e) {
      avisa(`No s'ha pogut desar: ${(e as Error).message}`, 'err');
    }
  }, espera));
}

async function carrega({ silenci = false } = {}): Promise<void> {
  try {
    const { subvencions: noves } = await api<{ subvencions: Subvencio[] }>('/api/calendari/subvencions');
    subvencions = noves;
    pinta();
    if (obertaId) pintaCalaix();
  } catch (e) {
    if (!silenci) avisa(`No s'ha pogut llegir el calendari: ${(e as Error).message}`, 'err');
    $('#carregantCal').classList.add('hidden');
  }
}

/* ---------- esdeveniments ---------- */

function connecta(): void {
  /** Baixa un nivell cap al període indicat. */
  function entra(i: number): void {
    const p = subPeriodes().llista[i];
    if (!p) return;
    if (clicPendent) { window.clearTimeout(clicPendent); clicPendent = null; }
    cami.push(p);
    seleccionat = null;
    desaRuta();
    pinta();
  }

  const graella = $('#graelaCal');
  graella.addEventListener('dragstart', ev => {
    const origen = (ev.target as HTMLElement).closest<HTMLElement>('[data-arrossega-subvencio]');
    if (!origen?.dataset.arrossegaSubvencio) return;
    arrossegantId = origen.dataset.arrossegaSubvencio;
    ev.dataTransfer?.setData('text/plain', arrossegantId);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    window.requestAnimationFrame(() => origen.classList.add('opacity-50'));
  });

  graella.addEventListener('dragover', ev => {
    const desti = (ev.target as HTMLElement).closest<HTMLElement>('[data-dest-trimestre], [data-dest-estat], [data-dest-data]');
    if (!desti || !arrossegantId) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    desti.classList.add('ring-2', 'ring-marca', 'bg-marca-clar/40');
  });

  graella.addEventListener('dragleave', ev => {
    const desti = (ev.target as HTMLElement).closest<HTMLElement>('[data-dest-trimestre], [data-dest-estat], [data-dest-data]');
    const següent = ev.relatedTarget as Node | null;
    if (desti && (!següent || !desti.contains(següent))) desti.classList.remove('ring-2', 'ring-marca', 'bg-marca-clar/40');
  });

  graella.addEventListener('drop', ev => {
    const desti = (ev.target as HTMLElement).closest<HTMLElement>('[data-dest-trimestre], [data-dest-estat], [data-dest-data]');
    if (!desti) return;
    ev.preventDefault();
    const id = ev.dataTransfer?.getData('text/plain') || arrossegantId;
    netejaDestinsArrossegament();
    if (id) void aplicaArrossegament(id, desti);
  });

  graella.addEventListener('dragend', ev => {
    (ev.target as HTMLElement).closest<HTMLElement>('[data-arrossega-subvencio]')?.classList.remove('opacity-50');
    arrossegantId = null;
    darrerArrossegament = Date.now();
    netejaDestinsArrossegament();
  });

  graella.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const tasca = (ev.target as HTMLElement).closest<HTMLElement>('[data-subvencio]');
    if (!tasca?.dataset.subvencio) return;
    ev.preventDefault();
    obreCalaix(tasca.dataset.subvencio);
  });

  graella.addEventListener('click', ev => {
    if (Date.now() - darrerArrossegament < 250) return;
    const subvencio = (ev.target as HTMLElement).closest<HTMLElement>('[data-subvencio]');
    if (subvencio?.dataset.subvencio) {
      obreCalaix(subvencio.dataset.subvencio);
      return;
    }
    const mouMes = (ev.target as HTMLElement).closest<HTMLElement>('[data-mou-mes]');
    if (mouMes?.dataset.mouMes) {
      mesVista += Number(mouMes.dataset.mouMes);
      if (mesVista < 0) { mesVista = 11; any -= 1; }
      if (mesVista > 11) { mesVista = 0; any += 1; }
      cami = [periodeAny(any)];
      seleccionat = null;
      desaRuta();
      pinta();
      return;
    }
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-periode]');
    if (!btn) return;
    const i = Number(btn.dataset.periode);
    // Esperem un moment: si arriba el segon clic, manarà el doble clic.
    if (clicPendent) window.clearTimeout(clicPendent);
    clicPendent = window.setTimeout(() => {
      clicPendent = null;
      seleccionat = seleccionat === i ? null : i;
      pintaGraella();
      pintaDetall();
    }, 220);
  });

  graella.addEventListener('dblclick', ev => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-periode]');
    if (btn) entra(Number(btn.dataset.periode));
  });

  $('#detallCal').addEventListener('click', ev => {
    if ((ev.target as HTMLElement).closest('#entraPeriode') && seleccionat !== null) entra(seleccionat);
  });

  $('#camiCal').addEventListener('click', ev => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-nivell]');
    if (!btn) return;
    cami = cami.slice(0, Number(btn.dataset.nivell) + 1);
    seleccionat = null;
    desaRuta();
    pinta();
  });

  $('#detallCal').addEventListener('click', ev => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-subvencio]');
    if (btn?.dataset.subvencio) obreCalaix(btn.dataset.subvencio);
  });

  const mouAny = (delta: number) => () => {
    any += delta;
    cami = [periodeAny(any)];
    seleccionat = null;
    desaRuta();
    pinta();
  };
  $('#anyAnterior').addEventListener('click', mouAny(-1));
  $('#anySeguent').addEventListener('click', mouAny(1));
  $('#refrescaCal').addEventListener('click', () => void carrega());
  $('#selectorVistaCal').addEventListener('change', ev => {
    vista = (ev.target as HTMLSelectElement).value as VistaCalendari;
    seleccionat = null;
    pinta();
  });
  window.addEventListener('popstate', () => {
    if (!restauraRuta()) return;
    pinta();
  });

  /* --- calaix --- */
  $('#fonsCalaix').addEventListener('click', tancaCalaix);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#calaix').classList.contains('hidden')) tancaCalaix();
  });

  const calaix = $('#contingutCalaix');

  calaix.addEventListener('click', async ev => {
    const diana = ev.target as HTMLElement;
    if (diana.closest('#tancaCalaix')) { tancaCalaix(); return; }

    const esb = diana.closest<HTMLElement>('[data-esborra-accio]');
    if (esb) {
      const id = esb.closest<HTMLElement>('[data-accio]')?.dataset.accio;
      const s = subvencions.find(x => x.id === obertaId);
      if (!id || !s) return;
      try {
        await api(`/api/calendari/accions/${id}`, { method: 'DELETE' });
        s.accions = s.accions.filter(a => a.id !== id);
        pintaCalaix(); pinta();
      } catch (e) { avisa(`No s'ha pogut eliminar l'acció: ${(e as Error).message}`, 'err'); }
      return;
    }

    if (diana.closest('#comentarisSubvencio')) {
      const s = subvencions.find(x => x.id === obertaId);
      if (s) obreUpdates(s.id, s.titol, n => { s.comentaris = n; pintaCalaix(); pinta(); });
      return;
    }

    if (diana.closest('#esborraSubvencio')) {
      const s = subvencions.find(x => x.id === obertaId);
      if (!s) return;
      if (!confirm(`Vols eliminar «${s.titol}»? També s'esborrarà de Monday, amb les seves accions.`)) return;
      try {
        await api(`/api/calendari/subvencions/${s.id}`, { method: 'DELETE' });
        subvencions = subvencions.filter(x => x !== s);
        tancaCalaix(); pinta();
        avisa('Subvenció eliminada.');
      } catch (e) { avisa(`No s'ha pogut eliminar: ${(e as Error).message}`, 'err'); }
    }
  });

  calaix.addEventListener('input', ev => {
    const el = ev.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const s = subvencions.find(x => x.id === obertaId);
    if (!s) return;

    const c = el.dataset.c as keyof Subvencio | undefined;
    if (c) {
      (s[c] as string) = el.value;
      // Monday només accepta l'interval sencer, així que enviem les dues dates juntes.
      const cos = c === 'inici' || c === 'fi' ? { inici: s.inici, fi: s.fi } : { [c]: el.value };
      desa(`/api/calendari/subvencions/${s.id}`, `${s.id}:${c}`, cos,
           el instanceof HTMLSelectElement || el.type === 'date' ? 200 : 700);
      if (c === 'grupId') void carrega({ silenci: true });
      return;
    }

    const ca = el.dataset.ca;
    const idAccio = el.closest<HTMLElement>('[data-accio]')?.dataset.accio;
    if (!ca || !idAccio) return;
    const a = s.accions.find(x => x.id === idAccio);
    if (!a) return;
    (a[ca as keyof Accio] as string) = el.value;
    desa(`/api/calendari/accions/${idAccio}`, `${idAccio}:${ca}`, { [ca]: el.value },
         el instanceof HTMLSelectElement || el.type === 'date' ? 200 : 700);
  });

  calaix.addEventListener('submit', async ev => {
    ev.preventDefault();
    const form = ev.target as HTMLFormElement;
    if (form.id !== 'formAccio') return;
    const s = subvencions.find(x => x.id === obertaId);
    if (!s) return;
    const dades = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (!dades['titol']?.trim()) return;
    try {
      await api(`/api/calendari/subvencions/${s.id}/accions`, { method: 'POST', body: JSON.stringify(dades) });
      await carrega({ silenci: true });
      avisa('Acció afegida.');
    } catch (e) { avisa(`No s'ha pogut afegir l'acció: ${(e as Error).message}`, 'err'); }
  });

  /* --- diàleg de les subvencions que encara no tenen dates --- */
  const modalSense = $('#modalSenseDates');
  const tancaSense = (): void => {
    modalSense.classList.add('hidden');
    if (document.querySelectorAll('.fixed.inset-0:not(.hidden)').length === 0) document.body.style.overflow = '';
  };
  $('#botoSenseDates').addEventListener('click', () => {
    pintaSenseDates();
    modalSense.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  });
  for (const sel of ['#tancaSenseDates', '#fonsSenseDates']) $(sel).addEventListener('click', tancaSense);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modalSense.classList.contains('hidden')) tancaSense();
  });
  $('#llistaSenseDates').addEventListener('click', ev => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-subvencio]');
    if (!btn?.dataset.subvencio) return;
    tancaSense();
    obreCalaix(btn.dataset.subvencio);
  });

  /* --- formulari de nova subvenció --- */
  const modal = $('#modalSub');
  const obre = (): void => {
    $<HTMLFormElement>('#formSub').reset();
    $('#errTitol').classList.add('hidden');
    $('#s_grup').innerHTML = esquema.grups.map(g => {
      const p = periodeActual();
      const t = p.nivell === 'any' ? null : Number(/T(\d)/.exec(cami[1]?.etiqueta ?? '')?.[1] ?? '');
      return `<option value="${esc(g.id)}" ${t && g.trimestre === t ? 'selected' : ''}>${esc(g.titol)}</option>`;
    }).join('');
    $('#s_prob').innerHTML = opcions(esquema.probabilitats, '', '— Sense definir —');
    $('#s_estat').innerHTML = opcions(esquema.estats, '', '— Sense estat —');
    // Proposem les dates del tram que estem mirant, si no és tot l'any.
    const p = periodeActual();
    if (p.nivell !== 'any') {
      $<HTMLInputElement>('#s_inici').value = p.inici;
      $<HTMLInputElement>('#s_fi').value = p.fi;
    }
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => $('#s_titol').focus(), 60);
  };
  const tanca = (): void => { modal.classList.add('hidden'); document.body.style.overflow = ''; };

  $('#novaSubvencio').addEventListener('click', obre);
  for (const sel of ['#tancaSub', '#cancellaSub', '#fonsSub']) $(sel).addEventListener('click', tanca);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) tanca();
  });

  $<HTMLFormElement>('#formSub').addEventListener('submit', async ev => {
    ev.preventDefault();
    const dades = Object.fromEntries(new FormData(ev.target as HTMLFormElement)) as Record<string, string>;
    if (!dades['titol']?.trim()) {
      $('#errTitol').classList.remove('hidden');
      $('#s_titol').focus();
      return;
    }
    const btn = $<HTMLButtonElement>('#desaSub');
    btn.disabled = true; btn.classList.add('opacity-60', 'pointer-events-none'); btn.textContent = 'Desant…';
    try {
      await api('/api/calendari/subvencions', { method: 'POST', body: JSON.stringify(dades) });
      tanca();
      await carrega();
      avisa(`«${dades['titol']}» s'ha afegit a Monday.`);
    } catch (e) {
      avisa(`No s'ha pogut crear: ${(e as Error).message}`, 'err');
    } finally {
      btn.disabled = false; btn.classList.remove('opacity-60', 'pointer-events-none'); btn.textContent = 'Desa a Monday';
    }
  });
}

/** S'executa el primer cop que s'obre la pestanya del calendari. */
export async function iniciaCalendari(): Promise<void> {
  if (iniciat) return;
  iniciat = true;
  const téRuta = restauraRuta();
  if (!téRuta) {
    cami = [periodeAny(any)];
    seleccionat = Math.floor(new Date().getMonth() / 3);
    desaRuta(true);
  }
  try {
    esquema = await api<EsquemaCalendari>('/api/calendari/esquema');
    if (esquema.falten.length) {
      $('#avisCal').classList.remove('hidden');
      $('#avisCal').innerHTML = `<strong>Falten columnes al tauler del calendari:</strong> ${esc(esquema.falten.join(', '))}.`;
    }
  } catch (e) {
    $('#avisCal').classList.remove('hidden');
    $('#avisCal').textContent = `No s'ha pogut llegir el tauler del calendari: ${(e as Error).message}`;
  }
  connecta();
  await carrega();
  window.setInterval(() => {
    if (!document.hidden && !$('#vistaCalendari').classList.contains('hidden')) void carrega({ silenci: true });
  }, 20000);
}
