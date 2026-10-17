// FakeIP Pool Allocator (RFC 2544 Range: 198.18.0.0/15)
// Maps domain names to synthetic IP addresses for L7 proxy interception

export class FakeIpPool {
  private static instance: FakeIpPool;

  // 198.18.0.2 ~ 198.19.255.254
  private currentOctet2 = 18;
  private currentOctet3 = 0;
  private currentOctet4 = 2;

  private domainToIp = new Map<string, string>();
  private ipToDomain = new Map<string, string>();

  private constructor() {}

  static get(): FakeIpPool {
    if (!FakeIpPool.instance) {
      FakeIpPool.instance = new FakeIpPool();
    }
    return FakeIpPool.instance;
  }

  /**
   * 为目标域名分配或获取已存在的 FakeIP
   */
  allocate(domain: string): string {
    const d = domain.trim().toLowerCase().replace(/\.$/, '');
    if (this.domainToIp.has(d)) {
      return this.domainToIp.get(d)!;
    }

    const ip = `198.${this.currentOctet2}.${this.currentOctet3}.${this.currentOctet4}`;

    // 递增下一个可用 IP
    this.currentOctet4++;
    if (this.currentOctet4 > 254) {
      this.currentOctet4 = 1;
      this.currentOctet3++;
      if (this.currentOctet3 > 255) {
        this.currentOctet3 = 0;
        this.currentOctet2++;
        if (this.currentOctet2 > 19) {
          // 溢出循环重置回 18.0.2
          this.currentOctet2 = 18;
          this.currentOctet3 = 0;
          this.currentOctet4 = 2;
        }
      }
    }

    // 若当前 IP 已被占用，剔除旧记录
    if (this.ipToDomain.has(ip)) {
      const oldDomain = this.ipToDomain.get(ip)!;
      this.domainToIp.delete(oldDomain);
    }

    this.domainToIp.set(d, ip);
    this.ipToDomain.set(ip, d);
    return ip;
  }

  /**
   * 根据 FakeIP 反查原始域名
   */
  lookup(ip: string): string | undefined {
    return this.ipToDomain.get(ip.trim());
  }

  /**
   * 判断某个 IP 是否属于 FakeIP 地址池 (198.18.0.0/15)
   */
  isFakeIp(ip: string): boolean {
    const parts = ip.trim().split('.');
    if (parts.length !== 4) return false;
    const o1 = parseInt(parts[0], 10);
    const o2 = parseInt(parts[1], 10);
    return o1 === 198 && (o2 === 18 || o2 === 19);
  }

  /**
   * 获取地址池分配统计
   */
  getStats(): { allocated: number; poolRange: string } {
    return {
      allocated: this.domainToIp.size,
      poolRange: '198.18.0.0/15',
    };
  }

  /**
   * 重置地址池
   */
  reset(): void {
    this.domainToIp.clear();
    this.ipToDomain.clear();
    this.currentOctet2 = 18;
    this.currentOctet3 = 0;
    this.currentOctet4 = 2;
  }
}
