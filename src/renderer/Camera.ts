import { perspective, lookAt, identity, multiply, type Mat4 } from '../math/mat4';

export class Camera {
  yaw = 0;
  pitch = 0.3;
  distance = 3;
  fovY = Math.PI / 4;
  near = 0.01;
  far = 1000;
  panX = 0;
  panY = 0;
  panZ = 0;

  get view(): Mat4 {
    return lookAt(this.eye, [this.panX, this.panY, this.panZ], [0,1,0]);
  }

  get projection(): Mat4 {
    return perspective(this.fovY, this.aspect, this.near, this.far);
  }

  get viewProjection(): Mat4 {
    return multiply(this.projection, this.view);
  }

  get eye(): [number,number,number] {
    return [
      this.panX + this.distance * Math.sin(this.yaw) * Math.cos(this.pitch),
      this.panY + this.distance * Math.sin(this.pitch),
      this.panZ + this.distance * Math.cos(this.yaw) * Math.cos(this.pitch),
    ];
  }

  aspect: number;
  constructor(aspect: number) { this.aspect = aspect; }

  get model(): Mat4 {
    return identity();
  }
}

export function attachOrbitControls(camera: Camera, canvas: HTMLCanvasElement): void {
  let orbiting = false;
  let panning  = false;
  let lastX = 0, lastY = 0;

  canvas.addEventListener('mousedown', e => {
    if (e.button === 1) { panning = true; e.preventDefault(); }
    else                { orbiting = true; }
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => { orbiting = false; panning = false; });
  window.addEventListener('mousemove', e => {
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;

    if (orbiting) {
      camera.yaw   -= dx * 0.005;
      camera.pitch  = Math.max(-Math.PI/2 + 0.05, Math.min(Math.PI/2 - 0.05, camera.pitch + dy * 0.005));
    }
    if (panning) {
      const speed = camera.distance * 0.001;
      const { yaw, pitch } = camera;
      // camera right vector (world space)
      const rx =  Math.cos(yaw);
      const rz = -Math.sin(yaw);
      // camera up vector (world space, derived from lookAt convention)
      const ux = -Math.sin(pitch) * Math.sin(yaw);
      const uy =  Math.cos(pitch);
      const uz = -Math.sin(pitch) * Math.cos(yaw);

      camera.panX -= (rx * dx + ux * dy) * speed;
      camera.panY +=            uy * dy  * speed;
      camera.panZ -= (rz * dx + uz * dy) * speed;
    }
  });

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('wheel', e => {
    camera.distance = Math.max(0.5, Math.min(100, camera.distance * (1 + e.deltaY * 0.001)));
  }, { passive: true });

  // Touch support
  let lastTouchDist = 0;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) { orbiting = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; }
    if (e.touches.length === 2) { lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
  });
  canvas.addEventListener('touchend', () => { orbiting = false; });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && orbiting) {
      const dx = e.touches[0].clientX - lastX;
      const dy = e.touches[0].clientY - lastY;
      lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      camera.yaw   -= dx * 0.005;
      camera.pitch  = Math.max(-Math.PI/2 + 0.05, Math.min(Math.PI/2 - 0.05, camera.pitch + dy * 0.005));
    }
    if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      camera.distance = Math.max(0.5, Math.min(100, camera.distance * (lastTouchDist / dist)));
      lastTouchDist = dist;
    }
  }, { passive: false });
}
