#!/usr/bin/env python3
"""Time LocalDNS DoH answers for cold/warm hosts."""
import base64
import random
import struct
import sys
import time
import urllib.request

URL = "http://127.0.0.1:9099/dns-query"


def build_query(name, qtype=1):
    tid = random.randint(0, 65535)
    header = struct.pack(">HHHHHH", tid, 0x0100, 1, 0, 0, 0)
    q = b""
    for label in name.split("."):
        q += bytes([len(label)]) + label.encode()
    q += b"\x00" + struct.pack(">HH", qtype, 1)
    return header + q


def ask(name, qtype=1):
    body = build_query(name, qtype)
    req = urllib.request.Request(
        URL, data=body, headers={"Content-Type": "application/dns-message"}, method="POST"
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = resp.read()
    ms = (time.time() - t0) * 1000
    # parse first A answer if any
    ancount = struct.unpack(">H", data[6:8])[0]
    ips = []
    idx = 12
    # skip question
    while data[idx] != 0:
        idx += 1 + data[idx]
    idx += 5
    for _ in range(ancount):
        while data[idx] != 0:
            if data[idx] & 0xC0 == 0xC0:
                idx += 2
                break
            idx += 1 + data[idx]
        else:
            idx += 1
        rtype, _cls, _ttl, rdlen = struct.unpack(">HHIH", data[idx:idx + 10])
        idx += 10
        rdata = data[idx:idx + rdlen]
        idx += rdlen
        if rtype == 1 and rdlen == 4:
            ips.append(".".join(str(b) for b in rdata))
    return ms, ips, ancount


hosts = sys.argv[1:]
for host in hosts:
    for round_no in (1, 2):
        try:
            ms, ips, n = ask(host)
            print(f"{host:45s} round{round_no} {ms:7.1f}ms ans={n} {ips[:3]}")
        except Exception as e:
            print(f"{host:45s} round{round_no} ERROR {e}")
