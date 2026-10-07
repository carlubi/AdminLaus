// Prepara el tauler de Monday perquè encaixi amb la taula web. S'executa un sol cop:
//   node setup-monday.mjs
// És idempotent: si una columna ja existeix, la deixa estar.
import { gql, BOARD_ID, GROUP_ID, COMUNITATS, llegeixEsquema } from './monday.mjs';

// Etiquetes d'estat amb els colors oficials de Monday, triats per acostar-se als de la web.
const ETIQUETES_ESTAT = {
  labels: { 1: 'Sense resposta', 2: 'En conversa', 3: 'En negociació', 4: 'Amb contracte', 5: 'Descartat' },
  labels_colors: {
    1: { color: '#c4c4c4', border: '#b0b0b0', var_name: 'grey' },
    2: { color: '#0086c0', border: '#3db9e3', var_name: 'blue-links' },
    3: { color: '#fdab3d', border: '#e99729', var_name: 'orange' },
    4: { color: '#00c875', border: '#00b461', var_name: 'green-shadow' },
    5: { color: '#df2f4a', border: '#ce3048', var_name: 'red-shadow' },
  },
};

async function columnes() {
  const d = await gql(`query($b:[ID!]) { boards(ids:$b) { name columns { id title type } } }`, { b: [BOARD_ID] });
  if (!d.boards?.[0]) throw new Error(`No s'ha trobat el tauler ${BOARD_ID}`);
  return d.boards[0];
}

async function elementsDelTauler() {
  const d = await gql(`query($b:ID!) { boards(ids:[$b]) { items_page(limit:1) { items { id } } } }`, { b: BOARD_ID });
  return d.boards?.[0]?.items_page?.items || [];
}

const board = await columnes();
console.log(`Tauler: ${board.name} (${BOARD_ID})\n`);

const te = (titol, tipus) => board.columns.find(c => c.title.trim().toLowerCase() === titol.toLowerCase() && c.type === tipus);

// 1) Columna de text «Responsable». Substitueix la columna Person perquè
//    Person només accepta usuaris reals del compte de Monday i l'Oriol no hi és.
if (te('Responsable', 'text')) {
  console.log('· «Responsable» (text) ja existeix.');
} else {
  const d = await gql(
    `mutation($b:ID!) { create_column(board_id:$b, title:"Responsable", column_type:text) { id } }`, { b: BOARD_ID });
  console.log(`· Creada «Responsable» (text) → ${d.create_column.id}`);
}

// 2) Columna d'estat amb les nostres etiquetes.
if (te('Estat', 'status')) {
  console.log('· «Estat» (status) ja existeix.');
} else {
  const d = await gql(
    `mutation($b:ID!,$d:JSON!) { create_column(board_id:$b, title:"Estat", column_type:status, defaults:$d) { id } }`,
    { b: BOARD_ID, d: JSON.stringify(ETIQUETES_ESTAT) });
  console.log(`· Creada «Estat» (status) → ${d.create_column.id}`);
}

// 3) Un títol entenedor per a la columna del nom.
try {
  await gql(`mutation($b:ID!) { change_column_title(board_id:$b, column_id:"name", title:"Empresa prescriptora") { id } }`,
    { b: BOARD_ID });
  console.log('· La columna del nom passa a dir-se «Empresa prescriptora».');
} catch (e) { console.log(`· No s'ha pogut reanomenar la columna del nom: ${e.message}`); }

// 4) Les columnes velles «Person» i «Status» ja no es fan servir. Només les esborrem
//    si el tauler és buit; si hi ha elements, ho deixem a les teves mans.
const buit = (await elementsDelTauler()).length === 0;
for (const [titol, tipus] of [['Person', 'people'], ['Status', 'status']]) {
  const col = te(titol, tipus);
  if (!col) continue;
  if (!buit) { console.log(`· «${titol}» ja no es fa servir, però el tauler té elements: esborra-la tu des de Monday si vols.`); continue; }
  await gql(`mutation($b:ID!,$c:String!) { delete_column(board_id:$b, column_id:$c) { id } }`, { b: BOARD_ID, c: col.id });
  console.log(`· Esborrada la columna «${titol}», que ja no es feia servir.`);
}

// 5) Etiquetes del desplegable «Comunitats Autònomes».
//    L'API de Monday no té cap mutació per definir etiquetes d'un desplegable, però sí que
//    les crea soles en escriure-hi un valor. Per això donem d'alta un element provisional
//    amb totes les comunitats i l'esborrem tot seguit: les etiquetes hi queden.
const ddCol = (await columnes()).columns
  .find(c => c.type === 'dropdown' && c.title.trim().toLowerCase() === 'comunitats autònomes');

if (!ddCol) {
  console.log('· No s\'ha trobat cap desplegable «Comunitats Autònomes»: crea\'l a Monday i torna a executar.');
} else {
  const jaHi = new Set((JSON.parse(ddCol.settings_str || '{}').labels || []).map(l => l.name));
  const falten = COMUNITATS.filter(c => !jaHi.has(c));
  if (!falten.length) {
    console.log(`· El desplegable «Comunitats Autònomes» ja té les ${COMUNITATS.length} comunitats.`);
  } else {
    const valors = JSON.stringify({ [ddCol.id]: { labels: COMUNITATS } });
    const creat = await gql(
      `mutation($b:ID!,$g:String!,$v:JSON!) {
         create_item(board_id:$b, group_id:$g, item_name:"__alta d'etiquetes__",
                     column_values:$v, create_labels_if_missing:true) { id }
       }`,
      { b: BOARD_ID, g: GROUP_ID, v: valors });
    await gql(`mutation($i:ID!) { delete_item(item_id:$i) { id } }`, { i: creat.create_item.id });
    console.log(`· Afegides ${falten.length} comunitats al desplegable: ${falten.join(', ')}`);
  }
}

const esquema = await llegeixEsquema();
console.log('\nResultat:');
for (const [camp, m] of Object.entries(esquema.mapa)) console.log(`  ${camp.padEnd(12)} → ${m.id} (${m.tipus})`);
if (esquema.falten.length) console.log(`\n⚠ Encara falten columnes: ${esquema.falten.join(', ')}`);
else console.log('\n✓ El tauler està a punt. Arrenca el servidor amb: npm start');
