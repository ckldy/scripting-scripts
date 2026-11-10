from pathlib import Path

src = Path('/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/LocalDNS/web/hub-local-canary-memsafe.sgmodule')
dst = Path('/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/LocalDNS/web/hub-yt-restore-slim.sgmodule')

lines = src.read_text(encoding='utf-8').splitlines()
out = []
removed = []
key_changed = None
for line in lines:
    if line.startswith('#!name='):
        out.append('#!name=LocalDNS Unified Hub YT Restore Slim')
        continue
    if line.startswith('youtube.enhance.log-event'):
        removed.append(line)
        continue
    if line.startswith('youtube.enhance.key'):
        new = line.replace('(?:config|log_event)', '(?:config)')
        new = new.replace('max-size=8388608', 'max-size=1048576')
        key_changed = (line != new)
        out.append(new)
        continue
    out.append(line)

dst.write_text('\n'.join(out) + '\n', encoding='utf-8')
print('src_lines', len(lines))
print('dst_lines', len(out))
print('removed', len(removed))
print('key_changed', key_changed)
print('name', out[0])
