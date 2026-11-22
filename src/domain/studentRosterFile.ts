/**
 * Browser-only roster import for Excel .xlsx and UTF-8 .csv files.
 * Does NOT upload the raw workbook: only validated row data is handed to
 * the existing authenticated, atomic student batch RPC after Admin confirms.
 *
 * Small, deliberately restricted OpenXML reader: first worksheet only,
 * plain cell values (never formulas/macros), ZIP entry + expanded byte caps.
 */
import type { RawStudentImportRow } from './businessRules';

export const MAX_ROSTER_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ROSTER_ROWS = 1000;
const MAX_XML_BYTES = 4 * 1024 * 1024;

type Cell = string;
type GridRow = { physicalRow: number; cells: Cell[] };
type Entry = { method: number; compressed: number; expanded: number; offset: number };

function studentHeaderName(v: string): 'studentName' | 'studentCode' | 'university' | null {
  const key = v.trim().toLowerCase().replace(/[\s_\-()]/g, '');
  if (['fullname','studentname','name','اسم','اسمالطالب','الاسمالكامل','الاسمالثلاثي'].includes(key)) return 'studentName';
  if (['studentcode','code','studentid','id','كودالطالب','كود','رقمالطالب'].includes(key)) return 'studentCode';
  if (['university','universityname','college','الجامعة','جامعة','الكلية'].includes(key)) return 'university';
  return null;
}

export function mapRosterGridToRows(grid: GridRow[]): RawStudentImportRow[] {
  const populated = grid.filter(r => r.cells.some(c => c.trim()));
  if (!populated.length) throw new Error('The selected roster file is empty.');
  const first = populated[0];
  const fields = first.cells.map(studentHeaderName);
  const headerPresent = fields.includes('studentName') || fields.includes('studentCode') || fields.includes('university');
  let nameCol = 0;
  let codeCol = 1;
  let universityCol = 2;
  if (headerPresent) {
    nameCol = fields.indexOf('studentName');
    codeCol = fields.indexOf('studentCode');
    universityCol = fields.indexOf('university');
    if (nameCol < 0 || codeCol < 0) {
      throw new Error('Excel header must include Full Name and Student Code (or their Arabic equivalents).');
    }
  }
  const input = headerPresent ? populated.slice(1) : populated;
  if (!input.length) throw new Error('The roster contains headings but no students.');
  if (input.length > MAX_ROSTER_ROWS) {
    throw new Error(`A roster may contain at most ${MAX_ROSTER_ROWS} students.`);
  }
  return input.map(r => ({
    rowNumber: r.physicalRow,
    studentName: (r.cells[nameCol] || '').trim(),
    studentCode: (r.cells[codeCol] || '').trim(),
    university: universityCol >= 0 ? (r.cells[universityCol] || '').trim() : '',
  }));
}

function parseCsv(text: string): GridRow[] {
  const raw = text.replace(/^\uFEFF/, '');
  const firstLine = raw.split(/\r?\n/, 1)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows: GridRow[] = [];
  let values: string[] = [];
  let value = '';
  let quoted = false;
  let rowNumber = 1;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (c === '"') {
      if (quoted && raw[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      values.push(value); value = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && raw[i + 1] === '\n') i++;
      values.push(value); value = '';
      rows.push({ physicalRow: rowNumber, cells: values });
      values = [];
      rowNumber++;
    } else {
      value += c;
    }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  if (values.length || value) rows.push({ physicalRow: rowNumber, cells: [...values, value] });
  return rows;
}

function parseXml(xml: string, fileName: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error(`Invalid Excel XML in ${fileName}.`);
  }
  return doc;
}
function nodes(parent: Element | Document, name: string): Element[] {
  return [...parent.getElementsByTagNameNS('*', name)];
}
function xmlString(parent: Element): string {
  return nodes(parent, 't').map(n => n.textContent || '').join('') || parent.textContent || '';
}
function columnIndex(reference: string): number {
  const match = /^([A-Z]+)/i.exec(reference);
  if (!match) return -1;
  let index = 0;
  for (const c of match[1].toUpperCase()) index = index * 26 + c.charCodeAt(0) - 64;
  return index - 1;
}

async function readXlsxGrid(file: File): Promise<GridRow[]> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const u16 = (n: number) => dv.getUint16(n, true);
  const u32 = (n: number) => dv.getUint32(n, true);
  // ZIP End-of-Central-Directory lives within the last 65,557 bytes.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) <= bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Invalid Excel .xlsx file (ZIP index not found).');
  const count = u16(end + 10);
  const cdOffset = u32(end + 16);
  if (count === 0 || count > 500 || cdOffset >= bytes.length) {
    throw new Error('Excel file contains an unsupported or oversized ZIP archive.');
  }
  const entries = new Map<string, Entry>();
  let at = cdOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || u32(at) !== 0x02014b50) throw new Error('Excel ZIP directory is corrupt.');
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const compressed = u32(at + 20);
    const expanded = u32(at + 24);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    const commentLength = u16(at + 32);
    const offset = u32(at + 42);
    if ((flags & 1) || compressed === 0xffffffff || expanded === 0xffffffff || offset === 0xffffffff) {
      throw new Error('Encrypted / ZIP64 Excel workbooks are not supported.');
    }
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (name.includes('..') || name.startsWith('/')) throw new Error('Unsafe Excel ZIP entry.');
    if (entries.has(name)) throw new Error('Duplicate Excel ZIP entry.');
    entries.set(name, { method, compressed, expanded, offset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  const readEntry = async (name: string): Promise<string> => {
    const e = entries.get(name);
    if (!e) throw new Error(`Excel workbook is missing ${name}.`);
    if (e.expanded > MAX_XML_BYTES) throw new Error('Excel worksheet is too large for roster import.');
    if (e.offset + 30 > bytes.length || u32(e.offset) !== 0x04034b50) throw new Error('Invalid Excel ZIP entry.');
    const start = e.offset + 30 + u16(e.offset + 26) + u16(e.offset + 28);
    if (start + e.compressed > bytes.length) throw new Error('Truncated Excel ZIP entry.');
    const compressed = bytes.slice(start, start + e.compressed);
    let expanded: Uint8Array;
    if (e.method === 0) expanded = compressed;
    else if (e.method === 8) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('Your browser does not support Excel unzip. Use Chrome or upload a CSV.');
      }
      // Chromium's deflate-raw decompressor for Excel ZIP entries.
      const stream = new Blob([compressed.buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      expanded = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error('Unsupported Excel compression format.');
    if (expanded.length !== e.expanded || expanded.length > MAX_XML_BYTES) {
      throw new Error('Excel ZIP content size mismatch.');
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(expanded);
  };
  const workbook = parseXml(await readEntry('xl/workbook.xml'), 'workbook');
  const firstSheet = nodes(workbook, 'sheet')[0];
  if (!firstSheet) throw new Error('Excel workbook has no worksheet.');
  const relId = firstSheet.getAttribute('r:id') || firstSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const relDoc = parseXml(await readEntry('xl/_rels/workbook.xml.rels'), 'workbook relationships');
  const rel = nodes(relDoc, 'Relationship').find(x => x.getAttribute('Id') === relId);
  if (!rel) throw new Error('Excel first-sheet relationship was not found.');
  const rawTarget = rel.getAttribute('Target') || '';
  if (rel.getAttribute('TargetMode') === 'External') throw new Error('External Excel worksheet links are not supported.');
  const target = rawTarget.startsWith('/') ? rawTarget.slice(1) : `xl/${rawTarget}`;
  const parts: string[] = [];
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  const sheetPath = parts.join('/');
  if (!sheetPath.startsWith('xl/worksheets/') || !sheetPath.endsWith('.xml')) {
    throw new Error('Excel worksheet path is invalid.');
  }
  const shared: string[] = [];
  if (entries.has('xl/sharedStrings.xml')) {
    const sharedDoc = parseXml(await readEntry('xl/sharedStrings.xml'), 'shared strings');
    for (const si of nodes(sharedDoc, 'si')) shared.push(xmlString(si));
  }
  const sheet = parseXml(await readEntry(sheetPath), 'worksheet');
  const grid: GridRow[] = [];
  let sequential = 1;
  for (const row of nodes(sheet, 'row')) {
    const physicalRow = Number(row.getAttribute('r')) || sequential;
    sequential = physicalRow + 1;
    const cells: string[] = [];
    let nextCol = 0;
    for (const cell of nodes(row, 'c')) {
      const index = columnIndex(cell.getAttribute('r') || '');
      const col = index >= 0 ? index : nextCol;
      nextCol = col + 1;
      if (col > 50) throw new Error('Student import supports columns A through AY only.');
      const type = cell.getAttribute('t');
      const v = nodes(cell, 'v')[0]?.textContent || '';
      let value = type === 's' ? shared[Number(v)] || '' :
                  type === 'inlineStr' ? xmlString(nodes(cell, 'is')[0] || cell) :
                  v;
      // Formula results may be cached in Excel but must not be used as identities.
      if (nodes(cell, 'f').length > 0) {
        throw new Error(`Excel row ${physicalRow} contains a formula; paste values before importing.`);
      }
      cells[col] = String(value || '').trim();
    }
    if (cells.some(v => v && v.trim())) grid.push({ physicalRow, cells });
    if (grid.length > MAX_ROSTER_ROWS + 1) throw new Error('Excel roster has too many rows.');
  }
  return grid;
}

export async function parseStudentRosterFile(file: File): Promise<RawStudentImportRow[]> {
  if (file.size === 0 || file.size > MAX_ROSTER_FILE_BYTES) {
    throw new Error('Choose a nonempty Excel / CSV file smaller than 2 MB.');
  }
  const name = file.name.toLowerCase();
  const grid = name.endsWith('.xlsx') ? await readXlsxGrid(file) :
               name.endsWith('.csv') ? parseCsv(await file.text()) :
               null;
  if (!grid) throw new Error('Only .xlsx and .csv roster files are supported.');
  return mapRosterGridToRows(grid);
}
