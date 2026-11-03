"""Inspect the native Windows app or NSIS setup before distribution. No execution or publication."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import struct
import xml.etree.ElementTree as ET

project = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--installer', action='store_true', help='Inspect an x86 NSIS installer containing the x64 app')
parser.add_argument('--binary', type=Path, help='Executable to inspect (must match the current version and icon)')
arguments = parser.parse_args()
version = json.loads((project / 'package.json').read_text())['version']
binary = arguments.binary or project / 'src-tauri/target/x86_64-pc-windows-msvc/release/DooTTY.exe'
data = binary.read_bytes()
# Check ASCII and UTF-16 strings before distributing a locally compiled binary.
private_home = rb"(?:/[h]ome/|[A-Za-z]:\\Users\\)(?!(?:developer|example|user|username)(?:[\\/\x00\s]|$))[^\x00\s\\/]+"
assert not re.search(private_home, data) and not re.search(private_home, data.replace(b'\0', b'')), 'Developer home path embedded in EXE; rebuild with scripts/build-windows.mjs'
pe = struct.unpack_from('<I', data, 0x3C)[0]
assert data[:2] == b'MZ' and data[pe:pe + 4] == b'PE\0\0'
assert struct.unpack_from('<H', data, pe + 4)[0] == (0x14C if arguments.installer else 0x8664), 'Unexpected PE architecture'
optional = pe + 24
assert struct.unpack_from('<H', data, optional)[0] == (0x10B if arguments.installer else 0x20B), 'Unexpected PE format'
directories = optional + (96 if arguments.installer else 112)
assert struct.unpack_from('<H', data, optional + 68)[0] == 2, 'Expected GUI subsystem'
section_count = struct.unpack_from('<H', data, pe + 6)[0]
sections = optional + struct.unpack_from('<H', data, pe + 20)[0]


def offset(rva):
    for index in range(section_count):
        position = sections + index * 40
        virtual_size, virtual_address, raw_size, raw_pointer = struct.unpack_from('<IIII', data, position + 8)
        if virtual_address <= rva < virtual_address + max(virtual_size, raw_size):
            return raw_pointer + rva - virtual_address
    raise ValueError(f'Unmapped RVA {rva:x}')


resource_rva = struct.unpack_from('<I', data, directories + 2 * 8)[0]
resource_base = offset(resource_rva)


def entries(position):
    named, ids = struct.unpack_from('<HH', data, position + 12)
    return [struct.unpack_from('<II', data, position + 16 + index * 8) for index in range(named + ids)]


resources = dict(entries(resource_base))
assert all(kind in resources for kind in (3, 14, 16, 24)), 'Missing Windows resources'


def resource_payload(leaf):
    while leaf & 0x80000000:
        leaf = entries(resource_base + (leaf & 0x7FFFFFFF))[0][1]
    rva, size = struct.unpack_from('<II', data, resource_base + leaf)
    return data[offset(rva):offset(rva) + size]


manifest = ET.fromstring(resource_payload(resources[24]).rstrip(b'\0'))
levels = [element.attrib.get('level') for element in manifest.iter()
          if element.tag.rsplit('}', 1)[-1] == 'requestedExecutionLevel']
assert not levels or levels == ['asInvoker'], 'DooTTY itself must not request elevation'
assert all(element.attrib.get('uiAccess', 'false') == 'false'
           for element in manifest.iter()
           if element.tag.rsplit('}', 1)[-1] == 'requestedExecutionLevel'), 'Unexpected UIAccess request'
certificate_offset, certificate_size = struct.unpack_from('<II', data, directories + 4 * 8)
embedded_signature_present = bool(certificate_offset and certificate_size)


# Check the actual icon pixels, not just the presence of an ICON resource.
icon = (project / 'src-tauri/icons/icon.ico').read_bytes()
icon_images = []
for index in range(struct.unpack_from('<H', icon, 4)[0]):
    length, position = struct.unpack_from('<II', icon, 6 + index * 16 + 8)
    icon_images.append(icon[position:position + length])
embedded_icons = [resource_payload(leaf) for _, leaf in
                  entries(resource_base + (resources[3] & 0x7FFFFFFF))]
assert sorted(icon_images) == sorted(embedded_icons), 'EXE icon differs from the current icon.ico; rebuild Windows resources'
leaf = resources[16]
while leaf & 0x80000000:
    leaf = entries(resource_base + (leaf & 0x7FFFFFFF))[0][1]
value_rva, value_size = struct.unpack_from('<II', data, resource_base + leaf)
value = data[offset(value_rva):offset(value_rva) + value_size]
signature = value.index(struct.pack('<I', 0xFEEF04BD))
major_minor, patch_build = struct.unpack_from('<II', value, signature + 8)
file_version = (major_minor >> 16, major_minor & 0xFFFF, patch_build >> 16, patch_build & 0xFFFF)
assert file_version == tuple(map(int, version.split('.'))) + (0,), (version, file_version)

imports = []
descriptor = offset(struct.unpack_from('<I', data, directories + 8)[0])
while any(data[descriptor:descriptor + 20]):
    name = offset(struct.unpack_from('<I', data, descriptor + 12)[0])
    imports.append(data[name:data.index(b'\0', name)].decode('ascii'))
    descriptor += 20

print(json.dumps({'version': version, 'sha256': hashlib.sha256(data).hexdigest(),
                  'bytes': len(data), 'embedded_icons_match': True,
                  'requested_execution_level': levels[0] if levels else None,
                  'embedded_signature_present': embedded_signature_present,
                  'manifest': resource_payload(resources[24]).decode('utf-8').strip(),
                  'imports': imports}, indent=2))
raise SystemExit(0)
