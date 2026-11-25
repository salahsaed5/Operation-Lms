/**
 * Tiny self-contained XLSX writer using standard uncompressed ZIP entries.
 * No third-party runtime dependencies or CDN requests. Every string is
 * emitted as inlineStr, protecting student names/codes from formula injection.
 */
export interface ExcelCell {
  value?: string | number;
  style?: number;
  formula?: string;
  cached?: number;
}
export interface ExcelSheet {
  name: string;
  rows: ExcelCell[][];
  widths?: number[];
  merges?: string[];
  freeze?: { columns: number; rows: number; topLeft: string };
  autoFilter?: string;
  rightToLeft?: boolean;
  headerRow?: number;
  rowHeights?: Record<number,number>;
}

export const excelCell = (value: string | number, style = 0): ExcelCell => ({ value, style });
export const excelFormula = (formula: string, cached: number, style = 10): ExcelCell =>
  ({ formula, cached, style });

const encoder = new TextEncoder();
const x = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const letter = (column: number): string => {
  let name = '';
  while (column > 0) {
    const mod = (column - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    column = Math.floor((column - 1) / 26);
  }
  return name;
};
const xmlPrefix = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function cellXml(cell: ExcelCell | undefined, column: number, row: number): string {
  if (!cell || (cell.value === undefined && cell.formula === undefined)) return '';
  const ref = letter(column) + row;
  const style = ' s="' + (cell.style || 0) + '"';
  if (cell.formula !== undefined) {
    return '<c r="' + ref + '"' + style + '><f>' + x(cell.formula) +
      '</f><v>' + Number(cell.cached || 0) + '</v></c>';
  }
  if (typeof cell.value === 'number') {
    return '<c r="' + ref + '"' + style + '><v>' + cell.value + '</v></c>';
  }
  const value = String(cell.value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
  return '<c r="' + ref + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">' +
    x(value) + '</t></is></c>';
}
function sheetXml(sh: ExcelSheet): string {
  const frozen = sh.freeze;
  const viewAttrs = ' workbookViewId="0"' + (sh.rightToLeft ? ' rightToLeft="1"' : '');
  const pane = frozen
    ? '<sheetView' + viewAttrs + '><pane xSplit="' + frozen.columns +
      '" ySplit="' + frozen.rows + '" topLeftCell="' + x(frozen.topLeft) +
      '" activePane="'+(frozen.columns&&frozen.rows?'bottomRight':frozen.rows?'bottomLeft':'topRight')+'" state="frozen"/></sheetView>'
    : '<sheetView' + viewAttrs + '/>';
  const widths = (sh.widths || []).map((w,i) => '<col min="' + (i+1) +
    '" max="' + (i+1) + '" width="' + Math.min(50,Math.max(8,w)) +
    '" customWidth="1"/>').join('');
  const columnIndex=(label:string)=>[...label].reduce((n,v)=>n*26+v.charCodeAt(0)-64,0);
  const rowHeight=(cells:ExcelCell[],row:number)=>{
    if(sh.rowHeights?.[row])return sh.rowHeights[row];
    const base=row===1?34:row===(sh.headerRow??4)?34:23;
    let lines=1;
    cells.forEach((cell,i)=>{
      if(typeof cell.value!=='string')return;
      const merge=sh.merges?.find(m=>m.startsWith(letter(i+1)+row+':'));
      const end=merge?.split(':')[1].match(/^([A-Z]+)/)?.[1];
      const effectiveWidth=end?Array.from({length:columnIndex(end)-i},(_,j)=>Math.min(50,Math.max(8,sh.widths?.[i+j]??13))).reduce((n,w)=>n+w,0):Math.min(50,Math.max(8,sh.widths?.[i]??13));
      const chars=Math.max(5,Math.floor(effectiveWidth*.83));
      lines=Math.max(lines,cell.value.split('\n').reduce((n,t)=>n+Math.max(1,Math.ceil([...t].length/chars)),0));
    });
    return Math.min(180,Math.max(base,lines*16+9));
  };
  const data=sh.rows.map((cells,i)=>'<row r="'+(i+1)+'" ht="'+rowHeight(cells,i+1)+'" customHeight="1">'+cells.map((cell,c)=>cellXml(cell,c+1,i+1)).join('')+'</row>').join('');
  const merges = sh.merges?.length
    ? '<mergeCells count="' + sh.merges.length + '">' +
      sh.merges.map(m=>'<mergeCell ref="' + x(m) + '"/>').join('') + '</mergeCells>'
    : '';
  return xmlPrefix + '<worksheet xmlns="' + main + '"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews>' +
    pane + '</sheetViews><sheetFormatPr defaultRowHeight="18"/>' +
    (widths ? '<cols>' + widths + '</cols>' : '') +
    '<sheetData>' + data + '</sheetData>' +
    (sh.autoFilter ? '<autoFilter ref="' + x(sh.autoFilter) + '"/>' : '') + merges +
    '<printOptions horizontalCentered="1"/><pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>' +
    '<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>' +
    '</worksheet>';
}
const solid = (color: string) =>
  '<fill><patternFill patternType="solid"><fgColor rgb="' + color + '"/><bgColor indexed="64"/></patternFill></fill>';
function styleXml(): string {
  const fonts = '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>';
  const fills = '<fills count="9"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' + solid('FF103B4C') +
    solid('FFE5EFF6') + solid('FF14677A') + solid('FFDCEFE5') +
    solid('FFFFF0D8') + solid('FFFBE7EB') + solid('FFF6F7FA') + '</fills>';
  const align = '<alignment horizontal="left" vertical="center" wrapText="1"/>';
  const center = '<alignment horizontal="center" vertical="center" wrapText="1"/>';
  const xf = (font:number,fill:number,fmt=0,alignment=align) =>
    '<xf numFmtId="' + fmt + '" fontId="' + font + '" fillId="' + fill +
    '" borderId="0" applyAlignment="1"' + (fmt===164 ? ' applyNumberFormat="1"' : '') +
    '>' + alignment + '</xf>';
  const xfs = [
    xf(0,0), xf(1,2), xf(0,3), xf(2,4), xf(0,0),
    xf(0,5,0,center), xf(0,6,0,center), xf(0,7,0,center),
    xf(0,8,0,center), xf(0,3,0,center), xf(0,0,0,center),
    xf(0,0,164,center), xf(0,8),
  ].join('');
  return xmlPrefix + '<styleSheet xmlns="' + main + '">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="0%"/></numFmts>' +
    fonts + fills + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="13">' + xfs + '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
}
const u16 = (view: DataView,off:number,val:number)=>view.setUint16(off,val,true);
const u32 = (view: DataView,off:number,val:number)=>view.setUint32(off,val>>>0,true);
function crc32(bytes: Uint8Array): number {
  let crc=0xFFFFFFFF;
  for (const b of bytes) {
    crc ^= b;
    for (let bit=0;bit<8;bit++) crc = (crc>>>1) ^ ((crc&1) ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum,b)=>sum+b.length,0);
  const all=new Uint8Array(size);let offset=0;
  for(const part of parts){all.set(part,offset);offset+=part.length;}
  return all;
}
function zipStore(entries: Array<{name:string;data:string}>): Uint8Array {
  const localParts: Uint8Array[]=[];
  const centralParts: Uint8Array[]=[];
  let position=0;
  for(const entry of entries){
    const filename=encoder.encode(entry.name),data=encoder.encode(entry.data),crc=crc32(data);
    const head=new Uint8Array(30),h=new DataView(head.buffer);
    u32(h,0,0x04034b50);u16(h,4,20);u16(h,6,0x0800);
    u16(h,8,0);u16(h,10,0);u16(h,12,33);
    u32(h,14,crc);u32(h,18,data.length);u32(h,22,data.length);
    u16(h,26,filename.length);u16(h,28,0);
    localParts.push(head,filename,data);
    const cent=new Uint8Array(46),c=new DataView(cent.buffer);
    u32(c,0,0x02014b50);u16(c,4,20);u16(c,6,20);u16(c,8,0x0800);
    u16(c,10,0);u16(c,12,0);u16(c,14,33);
    u32(c,16,crc);u32(c,20,data.length);u32(c,24,data.length);
    u16(c,28,filename.length);u16(c,30,0);u16(c,32,0);
    u16(c,34,0);u16(c,36,0);u32(c,38,0);u32(c,42,position);
    centralParts.push(cent,filename);
    position+=30+filename.length+data.length;
  }
  const central=concat(centralParts);
  const end=new Uint8Array(22),e=new DataView(end.buffer);
  u32(e,0,0x06054b50);u16(e,4,0);u16(e,6,0);
  u16(e,8,entries.length);u16(e,10,entries.length);
  u32(e,12,central.length);u32(e,16,position);u16(e,20,0);
  return concat([...localParts,central,end]);
}
/** Returns a real .xlsx Blob: no external packages and no external network. */
export function createXlsxWorkbook(sheets: ExcelSheet[]): Blob {
  if (!sheets.length || sheets.length > 20) throw new Error('Invalid workbook sheet count');
  const safeNames=new Set<string>();
  for(const sh of sheets){
    if(!sh.name || sh.name.length > 31 || /[\\/?*:[\]]/.test(sh.name) ||
       safeNames.has(sh.name.toLocaleLowerCase())) throw new Error('Invalid or duplicate sheet name');
    safeNames.add(sh.name.toLocaleLowerCase());
  }
  const workbook = xmlPrefix + '<workbook xmlns="' + main +
    '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' + sheets.map((s,i)=>'<sheet name="' + x(s.name) + '" sheetId="' +
      (i+1) + '" r:id="rId' + (i+1) + '"/>').join('') +
    '</sheets><calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1"/></workbook>';
  const relationshipNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const wbRelations = xmlPrefix + '<Relationships xmlns="' + relationshipNs + '">' +
    sheets.map((_,i)=>'<Relationship Id="rId' + (i+1) +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
      (i+1) + '.xml"/>').join('') +
    '<Relationship Id="rId' + (sheets.length+1) +
    '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const types = xmlPrefix +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet' + (i+1) +
      '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
    '</Types>';
  const rootRels=xmlPrefix + '<Relationships xmlns="' + relationshipNs +
    '"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const entries:Array<{name:string;data:string}>=[
    {name:'[Content_Types].xml',data:types},
    {name:'_rels/.rels',data:rootRels},
    {name:'xl/workbook.xml',data:workbook},
    {name:'xl/_rels/workbook.xml.rels',data:wbRelations},
    {name:'xl/styles.xml',data:styleXml()},
    ...sheets.map((sheet,i)=>({name:'xl/worksheets/sheet'+(i+1)+'.xml',data:sheetXml(sheet)})),
  ];
  const bytes=zipStore(entries);
  return new Blob([bytes.buffer as ArrayBuffer],{
    type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
