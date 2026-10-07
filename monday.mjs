// Capa d'accés a l'API de Monday.com. Comparada per server.mjs i setup-monday.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARREL = path.dirname(fileURLToPath(import.meta.url));

function carregaEnv() {
  const fitxer = path.join(ARREL, '.env');
  if (!fs.existsSync(fitxer)) return {};
  return Object.fromEntries(
    fs.readFileSync(fitxer, 'utf8')
      .split('\n')
      .filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('='))
      .map(l => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      })
  );
}

const env = { ...carregaEnv(), ...process.env };

export const API_KEY = env.monday_apiKey || env.MONDAY_API_KEY || '';
export const BOARD_ID = env.monday_boardId || '18433348240';
export const GROUP_ID = env.monday_groupId || 'topics';
export const RESPONSABLES = (env.responsables || 'Oriol,Jordi,Flor,Carla').split(',').map(s => s.trim());

// Les 17 comunitats autònomes més Ceuta i Melilla. Es poden canviar des del .env.
export const COMUNITATS = (env.comunitats || [
  "Andalusia","Aragó","Astúries","Canàries","Cantàbria","Castella i Lleó","Castella-la Manxa",
  "Catalunya","Ceuta","Comunitat Valenciana","Extremadura","Galícia","Illes Balears","La Rioja",
  "Madrid","Melilla","Múrcia","Navarra","País Basc",
].join(",")).split(",").map(s => s.trim());

// Els camps de la web i el títol exacte de la columna de Monday amb què lliguen.
// La columna especial `name` de Monday sempre guarda el nom de l'empresa.
export const CAMPS = [
  { camp: 'empresa',    titol: null,                 tipus: 'name' },
  { camp: 'responsable',titol: 'Responsable',        tipus: 'text' },
  { camp: 'estat',      titol: 'Estat',              tipus: 'status' },
  { camp: 'comunitats', titol: 'Comunitats Autònomes', tipus: 'dropdown' },
  { camp: 'anotacio',   titol: 'Anotacions',         tipus: 'long_text' },
  { camp: 'contacte',   titol: 'Nom Contacte',       tipus: 'text' },
  { camp: 'telefon',    titol: 'Telèfon Principal',  tipus: 'phone' },
  { camp: 'correu',     titol: 'Correu Principal',   tipus: 'email' },
  { camp: 'cif',        titol: 'CIF',                tipus: 'text' },
  { camp: 'fee',        titol: 'Fee (€)',            tipus: 'numbers' },
  { camp: 'acord',      titol: 'Acord (%)',          tipus: 'numbers' },
  { camp: 'dataVisita', titol: 'Data Última visita', tipus: 'date' },
];

export async function gql(query, variables = {}) {
  if (!API_KEY) throw new Error('Falta monday_apiKey o MONDAY_API_KEY a les variables d\'entorn');
  const r = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: API_KEY, 'API-Version': '2024-10' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => ({}));
  if (j.errors) throw new Error(j.errors.map(e => e.message).join(' · '));
  if (j.error_message) throw new Error(j.error_message);
  if (!r.ok) throw new Error(`Monday ha respost ${r.status}`);
  return j.data;
}

/** Llegeix les columnes del tauler i les lliga als camps de la web (per títol). */
export async function llegeixEsquema() {
  const d = await gql(
    `query($b:[ID!]) { boards(ids:$b) { id name columns { id title type settings_str } } }`,
    { b: [BOARD_ID] }
  );
  const board = d.boards?.[0];
  if (!board) throw new Error(`No s'ha trobat el tauler ${BOARD_ID}`);

  const mapa = {};       // camp de la web -> { id, tipus }
  const falten = [];
  for (const { camp, titol, tipus } of CAMPS) {
    if (tipus === 'name') { mapa[camp] = { id: 'name', tipus: 'name' }; continue; }
    const col = board.columns.find(c => c.title.trim().toLowerCase() === titol.toLowerCase() && c.type === tipus);
    if (col) mapa[camp] = { id: col.id, tipus: col.type };
    else falten.push(`${titol} (${tipus})`);
  }

  // Les etiquetes i els colors de l'estat surten del mateix Monday, així sempre coincideixen.
  let estats = [];
  if (mapa.estat) {
    const col = board.columns.find(c => c.id === mapa.estat.id);
    const s = JSON.parse(col.settings_str || '{}');
    estats = Object.entries(s.labels || {})
      .filter(([, nom]) => nom)
      .map(([idx, nom]) => ({
        nom,
        fons: s.labels_colors?.[idx]?.color || '#c4c4c4',
        ordre: s.labels_positions_v2?.[idx] ?? Number(idx),
      }))
      .sort((a, b) => a.ordre - b.ordre);
  }

  return { boardId: board.id, nomTauler: board.name, mapa, estats, falten,
           responsables: RESPONSABLES, comunitats: COMUNITATS };
}

/** Converteix un valor de la web al format JSON que espera cada tipus de columna de Monday. */
function aMonday(tipus, v) {
  const s = (v ?? '').toString().trim();
  switch (tipus) {
    case 'text':      return s;
    case 'long_text': return { text: s };
    case 'status':    return s ? { label: s } : {};
    // El desplegable admet diverses comunitats alhora.
    case 'dropdown':  return { labels: Array.isArray(v) ? v.filter(Boolean) : (s ? [s] : []) };
    case 'date':      return s ? { date: s } : {};
    case 'email':     return s ? { email: s, text: s } : {};
    case 'phone':     return s ? { phone: s.replace(/\s+/g, ''), countryShortName: 'ES' } : {};
    case 'numbers':   return s ? s.replace(',', '.') : '';
    default:          return s;
  }
}

/** Converteix la resposta de Monday al valor pla que fa servir la web. */
function deMonday(tipus, cv) {
  if (tipus === 'dropdown') {
    // Fem servir el text ja resolt per Monday ("Catalunya, Aragó") en comptes dels
    // identificadors: així no depenem d'un esquema en memòria que pot quedar desfasat
    // quan es creen etiquetes noves. Cap comunitat porta coma al nom.
    return (cv?.text || '').split(',').map(t => t.trim()).filter(Boolean);
  }
  if (!cv) return '';
  if (tipus === 'date') {
    try { return JSON.parse(cv.value || '{}').date || ''; } catch { return ''; }
  }
  if (tipus === 'phone') {
    try { return JSON.parse(cv.value || '{}').phone || ''; } catch { return cv.text || ''; }
  }
  return cv.text || '';
}

export async function llistaElements(esquema) {
  const d = await gql(
    `query($b:ID!) {
       boards(ids:[$b]) {
         items_page(limit: 500) {
           items { id name updated_at updates(limit:100) { id } column_values { id text value type } }
         }
       }
     }`,
    { b: BOARD_ID }
  );
  const items = d.boards?.[0]?.items_page?.items || [];
  return items.map(it => {
    const fila = { id: it.id, empresa: it.name, actualitzat: it.updated_at, comentaris: (it.updates || []).length };
    for (const { camp } of CAMPS) {
      if (camp === 'empresa') continue;
      const m = esquema.mapa[camp];
      const buit = CAMPS.find(c => c.camp === camp)?.tipus === 'dropdown' ? [] : '';
      fila[camp] = m ? deMonday(m.tipus, it.column_values.find(c => c.id === m.id)) : buit;
    }
    return fila;
  });
}

export async function creaElement(esquema, dades) {
  const valors = {};
  for (const [camp, m] of Object.entries(esquema.mapa)) {
    if (camp === 'empresa' || dades[camp] === undefined) continue;
    valors[m.id] = aMonday(m.tipus, dades[camp]);
  }
  const d = await gql(
    `mutation($b:ID!,$g:String!,$n:String!,$v:JSON!) {
       create_item(board_id:$b, group_id:$g, item_name:$n, column_values:$v, create_labels_if_missing:true) { id }
     }`,
    { b: BOARD_ID, g: GROUP_ID, n: (dades.empresa || 'Sense nom').slice(0, 255), v: JSON.stringify(valors) }
  );
  return d.create_item.id;
}

export async function actualitzaElement(esquema, itemId, canvis) {
  const valors = {};
  for (const [camp, valor] of Object.entries(canvis)) {
    const m = esquema.mapa[camp];
    if (!m) continue;
    valors[m.id] = m.tipus === 'name' ? (valor || 'Sense nom').slice(0, 255) : aMonday(m.tipus, valor);
  }
  if (!Object.keys(valors).length) return;
  await gql(
    `mutation($b:ID!,$i:ID!,$v:JSON!) {
       change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v, create_labels_if_missing:true) { id }
     }`,
    { b: BOARD_ID, i: itemId, v: JSON.stringify(valors) }
  );
}

export async function esborraElement(itemId) {
  await gql(`mutation($i:ID!) { delete_item(item_id:$i) { id } }`, { i: itemId });
}

/* ---------- analítica de prescriptors als taulers de subvencions ---------- */

export const WORKSPACE_SUBVENCIONS = env.monday_workspaceSubvencions || '7397781';
const FITXER_CACHE_SUBVENCIONS = path.join(process.env.VERCEL ? os.tmpdir() : path.join(ARREL, '.data'), 'subvencions-cache.json');
const VIDA_CACHE_SUBVENCIONS = 5 * 60_000;
let cacheSubvencions = { quan: 0, registres: [] };
let actualitzacioSubvencions = null;

/** Recuperem l'últim índex conegut perquè un reinici no obligui a esperar Monday. */
function carregaCacheSubvencions() {
  try {
    const desada = JSON.parse(fs.readFileSync(FITXER_CACHE_SUBVENCIONS, 'utf8'));
    if (Array.isArray(desada.registres) && Number.isFinite(desada.quan)) {
      cacheSubvencions = { quan: desada.quan, registres: desada.registres };
    }
  } catch { /* Encara no hi ha cap còpia local, o és una versió invàlida. */ }
}

/** Escrivim primer un temporal i el movem al final: mai no queda una còpia a mitges. */
function desaCacheSubvencions() {
  try {
    fs.mkdirSync(path.dirname(FITXER_CACHE_SUBVENCIONS), { recursive: true });
    const temporal = `${FITXER_CACHE_SUBVENCIONS}.tmp`;
    fs.writeFileSync(temporal, JSON.stringify(cacheSubvencions), 'utf8');
    fs.renameSync(temporal, FITXER_CACHE_SUBVENCIONS);
  } catch (e) {
    console.warn(`No s'ha pogut desar la memòria cau de subvencions: ${e.message}`);
  }
}

carregaCacheSubvencions();
const normalitza = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const estatGrup = titol => /sol licitud|sollicitud/.test(normalitza(titol)) ? 'sollicitud' : /lead/.test(normalitza(titol)) ? 'lead' : null;
/** Taulers operatius o històrics que no són subvencions i no s'han de mostrar mai. */
function taulerExclosAnalitica(nom) {
  const n = normalitza(nom);
  return n === normalitza('Leads_persones')
    || n === normalitza('Leads_persones y Formularis (antic, no tocar)')
    || (n.includes('formularis') && n.includes('antic') && n.includes('no tocar'));
}

/**
 * A Monday el prescriptor s'escriu al camp LEAD (normalment amb @).
 * Conservem variants del nom de la fitxa, però no fem servir cap altra columna
 * per atribuir un item: així no confon coincidències del nom o del contacte.
 */
function clausPrescriptor(p) {
  const descarta = new Set(['sl', 'sa', 'del', 'les', 'assessors', 'consultoria', 'grupo', 'group', 'empresa']);
  const fonts = [p.empresa, p.contacte].map(normalitza).filter(Boolean);
  const claus = new Set(fonts.filter(x => x.length >= 5));
  for (const font of fonts) for (const paraula of font.split(' ')) if (paraula.length >= 5 && !descarta.has(paraula)) claus.add(paraula);
  if (normalitza(p.empresa).includes('innovalaus')) claus.add('ilaus');
  return [...claus];
}

async function itemsTauler(tauler) {
  const d = await gql(`query($b:[ID!]) { boards(ids:$b) { items_page(limit:500) { cursor items {
    id name created_at group { title } column_values { id text } } } } }`, { b: [tauler.id] });
  let pagina = d.boards?.[0]?.items_page;
  const items = [...(pagina?.items || [])];
  while (pagina?.cursor) {
    const n = await gql(`query($c:String!) { next_items_page(cursor:$c, limit:500) { cursor items {
      id name created_at group { title } column_values { id text } } } }`, { c: pagina.cursor });
    pagina = n.next_items_page;
    items.push(...(pagina?.items || []));
  }
  return items;
}

export function estatCacheSubvencions() {
  return {
    actualitzada: cacheSubvencions.quan ? new Date(cacheSubvencions.quan).toISOString() : '',
    actualitzant: Boolean(actualitzacioSubvencions),
    desfasada: !cacheSubvencions.quan || Date.now() - cacheSubvencions.quan >= VIDA_CACHE_SUBVENCIONS,
  };
}

export async function actualitzaCacheSubvencions() {
  if (actualitzacioSubvencions) return actualitzacioSubvencions;
  actualitzacioSubvencions = (async () => {
  const d = await gql(`query($w:[ID]) { boards(workspace_ids:$w, limit:100) { id name groups { title } columns { id title } } }`, { w: [WORKSPACE_SUBVENCIONS] });
  const taulers = (d.boards || []).map(t => ({
    ...t,
    // Només es tenen en compte els ítems amb una columna que sigui LEAD.
    // Això replica la cerca de Monday, però evita atribucions d'altres camps.
    columnesLead: (t.columns || []).filter(c => /(^|\s)lead(\s|$)/.test(normalitza(c.title))).map(c => c.id),
    columnaStatusExp: (t.columns || []).find(c => normalitza(c.title) === 'status exp')?.id || '',
  })).filter(t => t.id !== BOARD_ID && !/^subitems?\b/i.test(t.name)
    && !taulerExclosAnalitica(t.name)
    && t.groups.some(g => estatGrup(g.title)) && t.columnesLead.length);
  const registres = [];
  for (let i = 0; i < taulers.length; i += 4) {
    const lots = await Promise.all(taulers.slice(i, i + 4).map(async tauler => {
      const items = await itemsTauler(tauler);
      return items.map(item => ({
        id: item.id, empresa: item.name, data: (item.created_at || '').slice(0, 10), subvencio: tauler.name,
        taulerId: tauler.id, grup: item.group?.title || '', estat: estatGrup(item.group?.title),
        // Guardem exclusivament el valor de la columna LEAD, no el text de l'item
        // ni de la resta de columnes.
        lead: item.column_values.filter(c => tauler.columnesLead.includes(c.id)).map(c => c.text).join(' '),
        statusExp: item.column_values.find(c => c.id === tauler.columnaStatusExp)?.text || '',
      })).filter(x => x.estat);
    }));
    registres.push(...lots.flat());
  }
    cacheSubvencions = { quan: Date.now(), registres };
    desaCacheSubvencions();
    return registres;
  })();
  try {
    return await actualitzacioSubvencions;
  } finally {
    actualitzacioSubvencions = null;
  }
}

// Manté la còpia al dia fins i tot si ningú no obre cap expedient.
setInterval(() => {
  if (Date.now() - cacheSubvencions.quan >= VIDA_CACHE_SUBVENCIONS) {
    void actualitzaCacheSubvencions().catch(e => console.warn(`No s'ha pogut actualitzar les subvencions: ${e.message}`));
  }
}, 60_000).unref();

async function registresSubvencions() {
  if (cacheSubvencions.registres.length) {
    // Servim de seguida l'última còpia vàlida; si ja toca, Monday s'actualitza en segon pla.
    if (Date.now() - cacheSubvencions.quan >= VIDA_CACHE_SUBVENCIONS) void actualitzaCacheSubvencions().catch(e => console.warn(`No s'ha pogut actualitzar les subvencions: ${e.message}`));
    return cacheSubvencions.registres;
  }
  return actualitzaCacheSubvencions();
}

export async function analitiquesPrescriptor(prescriptor) {
  const claus = clausPrescriptor(prescriptor);
  const tots = await registresSubvencions();
  const registres = tots.filter(r => {
    const lead = ` ${normalitza(r.lead)} `;
    return claus.some(clau => lead.includes(` ${clau} `));
  });
  const leads = registres.filter(r => r.estat === 'lead');
  const sollicituds = registres.filter(r => r.estat === 'sollicitud');
  const perSubvencio = [...new Set(registres.map(r => r.subvencio))].sort().map(subvencio => {
    const items = registres.filter(r => r.subvencio === subvencio);
    return {
      subvencio,
      leads: items.filter(r => r.estat === 'lead').length,
      sollicituds: items.filter(r => r.estat === 'sollicitud').length,
      items: items.sort((a, b) => b.data.localeCompare(a.data)).map(r => ({
        id: r.id, empresa: r.empresa, data: r.data, estat: r.estat, statusExp: r.statusExp,
      })),
    };
  });
  const serieDe = items => {
    const mesos = new Map();
    for (const r of items) {
      const mes = r.data ? r.data.slice(0, 7) : 'Sense data';
      const v = mesos.get(mes) || { mes, leads: 0, sollicituds: 0 };
      r.estat === 'lead' ? v.leads++ : v.sollicituds++;
      mesos.set(mes, v);
    }
    return [...mesos.values()].sort((a, b) => a.mes.localeCompare(b.mes));
  };
  const seriePerSubvencio = Object.fromEntries(perSubvencio.map(({ subvencio }) => [
    subvencio, serieDe(registres.filter(r => r.subvencio === subvencio)),
  ]));
  return { prescriptor: { id: prescriptor.id, empresa: prescriptor.empresa, contacte: prescriptor.contacte },
    resum: { leads: leads.length, sollicituds: sollicituds.length, conversio: leads.length ? Math.round(sollicituds.length / leads.length * 1000) / 10 : 0 },
    perSubvencio, serie: serieDe(registres), seriePerSubvencio,
    registres: registres.sort((a, b) => b.data.localeCompare(a.data)).slice(0, 100), cobertura: { taulers: new Set(tots.map(r => r.taulerId)).size, coincidencies: registres.length },
    cache: estatCacheSubvencions() };
}

/* ---------- updates (els comentaris de Monday) ---------- */
// Els updates pengen d'un element, no d'un tauler, així que aquestes funcions
// serveixen igual per als prescriptors i per a les subvencions del calendari.

/** Converteix el text que escriu l'usuari a l'HTML senzill que espera Monday. */
const aHtml = text =>
  String(text ?? '')
    .replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    .split('\n').map(l => l || '&nbsp;').join('<br>');

export async function llistaUpdates(itemId) {
  const d = await gql(
    `query($i:[ID!]) { items(ids:$i) {
       updates(limit: 100) {
         id text_body created_at
         creator { id name photo_thumb_small }
         replies { id text_body created_at creator { id name } }
       } } }`, { i: [itemId] });

  return (d.items?.[0]?.updates || []).map(u => ({
    id: u.id,
    text: u.text_body || '',
    quan: u.created_at,
    autor: u.creator?.name || 'Desconegut',
    foto: u.creator?.photo_thumb_small || '',
    respostes: (u.replies || []).map(r => ({
      id: r.id,
      text: r.text_body || '',
      quan: r.created_at,
      autor: r.creator?.name || 'Desconegut',
    })),
  }));
}

export async function creaUpdate(itemId, text, pareId = null) {
  const d = await gql(
    `mutation($i:ID!,$b:String!,$p:ID) { create_update(item_id:$i, body:$b, parent_id:$p) { id } }`,
    { i: itemId, b: aHtml(text), p: pareId });
  return d.create_update.id;
}

export const esborraUpdate = id =>
  gql(`mutation($u:ID!) { delete_update(id:$u) { id } }`, { u: id });
