# AVIF encoder

Unmodified single-threaded encoder artifacts from `@jsquash/avif` **2.1.1**, published at https://registry.npmjs.org/@jsquash/avif/-/avif-2.1.1.tgz.

Package SHA-512 integrity:
`sha512-LMRxd0fMgfCLtobDh0/sFYJMMiRJTNYSEEWvRDKXlAeZ08t3gI5V+1thIT0XjXJ+SVG7Zug9B0XPyx0Ti5VRNA==`

Upstream: https://github.com/jamsinclair/jSquash/tree/main/packages/avif

Only the encoder JavaScript and WASM are shipped; they load on demand in an export worker. No build step, cross-origin isolation, CDN, or export server is needed. The wrapper includes libavif/libaom and related runtime/conversion code. License and patent texts are included alongside the binaries.

The application feeds native 12-bit PQ RGB samples with quality 100 and 4:4:4 identity-matrix coding, then writes consistent P3-D65/PQ color descriptions to both the AVIF container and AV1 sequence header. Codec artifacts are not patched. `avif-hdr.js` checks the pinned codec's reduced still-picture header structure before touching color fields.
