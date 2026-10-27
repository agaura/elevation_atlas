// Read the GPU texture itself, preserving HDR values and device-pixel dimensions.
// Queue this copy in the same encoder as the render, before presentation.
export function captureTexture(device, encoder, texture) {
  const { width, height, format } = texture;
  const pixelBytes = format === "rgba16float" ? 8 : 4;
  if (!["rgba16float", "rgba8unorm", "bgra8unorm"].includes(format)) {
    throw new Error(`Unsupported export texture format: ${format}`);
  }
  const bytesPerRow = Math.ceil((width * pixelBytes) / 256) * 256;
  const size = bytesPerRow * height;
  if (size > device.limits.maxBufferSize) {
    throw new Error(
      "This image exceeds the GPU readback limit. Reduce the viewport size.",
    );
  }
  const buffer = device.createBuffer({
    label: "Full-resolution image export",
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [
      width,
      height,
    ]);
  } catch (error) {
    buffer.destroy();
    throw error;
  }
  return {
    async read() {
      try {
        await buffer.mapAsync(GPUMapMode.READ);
        const pixels = new Uint8Array(buffer.getMappedRange()).slice();
        return { width, height, format, bytesPerRow, pixels };
      } finally {
        buffer.destroy();
      }
    },
  };
}
