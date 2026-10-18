import { Script } from 'scripting';
import { DnsResolver } from '../src/resolver';
import { parseDnsPacket, serializeDnsPacket } from '../src/dns-packet';

async function test() {
  const dummy1 = {
    id: 1234, flags: 0x0100, qr: false, opcode: 0, aa: false, tc: false, rd: true, ra: false,
    rcode: 0, rcodeName: 'NOERROR',
    questions: [{ name: 'www.youtube.com', type: 1, typeName: 'A', class: 1 }],
    answers: [], authorities: [], additionals: []
  };
  const res1 = await DnsResolver.get().resolve(serializeDnsPacket(dummy1), '127.0.0.1');
  const packet1 = parseDnsPacket(res1);
  console.log('Query www.youtube.com =>', packet1.answers.map(a => a.data));

  const dummy2 = {
    id: 1235, flags: 0x0100, qr: false, opcode: 0, aa: false, tc: false, rd: true, ra: false,
    rcode: 0, rcodeName: 'NOERROR',
    questions: [{ name: 'rr1---sn-4g5edn6e.googlevideo.com', type: 1, typeName: 'A', class: 1 }],
    answers: [], authorities: [], additionals: []
  };
  const res2 = await DnsResolver.get().resolve(serializeDnsPacket(dummy2), '127.0.0.1');
  const packet2 = parseDnsPacket(res2);
  console.log('Query googlevideo.com =>', packet2.answers.map(a => a.data));

  const dummy3 = {
    id: 1236, flags: 0x0100, qr: false, opcode: 0, aa: false, tc: false, rd: true, ra: false,
    rcode: 0, rcodeName: 'NOERROR',
    questions: [{ name: 'pagead2.googlesyndication.com', type: 1, typeName: 'A', class: 1 }],
    answers: [], authorities: [], additionals: []
  };
  const res3 = await DnsResolver.get().resolve(serializeDnsPacket(dummy3), '127.0.0.1');
  const packet3 = parseDnsPacket(res3);
  console.log('Query pagead2.googlesyndication.com =>', packet3.answers.map(a => a.data));

  Script.exit({ ok: true });
}

test().catch(e => {
  console.error(e);
  Script.exit({ ok: false, error: String(e) });
});
