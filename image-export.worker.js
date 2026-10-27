import createEncoder from "./vendor/avif/avif_enc.js";
import { prepareHdrPixels } from "./hdr-pixels.js";
import { tagHdrAvif } from "./avif-hdr.js";

self.onmessage = async ({ data: frame }) => {
  try {
    self.postMessage({ status: "Preparing HDR colors…" });
    const image = prepareHdrPixels(frame);
    // Drop the readback before the encoder allocates its image planes.
    frame.pixels = null;
    self.postMessage({ status: "Encoding HDR AVIF…" });
    const encoder = await createEncoder();
    const encoded = encoder.encode(
      new Uint8Array(image.data.buffer),
      image.width,
      image.height,
      {
        quality: 100,
        qualityAlpha: -1,
        bitDepth: 12,
        subsample: 3,
        speed: 8,
        tileRowsLog2: 0,
        tileColsLog2: 0,
        denoiseLevel: 0,
        chromaDeltaQ: false,
        sharpness: 0,
        tune: 0,
        enableSharpYUV: false,
      },
    );
    if (!encoded)
      throw new Error("The AVIF encoder could not encode this image.");
    const bytes = tagHdrAvif(encoded);
    self.postMessage(
      {
        bytes,
        width: image.width,
        height: image.height,
        clipped: image.clipped,
      },
      [bytes.buffer],
    );
  } catch (error) {
    self.postMessage({ error: error.message || "HDR image export failed." });
  }
};
