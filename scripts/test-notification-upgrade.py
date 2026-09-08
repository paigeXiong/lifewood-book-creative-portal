"""Verify a real pre-notification server upgrade using disposable data.
Usage: python scripts/test-notification-upgrade.py --old-server PATH --new-server PATH
Accepts .NET server DLLs or Windows Native AOT executables. Never uses production data.
"""
import argparse, base64, hashlib, http.cookiejar, json, os, sqlite3, socket, struct, subprocess, time, urllib.request, urllib.error, uuid
from pathlib import Path

args = argparse.ArgumentParser()
args.add_argument('--old-server', required=True)
args.add_argument('--new-server', required=True)
args.add_argument('--port', type=int, default=5096)
a = args.parse_args()
root = Path(__file__).resolve().parents[1]
run = root / 'artifacts' / 'upgrade-check' / uuid.uuid4().hex
run.mkdir(parents=True)
data = run / 'data'
base = f'http://127.0.0.1:{a.port}'
process = None
log = None

def start(server):
    global process, log
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", a.port))
    path = Path(server).resolve(strict=True)
    env = dict(os.environ, ASPNETCORE_URLS=base, ASPNETCORE_ENVIRONMENT='Production', Lifewood__DataDirectory=str(data), Lifewood__RequireWebAssets='false')
    log = (run / (str(time.time_ns()) + '.log')).open('wb')
    process = subprocess.Popen((['dotnet', str(path)] if path.suffix == '.dll' else [str(path)]), cwd=path.parent, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    for _ in range(120):
        if process.poll() is not None: raise RuntimeError('Server exited; inspect ' + str(run))
        try:
            if json.load(urllib.request.urlopen(base+'/api/health', timeout=1))['status'] == 'ok': return
        except (OSError, ValueError): time.sleep(.25)
    raise RuntimeError('Server startup timeout')

def stop():
    global process
    if process is not None:
        process.terminate()
        try: process.wait(timeout=15)
        except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
        process = None
    if log: log.close()

class Client:
    def __init__(self): self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())); self.csrf=None
    def call(self, method, path, payload=None, raw=None, content_type=None):
        headers={'Accept-Language':'en-US'}
        if method!='GET':
            if not self.csrf: self.csrf=self.call('GET','/api/auth/csrf')['token']
            headers['X-CSRF-TOKEN']=self.csrf
        body=json.dumps(payload).encode() if payload is not None else raw
        if body is not None: headers['Content-Type']=content_type or 'application/json'
        try:
            with self.http.open(urllib.request.Request(base+path,body,headers,method=method),timeout=20) as response:
                content=response.read()
                return json.loads(content) if 'application/json' in response.headers.get('Content-Type','') else content
        except urllib.error.HTTPError as e: raise RuntimeError(f'{method} {path}: {e.code}: {e.read().decode()}') from e
    def upload(self,path,name,mime,content,fields=None):
        boundary=uuid.uuid4().hex; parts=[]
        for key,value in (fields or {}).items(): parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
        parts += [f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n'.encode(),content,f'\r\n--{boundary}--\r\n'.encode()]
        return self.call('POST',path,raw=b''.join(parts),content_type='multipart/form-data; boundary='+boundary)

def rows():
    with sqlite3.connect(data/'platform.db') as db:
        tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'notification_%' AND name!='notifications'")]
        return {t:sorted(db.execute('SELECT * FROM "'+t+'"').fetchall(),key=repr) for t in tables}

def files():
    return {str(p.relative_to(data)):hashlib.sha256(p.read_bytes()).hexdigest() for p in data.rglob('*') if p.is_file() and p.name not in ('platform.db','platform.db-wal','platform.db-shm','platform.lock')}

def box(kind,*payload):
    body=b''.join(payload); return struct.pack('>I',len(body)+8)+kind.encode()+body

def prepared_project(c):
    d=c.call('POST','/api/projects',{}); route='/api/projects/'+d['id']; options=c.call('GET','/api/form-options')
    d['project'].update(clientName='Upgrade owner',contactName='Owner',email='upgrade@example.test',projectName='Upgrade project',videoGoalId=options['videoGoals'][0]['id'],audienceIds=[options['audiences'][0]['id']])
    d['book'].update(title='Upgrade book',authorName='Author',genreId=options['genres'][0]['id'],contentLanguageId=options['contentLanguages'][0]['id'],videoDurationId=options['videoDurations'][0]['id'])
    c.call('PUT',route+'/draft',dict(version=d['version'],project=d['project'],book=d['book'])); d=c.call('GET',route)
    png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
    c.upload(route+'/files?categoryId=book-cover','cover.png','image/png',png,dict(version=d['version'],categoryId='book-cover')); d=c.call('GET',route)
    d['creative']['visualStyleId']=options['visualStyles'][0]['id']; c.call('PUT',route+'/creative',dict(version=d['version'],creative=d['creative']));d=c.call('GET',route)
    d['voiceAndReferences']['voiceover']['narrationEnabled']=False;d['voiceAndReferences']['creativeDirection']['coreMessage']='Upgrade preservation'
    c.call('PUT',route+'/voice-and-references',dict(version=d['version'],voiceAndReferences=d['voiceAndReferences']));return c.call('GET',route)

def submit(c,d):
    return c.call('POST','/api/projects/'+d['id']+'/submit',dict(version=d['version'],idempotencyKey=uuid.uuid4().hex))

try:
    start(a.old_server)
    owner=Client(); password='Upgrade!'+uuid.uuid4().hex
    owner.call('POST','/api/auth/bootstrap',dict(displayName='Upgrade Owner',email='upgrade@example.test',password=password));owner.csrf=None
    owner.call('POST','/api/admin/users',dict(displayName='Upgrade Admin',email='admin-upgrade@example.test',password=password,role='admin'))
    admin=Client();admin.call('POST','/api/auth/login',dict(email='admin-upgrade@example.test',password=password));admin.csrf=None
    published=prepared_project(owner);submit(owner,published)
    ftyp=box('ftyp',b'isom',bytes(4),b'isom');mdat=box('mdat',b'\1');hdlr=box('hdlr',bytes(8),b'vide')
    stbl=box('stbl',box('stsd',bytes(4),struct.pack('>I',1),box('avc1')),box('stsz',bytes(4),struct.pack('>I',1),struct.pack('>I',1)))
    video=ftyp+mdat+box('moov',box('trak',box('mdia',hdlr,box('minf',stbl))))
    delivery=owner.upload('/api/admin/projects/'+published['id']+'/deliveries','final.mp4','video/mp4',video)
    draft=prepared_project(owner)
    notice_id=uuid.uuid4().hex
    notice=owner.call('PUT','/api/admin/announcements/'+notice_id,dict(titleZh='升级前公告',bodyZh='保留正文',titleEn='Legacy notice',bodyEn='Preserved body',placement='personal',audience='all',languages=[],organizationIds=[],startsAt=None,endsAt='2099-01-01T00:00:00Z'))
    owner.call('POST','/api/admin/announcements/'+notice_id+'/publish',dict(version=notice['version']))
    owner.call('POST','/api/announcements/'+notice_id+'/dismiss')
    stop()
    # Establish the old version's own restart normalization before comparing the upgrade.
    start(a.old_server);stop();before=rows();hashes=files(); assert hashes
    for restart in range(2):
        start(a.new_server)
        after=rows()
        assert all(after.get(t)==records for t,records in before.items()), 'Existing tables changed: '+repr([t for t,records in before.items() if after.get(t)!=records])
        assert files()==hashes,'Existing files or encryption keys changed'
        assert owner.call('GET','/api/projects/'+published['id'])['status']=='submitted'
        assert owner.call('GET','/api/projects/'+published['id']+'/deliveries/'+delivery['id']+'/file')==video
        assert owner.call('GET','/api/announcements')['items'][0]['title']=='Legacy notice'
        assert owner.call('GET','/api/announcements?unread=true')['items']==[]
        assert admin.call('GET','/api/notifications')['items']==[],'Old business events were replayed'
        if restart==0: stop()
    submit(owner,draft)
    for _ in range(40):
        notices=admin.call('GET','/api/notifications')['items']
        if notices: break
        time.sleep(.25)
    assert len(notices)==1 and notices[0]['kind']=='submitted' and notices[0]['projectId']==draft['id']
    print('PASS: v0.3.9 records, attachments, final delivery, keys, legacy announcements and dismissal preserved across two starts; no historical backfill; new submission delivered once.')
    (run/'result.txt').write_text('PASS\n',encoding='utf-8')
    print('Evidence: '+str(run))
finally: stop()
