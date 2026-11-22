'use strict';

// Run only inside the designated disposable remote analysis container.
// Reads ELF bytes, hashes and unwind metadata; never loads native modules.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const objdump = process.env.CHERRY_NATIVE_OBJDUMP || 'objdump';

const targets = [
  { name: 'moeSend', rva: 0x65f92d0, prefix: 55, mask: [] },
  { name: 'moeRecv', rva: 0x65fb070, prefix: 35, mask: [[25, 29]] },
  { name: 'napiSend', rva: 0x6e5ab20, prefix: 37, mask: [] },
  { name: 'napiRecv', rva: 0x3a12cd0, prefix: 39, mask: [[20, 24]] },
];

function elf (file) {
  const bytes = fs.readFileSync(file);
  if (bytes.subarray(0, 6).toString('hex') !== '7f454c460201') throw Error('Expected ELF64LE');
  const shoff = Number(bytes.readBigUInt64LE(40));
  const shentsize = bytes.readUInt16LE(58);
  const shnum = bytes.readUInt16LE(60);
  const shstrndx = bytes.readUInt16LE(62);
  const sections = Array.from({ length: shnum }, (_, i) => {
    const p = shoff + i * shentsize;
    return {
      nameOffset: bytes.readUInt32LE(p),
      type: bytes.readUInt32LE(p + 4),
      address: Number(bytes.readBigUInt64LE(p + 16)),
      offset: Number(bytes.readBigUInt64LE(p + 24)),
      size: Number(bytes.readBigUInt64LE(p + 32)),
    };
  });
  const names = sections[shstrndx];
  for (const section of sections) {
    const p = names.offset + section.nameOffset;
    section.name = bytes.toString('ascii', p, bytes.indexOf(0, p));
  }
  const text = sections.find(x => x.name === '.text');
  if (!text) throw Error('No .text');
  const offsetOf = address => {
    const section = sections.find(s => s.type !== 8 && address >= s.address && address < s.address + s.size);
    if (!section) throw Error('Unmapped RVA ' + address.toString(16));
    return section.offset + address - section.address;
  };
  const hex = value => '0x' + value.toString(16);
  const uleb = state => {
    let result = 0; let shift = 0; let v;
    do { v = bytes[state.p++]; result += (v & 127) * 2 ** shift; shift += 7; } while (v & 128);
    return result;
  };
  const sleb = state => {
    let result = 0; let shift = 0; let v;
    do { v = bytes[state.p++]; result += (v & 127) * 2 ** shift; shift += 7; } while (v & 128);
    if (v & 64) result -= 2 ** shift;
    return result;
  };
  const encoded = (state, encoding, dataBase = 0) => {
    const p = state.p;
    let value;
    switch (encoding & 15) {
      case 0: value = Number(bytes.readBigUInt64LE(p)); state.p += 8; break;
      case 1: value = uleb(state); break;
      case 2: value = bytes.readUInt16LE(p); state.p += 2; break;
      case 3: value = bytes.readUInt32LE(p); state.p += 4; break;
      case 4: value = Number(bytes.readBigUInt64LE(p)); state.p += 8; break;
      case 9: value = sleb(state); break;
      case 10: value = bytes.readInt16LE(p); state.p += 2; break;
      case 11: value = bytes.readInt32LE(p); state.p += 4; break;
      case 12: value = Number(bytes.readBigInt64LE(p)); state.p += 8; break;
      default: throw Error('Unsupported DWARF encoding ' + encoding.toString(16));
    }
    const application = encoding & 112;
    if (application === 16) {
      const section = sections.find(s => s.type !== 8 && p >= s.offset && p < s.offset + s.size);
      value += section.address + p - section.offset;
    } else if (application === 48) value += dataBase;
    else if (application) throw Error('Unsupported DWARF base ' + encoding.toString(16));
    return value;
  };
  const hdr = sections.find(x => x.name === '.eh_frame_hdr');
  const unwind = [];
  if (hdr) {
    const state = { p: hdr.offset + 4 };
    encoded(state, bytes[hdr.offset + 1], hdr.address);
    const count = encoded(state, bytes[hdr.offset + 2], hdr.address);
    for (let i = 0; i < count; i++) {
      const start = encoded(state, bytes[hdr.offset + 3], hdr.address);
      const fde = encoded(state, bytes[hdr.offset + 3], hdr.address);
      unwind.push({ start, fde });
    }
  }
  function fdeBounds (entry) {
    const fde = offsetOf(entry.fde);
    const cie = fde + 4 - bytes.readUInt32LE(fde + 4);
    const state = { p: cie + 8 };
    const version = bytes[state.p++];
    const augEnd = bytes.indexOf(0, state.p);
    const aug = bytes.toString('ascii', state.p, augEnd);
    state.p = augEnd + 1;
    uleb(state); sleb(state);
    if (version === 1) state.p++; else uleb(state);
    let pointerEncoding = 0;
    if (aug.startsWith('z')) {
      uleb(state);
      for (const c of aug.slice(1)) {
        if (c === 'R') pointerEncoding = bytes[state.p++];
        else if (c === 'L') state.p++;
        else if (c === 'P') { const e = bytes[state.p++]; encoded(state, e); } else if (c !== 'S') throw Error('Unknown CIE augmentation ' + aug);
      }
    }
    state.p = fde + 8;
    const start = encoded(state, pointerEncoding);
    const size = encoded(state, pointerEncoding & 15);
    return { start: hex(start), size, end: hex(start + size), cieAugmentation: aug };
  }
  const info = address => {
    const exact = unwind.find(e => e.start === address);
    const earlier = unwind.filter(e => e.start <= address).at(-1);
    return {
      rva: hex(address),
      fileOffset: hex(offsetOf(address)),
      exactUnwindStart: !!exact,
      unwind: exact || earlier ? fdeBounds(exact || earlier) : null,
    };
  };
  const find = (prefix, mask) => {
    const ignored = new Set(mask.flatMap(([a, b]) => Array.from({ length: b - a }, (_, i) => a + i)));
    const anchorLength = mask.length ? Math.min(...mask.map(x => x[0])) : prefix.length;
    const anchor = prefix.subarray(0, anchorLength);
    const results = [];
    let p = text.offset;
    const limit = text.offset + text.size - prefix.length;
    while ((p = bytes.indexOf(anchor, p)) !== -1 && p <= limit) {
      if (prefix.every((v, i) => ignored.has(i) || bytes[p + i] === v)) results.push(text.address + p - text.offset);
      p++;
    }
    return results;
  };
  function stringRef (address) {
    const section = sections.find(s => address >= s.address && address < s.address + s.size);
    if (!section || section.name !== '.rodata') return null;
    const p = offsetOf(address);
    const end = bytes.indexOf(0, p);
    if (end <= p || end - p > 512) return null;
    const raw = bytes.subarray(p, end);
    if (!raw.every(v => v === 9 || v === 10 || v === 13 || (v >= 32 && v <= 126))) return null;
    return raw.toString('ascii');
  }
  function disassemble (address) {
    const bounds = info(address).unwind;
    if (!bounds || bounds.start !== hex(address)) throw Error('No exact FDE');
    const result = spawnSync(objdump, [
      '-d', '-M', 'intel', '--no-show-raw-insn', '--start-address=' + hex(address),
      '--stop-address=' + bounds.end, file,
    ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) throw Error(result.stderr || 'objdump failed');
    const instructions = []; const references = [];
    for (const line of result.stdout.split('\n')) {
      const matched = /^\s*([0-9a-f]+):\s+(.+)$/.exec(line);
      if (!matched) continue;
      const ip = parseInt(matched[1], 16);
      const comment = /#\s*([0-9a-f]+)/.exec(matched[2]);
      let op = matched[2].split('#')[0].trim().replace(/\s+/g, ' ');
      op = op.replace(/\[rip[+-]0x[0-9a-f]+\]/g, '[rip+relative]');
      const branch = /^(call|j[a-z]+)\s+([0-9a-f]+)(?: <([^>]+)>)?$/.exec(op);
      if (branch) {
        const destination = parseInt(branch[2], 16);
        if (destination >= address && destination < address + bounds.size) op = branch[1] + ' local+' + hex(destination - address);
        else if (branch[3]?.endsWith('@plt')) op = branch[1] + ' symbol:' + branch[3];
        else op = branch[1] + ' external';
      }
      if (comment) {
        const value = stringRef(parseInt(comment[1], 16));
        if (value) {
          references.push({ offset: hex(ip - address), value });
          op += ' string:' + JSON.stringify(value);
        }
      }
      instructions.push(hex(ip - address) + ':' + op);
    }
    const canonical = instructions.join('\n');
    return {
      rva: hex(address),
      size: bounds.size,
      instructionCount: instructions.length,
      normalizedSha256: crypto.createHash('sha256').update(canonical).digest('hex'),
      references,
      canonical,
    };
  }
  return {
    bytes,
    offsetOf,
    info,
    find,
    disassemble,
    metadata: {
      file,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      text,
    },
  };
}

const old = elf(process.argv[2] || '/opt/qq-root/opt/QQ/resources/app/wrapper.node');
const next = elf(process.argv[3] || '/job/analysis/qq54395/opt/QQ/resources/app/wrapper.node');
const result = targets.map(target => {
  const prefix = old.bytes.subarray(old.offsetOf(target.rva), old.offsetOf(target.rva) + target.prefix);
  return {
    ...target,
    prefixHex: prefix.toString('hex'),
    old: old.info(target.rva),
    oldPrefixMatches: old.find(prefix, target.mask).map(old.info),
    newPrefixMatches: next.find(prefix, target.mask).map(next.info),
  };
});
if (process.argv.includes('--functions')) {
  for (const target of result) {
    const oldFunction = old.disassemble(target.rva);
    const candidates = target.newPrefixMatches.filter(x => x.exactUnwindStart && x.unwind.size === oldFunction.size)
      .map(x => next.disassemble(parseInt(x.rva, 16)));
    target.oldFunction = oldFunction;
    target.candidates = candidates.map(c => ({ ...c, exactNormalizedMatch: c.canonical === oldFunction.canonical }));
  }
}
console.log(JSON.stringify({ old: old.metadata, next: next.metadata, targets: result }, null, 2));
