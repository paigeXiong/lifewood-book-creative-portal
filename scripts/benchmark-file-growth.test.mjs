import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createFileGrowth} from './benchmark-file-growth.mjs';

function fixture() {
  const parent=resolve('artifacts/file-growth-harness-tests');mkdirSync(parent,{recursive:true});
  const root=mkdtempSync(join(parent,'case-')),folder=join(root,'data/uploads/customer/project');mkdirSync(folder,{recursive:true});
  const png=Buffer.from([1,2,3]),file=join(folder,'asset_cover.png');writeFileSync(file,png);
  const asset={id:'asset',categoryId:'book-cover',fileName:'cover.png',contentType:'image/png',sizeBytes:3,url:'/api/projects/project/files/asset'};
  const entry={locale:'zh-CN',draft:{id:'project',book:{sourceAssets:[asset]}},asset};
  const growth=createFileGrowth({root,report:{},png});
  growth.register(entry,0,{sourceCategories:[{id:'supplemental-images',accept:['image/png'],maxBytes:100,maxFiles:8}]});
  growth.coverReady(entry);
  return {growth,entry,file};
}
test('accepts an unchanged attachment manifest and stored content',()=>{
  const {growth,entry}=fixture();growth.verifyMetadata(entry);growth.verifyDisk(entry,'limit-rejected');
});
test('rejects changed metadata even when the attachment count is unchanged',()=>{
  const {growth,entry}=fixture();
  const draft=structuredClone(entry.draft);draft.book.sourceAssets[0].url='/api/projects/project/files/wrong';
  assert.throws(()=>growth.verifyMetadata(entry,draft),/metadata differs/);
});
test('detects same-size corruption immediately after an upload is refused',()=>{
  const {growth,entry,file}=fixture();writeFileSync(file,Buffer.from([4,5,6]));
  assert.throws(()=>growth.verifyDisk(entry,'limit-rejected'),assert.AssertionError);
});
