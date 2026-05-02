import { Renderer } from './renderer/Renderer';
import { Shader } from './renderer/Shader';
import { Mesh } from './renderer/Mesh';
import { Camera, attachOrbitControls } from './renderer/Camera';
import { parseOBJ, type SubMesh } from './loader/OBJLoader';
import { parseFBX } from './loader/FBXLoader';
import { loadEXR } from './loader/EXRLoader';
import { createIBL, type IBLMaps } from './renderer/IBL';
import { multiply } from './math/mat4';

// ── Skybox shaders ────────────────────────────────────────────────────────────
const SKYBOX_VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_ndc;
void main() {
  v_ndc = a_pos;
  gl_Position = vec4(a_pos, 0.9999, 1.0);
}`;

// Shared tone mapping GLSL (injected into both fragment shaders)
const TONEMAP_GLSL = `
uniform int u_tonemap; // 0=Linear 1=Reinhard 2=ACES 3=Uncharted2
vec3 applyTonemap(vec3 c) {
  if (u_tonemap == 1) {
    c = c / (c + vec3(1.0));
  } else if (u_tonemap == 2) {
    c = (c * (2.51*c + 0.03)) / (c * (2.43*c + 0.59) + 0.14);
  } else if (u_tonemap == 3) {
    // Uncharted 2 (John Hable)
    const float A=0.15, B=0.50, C=0.10, D=0.20, E=0.02, F=0.30, W=11.2;
    #define UC2(x) ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F
    c = UC2(c * 2.0) / UC2(vec3(W));
    #undef UC2
  }
  return pow(clamp(c, 0.0, 1.0), vec3(1.0/2.2));
}`;

const SKYBOX_FRAG = `#version 300 es
precision highp float;
in vec2 v_ndc;
uniform mat3 u_invViewRot;
uniform float u_fovTan;
uniform float u_aspect;
uniform samplerCube u_envMap;
uniform float u_exposure;
${TONEMAP_GLSL}
out vec4 outColor;
void main() {
  vec3 viewDir  = vec3(v_ndc.x * u_aspect * u_fovTan, v_ndc.y * u_fovTan, -1.0);
  vec3 worldDir = normalize(u_invViewRot * viewDir);
  vec3 color    = textureLod(u_envMap, worldDir, 1.5).rgb * pow(2.0, u_exposure);
  outColor = vec4(applyTonemap(color), 1.0);
}`;

// ── PBR shaders ───────────────────────────────────────────────────────────────
const VERT = `#version 300 es
in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
uniform mat4 u_mvp;
uniform mat4 u_model;
out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;
void main() {
  v_worldPos = (u_model * vec4(a_position, 1.0)).xyz;
  v_normal   = normalize(mat3(u_model) * a_normal);
  v_uv       = a_uv;
  gl_Position = u_mvp * vec4(a_position, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;

uniform vec3  u_eyePos;
uniform vec3  u_albedo;
uniform float u_metallic;
uniform float u_roughness;
uniform float u_exposure;

uniform samplerCube u_irradianceMap;
uniform samplerCube u_prefilterMap;
uniform sampler2D   u_brdfLUT;

${TONEMAP_GLSL}

out vec4 outColor;
const float PI = 3.14159265359;
const float MAX_LOD = 4.0;

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
vec3 fresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness) {
  return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

void main() {
  vec3  N     = normalize(v_normal);
  vec3  V     = normalize(u_eyePos - v_worldPos);
  vec3  R     = reflect(-V, N);
  float NdotV = max(dot(N, V), 0.0);

  vec3 F0 = mix(vec3(0.04), u_albedo, u_metallic);
  vec3 kS = fresnelSchlickRoughness(NdotV, F0, u_roughness);
  vec3 kD = (1.0 - kS) * (1.0 - u_metallic);

  vec3 irradiance       = texture(u_irradianceMap, N).rgb;
  vec3 diffuse          = irradiance * u_albedo;
  vec3 prefilteredColor = textureLod(u_prefilterMap, R, u_roughness * MAX_LOD).rgb;
  vec2 brdf             = texture(u_brdfLUT, vec2(NdotV, u_roughness)).rg;
  vec3 specular         = prefilteredColor * (kS * brdf.x + brdf.y);

  vec3 color = (kD * diffuse + specular) * pow(2.0, u_exposure);
  outColor = vec4(applyTonemap(color), 1.0);
}`;

// ── setup ─────────────────────────────────────────────────────────────────────
const canvas   = document.getElementById('canvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const shader   = new Shader(renderer.gl, VERT, FRAG);
const camera   = new Camera(canvas.width / canvas.height);
attachOrbitControls(camera, canvas);

const { gl } = renderer;

// Shared fullscreen triangle (same approach as IBL passes)
const fsTriBuf = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, fsTriBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
const fsTriVAO = gl.createVertexArray()!;
gl.bindVertexArray(fsTriVAO);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);

const skyboxShader = new Shader(gl, SKYBOX_VERT, SKYBOX_FRAG);

let mesh:    Mesh | null    = null;
let iblMaps: IBLMaps | null = null;

// ── per-material params ───────────────────────────────────────────────────────
interface MaterialParams {
  r: number; g: number; b: number;
  metallic: number; roughness: number;
}

let matParams: MaterialParams[] = [];

function makeSlider(
  label: string, min: number, max: number, step: number, defaultVal: number,
  onchange: (v: number) => void
): HTMLElement {
  const row   = document.createElement('div');
  row.className = 'ctrl';

  const lbl   = document.createElement('label');
  lbl.textContent = label;

  const input = document.createElement('input');
  input.type  = 'range';
  input.min   = String(min);
  input.max   = String(max);
  input.step  = String(step);
  input.value = String(defaultVal);

  const val   = document.createElement('span');
  val.textContent = defaultVal.toFixed(2);

  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = v.toFixed(2);
    onchange(v);
  });

  row.appendChild(lbl);
  row.appendChild(input);
  row.appendChild(val);
  return row;
}

function buildMaterialUI(submeshes: SubMesh[]): void {
  const container = document.getElementById('material-panels')!;
  container.innerHTML = '';
  matParams = submeshes.map(() => ({ r: 0.8, g: 0.8, b: 0.8, metallic: 0, roughness: 0.4 }));

  submeshes.forEach((sm, i) => {
    const p = matParams[i];

    const panel = document.createElement('div');
    panel.className = 'panel';

    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = sm.name;
    panel.appendChild(title);

    panel.appendChild(makeSlider('Roughness', 0.02, 1,    0.01, 0.4, v => { p.roughness = v; }));
    panel.appendChild(makeSlider('Metallic',  0,    1,    0.01, 0,   v => { p.metallic  = v; }));
    panel.appendChild(makeSlider('R',         0,    1,    0.01, 0.8, v => { p.r         = v; }));
    panel.appendChild(makeSlider('G',         0,    1,    0.01, 0.8, v => { p.g         = v; }));
    panel.appendChild(makeSlider('B',         0,    1,    0.01, 0.8, v => { p.b         = v; }));

    container.appendChild(panel);
  });
}

// ── render controls ───────────────────────────────────────────────────────────
function getFloat(id: string): number { return parseFloat((document.getElementById(id) as HTMLInputElement).value); }
function getInt(id: string): number   { return parseInt((document.getElementById(id) as HTMLSelectElement).value, 10); }

// ── IBL preview ───────────────────────────────────────────────────────────────
function showIBLPreview(data: Float32Array, imgW: number, imgH: number): void {
  const preview = document.getElementById('ibl-preview') as HTMLCanvasElement;
  const ph = 2048;
  const pw = ph * 2;
  preview.width  = pw;
  preview.height = ph;

  const ctx = preview.getContext('2d')!;
  const buf = new Uint8ClampedArray(pw * ph * 4);
  const aces = (v: number): number => {
    const t = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
    return Math.pow(Math.max(0, Math.min(1, t)), 1 / 2.2) * 255;
  };
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const sx = Math.min(Math.floor(x * imgW / pw), imgW - 1);
      const sy = Math.min(Math.floor(y * imgH / ph), imgH - 1);
      const si = (sy * imgW + sx) * 4;
      const di = (y * pw + x) * 4;
      buf[di]     = aces(data[si]);
      buf[di + 1] = aces(data[si + 1]);
      buf[di + 2] = aces(data[si + 2]);
      buf[di + 3] = 255;
    }
  }
  ctx.putImageData(new ImageData(buf, pw, ph), 0, 0);
  preview.style.display = 'block';
  document.getElementById('ibl-preview-wrap')!.style.display = 'block';
  document.getElementById('ibl-res')!.textContent = `${imgW} × ${imgH}`;
}

// ── mesh loading ──────────────────────────────────────────────────────────────
function normalizeMesh(vertices: Float32Array): Float32Array {
  let minX=Infinity, minY=Infinity, minZ=Infinity;
  let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
  for (let i = 0; i < vertices.length; i += 8) {
    minX=Math.min(minX,vertices[i]);   maxX=Math.max(maxX,vertices[i]);
    minY=Math.min(minY,vertices[i+1]); maxY=Math.max(maxY,vertices[i+1]);
    minZ=Math.min(minZ,vertices[i+2]); maxZ=Math.max(maxZ,vertices[i+2]);
  }
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2, cz=(minZ+maxZ)/2;
  const scale = 2 / Math.max(maxX-minX, maxY-minY, maxZ-minZ, 1e-4);
  const out = new Float32Array(vertices);
  for (let i = 0; i < out.length; i += 8) {
    out[i]   = (out[i]   - cx) * scale;
    out[i+1] = (out[i+1] - cy) * scale;
    out[i+2] = (out[i+2] - cz) * scale;
  }
  return out;
}

function loadOBJ(file: File): void {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = parseOBJ(e.target!.result as string);
      data.vertices = normalizeMesh(data.vertices);
      mesh?.dispose();
      mesh = new Mesh(gl, data, shader.program);
      buildMaterialUI(mesh.submeshes);
      document.getElementById('hint')!.style.display = 'none';
    } catch (err) {
      setStatus(`OBJ error: ${err}`);
    }
  };
  reader.readAsText(file);
}

function loadFBX(file: File): void {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = parseFBX(e.target!.result as ArrayBuffer);
      data.vertices = normalizeMesh(data.vertices);
      mesh?.dispose();
      mesh = new Mesh(gl, data, shader.program);
      buildMaterialUI(mesh.submeshes);
      document.getElementById('hint')!.style.display = 'none';
    } catch (err) {
      setStatus(`FBX error: ${err}`);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ── IBL loading ───────────────────────────────────────────────────────────────
function setStatus(msg: string): void {
  const el = document.getElementById('status')!;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function loadIBL(file: File): void {
  setStatus('Loading EXR…');
  const reader = new FileReader();
  reader.onerror = () => setStatus('EXR read error');
  reader.onload = e => {
    try {
      const img = loadEXR(e.target!.result as ArrayBuffer);
      showIBLPreview(img.data, img.width, img.height);
      setStatus('Computing IBL…');
      setTimeout(() => {
        try {
          iblMaps?.dispose();
          iblMaps = createIBL(gl, img.data, img.width, img.height);
          renderer.resize(); // restore viewport
          document.getElementById('hint')!.style.display = 'none';
          setStatus('');
        } catch (err) {
          console.error('IBL error:', err);
          setStatus(`IBL error: ${err}`);
        }
      }, 0);
    } catch (err) {
      console.error('EXR error:', err);
      setStatus(`EXR error: ${err}`);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ── file inputs ───────────────────────────────────────────────────────────────
const objInput = document.getElementById('objInput') as HTMLInputElement;
const iblInput = document.getElementById('iblInput') as HTMLInputElement;
objInput.addEventListener('change', () => {
  const f = objInput.files?.[0]; if (!f) return;
  if (f.name.toLowerCase().endsWith('.fbx')) loadFBX(f); else loadOBJ(f);
});
iblInput.addEventListener('change', () => { if (iblInput.files?.[0]) loadIBL(iblInput.files[0]); });

canvas.addEventListener('dragover', e => e.preventDefault());
canvas.addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer?.files[0];
  if (!f) return;
  const name = f.name.toLowerCase();
  if (name.endsWith('.obj')) loadOBJ(f);
  else if (name.endsWith('.fbx')) loadFBX(f);
  else if (name.endsWith('.exr')) loadIBL(f);
});

window.addEventListener('resize', () => {
  renderer.resize();
  camera.aspect = canvas.width / canvas.height;
});

// ── render loop ───────────────────────────────────────────────────────────────
function loop(): void {
  try {
  renderer.clear(0.08, 0.08, 0.10);

  // ── skybox ──────────────────────────────────────────────────────────────────
  if (iblMaps) {
    gl.disable(gl.DEPTH_TEST);
    skyboxShader.use();

    // Inverse view rotation = transpose of the 3x3 rotation in the view matrix
    // View matrix (column-major): col0=[v[0],v[1],v[2]], col1=[v[4],v[5],v[6]], col2=[v[8],v[9],v[10]]
    const v = camera.view;
    const invViewRot = new Float32Array([
      v[0], v[4], v[8],
      v[1], v[5], v[9],
      v[2], v[6], v[10],
    ]);
    skyboxShader.setUniformMatrix3fv('u_invViewRot', invViewRot);
    skyboxShader.setUniform1f('u_fovTan',  Math.tan(camera.fovY / 2));
    skyboxShader.setUniform1f('u_aspect',  camera.aspect);
    skyboxShader.setUniform1f('u_exposure', getFloat('exposure'));
    skyboxShader.setUniform1i('u_tonemap',  getInt('tonemap'));
    skyboxShader.setTextureCube('u_envMap', iblMaps.prefilterMap, 0);

    gl.bindVertexArray(fsTriVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
  }

  if (mesh && iblMaps) {
    shader.use();

    const mvp = multiply(camera.viewProjection, camera.model);
    shader.setUniformMatrix4fv('u_mvp',   mvp);
    shader.setUniformMatrix4fv('u_model', camera.model);
    shader.setUniform3fv('u_eyePos', camera.eye);
    shader.setUniform1f('u_exposure',   getFloat('exposure'));
    shader.setUniform1i('u_tonemap',    getInt('tonemap'));

    shader.setTextureCube('u_irradianceMap', iblMaps.irradianceMap, 0);
    shader.setTextureCube('u_prefilterMap',  iblMaps.prefilterMap,  1);
    shader.setTexture2D  ('u_brdfLUT',       iblMaps.brdfLUT,       2);

    for (let i = 0; i < mesh.submeshes.length; i++) {
      const sm = mesh.submeshes[i];
      const p  = matParams[i] ?? { r: 0.8, g: 0.8, b: 0.8, metallic: 0, roughness: 0.4 };
      shader.setUniform3f('u_albedo',    p.r, p.g, p.b);
      shader.setUniform1f('u_metallic',  p.metallic);
      shader.setUniform1f('u_roughness', p.roughness);
      mesh.drawSubmesh(sm.start, sm.count);
    }
  }

  } catch (err) {
    console.error('Render loop error:', err);
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
