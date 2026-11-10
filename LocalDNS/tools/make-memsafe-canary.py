from pathlib import Path

src = Path('/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/LocalDNS/web/hub-local-canary.sgmodule')
dst = Path('/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/LocalDNS/web/hub-local-canary-memsafe.sgmodule')

lines = src.read_bytes().splitlines(keepends=True)
out = []
for line in lines:
    if line.startswith(b'#!name='):
        if line.endswith(b'\r\n'):
            eol = b'\r\n'
        elif line.endswith(b'\n'):
            eol = b'\n'
        else:
            eol = b''
        line = b'#!name=LocalDNS Unified Hub LocalCanary MemSafe' + eol
    elif line.startswith(b'youtube.enhance.auto-hd'):
        line = line.replace(b'max-size=8388608', b'max-size=1048576')
    out.append(line)

dst.write_bytes(b''.join(out))
print('lines', len(out))
print('first', repr(out[0]))
print('auto', repr([l for l in out if l.startswith(b'youtube.enhance.auto-hd')][0][:220]))
print('bytes', dst.stat().st_size)
