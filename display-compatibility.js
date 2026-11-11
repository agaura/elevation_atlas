// Media queries describe the combined browser/output capability, independently
// of whether the WebGPU canvas accepts an HDR or Display P3 configuration.
export function setupDisplayCompatibility() {
  const hdr = matchMedia('(dynamic-range: high)');
  const gamut = matchMedia('(color-gamut: p3)');
  const palette = document.getElementById('palette');
  for (const option of palette.options) option.dataset.name = option.textContent;

  function update() {
    const missingHdr = !hdr.matches;
    const missingGamut = !gamut.matches;
    document.getElementById('display-footnotes').hidden = !missingHdr && !missingGamut;
    document.getElementById('hdr-footnote').hidden = !missingHdr;
    document.getElementById('gamut-footnote').hidden = !missingGamut;
    for (const option of palette.options) {
      const grayscale = option.value === '0';
      const styx = option.value === '10';
      option.textContent = option.dataset.name
        + (missingHdr && !grayscale ? ' *' : '')
        + (missingGamut && !grayscale && !styx ? ' †' : '');
    }
    for (const marker of document.querySelectorAll('[data-hdr-marker]')) {
      marker.hidden = !missingHdr;
      const input = marker.closest('label').querySelector('input');
      if (missingHdr) input.setAttribute('aria-describedby', 'hdr-footnote');
      else input.removeAttribute('aria-describedby');
    }
    const selected = palette.selectedOptions[0];
    const notes = [];
    if (missingHdr && selected.value !== '0') notes.push('hdr-footnote');
    if (missingGamut && !['0', '10'].includes(selected.value)) notes.push('gamut-footnote');
    if (notes.length) palette.setAttribute('aria-describedby', notes.join(' '));
    else palette.removeAttribute('aria-describedby');
  }
  hdr.addEventListener('change', update);
  gamut.addEventListener('change', update);
  palette.addEventListener('change', update);
  update();
}
