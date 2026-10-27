// Write matching CICP metadata into our pinned encoder's AVIF and AV1 headers.
// RGB samples are already P3-D65/PQ. Identity-matrix lossless coding is unchanged.
const P3_D65 = 12,
  PQ = 16,
  IDENTITY = 0;

export function tagHdrAvif(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start, length) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  let colorBoxes = 0,
    sequences = 0;

  function patchSequence(start, end) {
    let bit = start * 8;
    function read(count) {
      if (bit + count > end * 8) throw new Error("Truncated AV1 color header.");
      let value = 0;
      while (count--) {
        value = value * 2 + ((bytes[bit >>> 3] >>> (7 - (bit & 7))) & 1);
        bit++;
      }
      return value;
    }
    function write(at, count, value) {
      for (let i = 0; i < count; i++) {
        const position = at + i,
          mask = 1 << (7 - (position & 7));
        bytes[position >>> 3] =
          (bytes[position >>> 3] & ~mask) |
          ((value >>> (count - i - 1)) & 1 ? mask : 0);
      }
    }
    const profile = read(3),
      still = read(1),
      reduced = read(1);
    if (profile !== 2 || !still || !reduced)
      throw new Error(
        "Unexpected AVIF codec header; HDR export was not written.",
      );
    read(5); // seq_level_idx[0]; reduced still-picture headers have no timing fields.
    const widthBits = read(4) + 1,
      heightBits = read(4) + 1;
    read(widthBits);
    read(heightBits);
    read(6); // superblock, filter-intra, intra-edge, superres, CDEF, restoration.
    const high = read(1),
      twelve = high ? read(1) : 0,
      monochrome = read(1),
      description = read(1);
    if (!high || !twelve || monochrome || !description)
      throw new Error("Expected explicit 12-bit RGB AVIF color information.");
    const colorAt = bit,
      primaries = read(8),
      transfer = read(8),
      matrix = read(8);
    // Neither old nor new descriptors use AV1's special sRGB syntax branch.
    if (
      matrix !== IDENTITY ||
      (primaries === 1 && transfer === 13) ||
      read(1) !== 1 ||
      read(1) !== 0
    ) {
      throw new Error(
        "Expected full-range, identity-matrix 4:4:4 AVIF encoding.",
      );
    }
    write(colorAt, 8, P3_D65);
    write(colorAt + 8, 8, PQ);
    sequences++;
  }

  function obus(start, end) {
    let offset = start;
    while (offset < end) {
      const header = bytes[offset++],
        type = (header >>> 3) & 15;
      if (header & 0x81 || !(header & 2))
        throw new Error("Unsupported AV1 OBU header.");
      if (header & 4) offset++; // OBU extension.
      let length = 0,
        shift = 0,
        part;
      do {
        if (offset >= end || shift > 49)
          throw new Error("Invalid AV1 OBU length.");
        part = bytes[offset++];
        length += (part & 127) * 2 ** shift;
        shift += 7;
      } while (part & 128);
      if (offset + length > end) throw new Error("Truncated AV1 OBU payload.");
      if (type === 1) patchSequence(offset, offset + length);
      offset += length;
    }
  }

  function boxes(start, end) {
    for (let offset = start; offset < end;) {
      if (offset + 8 > end) throw new Error("Truncated AVIF box.");
      const length = view.getUint32(offset),
        type = text(offset + 4, 4);
      if (length < 8 || offset + length > end)
        throw new Error("Invalid AVIF box length.");
      const payload = offset + 8,
        stop = offset + length;
      if (type === "meta" || type === "iprp" || type === "ipco")
        boxes(payload + (type === "meta" ? 4 : 0), stop);
      else if (type === "colr") {
        if (
          length !== 19 ||
          text(payload, 4) !== "nclx" ||
          view.getUint16(payload + 8) !== IDENTITY ||
          bytes[payload + 10] !== 128
        ) {
          throw new Error("Unexpected AVIF color container.");
        }
        view.setUint16(payload + 4, P3_D65);
        view.setUint16(payload + 6, PQ);
        colorBoxes++;
      } else if (type === "av1C") obus(payload + 4, stop);
      else if (type === "mdat") obus(payload, stop);
      offset = stop;
    }
  }
  boxes(0, bytes.length);
  if (colorBoxes !== 1 || sequences < 1)
    throw new Error("The AVIF export has no complete HDR color description.");
  return bytes;
}
