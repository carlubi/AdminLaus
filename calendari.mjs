// Accés al tauler «Agile - Roadmap», que fa de calendari trimestral de subvencions.
// Els grups són els trimestres, els elements són les subvencions o iniciatives
// (amb un interval de dates) i les subtasques són les accions de preparació.
import { gql } from './monday.mjs';

export const TAULER_CAL = process.env.monday_boardCalendari || '18400175021';

/** Columnes del tauler principal. Les lliguem per identificador, que és estable. */
const COL = {
  interval:    'timeline',                   // Timeline: {from, to}
  probabilitat:'status',                     // Priority: High | Medium | Low
  estat:       'status7',                    // Status: Working on it | Done | Stuck | Not Started
  comentari:   'text',
  responsable: 'person',                     // Owner (només lectura: cal ID d'usuari de Monday)
};

/** Columnes del tauler de subtasques. */
const COL_SUB = {
  data:  'date0',
  estat: 'status',
  responsable: 'person',
};

const etiquetes = col => {
  const s = JSON.parse(col?.settings_str || '{}');
  const l = s.labels || {};
  const pos = s.labels_positions_v2 || {};
  return Object.entries(l)
    .filter(([, nom]) => nom)
    .map(([idx, nom]) => ({
      nom,
      fons: s.labels_colors?.[idx]?.color || '#c4c4c4',
      ordre: pos[idx] ?? Number(idx),
    }))
    .sort((a, b) => a.ordre - b.ordre);
};

/** Trimestre (1-4) a partir del títol del grup: «Q2 initiatives» → 2. */
const trimestreDelGrup = titol => {
  const m = /\bQ([1-4])\b/i.exec(titol || '');
  return m ? Number(m[1]) : null;
};

export async function esquemaCalendari() {
  const d = await gql(
    `query($b:[ID!]) { boards(ids:$b) {
       id name
       columns { id title type settings_str }
       groups { id title }
     } }`, { b: [TAULER_CAL] });

  const board = d.boards?.[0];
  if (!board) throw new Error(`No s'ha trobat el tauler de calendari ${TAULER_CAL}`);

  const col = id => board.columns.find(c => c.id === id);
  const falten = Object.entries(COL)
    .filter(([, id]) => !col(id))
    .map(([camp, id]) => `${camp} (${id})`);

  // El tauler de subtasques és un tauler propi de Monday; el trobem a partir de la columna subtasks.
  const colSub = board.columns.find(c => c.type === 'subtasks');
  let taulerSub = null;
  if (colSub) {
    try { taulerSub = JSON.parse(colSub.settings_str || '{}').boardIds?.[0] ?? null; } catch { /* res */ }
  }

  return {
    boardId: board.id,
    nomTauler: board.name,
    taulerSub: taulerSub ? String(taulerSub) : null,
    falten,
    grups: board.groups.map(g => ({ id: g.id, titol: g.title, trimestre: trimestreDelGrup(g.title) })),
    probabilitats: etiquetes(col(COL.probabilitat)),
    estats: etiquetes(col(COL.estat)),
    estatsSub: [],   // s'omple més avall
  };
}

/** Etiquetes d'estat de les subtasques, que viuen al seu propi tauler. */
export async function estatsSubtasques(taulerSub) {
  if (!taulerSub) return [];
  const d = await gql(`query($b:[ID!]) { boards(ids:$b) { columns { id title type settings_str } } }`,
    { b: [taulerSub] });
  return etiquetes(d.boards?.[0]?.columns?.find(c => c.id === COL_SUB.estat));
}

const textDe = (cvs, id) => cvs.find(c => c.id === id)?.text || '';

function interval(cvs) {
  const cv = cvs.find(c => c.id === COL.interval);
  try {
    const v = JSON.parse(cv?.value || 'null');
    return { inici: v?.from || '', fi: v?.to || '' };
  } catch { return { inici: '', fi: '' }; }
}

export async function llistaSubvencions() {
  const d = await gql(
    `query($b:ID!) { boards(ids:[$b]) { items_page(limit:200) { items {
       id name
       group { id title }
       updates(limit:100) { id }
       column_values { id text value }
       subitems { id name column_values { id text value } }
     } } } }`, { b: TAULER_CAL });

  return (d.boards?.[0]?.items_page?.items || []).map(it => {
    const { inici, fi } = interval(it.column_values);
    return {
      id: it.id,
      titol: it.name,
      comentaris: (it.updates || []).length,
      grupId: it.group.id,
      grupTitol: it.group.title,
      trimestre: trimestreDelGrup(it.group.title),
      inici, fi,
      probabilitat: textDe(it.column_values, COL.probabilitat),
      estat: textDe(it.column_values, COL.estat),
      comentari: textDe(it.column_values, COL.comentari),
      responsable: textDe(it.column_values, COL.responsable),
      accions: (it.subitems || []).map(s => ({
        id: s.id,
        titol: s.name,
        data: textDe(s.column_values, COL_SUB.data),
        estat: textDe(s.column_values, COL_SUB.estat),
        responsable: textDe(s.column_values, COL_SUB.responsable),
      })),
    };
  });
}

/** Passa els camps de la web al format de columnes de Monday. */
function valorsSubvencio(dades) {
  const v = {};
  if (dades.probabilitat !== undefined) v[COL.probabilitat] = dades.probabilitat ? { label: dades.probabilitat } : {};
  if (dades.estat !== undefined)        v[COL.estat]        = dades.estat ? { label: dades.estat } : {};
  if (dades.comentari !== undefined)    v[COL.comentari]    = String(dades.comentari ?? '');
  if (dades.inici !== undefined || dades.fi !== undefined) {
    const { inici, fi } = dades;
    v[COL.interval] = inici && fi ? { from: inici, to: fi } : {};
  }
  return v;
}

export async function creaSubvencio(dades) {
  const d = await gql(
    `mutation($b:ID!,$g:String!,$n:String!,$v:JSON!) {
       create_item(board_id:$b, group_id:$g, item_name:$n, column_values:$v, create_labels_if_missing:true) { id }
     }`,
    { b: TAULER_CAL, g: dades.grupId, n: (dades.titol || 'Sense títol').slice(0, 255), v: JSON.stringify(valorsSubvencio(dades)) });
  return d.create_item.id;
}

export async function actualitzaSubvencio(id, canvis) {
  if (canvis.titol !== undefined) {
    await gql(`mutation($b:ID!,$i:ID!,$v:String!) {
       change_simple_column_value(board_id:$b, item_id:$i, column_id:"name", value:$v) { id } }`,
      { b: TAULER_CAL, i: id, v: (canvis.titol || 'Sense títol').slice(0, 255) });
  }
  if (canvis.grupId !== undefined) {
    await gql(`mutation($i:ID!,$g:String!) { move_item_to_group(item_id:$i, group_id:$g) { id } }`,
      { i: id, g: canvis.grupId });
  }
  const v = valorsSubvencio(canvis);
  if (Object.keys(v).length) {
    await gql(`mutation($b:ID!,$i:ID!,$v:JSON!) {
       change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v, create_labels_if_missing:true) { id } }`,
      { b: TAULER_CAL, i: id, v: JSON.stringify(v) });
  }
}

export const esborraSubvencio = id =>
  gql(`mutation($i:ID!) { delete_item(item_id:$i) { id } }`, { i: id });

/* ---------- accions de preparació (subtasques) ---------- */

function valorsAccio(dades) {
  const v = {};
  if (dades.data !== undefined)  v[COL_SUB.data]  = dades.data ? { date: dades.data } : {};
  if (dades.estat !== undefined) v[COL_SUB.estat] = dades.estat ? { label: dades.estat } : {};
  return v;
}

export async function creaAccio(pareId, dades) {
  const d = await gql(
    `mutation($p:ID!,$n:String!,$v:JSON!) {
       create_subitem(parent_item_id:$p, item_name:$n, column_values:$v, create_labels_if_missing:true) { id }
     }`,
    { p: pareId, n: (dades.titol || 'Sense títol').slice(0, 255), v: JSON.stringify(valorsAccio(dades)) });
  return d.create_subitem.id;
}

export async function actualitzaAccio(taulerSub, id, canvis) {
  if (canvis.titol !== undefined) {
    await gql(`mutation($b:ID!,$i:ID!,$v:String!) {
       change_simple_column_value(board_id:$b, item_id:$i, column_id:"name", value:$v) { id } }`,
      { b: taulerSub, i: id, v: (canvis.titol || 'Sense títol').slice(0, 255) });
  }
  const v = valorsAccio(canvis);
  if (Object.keys(v).length) {
    await gql(`mutation($b:ID!,$i:ID!,$v:JSON!) {
       change_multiple_column_values(board_id:$b, item_id:$i, column_values:$v, create_labels_if_missing:true) { id } }`,
      { b: taulerSub, i: id, v: JSON.stringify(v) });
  }
}

export const esborraAccio = id =>
  gql(`mutation($i:ID!) { delete_item(item_id:$i) { id } }`, { i: id });
