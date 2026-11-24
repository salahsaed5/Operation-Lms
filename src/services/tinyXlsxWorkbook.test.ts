import test from 'node:test';
import assert from 'node:assert/strict';
import { createXlsxWorkbook, excelCell, excelFormula } from './tinyXlsxWorkbook';

function getZipLocalEntries(bytes: Uint8Array): Record<string,string> {
  const result:Record<string,string>={};
  const dataView=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const decoder=new TextDecoder('utf-8');
  let index=0;
  while(index+30<=bytes.length && dataView.getUint32(index,true)===0x04034b50){
    const compression=dataView.getUint16(index+8,true);
    assert.equal(compression,0,'Uncompressed OOXML ZIP entry');
    const size=dataView.getUint32(index+18,true);
    const filenameLength=dataView.getUint16(index+26,true);
    const extraLength=dataView.getUint16(index+28,true);
    const nameStart=index+30;
    const start=nameStart+filenameLength+extraLength;
    const name=decoder.decode(bytes.slice(nameStart,nameStart+filenameLength));
    result[name]=decoder.decode(bytes.slice(start,start+size));
    index=start+size;
  }
  return result;
}

test('creates a real ZIP/XLSX with content types, workbook, relationships and sheets',async()=>{
  const workbook=createXlsxWorkbook([
    {name:'Summary',rows:[[excelCell('Hello',1)]]},
    {name:'Daily Attendance',rows:[[excelCell('Student',3),excelCell('Present',3)]]},
  ]);
  const bytes=new Uint8Array(await workbook.arrayBuffer());
  assert.equal(bytes[0],0x50);
  assert.equal(bytes[1],0x4b);
  const entries=getZipLocalEntries(bytes);
  assert.ok(entries['[Content_Types].xml']);
  assert.ok(entries['_rels/.rels']);
  assert.ok(entries['xl/workbook.xml']);
  assert.ok(entries['xl/_rels/workbook.xml.rels']);
  assert.ok(entries['xl/styles.xml']);
  assert.ok(entries['xl/worksheets/sheet1.xml']);
  assert.ok(entries['xl/worksheets/sheet2.xml']);
  assert.match(entries['xl/workbook.xml'],/Daily Attendance/);
  assert.match(entries['xl/worksheets/sheet2.xml'],/Present/);
});

test('student codes beginning with equals remain inline text, never Excel formulas',async()=>{
  const wb=createXlsxWorkbook([{name:'Safe',rows:[[excelCell('=HYPERLINK("bad", "click")')]]}]);
  const entries=getZipLocalEntries(new Uint8Array(await wb.arrayBuffer()));
  assert.match(entries['xl/worksheets/sheet1.xml'],/t="inlineStr"/);
  assert.doesNotMatch(entries['xl/worksheets/sheet1.xml'],/<f>HYPERLINK/);
});

test('Arabic names roundtrip through UTF-8 stored sheet XML',async()=>{
  const wb=createXlsxWorkbook([{
    name:'Arabic',rows:[[excelCell('أحمد محمد'),excelFormula('COUNTIF(A2:A10,"P")',3)]],
  }]);
  const entries=getZipLocalEntries(new Uint8Array(await wb.arrayBuffer()));
  assert.match(entries['xl/worksheets/sheet1.xml'],/أحمد محمد/);
  assert.match(entries['xl/worksheets/sheet1.xml'],/<f>COUNTIF/);
  assert.match(entries['xl/worksheets/sheet1.xml'],/<v>3<\/v>/);
});

test('workbook rejects malicious or duplicate worksheet names',()=>{
  assert.throws(()=>createXlsxWorkbook([{name:'Bad/Name',rows:[]}]),/sheet name/);
  assert.throws(()=>createXlsxWorkbook([{name:'Sheet',rows:[]},{name:'sheet',rows:[]}]),/sheet name/);
});

test('RTL worksheet places autoFilter before merged cells in OOXML schema order', async()=>{
  const wb=createXlsxWorkbook([{name:'ملخص',rightToLeft:true,rows:[[excelCell('Title')],[excelCell('Name')]],merges:['A1:B1'],autoFilter:'A2:B2'}]);
  const xml=getZipLocalEntries(new Uint8Array(await wb.arrayBuffer()))['xl/worksheets/sheet1.xml'];
  assert.match(xml,/rightToLeft="1"/);
  assert.ok(xml.indexOf('<autoFilter') < xml.indexOf('<mergeCells'));
});
