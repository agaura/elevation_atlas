// Native interleaved elevation and water/texel-spacing metadata stay float32.
export function uploadTerrainTexture(device,entry){
 if(entry.texture)return;
 entry.texture=device.createTexture({size:[entry.size,entry.size],format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});
 device.queue.writeTexture({texture:entry.texture},entry.values,{bytesPerRow:entry.size*8},[entry.size,entry.size]);
 entry.textureVersion=(entry.textureVersion||0)+1;
 entry.bytes=entry.values.byteLength+entry.size*entry.size*8;
}
