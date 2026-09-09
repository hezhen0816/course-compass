import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCatalog, initialFilters, resultCsv, catalog } from './search-model.js';
import { official } from './model.js';
const search=(q='',filters={},free=false)=>filterCatalog(q,'全部課程',free,{...initialFilters,...filters},official);
test('exact multi-name search excludes partial names and supports codes otherwise',()=>{
  assert.deepEqual(search('資料庫系統、成本會計',{exact:true}).map(c=>c.name).sort(),['成本會計','資料庫系統']);
  assert.equal(search('資料庫',{exact:true}).length,0);
  assert.equal(search('cs301')[0].name,'資料庫系統');
});
test('period filters match the same meeting as the weekday and include interior periods',()=>{
  assert.equal(search('資料結構',{day:'3',period:'3'}).length,0);
  assert.equal(search('資料結構',{day:'1',period:'4'}).length,1);
});
test('semester, cross-school and unknown capacity remain distinct',()=>{
  assert.equal(search('經濟學').length,0);
  assert.equal(search('經濟學',{cross:true}).length,1);
  assert.equal(search('貨幣',{capacity:'unknown'}).length,1);
  assert.equal(search('貨幣',{capacity:'full'}).length,0);
  assert.ok(search('',{semester:'1141'}).every(c=>c.historical));
  assert.equal(search('',{semester:'1141'},true).length,0);
});
test('export represents filtered rows with semester, unknown seats and escaped formula prefixes',()=>{
  const rows=search('貨幣'); const csv=resultCsv(rows);
  assert.ok(csv.includes('未公告')); assert.ok(csv.includes('1151')); assert.ok(!csv.includes('成本會計'));
  assert.ok(resultCsv([{...catalog[0],name:'=1+1'}]).includes("'=1+1"));
});
