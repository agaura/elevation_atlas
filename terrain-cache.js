// Visible samples are mandatory. LRU budgets govern optional recently visited
// data; the renderer reports globe-atlas and screen-texture allocations too.
export function trimTerrain(cache, needed, {budget, gpuBudget, extraBytes = 0}) {
  const entries = [...cache].filter(([,entry]) => entry.state === 'ready');
  const sizeOf = entry => entry.size * entry.size * 8;
  let bytes = extraBytes, gpu = 0, mandatoryGpu = 0;
  for (const [key,entry] of entries) {
    entry.bytes = entry.values.byteLength + (entry.texture ? sizeOf(entry) : 0);
    bytes += entry.bytes;if (entry.texture) {gpu += sizeOf(entry);if(needed.has(key))mandatoryGpu+=sizeOf(entry);}
  }
  const optional = entries.filter(([key]) => !needed.has(key)).sort((a,b) => (a[1].used || 0) - (b[1].used || 0));
  for (const [,entry] of optional) {
    if (!entry.texture || (bytes <= budget && gpu <= mandatoryGpu + gpuBudget)) continue;
    const size = sizeOf(entry);entry.texture.destroy();delete entry.texture;
    entry.bytes -= size;bytes -= size;gpu -= size;
  }
  for (const [key,entry] of optional) {
    if (bytes <= budget) break;
    entry.refineAbort?.abort();entry.texture?.destroy();cache.delete(key);bytes -= entry.bytes;
  }
  return bytes;
}
