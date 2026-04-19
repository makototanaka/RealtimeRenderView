import { type Vec3, cross, normalize, dot, sub } from './vec3';

export type Mat4 = Float32Array;

export function identity(): Mat4 {
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i + k*4] * b[k + j*4];
      out[i + j*4] = s;
    }
  }
  return out;
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const f = normalize(sub(center, eye));
  const s = normalize(cross(f, up));
  const u = cross(s, f);
  const out = new Float32Array(16);
  out[0]=s[0]; out[4]=s[1]; out[8]=s[2];  out[12]=-dot(s,eye);
  out[1]=u[0]; out[5]=u[1]; out[9]=u[2];  out[13]=-dot(u,eye);
  out[2]=-f[0];out[6]=-f[1];out[10]=-f[2];out[14]=dot(f,eye);
  out[15]=1;
  return out;
}

export function rotateX(m: Mat4, angle: number): Mat4 {
  const c = Math.cos(angle), s = Math.sin(angle);
  const r = new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);
  return multiply(m, r);
}

export function rotateY(m: Mat4, angle: number): Mat4 {
  const c = Math.cos(angle), s = Math.sin(angle);
  const r = new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
  return multiply(m, r);
}
