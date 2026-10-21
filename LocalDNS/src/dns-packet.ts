import type { DnsPacket, DnsQuestion, DnsRecord } from './types';

export const DNS_TYPES: Record<number, string> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  12: 'PTR',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV',
  65: 'HTTPS',
  255: 'ANY',
};

export const DNS_TYPE_IDS: Record<string, number> = Object.fromEntries(
  Object.entries(DNS_TYPES).map(([k, v]) => [v, Number(k)])
);

export const DNS_RCODES: Record<number, string> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
  9: 'NOTAUTH',
};

export class DnsParser {
  private view: DataView;
  private offset = 0;

  constructor(private buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  parse(): DnsPacket {
    this.offset = 0;
    const id = this.readUint16();
    const flags = this.readUint16();

    const qr = (flags & 0x8000) !== 0;
    const opcode = (flags >> 11) & 0x0f;
    const aa = (flags & 0x0400) !== 0;
    const tc = (flags & 0x0200) !== 0;
    const rd = (flags & 0x0100) !== 0;
    const ra = (flags & 0x0080) !== 0;
    const rcode = flags & 0x000f;

    const qdcount = this.readUint16();
    const ancount = this.readUint16();
    const nscount = this.readUint16();
    const arcount = this.readUint16();

    const questions: DnsQuestion[] = [];
    for (let i = 0; i < qdcount; i++) {
      const name = this.readName();
      const type = this.readUint16();
      const qclass = this.readUint16();
      questions.push({
        name,
        type,
        typeName: DNS_TYPES[type] || `TYPE${type}`,
        class: qclass,
      });
    }

    const answers = this.readRecords(ancount);
    const authorities = this.readRecords(nscount);
    const additionals = this.readRecords(arcount);

    return {
      id,
      flags,
      qr,
      opcode,
      aa,
      tc,
      rd,
      ra,
      rcode,
      rcodeName: DNS_RCODES[rcode] || `RCODE${rcode}`,
      questions,
      answers,
      authorities,
      additionals,
    };
  }

  private readUint8(): number {
    const val = this.view.getUint8(this.offset);
    this.offset += 1;
    return val;
  }

  private readUint16(): number {
    const val = this.view.getUint16(this.offset);
    this.offset += 2;
    return val;
  }

  private readUint32(): number {
    const val = this.view.getUint32(this.offset);
    this.offset += 4;
    return val;
  }

  private readBytes(length: number): Uint8Array {
    const slice = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  private readName(seenPointers = new Set<number>()): string {
    const labels: string[] = [];
    while (this.offset < this.buffer.length) {
      const len = this.readUint8();
      if (len === 0) break;

      // Pointer (11xxxxxx)
      if ((len & 0xc0) === 0xc0) {
        const b2 = this.readUint8();
        const ptr = ((len & 0x3f) << 8) | b2;
        if (seenPointers.has(ptr)) {
          labels.push('cycle');
          break;
        }
        seenPointers.add(ptr);
        const savedOffset = this.offset;
        this.offset = ptr;
        const targetName = this.readName(seenPointers);
        this.offset = savedOffset;
        labels.push(targetName);
        break;
      }

      // Normal label
      const bytes = this.readBytes(len);
      let label = '';
      for (let i = 0; i < bytes.length; i++) {
        label += String.fromCharCode(bytes[i]);
      }
      labels.push(label);
    }
    return labels.join('.').toLowerCase();
  }

  private readRecords(count: number): DnsRecord[] {
    const records: DnsRecord[] = [];
    for (let i = 0; i < count; i++) {
      if (this.offset >= this.buffer.length) break;
      const name = this.readName();
      const type = this.readUint16();
      const rclass = this.readUint16();
      const ttl = this.readUint32();
      const rdlength = this.readUint16();
      const dataOffset = this.offset;

      let data: string | Uint8Array;
      if (type === 1 && rdlength === 4) {
        // IPv4
        const a = this.readUint8();
        const b = this.readUint8();
        const c = this.readUint8();
        const d = this.readUint8();
        data = `${a}.${b}.${c}.${d}`;
      } else if (type === 28 && rdlength === 16) {
        // IPv6
        const parts: string[] = [];
        for (let j = 0; j < 8; j++) {
          parts.push(this.readUint16().toString(16));
        }
        data = parts.join(':');
      } else if (type === 5 || type === 12 || type === 2) {
        // CNAME, PTR, NS
        data = this.readName();
      } else if (type === 16) {
        // TXT
        let txt = '';
        let readLen = 0;
        while (readLen < rdlength && this.offset < this.buffer.length) {
          const tlen = this.readUint8();
          readLen++;
          const tbytes = this.readBytes(Math.min(tlen, rdlength - readLen));
          readLen += tbytes.length;
          txt += new TextDecoder('utf-8').decode(tbytes);
        }
        data = txt;
      } else {
        data = this.readBytes(rdlength);
      }

      // Ensure offset matches end of rdata
      this.offset = dataOffset + rdlength;

      records.push({
        name,
        type,
        typeName: DNS_TYPES[type] || `TYPE${type}`,
        class: rclass,
        ttl,
        data,
      });
    }
    return records;
  }
}

export class DnsSerializer {
  private chunks: Uint8Array[] = [];
  private totalLength = 0;

  private pushUint8(val: number): void {
    const buf = new Uint8Array(1);
    buf[0] = val & 0xff;
    this.chunks.push(buf);
    this.totalLength += 1;
  }

  private pushUint16(val: number): void {
    const buf = new Uint8Array(2);
    const view = new DataView(buf.buffer);
    view.setUint16(0, val & 0xffff);
    this.chunks.push(buf);
    this.totalLength += 2;
  }

  private pushUint32(val: number): void {
    const buf = new Uint8Array(4);
    const view = new DataView(buf.buffer);
    view.setUint32(0, val >>> 0);
    this.chunks.push(buf);
    this.totalLength += 4;
  }

  private pushBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.totalLength += bytes.length;
  }

  private pushName(name: string): void {
    const clean = name.replace(/\.$/, '');
    if (!clean) {
      this.pushUint8(0);
      return;
    }
    const parts = clean.split('.');
    for (const part of parts) {
      const bytes = new TextEncoder().encode(part);
      this.pushUint8(bytes.length);
      this.pushBytes(bytes);
    }
    this.pushUint8(0);
  }

  serialize(packet: DnsPacket): Uint8Array {
    this.chunks = [];
    this.totalLength = 0;

    // Header
    this.pushUint16(packet.id);

    let flags = 0;
    if (packet.qr) flags |= 0x8000;
    flags |= (packet.opcode & 0x0f) << 11;
    if (packet.aa) flags |= 0x0400;
    if (packet.tc) flags |= 0x0200;
    if (packet.rd) flags |= 0x0100;
    if (packet.ra) flags |= 0x0080;
    flags |= packet.rcode & 0x0f;

    this.pushUint16(flags);
    this.pushUint16(packet.questions.length);
    this.pushUint16(packet.answers.length);
    this.pushUint16(packet.authorities.length);
    this.pushUint16(packet.additionals.length);

    // Questions
    for (const q of packet.questions) {
      this.pushName(q.name);
      this.pushUint16(q.type);
      this.pushUint16(q.class);
    }

    // Answers
    this.writeRecords(packet.answers);
    // Authorities
    this.writeRecords(packet.authorities);
    // Additionals
    this.writeRecords(packet.additionals);

    // Combine chunks
    const result = new Uint8Array(this.totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  private writeRecords(records: DnsRecord[]): void {
    for (const rec of records) {
      this.pushName(rec.name);
      this.pushUint16(rec.type);
      this.pushUint16(rec.class);
      this.pushUint32(rec.ttl);

      if (typeof rec.data === 'string') {
        if (rec.type === 1) {
          // IPv4
          const nums = rec.data.split('.').map(Number);
          this.pushUint16(4);
          for (let i = 0; i < 4; i++) this.pushUint8(nums[i] || 0);
        } else if (rec.type === 28) {
          // IPv6
          const buf = new Uint8Array(16);
          const parts = rec.data.split(':');
          let bIdx = 0;
          for (const p of parts) {
            const val = parseInt(p || '0', 16);
            buf[bIdx++] = (val >> 8) & 0xff;
            buf[bIdx++] = val & 0xff;
          }
          this.pushUint16(16);
          this.pushBytes(buf);
        } else if (rec.type === 5 || rec.type === 12 || rec.type === 2) {
          // CNAME / PTR / NS
          const nameSerializer = new DnsSerializer();
          nameSerializer.pushName(rec.data);
          const nameBytes = nameSerializer.toByteArray();
          this.pushUint16(nameBytes.length);
          this.pushBytes(nameBytes);
        } else if (rec.type === 16) {
          // TXT
          const txtBytes = new TextEncoder().encode(rec.data);
          this.pushUint16(txtBytes.length + 1);
          this.pushUint8(txtBytes.length);
          this.pushBytes(txtBytes);
        } else {
          const raw = new TextEncoder().encode(rec.data);
          this.pushUint16(raw.length);
          this.pushBytes(raw);
        }
      } else if (rec.data instanceof Uint8Array) {
        this.pushUint16(rec.data.length);
        this.pushBytes(rec.data);
      } else {
        this.pushUint16(0);
      }
    }
  }

  private toByteArray(): Uint8Array {
    const result = new Uint8Array(this.totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

export function parseDnsPacket(buffer: Uint8Array): DnsPacket {
  return new DnsParser(buffer).parse();
}

export function serializeDnsPacket(packet: DnsPacket): Uint8Array {
  return new DnsSerializer().serialize(packet);
}

export function createBlockedResponse(req: DnsPacket, domain: string, qtype: number): DnsPacket {
  const isV6 = qtype === 28;
  const answers: DnsRecord[] = [
    {
      name: domain,
      type: qtype,
      typeName: isV6 ? 'AAAA' : 'A',
      class: 1, // IN
      ttl: 300,
      data: isV6 ? '0:0:0:0:0:0:0:0' : '0.0.0.0',
    },
  ];

  return {
    id: req.id,
    flags: 0x8180, // Response, Recursion Available, No error
    qr: true,
    opcode: 0,
    aa: true,
    tc: false,
    rd: req.rd,
    ra: true,
    rcode: 0,
    rcodeName: 'NOERROR',
    questions: req.questions,
    answers,
    authorities: [],
    additionals: [],
  };
}

export function createEmptyResponse(req: DnsPacket, rcode = 0, rcodeName = 'NOERROR'): DnsPacket {
  return {
    id: req.id,
    flags: 0x8180 | (rcode & 0x0f),
    qr: true,
    opcode: 0,
    aa: true,
    tc: false,
    rd: req.rd,
    ra: true,
    rcode,
    rcodeName,
    questions: req.questions,
    answers: [],
    authorities: [],
    additionals: [],
  };
}

export function createAnswersResponse(
  req: DnsPacket,
  domain: string,
  qtype: number,
  ips: string[],
  ttl = 300
): DnsPacket {
  const isV6 = qtype === 28;
  const answers: DnsRecord[] = ips.map(ip => ({
    name: domain,
    type: qtype,
    typeName: isV6 ? 'AAAA' : 'A',
    class: 1, // IN
    ttl,
    data: ip,
  }));

  return {
    id: req.id,
    flags: 0x8180,
    qr: true,
    opcode: 0,
    aa: true,
    tc: false,
    rd: req.rd,
    ra: true,
    rcode: 0,
    rcodeName: 'NOERROR',
    questions: req.questions,
    answers,
    authorities: [],
    additionals: [],
  };
}

