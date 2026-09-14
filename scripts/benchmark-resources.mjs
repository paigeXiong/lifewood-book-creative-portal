// Windows-only process counters for the disposable benchmark backend.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {cpus} from 'node:os';

export async function startResourceSampler(pid, root) {
  assert(Number.isInteger(pid) && pid>0);
  const stopPath=join(root,'resource-sampler.stop');
  const report={pid,intervalMs:1000,logicalCpus:cpus().length,samples:[],errors:[],passed:false};
  // Only the known benchmark child is observed; no service or process enumeration.
  const script=`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
$targetProcess=Get-Process -Id ${pid}
$startedTicks=$targetProcess.StartTime.Ticks
$watch=[Diagnostics.Stopwatch]::StartNew()
while(-not (Test-Path -LiteralPath '${stopPath.replaceAll("'","''")}')) {
  $targetProcess.Refresh()
  if($targetProcess.HasExited -or $targetProcess.StartTime.Ticks -ne $startedTicks) { throw 'Benchmark process exited during sampling' }
  @{elapsedMs=$watch.Elapsed.TotalMilliseconds;cpuSeconds=$targetProcess.TotalProcessorTime.TotalSeconds;workingSetBytes=$targetProcess.WorkingSet64;privateBytes=$targetProcess.PrivateMemorySize64;handles=$targetProcess.HandleCount;threads=$targetProcess.Threads.Count} | ConvertTo-Json -Compress
  Start-Sleep -Milliseconds 1000
}`;
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let pending='',readyResolve;
  const ready=new Promise(resolve=>{readyResolve=resolve;});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
    pending+=chunk;
    for(let at;(at=pending.indexOf('\n'))>=0;) {
      const line=pending.slice(0,at).trim();pending=pending.slice(at+1);
      if(!line)continue;
      try {
        const sample=JSON.parse(line);
        for(const key of ['elapsedMs','cpuSeconds','workingSetBytes','privateBytes','handles','threads'])assert(Number.isFinite(sample[key]));
        report.samples.push(sample);readyResolve();
      } catch(error) {report.errors.push(error.message);}
    }
  });
  child.stderr.on('data',text=>report.errors.push(text));
  const exited=new Promise(resolve=>{child.once('error',error=>{report.errors.push(error.message);resolve(-1);readyResolve();});child.once('close',code=>{resolve(code);readyResolve();});});
  let stopped;
  const stop=()=>stopped??=(async()=>{
    writeFileSync(stopPath,'stop');
    const timer=setTimeout(()=>{report.errors.push('Sampler stop timed out');child.kill();},5000);
    const code=await exited;clearTimeout(timer);
    writeFileSync(join(root,'resources.json'),JSON.stringify(report,null,2));
    assert.equal(code,0,'Resource sampler failed');assert.equal(report.errors.length,0,report.errors.join('\n'));
    assert(report.samples.length>=2,'Insufficient resource samples');
    const first=report.samples[0],last=report.samples.at(-1);
    const intervals=report.samples.slice(1).map((sample,index)=>{
      const previous=report.samples[index];
      assert(sample.elapsedMs>previous.elapsedMs && sample.cpuSeconds>=previous.cpuSeconds);
      return (sample.cpuSeconds-previous.cpuSeconds)*100000/(sample.elapsedMs-previous.elapsedMs);
    });
    report.summary={durationSeconds:(last.elapsedMs-first.elapsedMs)/1000,
      averageCpuOneCorePercent:(last.cpuSeconds-first.cpuSeconds)*100000/(last.elapsedMs-first.elapsedMs),
      peakCpuOneCorePercent:Math.max(...intervals),
      firstWorkingSetBytes:first.workingSetBytes,lastWorkingSetBytes:last.workingSetBytes,
      peakWorkingSetBytes:Math.max(...report.samples.map(s=>s.workingSetBytes)),
      firstPrivateBytes:first.privateBytes,lastPrivateBytes:last.privateBytes,
      peakPrivateBytes:Math.max(...report.samples.map(s=>s.privateBytes))};
    report.summary.averageCpuMachinePercent=report.summary.averageCpuOneCorePercent/report.logicalCpus;
    report.passed=true;writeFileSync(join(root,'resources.json'),JSON.stringify(report,null,2));
  })();
  const timer=setTimeout(()=>{report.errors.push('Sampler startup timed out');readyResolve();},10000);
  await ready;clearTimeout(timer);
  if(!report.samples.length || report.errors.length) {try{await stop();}catch{}throw new Error('Resource sampler could not start: '+report.errors.join('; '));}
  return {report,stop};
}
