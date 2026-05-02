# RealtimeRenderView

A lightweight, zero-dependency 3D model viewer built with raw WebGL2 and TypeScript. No Three.js — just shaders, buffers, and math.

## Features

- **PBR shading** — Cook-Torrance BRDF with Fresnel-Schlick, GGX NDF, and Smith geometry term
- **Image-Based Lighting** — Load any `.exr` HDR panorama; the app computes irradiance map, pre-filtered environment map, and BRDF LUT on the GPU at runtime
- **Skybox** — Environment rendered as a fullscreen-triangle skybox using the same pre-filtered cubemap
- **Model loading** — Drag-and-drop or file-picker for `.obj` and binary `.fbx` (ASCII FBX not supported)
- **Material controls** — Albedo (RGB), metallic, roughness, exposure
- **Tone mapping** — Linear / Reinhard / ACES / Uncharted 2 (selectable at runtime)
- **Orbit camera** — Mouse drag to rotate, scroll to zoom

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 6 |
| Bundler | Vite 8 |
| Rendering | WebGL2 (GLSL ES 3.00) |
| FBX decompression | fflate (zlib inflate for compressed FBX nodes) |

No external 3D framework. All math (vec3, mat4), loaders (OBJ, FBX, EXR), and rendering (PBR, IBL, camera) are implemented from scratch in `src/`.

## Getting Started

```bash
npm install
npm run dev
```

Then open `http://localhost:5173` in a browser that supports WebGL2 (all modern browsers do).

### Build for production

```bash
npm run build   # type-check + bundle
npm run preview # serve the dist/ folder locally
```

## Usage

1. **Load a model** — drag an `.obj` or `.fbx` file onto the canvas, or use the file picker. The mesh is auto-centered and normalized to a unit cube.
2. **Load an environment** — drag an `.exr` equirectangular HDR image. IBL maps are computed automatically and the skybox updates immediately.
3. **Tweak material** — adjust albedo, metallic, roughness, exposure, and tone mapping operator via the side panel.
4. **Orbit** — left-click drag to rotate, scroll wheel to zoom.

## Project Structure

```
src/
├── main.ts              # Entry point: GLSL shaders, UI wiring, render loop
├── math/
│   ├── vec3.ts          # 3-component vector operations
│   └── mat4.ts          # 4×4 matrix operations (multiply, perspective, lookAt)
├── renderer/
│   ├── Renderer.ts      # WebGL2 context + resize handling
│   ├── Shader.ts        # Shader compilation, uniform setters
│   ├── Mesh.ts          # VAO/VBO creation and draw call
│   ├── Camera.ts        # Perspective camera + orbit controls
│   └── IBL.ts           # GPU-side IBL precomputation (irradiance, prefilter, BRDF LUT)
└── loader/
    ├── OBJLoader.ts     # Wavefront OBJ parser → interleaved vertex buffer
    ├── FBXLoader.ts     # Binary FBX parser (v7.1–v7.7, 32-bit and 64-bit offsets)
    └── EXRLoader.ts     # OpenEXR reader (half-float, ZIP/ZIPS/uncompressed)
```

## Browser Requirements

WebGL2 is required. All evergreen browsers (Chrome 56+, Firefox 51+, Safari 15+, Edge 79+) support it.

## License

MIT
