"""Reproduce the local Braces backport from checksum-pinned public sources."""

import gzip
import hashlib
import io
import json
import sys
import tarfile
from http.client import HTTPSConnection
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit


def download(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in {'registry.npmjs.org', 'raw.githubusercontent.com'}:
        raise RuntimeError('Unexpected Braces source URL')
    connection = HTTPSConnection(parsed.hostname, timeout=60)
    try:
        connection.request('GET', parsed.path, headers={'User-Agent': 'Braces security rebuild'})
        response = connection.getresponse()
        if response.status != 200:
            raise RuntimeError(f'Source download returned HTTP {response.status}')
        return response.read()
    finally:
        connection.close()


def read_archive(source):
    files = {}
    with tarfile.open(fileobj=io.BytesIO(source), mode='r:gz') as archive:
        for member in archive:
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or name.parts[0] != 'package':
                raise RuntimeError('Unsafe registry archive path')
            if member.isfile():
                files[str(name)] = archive.extractfile(member).read()
            elif not member.isdir():
                raise RuntimeError('Registry archive contains a non-regular entry')
    return files


def pack_archive(files):
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode='wb', filename='', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as archive:
            for name, payload in sorted(files.items()):
                entry = tarfile.TarInfo(name)
                entry.size = len(payload)
                entry.mode = 0o644
                archive.addfile(entry, io.BytesIO(payload))
    return output.getvalue()


def main():
    vendor = Path(__file__).resolve().parent
    provenance = json.loads((vendor / 'braces-provenance.json').read_text())
    source = download(provenance['registry_url'])
    if hashlib.sha256(source).hexdigest() != provenance['registry_sha256']:
        raise RuntimeError('Original registry archive checksum mismatch')
    files = read_archive(source)
    for name, pin in provenance['files'].items():
        payload = download(pin['url'])
        if hashlib.sha256(payload).hexdigest() != pin['sha256']:
            raise RuntimeError(f'Pinned patch checksum mismatch: {name}')
        files['package/' + name] = payload
    metadata = json.loads(files['package/package.json'])
    metadata['version'] = provenance['local_version']
    files['package/package.json'] = (json.dumps(metadata, indent=2) + '\n').encode()
    artifact = pack_archive(files)
    digest = hashlib.sha256(artifact).hexdigest()
    if digest != provenance['artifact_sha256']:
        raise RuntimeError(f'Backport is not byte reproducible: {digest}')
    target = vendor / ('braces-' + provenance['local_version'] + '.tgz')
    target.write_bytes(artifact)
    sys.stdout.write(f'Verified {target.name}: {digest}\n')


if __name__ == '__main__':
    main()
