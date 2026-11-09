// sRGB accents shared by CSS and the HDR map-ink shader.
export const DEFAULT_ACCENT = '#8fc5ff';
export const PALETTE_ACCENTS = {
  0: '#d6d6d6', // Grayscale
  5: '#ffe6ad', // Amber: pale honey
  10: '#edbdad', // Styx: rose gold
};
export function paletteAccent(palette) {
  return PALETTE_ACCENTS[palette] ?? DEFAULT_ACCENT;
}
function vector(hex) {
  return `vec3f(${[1, 3, 5].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(8)).join(',')})`;
}
export const PALETTE_ACCENT_WGSL = `
fn paletteAccent(palette: f32)->vec3f {
${Object.entries(PALETTE_ACCENTS).map(([id, hex]) => ` if(abs(palette-${id}.)<.5){return ${vector(hex)};}`).join('\n')}
 return ${vector(DEFAULT_ACCENT)};
}`;
