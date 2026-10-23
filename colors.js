export const COLOR_WGSL = `
fn encodeSRGBComponent(value: f32) -> f32 {
  return select(12.92 * value, 1.055 * pow(max(value, 0.0), 1.0 / 2.4) - 0.055, value > 0.0031308);
}

fn decodeSRGBComponent(value: f32) -> f32 {
  return select(value / 12.92, pow((value + 0.055) / 1.055, 2.4), value > 0.04045);
}

fn encodeSRGB(color: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    encodeSRGBComponent(color.r),
    encodeSRGBComponent(color.g),
    encodeSRGBComponent(color.b)
  );
}

fn decodeSRGB(color: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    decodeSRGBComponent(color.r),
    decodeSRGBComponent(color.g),
    decodeSRGBComponent(color.b)
  );
}

const LINEAR_SRGB_TO_LINEAR_P3 = mat3x3<f32>(
  0.82246210, 0.03319419, 0.01708263,
  0.17753790, 0.96680581, 0.07239744,
  0.00000000, 0.00000000, 0.91051993
);

const LINEAR_P3_TO_LINEAR_SRGB = mat3x3<f32>(
  1.22493997, -0.04205694, -0.01963755,
  -0.22493997, 1.04205694, -0.07863605,
  0.00000000, 0.00000000, 1.09827360
);

fn linearSRGBToOKLab(color: vec3<f32>) -> vec3<f32> {
  let l = 0.4122214708 * color.r + 0.5363325363 * color.g + 0.0514459929 * color.b;
  let m = 0.2119034982 * color.r + 0.6806995451 * color.g + 0.1073969566 * color.b;
  let s = 0.0883024619 * color.r + 0.2817188376 * color.g + 0.6299787005 * color.b;
  let root = sign(vec3<f32>(l, m, s)) * pow(abs(vec3<f32>(l, m, s)), vec3<f32>(1.0 / 3.0));
  return vec3<f32>(
    0.2104542553 * root.x + 0.7936177850 * root.y - 0.0040720468 * root.z,
    1.9779984951 * root.x - 2.4285922050 * root.y + 0.4505937099 * root.z,
    0.0259040371 * root.x + 0.7827717662 * root.y - 0.8086757660 * root.z
  );
}

fn linearSRGBToOKLab2(color: vec3<f32>) -> vec3<f32> {
  let l = 0.4122214708 * color.r + 0.5363325363 * color.g + 0.0514459929 * color.b;
  let m = 0.2119034982 * color.r + 0.6806995451 * color.g + 0.1073969566 * color.b;
  let s = 0.0883024619 * color.r + 0.2817188376 * color.g + 0.6299787005 * color.b;
  let root = sign(vec3<f32>(l, m, s)) * pow(abs(vec3<f32>(l, m, s)), vec3<f32>(1.0 / 3.0));
  let lab = vec3<f32>(
    0.2104542553 * root.x + 0.7936177850 * root.y - 0.0040720468 * root.z,
    1.9779984951 * root.x - 2.4285922050 * root.y + 0.4505937099 * root.z,
    0.0259040371 * root.x + 0.7827717662 * root.y - 0.8086757660 * root.z
  );
  let chroma = length(lab.yz);
  let chroma2 = sqrt(chroma) / 2.;
  let unit = select(vec2<f32>(0.0), lab.yz / chroma, chroma > 0.000001);
  return vec3<f32>(lab.x, chroma2 * unit);
}

fn p3ToOKLab(color: vec3<f32>) -> vec3<f32> {
  return linearSRGBToOKLab(LINEAR_P3_TO_LINEAR_SRGB * decodeSRGB(color));
}

fn linearP3ToOKLab(color: vec3<f32>) -> vec3<f32> {
  return linearSRGBToOKLab(LINEAR_P3_TO_LINEAR_SRGB * color);
}

fn oklabToP3(lab: vec3<f32>) -> vec3<f32> {
  return encodeSRGB(oklabToLinearP3(lab));
}

fn oklabToLinearP3(lab: vec3<f32>) -> vec3<f32> {
  let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  let s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  let lms = vec3<f32>(l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_);
  let linearSRGB = vec3<f32>(
    4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
    -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
    -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z
  );
  return LINEAR_SRGB_TO_LINEAR_P3 * linearSRGB;
}

fn oklab2ToLinearP3(lab2: vec3<f32>) -> vec3<f32> {
  let chroma2 = length(lab2.yz);
  let unscaledChroma2 = 2.0 * chroma2;
  let chroma = unscaledChroma2 * unscaledChroma2;
  let unit = select(vec2<f32>(0.0), lab2.yz / chroma2, chroma2 > 0.000001);
  let lab = vec3<f32>(lab2.x, chroma * unit);
  let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  let s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  let lms = vec3<f32>(l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_);
  let linearSRGB = vec3<f32>(
    4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
    -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
    -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z
  );
  return LINEAR_SRGB_TO_LINEAR_P3 * linearSRGB;
}

fn triangleWave(value: f32) -> f32 {
  return 2.0 * abs(2.0 * fract(value) - 1.0) - 1.0;
}

fn cosineWave(value: f32) -> f32 {
  return cos(6.2831853 * value);
}

fn forwardBoundaryDistance(value: f32, direction: f32, minimum: f32, maximum: f32) -> f32 {
  let big = 1.0e30;
  var distance = big;
  if (direction > 0.0) {
    distance = (maximum - value) / direction;
  } else if (direction < 0.0) {
    distance = (minimum - value) / direction;
  }
  return select(big, distance, distance > 0.0);
}

fn firstBoundaryHit(
  start: vec3<f32>,
  destination: vec3<f32>,
  minimum: vec3<f32>,
  maximum: vec3<f32>
) -> vec3<f32> {
  let direction = destination - start;
  let tx = forwardBoundaryDistance(start.x, direction.x, minimum.x, maximum.x);
  let ty = forwardBoundaryDistance(start.y, direction.y, minimum.y, maximum.y);
  let tz = forwardBoundaryDistance(start.z, direction.z, minimum.z, maximum.z);
  return clamp(start + direction * min(tx, min(ty, tz)), minimum, maximum);
}

fn colorMapAntarctica(t0: f32, selected: f32, emphasisWeight: f32, hdrScale: f32, emphasisEnabled: bool) -> vec3<f32> {
  let t = - t0;
  let coverage = 0.045 * 3.;
  let luminanceCoverage = 0.5;
  let luminanceCycle = mix((cosineWave(luminanceCoverage * t + 1.5) + 1.0) * 0.5, (triangleWave(luminanceCoverage * t + 1.5) + 1.0) * 0.5, 1.);
  let lightness = mix(0.2, 1.175 + 0.10 * t, luminanceCycle);
  let chromaStart = 0.077;
  let chromaMid = 0.21;
  let chromaEnd = 0.12;
  let chromaMidT = 0.5;
  let oneMinusChromaMidT = 1.0 - chromaMidT;
  let chromaControl = (
    chromaMid -
    oneMinusChromaMidT * oneMinusChromaMidT * chromaStart -
    chromaMidT * chromaMidT * chromaEnd
  ) / (2.0 * oneMinusChromaMidT * chromaMidT);
  let chroma = mix(
    mix(chromaStart, chromaControl, luminanceCycle),
    mix(chromaControl, chromaEnd, luminanceCycle),
    luminanceCycle
  );
  let angleOffset = 4.68;
  let angle = t * 6.2831853 * coverage + angleOffset;
  var lab = vec3<f32>(lightness, chroma * cos(angle), chroma * sin(angle));
  let emphasis = emphasisWeight;
  let minimumHdrLightness = 0.25;
  let potentialMax = oklabToLinearP3(lab);
  let neutral = oklabToLinearP3(vec3<f32>(lab.x, 0.0, 0.0));
  let hdrFactor = hdrScale;
  let boundary = firstBoundaryHit(neutral, potentialMax, vec3<f32>(0.0), vec3<f32>(4.));
  let peak = max(boundary.x, max(boundary.y, boundary.z));
  let saturatedBoundaryP3 = hdrFactor * boundary / max(peak, 0.000001);
  var saturatedP3 = mix(neutral, saturatedBoundaryP3, 0.999);
  let saturatedY = dot(saturatedP3, vec3<f32>(0.22897456, 0.69173852, 0.07928691));
  let scale = clamp(2. / saturatedY, 1.25, 1.75);
  saturatedP3 *= scale;
  let saturated = select(lab, linearP3ToOKLab(saturatedP3), emphasisEnabled);

  return mix(lab, saturated, emphasis);
}
fn colorMapThermal(t0: f32, selected: f32, emphasisWeight: f32, hdrScale: f32, emphasisEnabled: bool) -> vec3<f32> {
  let t = - t0;
  let coverage = 1.;
  let luminanceCycle = mix((cosineWave((1.0) * t * coverage + 1.5) + 1.0) * 0.5, (triangleWave((1.0) * t * coverage + 1.5) + 1.0) * 0.5, 0.25);
  let lightness = mix(0.19, 1.1 + 0.10 * ((t * coverage) % 1.), luminanceCycle);
  //let chroma = mix(0.025, 0.21, luminanceCycle);
  let chromaThickness = 0.3;
  let chroma = pow(mix(pow(0.1, chromaThickness), pow(0.2259, chromaThickness), luminanceCycle), 1. / chromaThickness);
  let angleOffset = 5.5;
  let angle = t * 6.2831853 * coverage + angleOffset;
  var lab = vec3<f32>(lightness, chroma * cos(angle), chroma * sin(angle));
  let threshold = 0.5;
  let thresh0 = 0.15;
  let thresh1 = 0.35;
  // if (t0 < thresh0) {
  //   let tRescale = t0 / thresh0;
  //   let temp = oklabToLinearP3(lab);
  //   let Yvec = vec3(0.22897456, 0.69173852, 0.07928691);
  //   let tempY = dot(temp, Yvec);
  //   let blue = vec3(0., 0.15, 1.);
  //   let blueY = dot(blue, Yvec);
  //   lab = linearP3ToOKLab(mix(temp, blue * (tempY/blueY * (1.)), tRescale));
  // }
  // else {
  //   if (t0 < thresh1) {
  //     let tRescale = 1.0 - (t0 - thresh0) / (thresh1 - thresh0);
  //     let temp = oklabToLinearP3(lab);
  //     let Yvec = vec3(0.22897456, 0.69173852, 0.07928691);
  //     let tempY = dot(temp, Yvec);
  //     let blue = vec3(0., 0.15, 1.);
  //     let blueY = dot(blue, Yvec);
  //     lab = linearP3ToOKLab(mix(temp, blue * (tempY/blueY * (1.)), mix(pow(tRescale, 2.), pow(tRescale, .5), tRescale)));
  //   }
  //   if (t0 < thresh1) {
  //     let tRescale = 1.0 - (t0 - thresh0) / (thresh1 - thresh0);
  //     let temp = oklabToLinearP3(lab);
  //     let Yvec = vec3(0.22897456, 0.69173852, 0.07928691);
  //     let tempY = dot(temp, Yvec);
  //     let blue = vec3(0.001, temp.g, temp.b);
  //     let blueY = dot(blue, Yvec);
  //     let oklabBlue = linearP3ToOKLab(blue * (tempY/blueY * (1.)));
  //     lab = linearP3ToOKLab(mix(temp, blue * (tempY/blueY * (1.)), clamp(0., 1.0, tRescale * 4.)));
  //   }
  // }
  if (t0 > threshold) {
    let tRescale = (t0 - threshold) / (1. - threshold);
    let temp = oklabToLinearP3(lab);
    let Yvec = vec3(0.22897456, 0.69173852, 0.07928691);
    let tempY = dot(temp, Yvec);
    let red = vec3(1., 0., 0.);
    let redY = dot(red, Yvec);
    let oklabRed = linearP3ToOKLab(red * (tempY/redY * (1.)));
    lab = mix(lab, oklabRed, mix(pow(tRescale, 2.0), pow(tRescale, 0.5), tRescale));
  }
  if (t0 > threshold) {
    let tRescale = (t0 - threshold) / (1. - threshold);
    let temp = oklabToLinearP3(lab);
    let Yvec = vec3(0.22897456, 0.69173852, 0.07928691);
    let tempY = dot(temp, Yvec);
    let red = vec3(temp.r, temp.g, 0.001);
    let redY = dot(red, Yvec);
    let oklabRed = linearP3ToOKLab(red * (tempY/redY * (1.)));
    lab = mix(lab, oklabRed, clamp(0., 1.0, (t0 - threshold) * 4.));
  }
  let emphasis = emphasisWeight;
  let potentialMax = oklabToLinearP3(lab);
  let neutral = oklabToLinearP3(vec3<f32>(lab.x, 0.0, 0.0));
  let hdrFactor = hdrScale;
  let boundary = firstBoundaryHit(neutral, potentialMax, vec3<f32>(0.0), vec3<f32>(4.));
  let peak = max(boundary.x, max(boundary.y, boundary.z));
  let saturatedBoundaryP3 = 4. * boundary / max(peak, 0.000001);
  var saturatedP3 = mix(neutral, saturatedBoundaryP3, 0.999);
  let saturatedY = dot(saturatedP3, vec3<f32>(0.22897456, 0.69173852, 0.07928691));
  let scale = clamp(2. / saturatedY, 1.25, 1.75);
  saturatedP3 *= scale;
  let saturated = select(lab, linearP3ToOKLab(saturatedP3), emphasisEnabled);

  return mix(lab, saturated, emphasis);
}
`;
