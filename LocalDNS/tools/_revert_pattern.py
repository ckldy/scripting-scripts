P = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/LocalDNS/src/surge-service.ts"
s = open(P, encoding="utf-8").read()

before = s.count("|next|browse|search|get_watch|reel")
s = s.replace("|next|browse|search|get_watch|reel", "|next|reel")
ver_before = s.count("youtube-web.js?v=20261107a")
s = s.replace("youtube-web.js?v=20261107a", "youtube-web.js?v=20261107b")

open(P, "w", encoding="utf-8").write(s)
print("pattern reverted:", before, "| version bumped:", ver_before)
for line in s.splitlines():
    if "builtinYtPattern" in line:
        print(line.strip()[:200])
