// Shared by flat and globe height passes. Each supplies sourceSize() and
// sourceValue(coord, layer) for its original, unresampled terrain texture.
export const SOURCE_GRADIENT_WGSL = `
// Missing sides do not define a slope. Replacing them with the center height
// can create artificial diagonal Sobel differences along irregular masks.
fn gradientDifference(a: vec2f, b: vec2f, center: vec2f) -> f32 {
    let validA = a.x >= -40000. && a.x <= 40000. && sign(a.y) == sign(center.y);
    let validB = b.x >= -40000. && b.x <= 40000. && sign(b.y) == sign(center.y);
    if (!(validA && validB)) { return 0.; }
    return b.x - a.x;
}

fn sourceEdge(xy: vec2f, referenceKind: f32, layer: i32) -> f32 {
    let limit = sourceSize() - 1;
    let position = clamp(xy, vec2f(0.), vec2f(limit));
    let base = vec2i(floor(position));
    let fraction = fract(position);

    // Four adjacent Sobel stencils share a 4x4 neighborhood (16 loads).
    var samples: array<vec2f, 16>;
    for (var y = 0; y < 4; y++) {
        for (var x = 0; x < 4; x++) {
            let coord = clamp(base + vec2i(x - 1, y - 1), vec2i(0), limit);
            samples[y * 4 + x] = sourceValue(coord, layer).rg;
        }
    }

    var edges: array<f32, 4>;
    for (var y = 0; y < 2; y++) {
        for (var x = 0; x < 2; x++) {
            let index = y * 4 + x;
            let center = samples[index + 5];
            edges[y * 2 + x] = 0.;
            if (!(center.x >= -40000. && center.x <= 40000.) || sign(center.y) != sign(referenceKind)) {
                continue;
            }
            var gradient = vec2f(
                gradientDifference(samples[index], samples[index + 2], center)
                + 2. * gradientDifference(samples[index + 4], samples[index + 6], center)
                + gradientDifference(samples[index + 8], samples[index + 10], center),
                gradientDifference(samples[index], samples[index + 8], center)
                + 2. * gradientDifference(samples[index + 1], samples[index + 9], center)
                + gradientDifference(samples[index + 2], samples[index + 10], center)
            );

            // One-sided derivatives preserve a planar slope at tile boundaries.
            let coord = base + vec2i(x, y);
            let span = clamp(coord + 1, vec2i(0), limit) - clamp(coord - 1, vec2i(0), limit);
            gradient *= 2. / vec2f(max(span, vec2i(1)));
            edges[y * 2 + x] = length(gradient) * max(1., abs(center.y));
        }
    }
    return mix(mix(edges[0], edges[1], fraction.x), mix(edges[2], edges[3], fraction.x), fraction.y);
}
`;
