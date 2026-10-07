// Tipus compartits entre la web i el que retorna el servidor.

/** Una fila de la taula. `id` és l'identificador de l'element a Monday. */
export interface Prescriptor {
  id: string;
  empresa: string;
  responsable: string;
  estat: string;
  /** Un prescriptor pot cobrir més d'una comunitat. */
  comunitats: string[];
  anotacio: string;
  contacte: string;
  telefon: string;
  correu: string;
  cif: string;
  fee: string;
  acord: string;
  dataVisita: string;
  actualitzat?: string;
  /** Quants updates de Monday té l'element. */
  comentaris?: number;
}

export interface AnaliticaPrescriptor {
  prescriptor: Pick<Prescriptor, 'id' | 'empresa' | 'contacte'>;
  resum: { leads: number; sollicituds: number; conversio: number };
  perSubvencio: { subvencio: string; leads: number; sollicituds: number;
    items: { id: string; empresa: string; data: string; estat: 'lead' | 'sollicitud'; statusExp: string }[] }[];
  serie: { mes: string; leads: number; sollicituds: number }[];
  seriePerSubvencio: Record<string, { mes: string; leads: number; sollicituds: number }[]>;
  registres: { id: string; empresa: string; data: string; subvencio: string; grup: string;
    estat: 'lead' | 'sollicitud'; statusExp?: string }[];
  cobertura: { taulers: number; coincidencies: number };
  cache: { actualitzada: string; actualitzant: boolean; desfasada: boolean };
}

/** Nom de cada camp editable d'un prescriptor. */
export type CampPrescriptor = Exclude<keyof Prescriptor, 'id' | 'actualitzat'>;

/** Valor que pot prendre un camp: text, o llista de comunitats. */
export type ValorCamp = string | string[];

/** Etiqueta d'estat tal com la defineix el tauler de Monday. */
export interface EtiquetaEstat {
  nom: string;
  fons: string;
  ordre: number;
}

/** Resposta de GET /api/esquema. */
export interface Esquema {
  boardId: string;
  nomTauler: string;
  responsables: string[];
  /** Comunitats que s'ofereixen al desplegable. */
  comunitats: string[];
  estats: EtiquetaEstat[];
  falten: string[];
}

export type MenaAvis = 'ok' | 'err';
export type MenaSync = 'neutre' | 'desa' | 'ok' | 'err';

/* ---------- calendari trimestral de subvencions ---------- */

/** Una acció de preparació. A Monday és una subtasca amb data. */
export interface Accio {
  id: string;
  titol: string;
  data: string;
  estat: string;
  responsable: string;
}

/** Una subvenció o iniciativa, amb l'interval de dates previst. */
export interface Subvencio {
  id: string;
  titol: string;
  grupId: string;
  grupTitol: string;
  /** Trimestre 1-4 deduït del nom del grup, o null si el grup no ho diu. */
  trimestre: number | null;
  inici: string;
  fi: string;
  probabilitat: string;
  estat: string;
  comentari: string;
  responsable: string;
  comentaris?: number;
  accions: Accio[];
}

export interface GrupTrimestre {
  id: string;
  titol: string;
  trimestre: number | null;
}

export interface EsquemaCalendari {
  boardId: string;
  nomTauler: string;
  taulerSub: string | null;
  falten: string[];
  grups: GrupTrimestre[];
  probabilitats: EtiquetaEstat[];
  estats: EtiquetaEstat[];
  estatsSub: EtiquetaEstat[];
}

/** Fins on hem baixat al calendari. */
export type NivellCalendari = 'any' | 'trimestre' | 'mes' | 'setmana' | 'dia';

/** Un tram de temps tancat, amb dates ISO incloses totes dues. */
export interface Periode {
  nivell: NivellCalendari;
  etiqueta: string;
  inici: string;
  fi: string;
}

/* ---------- updates: els comentaris de Monday ---------- */

export interface Resposta {
  id: string;
  text: string;
  quan: string;
  autor: string;
}

export interface Update {
  id: string;
  text: string;
  quan: string;
  autor: string;
  foto: string;
  respostes: Resposta[];
}
