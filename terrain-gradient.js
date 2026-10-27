// Shared by flat and globe height passes. Each supplies sourceSize() and
// sourceValue(coord, layer) for its original, unresampled terrain texture.
export const SOURCE_GRADIENT_WGSL = `
fn gradientHeight(value: vec2f, center: vec2f) -> f32 {
    if (!(value.x >= -40000. && value.x <= 40000.) || sign(value.y) != sign(center.y)) {
        return center.x;
    }
    return value.x;
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
            let tl = gradientHeight(samples[index], center);
            let tc = gradientHeight(samples[index + 1], center);
            let tr = gradientHeight(samples[index + 2], center);
            let ml = gradientHeight(samples[index + 4], center);
            let mr = gradientHeight(samples[index + 6], center);
            let bl = gradientHeight(samples[index + 8], center);
            let bc = gradientHeight(samples[index + 9], center);
            let br = gradientHeight(samples[index + 10], center);
            var gradient = vec2f(
                -tl - 2. * ml - bl + tr + 2. * mr + br,
                -tl - 2. * tc - tr + bl + 2. * bc + br
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
