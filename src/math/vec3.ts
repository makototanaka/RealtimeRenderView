export type Vec3 = [number, number, number];

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}

export function normalize(a: Vec3): Vec3 {
  const len = Math.sqrt(dot(a, a));
  return len > 0 ? [a[0]/len, a[1]/len, a[2]/len] : [0,0,0];
}

export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}
