#!/usr/bin/env python3
"""Fetch the pinned optional PostgreSQL test engine; no global software installation.
Files are fetched over verified HTTPS and checked against a committed SHA-256 manifest.
Only a dedicated project .cache path is populated. Standard npm installation is preferred
when available; this bootstrap supports hosts whose registry connection is unavailable.
"""
import base64, concurrent.futures, hashlib, json, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
DEST=ROOT/'.cache'/'pglite-0.5.16'
FILES=json.loads((ROOT/'implementation-kit'/'pglite-0.5.16-files.json').read_text())
def valid(path,entry):
    return path.exists() and 'sha256-'+base64.b64encode(hashlib.sha256(path.read_bytes()).digest()).decode()==entry['integrity']
def fetch(entry):
    rel=entry['path'].lstrip('/')
    if '..' in Path(rel).parts:raise ValueError('Invalid manifest path')
    path=DEST/rel;path.parent.mkdir(parents=True,exist_ok=True)
    if valid(path,entry):return
    temp=path.with_name(path.name+'.download')
    subprocess.run(['curl','-fsSL','--connect-timeout','8','--max-time','60','--retry','2',f'https://unpkg.com/@electric-sql/pglite@0.5.16/{rel}','-o',str(temp)],check=True)
    if not valid(temp,entry):raise ValueError('Downloaded file integrity mismatch: '+rel)
    temp.replace(path)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(fetch,FILES))
print(f'Verified optional PGlite engine: {DEST}')
print('Run: node scripts/verify-database.mjs')
