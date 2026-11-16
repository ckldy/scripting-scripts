#!/usr/bin/env python3
"""Write a raw DNS wire query for a domain to a file (for curl DoH tests)."""
import struct, sys
name = sys.argv[1]
out = sys.argv[2]
tid = 0x1234
h = struct.pack(">HHHHHH", tid, 0x0100, 1, 0, 0, 0)
q = b""
for label in name.split("."):
    q += bytes([len(label)]) + label.encode()
q += b"\x00" + struct.pack(">HH", 1, 1)
open(out, "wb").write(h + q)
print("wrote", out, len(h + q))
