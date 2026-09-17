"""Apply reviewed UTF-8 byte edits, rejecting drift and verifying every output."""
import hashlib
import json
from pathlib import Path
import sys

root = Path.cwd().resolve()
allowed = {'faculty-access.js', 'firestore.rules', 'index.html', 'tests/faculty-swap-integration.test.js', 'tests/hosting-boundary.test.js', 'tests/runtime-assets.test.js', 'tests/user-management.test.js', 'tools/static-assets.json', 'user-management.html', 'user-management.js'}
expected, entries, prepared = {}, [], {}
for filename in sys.argv[1:]:
    manifest = json.loads(Path(filename).read_text(encoding='utf-8'))
    if manifest['base'] != '86bd5aa2c8a25259f3f708e49b322220ff43a147':
        raise ValueError('Unexpected baseline')
    entries.extend(manifest['files'])
    expected.update(manifest['verify'])
if {item['path'] for item in entries} != allowed or len(entries) != len(allowed):
    raise ValueError('Unexpected or repeated edit target')
for item in entries:
    data = (root / item['path']).read_bytes()
    if hashlib.sha256(data).hexdigest() != item['before']:
        raise ValueError('Source drift: ' + item['path'])
    last = len(data)
    for edit in reversed(item['edits']):
        start, count = edit['start'], edit['delete']
        if not 0 <= start <= start + count <= last:
            raise ValueError('Invalid or overlapping edit')
        data = data[:start] + edit['insert'].encode('utf-8') + data[start + count:]
        last = start
    prepared[item['path']] = data
for name, digest in expected.items():
    target = (root / name).resolve()
    if not target.is_relative_to(root) or target.is_symlink():
        raise ValueError('Unsafe verification path')
    data = prepared[name] if name in prepared else target.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('Output checksum mismatch: ' + name)
if len(expected) != 18 or not allowed.issubset(expected):
    raise ValueError('Incomplete verification manifest')
for name, data in prepared.items():
    (root / name).write_bytes(data)
print('Verified all 18 foundation files; applied 10 tracked-file updates.')
