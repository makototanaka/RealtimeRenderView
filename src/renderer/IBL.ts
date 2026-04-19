import { Shader } from './Shader';

// ── shared vertex shader (3-vertex fullscreen triangle, location=0 required) ─
const QUAD_VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// face index → cubemap direction (follows OpenGL cubemap UV spec)
const FACE_DIR_FN = `
vec3 faceDir(int face, vec2 uv) {
  float s = uv.x * 2.0 - 1.0;
  float t = uv.y * 2.0 - 1.0;
  if (face == 0) return normalize(vec3( 1.0,  -t,  -s));
  if (face == 1) return normalize(vec3(-1.0,  -t,   s));
  if (face == 2) return normalize(vec3(   s, 1.0,   t));
  if (face == 3) return normalize(vec3(   s,-1.0,  -t));
  if (face == 4) return normalize(vec3(   s,  -t, 1.0));
                 return normalize(vec3(  -s,  -t,-1.0));
}`;

// equirectangular direction → UV
const EQUIRECT_FN = `
const float PI = 3.14159265359;
vec2 equirectUV(vec3 dir) {
  float phi   = atan(dir.z, dir.x);
  float theta = asin(clamp(dir.y, -1.0, 1.0));
  return vec2(phi / (2.0 * PI) + 0.5, theta / PI + 0.5);
}`;

// ── equirect → cubemap ───────────────────────────────────────────────────────
const EQUIRECT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_equirect;
uniform int u_face;
in vec2 v_uv;
out vec4 outColor;
${EQUIRECT_FN}
${FACE_DIR_FN}
void main() {
  vec3 dir = faceDir(u_face, v_uv);
  outColor = vec4(texture(u_equirect, equirectUV(dir)).rgb, 1.0);
}`;

// ── irradiance convolution ───────────────────────────────────────────────────
const IRRADIANCE_FRAG = `#version 300 es
precision highp float;
uniform samplerCube u_envMap;
uniform int u_face;
in vec2 v_uv;
out vec4 outColor;
const float PI = 3.14159265359;
${FACE_DIR_FN}
void main() {
  vec3 N = faceDir(u_face, v_uv);
  vec3 up    = abs(N.z) < 0.999 ? vec3(0,0,1) : vec3(1,0,0);
  vec3 right = normalize(cross(up, N));
  up = cross(N, right);

  vec3 irradiance = vec3(0.0);
  float delta = 0.04, samples = 0.0;
  for (float phi = 0.0; phi < 2.0*PI; phi += delta) {
    for (float theta = 0.0; theta < 0.5*PI; theta += delta) {
      vec3 tv = vec3(sin(theta)*cos(phi), sin(theta)*sin(phi), cos(theta));
      vec3 sv = tv.x*right + tv.y*up + tv.z*N;
      irradiance += texture(u_envMap, sv).rgb * cos(theta) * sin(theta);
      samples++;
    }
  }
  outColor = vec4(PI * irradiance / samples, 1.0);
}`;

// ── GGX prefilter ────────────────────────────────────────────────────────────
const PREFILTER_FRAG = `#version 300 es
precision highp float;
uniform samplerCube u_envMap;
uniform int u_face;
uniform float u_roughness;
uniform float u_envSize;
in vec2 v_uv;
out vec4 outColor;
const float PI = 3.14159265359;
const uint SAMPLES = 1024u;
${FACE_DIR_FN}

float RadicalInverse(uint bits) {
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return float(bits) * 2.3283064365386963e-10;
}
vec2 Hammersley(uint i, uint N) { return vec2(float(i)/float(N), RadicalInverse(i)); }

vec3 ImportanceSampleGGX(vec2 Xi, vec3 N, float a) {
  float phi      = 2.0 * PI * Xi.x;
  float cosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a*a - 1.0) * Xi.y));
  float sinTheta = sqrt(1.0 - cosTheta*cosTheta);
  vec3 H = vec3(cos(phi)*sinTheta, sin(phi)*sinTheta, cosTheta);
  vec3 up = abs(N.z) < 0.999 ? vec3(0,0,1) : vec3(1,0,0);
  vec3 T  = normalize(cross(up, N));
  vec3 B  = cross(N, T);
  return normalize(T*H.x + B*H.y + N*H.z);
}

float DistributionGGX(float NdotH, float a) {
  float a2    = a*a*a*a;
  float d     = NdotH*NdotH*(a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

void main() {
  vec3 N = faceDir(u_face, v_uv);
  vec3 V = N; // assume N=V=R for pre-filtering
  float a = u_roughness * u_roughness;

  vec3 color = vec3(0.0);
  float weight = 0.0;
  for (uint i = 0u; i < SAMPLES; i++) {
    vec2 Xi = Hammersley(i, SAMPLES);
    vec3 H  = ImportanceSampleGGX(Xi, N, a);
    vec3 L  = normalize(2.0*dot(V,H)*H - V);
    float NdotL = max(dot(N, L), 0.0);
    if (NdotL > 0.0) {
      float NdotH = max(dot(N,H), 0.0);
      float HdotV = max(dot(H,V), 0.0);
      float D     = DistributionGGX(NdotH, a);
      float pdf   = D * NdotH / (4.0*HdotV) + 0.0001;
      float saTexel  = 4.0 * PI / (6.0 * u_envSize * u_envSize);
      float saSample = 1.0 / (float(SAMPLES) * pdf + 0.0001);
      float mip = u_roughness == 0.0 ? 0.0 : 0.5 * log2(saSample / saTexel);
      color  += textureLod(u_envMap, L, mip).rgb * NdotL;
      weight += NdotL;
    }
  }
  outColor = vec4(color / weight, 1.0);
}`;

// ── BRDF LUT ─────────────────────────────────────────────────────────────────
const BRDF_LUT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
const float PI = 3.14159265359;
const uint SAMPLES = 1024u;

float RadicalInverse(uint bits) {
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return float(bits) * 2.3283064365386963e-10;
}
vec2 Hammersley(uint i, uint N) { return vec2(float(i)/float(N), RadicalInverse(i)); }

vec3 ImportanceSampleGGX(vec2 Xi, vec3 N, float a) {
  float phi      = 2.0 * PI * Xi.x;
  float cosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a*a - 1.0) * Xi.y));
  float sinTheta = sqrt(1.0 - cosTheta*cosTheta);
  vec3 H = vec3(cos(phi)*sinTheta, sin(phi)*sinTheta, cosTheta);
  vec3 up = abs(N.z) < 0.999 ? vec3(0,0,1) : vec3(1,0,0);
  vec3 T = normalize(cross(up, N)); vec3 B = cross(N, T);
  return normalize(T*H.x + B*H.y + N*H.z);
}

float GSchlickGGX(float NdotV, float roughness) {
  float k = (roughness*roughness) / 2.0;
  return NdotV / (NdotV*(1.0 - k) + k);
}

vec2 IntegrateBRDF(float NdotV, float roughness) {
  vec3 V = vec3(sqrt(1.0 - NdotV*NdotV), 0.0, NdotV);
  float scale = 0.0, bias = 0.0;
  vec3 N = vec3(0.0, 0.0, 1.0);
  float a = roughness * roughness;
  for (uint i = 0u; i < SAMPLES; i++) {
    vec2 Xi = Hammersley(i, SAMPLES);
    vec3 H  = ImportanceSampleGGX(Xi, N, a);
    vec3 L  = normalize(2.0*dot(V,H)*H - V);
    float NdotL = max(L.z, 0.0);
    float NdotH = max(H.z, 0.0);
    float VdotH = max(dot(V,H), 0.0);
    if (NdotL > 0.0) {
      float G    = GSchlickGGX(NdotV, roughness) * GSchlickGGX(NdotL, roughness);
      float GVis = (G * VdotH) / (NdotH * NdotV + 0.0001);
      float Fc   = pow(1.0 - VdotH, 5.0);
      scale += (1.0 - Fc) * GVis;
      bias  += Fc * GVis;
    }
  }
  return vec2(scale, bias) / float(SAMPLES);
}

void main() {
  outColor = vec4(IntegrateBRDF(v_uv.x, v_uv.y), 0.0, 1.0);
}`;

// ── IBL class ────────────────────────────────────────────────────────────────
export interface IBLMaps {
  irradianceMap: WebGLTexture;
  prefilterMap:  WebGLTexture;
  brdfLUT:       WebGLTexture;
  dispose():     void;
}

const ENV_SIZE        = 512;
const IRRADIANCE_SIZE = 32;
const PREFILTER_SIZE  = 128;
const PREFILTER_MIPS  = 5;
const LUT_SIZE        = 512;

export function createIBL(
  gl: WebGL2RenderingContext,
  equirectData: Float32Array,
  imgW: number,
  imgH: number,
): IBLMaps {
  if (!gl.getExtension('EXT_color_buffer_float'))
    throw new Error('EXT_color_buffer_float not supported');

  // Save GL state — we will modify it during precomputation
  const savedCullFace  = gl.isEnabled(gl.CULL_FACE);
  const savedDepthTest = gl.isEnabled(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DEPTH_TEST);

  // ── helpers ────────────────────────────────────────────────────────────────
  const fb = gl.createFramebuffer()!;

  // Fullscreen triangle — real vertex buffer ensures drawArrays works on all drivers
  const quadBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const quadVAO = gl.createVertexArray()!;
  gl.bindVertexArray(quadVAO);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  function renderPass(shader: Shader, uniforms: () => void): void {
    shader.use();
    uniforms();
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  function makeCubemap(size: number, mips: number): WebGLTexture {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
    gl.texStorage2D(gl.TEXTURE_CUBE_MAP, mips, gl.RGBA16F, size, size);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R,     gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, mips > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
    return tex;
  }

  function renderCubeFaces(
    label: string,
    targetTex: WebGLTexture,
    mip: number,
    size: number,
    shader: Shader,
    perFaceUniforms: (face: number) => void,
  ): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, size, size);
    for (let face = 0; face < 6; face++) {
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, targetTex, mip,
      );
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error(`${label} face ${face} mip ${mip}: framebuffer incomplete (${status})`);
      renderPass(shader, () => perFaceUniforms(face));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ── upload equirect (RGBA32F + Y-flip so v=0 is south pole) ────────────────
  const equirectTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, equirectTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, imgW, imgH, 0, gl.RGBA, gl.FLOAT, equirectData);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE);
  // OES_texture_float_linear enables bilinear on float textures; fall back to nearest
  const hasFloatLinear = !!gl.getExtension('OES_texture_float_linear');
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, hasFloatLinear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, hasFloatLinear ? gl.LINEAR : gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);

  // ── equirect → env cubemap ──────────────────────────────────────────────────
  const envMips = Math.floor(Math.log2(ENV_SIZE)) + 1; // 10 for 512
  const envMap = makeCubemap(ENV_SIZE, envMips);
  const equirectShader = new Shader(gl, QUAD_VERT, EQUIRECT_FRAG);
  renderCubeFaces('equirect→env', envMap, 0, ENV_SIZE, equirectShader, face => {
    equirectShader.setTexture2D('u_equirect', equirectTex, 0);
    equirectShader.setUniform1i('u_face', face);
  });
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, envMap);
  gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);

  // ── irradiance map ──────────────────────────────────────────────────────────
  const irradianceMap = makeCubemap(IRRADIANCE_SIZE, 1);
  const irradianceShader = new Shader(gl, QUAD_VERT, IRRADIANCE_FRAG);
  renderCubeFaces('irradiance', irradianceMap, 0, IRRADIANCE_SIZE, irradianceShader, face => {
    irradianceShader.setTextureCube('u_envMap', envMap, 0);
    irradianceShader.setUniform1i('u_face', face);
  });

  // ── specular prefilter map ──────────────────────────────────────────────────
  const prefilterMap = makeCubemap(PREFILTER_SIZE, PREFILTER_MIPS);
  const prefilterShader = new Shader(gl, QUAD_VERT, PREFILTER_FRAG);
  for (let mip = 0; mip < PREFILTER_MIPS; mip++) {
    const mipSize = Math.max(1, PREFILTER_SIZE >> mip);
    const roughness = mip / (PREFILTER_MIPS - 1);
    renderCubeFaces(`prefilter mip${mip}`, prefilterMap, mip, mipSize, prefilterShader, face => {
      prefilterShader.setTextureCube('u_envMap', envMap, 0);
      prefilterShader.setUniform1i('u_face', face);
      prefilterShader.setUniform1f('u_roughness', roughness);
      prefilterShader.setUniform1f('u_envSize', ENV_SIZE);
    });
  }

  // ── BRDF integration LUT (RGBA16F to avoid RG16F renderbuffer issues) ───────
  const brdfLUT = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, brdfLUT);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, LUT_SIZE, LUT_SIZE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindTexture(gl.TEXTURE_2D, null);

  const brdfShader = new Shader(gl, QUAD_VERT, BRDF_LUT_FRAG);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, brdfLUT, 0);
  const lutStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (lutStatus !== gl.FRAMEBUFFER_COMPLETE)
    throw new Error(`BRDF LUT framebuffer incomplete (${lutStatus})`);
  gl.viewport(0, 0, LUT_SIZE, LUT_SIZE);
  renderPass(brdfShader, () => {});
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // ── cleanup ─────────────────────────────────────────────────────────────────
  equirectShader.dispose();
  irradianceShader.dispose();
  prefilterShader.dispose();
  brdfShader.dispose();
  gl.deleteTexture(equirectTex);
  gl.deleteFramebuffer(fb);
  gl.deleteVertexArray(quadVAO);
  gl.deleteBuffer(quadBuf);

  // Restore GL state
  if (savedCullFace)  gl.enable(gl.CULL_FACE);
  if (savedDepthTest) gl.enable(gl.DEPTH_TEST);

  return {
    irradianceMap,
    prefilterMap,
    brdfLUT,
    dispose() {
      gl.deleteTexture(irradianceMap);
      gl.deleteTexture(prefilterMap);
      gl.deleteTexture(brdfLUT);
      gl.deleteTexture(envMap);
    },
  };
}
