// Exercise the installer data oracle locally without installing or stopping any service.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync, cpSync, openSync, closeSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
const workspace = resolve(import.meta.dirname, '..');
const dll = resolve(process.argv[2] ?? 'services/platform-api/bin/Release/net10.0/Lifewood.BookPortal.Server.dll');
const root = join(workspace, 'artifacts/installer-lifecycle', randomUUID());
const base = 'http://127.0.0.1:5098';
const probe = createServer();
await new Promise((done, fail) => { probe.once('error', fail); probe.listen(5098, '127.0.0.1', done); });
await new Promise(done => probe.close(done));
mkdirSync(root, {recursive:true});
cpSync(join(workspace,'apps/task-entry-web/dist'), join(root,'web/customer'), {recursive:true});
cpSync(join(workspace,'apps/admin-web/dist'), join(root,'web/admin'), {recursive:true});
let child;
const delay = ms => new Promise(done => setTimeout(done, ms));
async function start() {
  const fd = openSync(join(root, 'server.log'), 'a');
  child = spawn('dotnet', [dll, '--urls='+base, '--Lifewood:DataDirectory='+join(root,'data'),
    '--Lifewood:CoordinationDirectory='+join(root,'coordination'), '--Lifewood:WebRoot='+join(root,'web'),
    '--Lifewood:RequireWebAssets=true'], {cwd:root, env:{...process.env, ASPNETCORE_ENVIRONMENT:'Production'}, windowsHide:true, stdio:['ignore',fd,fd]});
  closeSync(fd);
  child.on('error', error => { throw error; });
  for (let attempt=0; attempt<120; attempt++) {
    assert(child.exitCode === null, 'Fixture server exited: inspect ' + root);
    try { if ((await fetch(base+'/api/health', {signal:AbortSignal.timeout(1000)})).ok) return; } catch {}
    await delay(500);
  }
  throw new Error('Fixture startup timed out');
}
async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exit = once(child, 'exit'); child.kill(); await exit;
  }
  child = null;
}
async function fixture(mode, expected = 0) {
  const command = spawn(process.execPath, [join(workspace,'scripts/installer-fixture.mjs'), mode, base, join(root,'private-state.json')],
    {cwd:workspace, env:{...process.env,LIFEWOOD_INSTALLER_FIXTURE:'1'}, windowsHide:true, stdio:['ignore','pipe','pipe']});
  let output = ''; command.stdout.on('data', data => { output += data; }); command.stderr.on('data', data => { output += data; });
  const [code] = await once(command,'exit');
  if (expected === 0) assert.equal(code, 0, output);
  else { assert.notEqual(code, 0, output); assert.match(output, /Refusing to seed an initialized server/); }
  if (expected === 0) console.log(output.trim());
}
try {
  await start(); await fixture('seed');
  // A second seed must refuse the existing data before creating any new accounts.
  await fixture('seed', 1);
  await fixture('verify'); await stop();
  await start(); await fixture('verify');
  writeFileSync(join(root,'local-result.json'), JSON.stringify({passed:true, scope:'managed process only; no MSI installation', checks:['seed refuses initialized server','business data verified before and after process restart']}, null, 2));
  console.log('Local installer fixture passed: ' + root);
} finally { await stop(); }
