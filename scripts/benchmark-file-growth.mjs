// Real, bounded attachment growth in the benchmark's disposable data directory.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readdirSync,statSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function createFileGrowth({root,report,send,screenshot,png}) {
  const entries=new Map(),started=performance.now();
  const result=report.fileGrowth={category:'supplemental-images',appendEverySaveIterations:5,projects:[],diskSamples:[],passed:false};
  function files(directory) {
    return readdirSync(directory,{withFileTypes:true}).flatMap(item=>{
      assert(!item.isSymbolicLink(),'Unexpected link in disposable upload directory');
      const path=join(directory,item.name);
      return item.isDirectory()?files(path):[path];
    });
  }
  const assets=entry=>entries.get(entry).retained;
  function verifyMetadata(entry,draft=entry.draft) {
    const fields=items=>items.map(({id,categoryId,fileName,contentType,sizeBytes,url})=>({id,categoryId,fileName,contentType,sizeBytes,url})).sort((a,b)=>a.id.localeCompare(b.id));
    assert.deepEqual(fields(draft.book.sourceAssets),fields(assets(entry)),'Stored attachment metadata differs from the expected manifest');
  }
  function verifyDisk(entry,label) {
    const manifest=assets(entry),id=entry.draft.id;
    const paths=files(join(root,'data/uploads')).filter(path=>path.replaceAll('\\','/').includes('/'+id+'/'));
    assert.equal(paths.length,manifest.length,'Unexpected staged, duplicate or orphan files in project folder');
    let bytes=0;
    for(const asset of manifest) {
      const path=paths.find(path=>path.endsWith('/'+asset.id+'_'+asset.fileName)||path.endsWith('\\'+asset.id+'_'+asset.fileName));
      assert(path,'Missing expected stored file');
      assert.equal(statSync(path).size,asset.sizeBytes);bytes+=asset.sizeBytes;
      if(label==='durability'||label==='limit-rejected')assert.equal(hash(readFileSync(path)),asset.sha256);
    }
    result.diskSamples.push({projectId:id,label,elapsedMs:Math.round(performance.now()-started),files:paths.length,bytes});
  }
  const request=(entry,operation,path,method,body,expected=[200])=>send(operation,entry.client,path,method,body,expected,entry.locale);
  function payload(entry,version,id,bytes,name) {
    const form=new FormData();form.set('version',String(version));form.set('categoryId',result.category);form.set('uploadId',id);
    form.set('file',new Blob([bytes],{type:'image/png'}),name);return form;
  }
  async function appendNext(entry) {
    const state=entries.get(entry);
    if(state.retained.length-1>=state.limit)return;
    const ordinal=++state.created,bytes=screenshot((state.index+1)*100000+ordinal),sha256=hash(bytes);
    const name=(entry.locale==='zh-CN'?'补充图片-':'supplement-')+ordinal+'.png';
    const version=entry.draft.version,id=randomUUID(),path=entry.path+'/files?categoryId='+result.category;
    const uploaded=(await request(entry,'new-file-upload',path,'POST',payload(entry,version,id,bytes,name))).data;
    assert.equal(uploaded.draft.version,version+1);entry.draft=uploaded.draft;
    assert.equal(uploaded.asset.sizeBytes,bytes.length);
    state.retained.push({...uploaded.asset,sha256});state.allHashes.push(sha256);
    verifyMetadata(entry);
    const replay=(await request(entry,'new-file-replay',path,'POST',payload(entry,version,id,bytes,name))).data;
    assert.equal(replay.asset.id,uploaded.asset.id);assert.equal(replay.draft.version,entry.draft.version);
    assert.equal(replay.draft.book.sourceAssets.length,state.retained.length);
    verifyMetadata(entry,replay.draft);
    state.replays++;verifyDisk(entry,'append-and-replay');
  }
  return {
    register(entry,index,options) {
      const category=options.sourceCategories.find(item=>item.id===result.category);
      assert(category?.accept.includes('image/png') && category.maxBytes>=png.length && category.maxFiles===8,'Revisit fixture when default category rules change');
      const state={projectId:entry.draft.id,locale:entry.locale,index,limit:category.maxFiles,created:0,replays:0,retained:[],removed:[],allHashes:[]};
      entries.set(entry,state);result.projects.push(state);
    },
    coverReady(entry) {assets(entry).push({...entry.asset,sha256:hash(png)});verifyMetadata(entry);verifyDisk(entry,'initial-cover');},
    assets,appendNext,verifyDisk,verifyMetadata,
    async verifyLimitAndReplace(entry) {
      const state=entries.get(entry);assert.equal(state.retained.length,state.limit+1,'Growth run did not reach the configured category limit');
      const version=entry.draft.version;
      // GET includes derived workflow metadata that write responses need not contain.
      // Compare the same read endpoint before/after, without ignoring any returned fields.
      const before=(await request(entry,'before-file-limit',entry.path)).data;
      assert.equal(before.version,version);verifyMetadata(entry,before);
      const denied=(await request(entry,'file-count-limit',entry.path+'/files?categoryId='+result.category,'POST',payload(entry,version,randomUUID(),png,'over-limit.png'),[400])).data;
      const error=denied.error??denied;
      assert((error.fields??error.fieldErrors).some(field=>field.code==='too_many'));
      assert.deepEqual((await request(entry,'after-file-limit',entry.path)).data,before);
      verifyDisk(entry,'limit-rejected');
      // Remove two unsubmitted attachments, then use the freed capacity for different bytes.
      for(const asset of state.retained.slice(1,3)) {
        const previous=entry.draft.version;
        entry.draft=(await request(entry,'delete-grown-file',entry.path+'/files/'+asset.id+'?version='+previous,'DELETE')).data;
        assert.equal(entry.draft.version,previous+1);
        state.retained=state.retained.filter(item=>item.id!==asset.id);state.removed.push(asset.id);
        verifyMetadata(entry);
        const response=await entry.client.raw(asset.url,{headers:{'Accept-Language':entry.locale}});assert.equal(response.status,404);await response.arrayBuffer();
        verifyDisk(entry,'deleted');
      }
      await appendNext(entry);await appendNext(entry);
      assert.equal(new Set(state.allHashes).size,state.created,'Growth fixtures must have distinct contents');
    },
    finish() {
      for(const state of entries.values())assert(state.created===state.limit+2 && state.replays===state.created && state.removed.length===2);
      result.expectedFiles=[...entries.values()].reduce((sum,state)=>sum+state.retained.length,0);
      result.expectedBytes=[...entries.values()].flatMap(state=>state.retained).reduce((sum,asset)=>sum+asset.sizeBytes,0);
      assert.equal(new Set([...entries.values()].flatMap(state=>state.retained.map(asset=>asset.id))).size,result.expectedFiles);
      assert.equal(new Set([...entries.values()].flatMap(state=>state.allHashes)).size,[...entries.values()].reduce((sum,state)=>sum+state.created,0));
      result.passed=true;
    },
  };
}
