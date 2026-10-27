// Web HDR uses relative linear RGB; PQ uses absolute luminance (10,000 nits).
// Reference white follows the CSS Color HDR / BT.2408 convention of 203 nits.
export const HDR_REFERENCE_WHITE = 203;
export const AVIF_BIT_DEPTH = 12;
const PQ_MAX = 2 ** AVIF_BIT_DEPTH - 1;

export function halfToFloat(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >>> 10) & 31;
  const fraction = bits & 1023;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return (
    sign *
    (exponent
      ? 2 ** (exponent - 15) * (1 + fraction / 1024)
      : (2 ** -14 * fraction) / 1024)
  );
}

export function decodeSRGB(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function linearToPQ(value) {
  const luminance = Math.max(
    0,
    Math.min(1, (value * HDR_REFERENCE_WHITE) / 10000),
  );
  const power = luminance ** (2610 / 16384);
  return (
    ((3424 / 4096 + (2413 / 128) * power) / (1 + (2392 / 128) * power)) **
    (2523 / 32)
  );
}

let linearTable, pqTable;
function prepareTables() {
  if (linearTable) return;
  linearTable = new Float64Array(65536);
  pqTable = new Uint16Array(65536);
  for (let bits = 0; bits < 65536; bits++) {
    const linear = decodeSRGB(halfToFloat(bits));
    linearTable[bits] = linear;
    pqTable[bits] = Number.isFinite(linear)
      ? Math.round(linearToPQ(linear) * PQ_MAX)
      : 0;
  }
}

export function prepareHdrPixels({
  width,
  height,
  format,
  bytesPerRow,
  pixels,
  colorSpace,
}) {
  if (format !== "rgba16float")
    throw new Error("HDR export requires a floating-point render.");
  if (!["display-p3", "srgb"].includes(colorSpace))
    throw new Error("Unknown render color space.");
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    bytesPerRow < width * 8 ||
    pixels.byteLength < bytesPerRow * height
  ) {
    throw new Error("Invalid HDR image dimensions or pixel buffer.");
  }
  prepareTables();
  const view = new DataView(
    pixels.buffer,
    pixels.byteOffset,
    pixels.byteLength,
  );
  const data = new Uint16Array(width * height * 4);
  let clipped = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = y * bytesPerRow + x * 8,
        target = (y * width + x) * 4;
      const rb = view.getUint16(source, true),
        gb = view.getUint16(source + 2, true),
        bb = view.getUint16(source + 4, true);
      let r = linearTable[rb],
        g = linearTable[gb],
        b = linearTable[bb];
      if (![r, g, b].every(Number.isFinite))
        throw new Error("The rendered image contains non-finite HDR pixels.");
      if (colorSpace === "srgb") {
        // Convert actual sRGB fallback renders into the same P3-D65 output gamut.
        [r, g, b] = [
          0.8224619687143623 * r + 0.1775380312856377 * g,
          0.0331941988509618 * r + 0.9668058011490382 * g,
          0.01708263072112 * r + 0.072397440663963 * g + 0.910519928614917 * b,
        ];
        data[target] = Math.round(linearToPQ(r) * PQ_MAX);
        data[target + 1] = Math.round(linearToPQ(g) * PQ_MAX);
        data[target + 2] = Math.round(linearToPQ(b) * PQ_MAX);
      } else {
        data[target] = pqTable[rb];
        data[target + 1] = pqTable[gb];
        data[target + 2] = pqTable[bb];
      }
      if (
        Math.min(r, g, b) < 0 ||
        Math.max(r, g, b) * HDR_REFERENCE_WHITE > 10000
      )
        clipped++;
      data[target + 3] = PQ_MAX; // The rendered map is opaque.
    }
  }
  return { width, height, data, clipped };
}
