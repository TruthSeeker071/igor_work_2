/**
 * FWZip — minimal, self-contained, STORE-only ZIP writer.
 *
 * Vendored for Resume Builder v2's client-side DOCX export (a .docx is a ZIP
 * of XML parts). No compression, no dependencies, no network. A STORE-method
 * ZIP is a fully valid archive Word/Google Docs/unzip can all read.
 *
 * Usage: window.FWZip.zip({ 'a.txt': 'hello', 'b/c.bin': someUint8Array })
 * → returns a Uint8Array containing the ZIP bytes.
 */
(function (global) {
  'use strict';

  // Standard CRC-32 table (polynomial 0xEDB88320), built once.
  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8Encode(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    // Manual UTF-8 fallback for environments without TextEncoder.
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.codePointAt(i);
      if (code > 0xFFFF) i++; // consumed a surrogate pair
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      } else if (code < 0x10000) {
        bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      } else {
        bytes.push(
          0xF0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3F),
          0x80 | ((code >> 6) & 0x3F),
          0x80 | (code & 0x3F)
        );
      }
    }
    return new Uint8Array(bytes);
  }

  function toBytes(v) {
    if (v instanceof Uint8Array) return v;
    if (typeof v === 'string') return utf8Encode(v);
    if (v && typeof v.byteLength === 'number' && v.buffer instanceof ArrayBuffer) {
      return new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength);
    }
    throw new Error('FWZip: unsupported file content — expected a string or Uint8Array');
  }

  function writeU16LE(arr, offset, val) {
    arr[offset] = val & 0xFF;
    arr[offset + 1] = (val >>> 8) & 0xFF;
  }

  function writeU32LE(arr, offset, val) {
    arr[offset] = val & 0xFF;
    arr[offset + 1] = (val >>> 8) & 0xFF;
    arr[offset + 2] = (val >>> 16) & 0xFF;
    arr[offset + 3] = (val >>> 24) & 0xFF;
  }

  // Fixed DOS date/time: 2026-01-01 00:00:00. Exact value is irrelevant to
  // ZIP validity — readers only need a well-formed (non-negative) field.
  var DOS_TIME = 0x0000;
  var DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

  /**
   * @param {Object<string, string|Uint8Array>} files map of archive path -> content
   * @returns {Uint8Array} the assembled ZIP archive bytes
   */
  function zip(files) {
    var names = Object.keys(files || {});
    var localParts = [];
    var centralParts = [];
    var offset = 0;

    names.forEach(function (name) {
      var nameBytes = utf8Encode(name);
      var data = toBytes(files[name]);
      var crc = crc32(data);
      var size = data.length;

      var localHeader = new Uint8Array(30 + nameBytes.length);
      writeU32LE(localHeader, 0, 0x04034b50); // local file header signature
      writeU16LE(localHeader, 4, 20);          // version needed to extract
      writeU16LE(localHeader, 6, 0);           // general purpose flag
      writeU16LE(localHeader, 8, 0);           // compression method: 0 = STORE
      writeU16LE(localHeader, 10, DOS_TIME);
      writeU16LE(localHeader, 12, DOS_DATE);
      writeU32LE(localHeader, 14, crc);
      writeU32LE(localHeader, 18, size);       // compressed size == uncompressed (STORE)
      writeU32LE(localHeader, 22, size);       // uncompressed size
      writeU16LE(localHeader, 26, nameBytes.length);
      writeU16LE(localHeader, 28, 0);          // extra field length
      localHeader.set(nameBytes, 30);

      localParts.push(localHeader, data);

      var centralHeader = new Uint8Array(46 + nameBytes.length);
      writeU32LE(centralHeader, 0, 0x02014b50); // central directory file header signature
      writeU16LE(centralHeader, 4, 20);          // version made by
      writeU16LE(centralHeader, 6, 20);          // version needed to extract
      writeU16LE(centralHeader, 8, 0);           // general purpose flag
      writeU16LE(centralHeader, 10, 0);          // compression method
      writeU16LE(centralHeader, 12, DOS_TIME);
      writeU16LE(centralHeader, 14, DOS_DATE);
      writeU32LE(centralHeader, 16, crc);
      writeU32LE(centralHeader, 20, size);
      writeU32LE(centralHeader, 24, size);
      writeU16LE(centralHeader, 28, nameBytes.length);
      writeU16LE(centralHeader, 30, 0);          // extra field length
      writeU16LE(centralHeader, 32, 0);          // file comment length
      writeU16LE(centralHeader, 34, 0);          // disk number start
      writeU16LE(centralHeader, 36, 0);          // internal file attributes
      writeU32LE(centralHeader, 38, 0);          // external file attributes
      writeU32LE(centralHeader, 42, offset);     // relative offset of local header
      centralHeader.set(nameBytes, 46);

      centralParts.push(centralHeader);

      offset += localHeader.length + data.length;
    });

    var centralDirStart = offset;
    var centralDirSize = centralParts.reduce(function (n, c) { return n + c.length; }, 0);

    var eocd = new Uint8Array(22);
    writeU32LE(eocd, 0, 0x06054b50); // end of central directory signature
    writeU16LE(eocd, 4, 0);           // disk number
    writeU16LE(eocd, 6, 0);           // disk where central directory starts
    writeU16LE(eocd, 8, names.length);  // number of central dir records on this disk
    writeU16LE(eocd, 10, names.length); // total number of central dir records
    writeU32LE(eocd, 12, centralDirSize);
    writeU32LE(eocd, 16, centralDirStart);
    writeU16LE(eocd, 20, 0);          // comment length

    var totalSize = centralDirStart + centralDirSize + eocd.length;
    var out = new Uint8Array(totalSize);
    var pos = 0;
    localParts.forEach(function (part) { out.set(part, pos); pos += part.length; });
    centralParts.forEach(function (part) { out.set(part, pos); pos += part.length; });
    out.set(eocd, pos);

    return out;
  }

  global.FWZip = { zip: zip };
})(typeof window !== 'undefined' ? window : globalThis);
