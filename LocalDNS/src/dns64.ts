// DNS64 — synthesize AAAA from A using a /96 NAT64 prefix (e.g. 64:ff9b::/96)

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const nums = m.slice(1).map(Number);
  if (nums.some(n => n > 255)) return null;
  return (((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3]) >>> 0;
}

/** Expand an IPv6 literal into 8 16-bit groups (handles "::" compression). */
function expandV6(addr: string): number[] | null {
  const clean = addr.trim().replace(/\/.*$/, '');
  if (!clean.includes(':')) return null;
  const [head, tail] = clean.split('::');
  const headParts = head ? head.split(':').filter(s => s !== '') : [];
  const tailParts = tail !== undefined && tail !== '' ? tail.split(':').filter(s => s !== '') : [];
  const toInt = (s: string) => parseInt(s, 16);
  const nums = [...headParts.map(toInt), ...tailParts.map(toInt)];
  if (nums.some(n => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  if (clean.includes('::')) {
    const missing = 8 - nums.length;
    if (missing < 0) return null;
    const headNums = headParts.map(toInt);
    const tailNums = tailParts.map(toInt);
    const zeros = new Array(missing).fill(0);
    return [...headNums, ...zeros, ...tailNums];
  }
  return nums.length === 8 ? nums : null;
}

/** Only /96 prefixes are supported (the overwhelmingly common NAT64 case). */
export function synthesizeAAAA(ipv4List: string[], prefix = '64:ff9b::/96'): string[] {
  const groups = expandV6(prefix);
  if (!groups) return [];
  const prefixGroups = groups.slice(0, 6); // first 96 bits
  const out: string[] = [];
  for (const v4 of ipv4List) {
    const v = ipv4ToInt(v4);
    if (v === null) continue;
    const g7 = (v >>> 16) & 0xffff;
    const g8 = v & 0xffff;
    const all = [...prefixGroups, g7, g8];
    out.push(all.map(x => x.toString(16)).join(':'));
  }
  return out;
}
