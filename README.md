# RealtimeRenderView

A lightweight, zero-dependency 3D model viewer built with raw WebGL2 and TypeScript. No Three.js — just shaders, buffers, and math.

## Features

- **PBR shading** — Cook-Torrance microfacet BRDF: GGX NDF, Smith-Schlick-GGX geometry, Fresnel-Schlick
- **Image-Based Lighting** — Load any `.exr` HDR panorama; irradiance map, pre-filtered specular map, and BRDF LUT are computed on the GPU at load time
- **IBL rotation** — Rotate the environment around the Y axis at runtime; skybox and all lighting update together
- **Skybox** — Fullscreen-triangle skybox using the pre-filtered cubemap
- **Tone mapping** — Linear / Reinhard / ACES / Uncharted 2, selectable at runtime
- **Model loading** — Drag-and-drop or file-picker for `.obj` and binary `.fbx` (v7.1–v7.7)
- **Per-material controls** — Albedo (RGB), metallic, roughness per submesh
- **Orbit camera** — Left-drag to rotate, scroll to zoom, middle-drag to pan
- **VFX reference overlay** — Fixed top-right viewport showing three PBR-lit reference objects:
  - **Chrome ball** — metallic mirror (metallic 1.0 / roughness 0.0)
  - **Mid-grey ball** — 18 % diffuse reference (albedo 0.18 / roughness 1.0)
  - **Macbeth ColorChecker** — 24-patch color chart with linearized sRGB albedos, IBL-lit

## BRDF Model

Split-sum IBL approximation from *"Real Shading in Unreal Engine 4"* (Brian Karis, SIGGRAPH 2013):

```
L_o ≈ prefilteredColor(R, α) × (F × scale + bias)   // specular
     + irradiance(N) × albedo × kD                    // diffuse
```

| Component | Method |
|-----------|--------|
| NDF | GGX / Trowbridge-Reitz |
| Geometry | Smith-Schlick-GGX (`k = α² / 2`) |
| Fresnel | Schlick with roughness correction |
| Diffuse | Lambertian |
| Prefilter sampling | GGX importance sampling + Hammersley LDS (1024 samples) |
| BRDF LUT | Pre-integrated Schlick-Smith visibility (512 × 512) |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript 6 |
| Bundler | Vite 8 |
| Rendering | WebGL2 (GLSL ES 3.00) |
| FBX decompression | fflate |

No external 3D framework. All math, loaders, and rendering are implemented from scratch in `src/`.

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in any WebGL2-capable browser (Chrome 56+, Firefox 51+, Safari 15+, Edge 79+).

### Production build

```bash
npm run build   # type-check + bundle → dist/
npm run preview # serve dist/ locally
```

## Usage

1. **Load a model** — drag an `.obj` or `.fbx` onto the canvas, or use the file picker. The mesh is auto-centered and normalized to fit a unit cube.
2. **Load an environment** — drag an `.exr` equirectangular HDR image. IBL maps are precomputed automatically and the skybox appears immediately.
3. **Adjust lighting** — use the **IBL Rotation** slider to rotate the environment around the Y axis.
4. **Tweak materials** — adjust albedo, metallic, roughness per submesh, plus global exposure and tone mapping operator.
5. **Navigate** — left-drag to orbit, scroll to zoom, middle-drag to pan.
6. **Reference overlay** — the top-right panel shows the chrome ball, mid-grey ball, and Macbeth chart lit by the same IBL. Toggle with the **Ref Objects** checkbox.

## Project Structure

```
src/
├── main.ts              # Entry point: GLSL shaders, UI wiring, render loop
├── math/
│   ├── vec3.ts          # 3-component vector math
│   └── mat4.ts          # 4×4 matrix math (multiply, perspective, lookAt)
├── renderer/
│   ├── Renderer.ts      # WebGL2 context + DPI-aware resize
│   ├── Shader.ts        # Shader compilation and uniform setters
│   ├── Mesh.ts          # VAO/VBO/EBO creation and submesh draw calls
│   ├── Camera.ts        # Perspective camera + orbit/pan/zoom controls
│   ├── IBL.ts           # GPU IBL precomputation (irradiance, prefilter, BRDF LUT)
│   └── RefObjects.ts    # VFX reference geometry (sphere, Macbeth chart mesh)
└── loader/
    ├── OBJLoader.ts     # Wavefront OBJ parser → interleaved vertex buffer
    ├── FBXLoader.ts     # Binary FBX parser (v7.1–v7.7, 32/64-bit offsets)
    └── EXRLoader.ts     # OpenEXR reader (half-float, ZIP/ZIPS/uncompressed)
```

## License

MIT
