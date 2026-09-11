import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
for(const app of ['task-entry-web','admin-web']){
 const root=join('apps',app,'dist');const manifest=JSON.parse(readFileSync(join(root,'.vite','manifest.json'),'utf8'));
 const entry=Object.keys(manifest).find(key=>manifest[key].isEntry);const files=new Set();
 const visit=key=>{const item=manifest[key];if(files.has(item.file))return;files.add(item.file);for(const dependency of item.imports??[])visit(dependency);};visit(entry);
 let bytes=0,gzip=0;for(const file of files){const data=readFileSync(join(root,file));bytes+=data.length;gzip+=gzipSync(data).length;}
 console.log(JSON.stringify({app,initialJavaScriptBytes:bytes,initialGzipBytes:gzip,files:[...files],deferredChunks:Object.values(manifest).filter(item=>item.isDynamicEntry).map(item=>item.file)}));
}
