import test from 'node:test';
import assert from 'node:assert/strict';
import { generateEntityCode } from './generateEntityCode';
test('entity code defaults are editable-format random identifiers',()=>{
  for(const p of ['CAMP','INST','GRP','STU','R'] as const){
    const values=Array.from({length:100},()=>generateEntityCode(p));
    assert.ok(values.every(v=>new RegExp('^'+p+'-[0-9A-F]{12}$').test(v)));
    assert.equal(new Set(values).size,100);
  }
});
