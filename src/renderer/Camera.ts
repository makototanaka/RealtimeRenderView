import { perspective, lookAt, identity, multiply, type Mat4 } from '../math/mat4';

export class Camera {
  yaw = 0;
  pitch = 0.3;
  distance = 3;
  fovY = Math.PI / 4;
  near = 0.01;
  far = 1000;

  get view(): Mat4 {
    const eye: [number,number,number] = [
      this.distance * Math.sin(this.yaw) * Math.cos(this.pitch),
      this.distance * Math.sin(this.pitch),
      this.distance * Math.cos(this.yaw) * Math.cos(this.pitch),
    ];
    return lookAt(eye, [0,0,0], [0,1,0]);
  }

  get projection(): Mat4 {
    return perspective(this.fovY, this.aspect, this.near, this.far);
  }

  get viewProjection(): Mat4 {
    return multiply(this.projection, this.view);
  }

  get eye(): [number,number,number] {
    return [
      this.distance * Math.sin(this.yaw) * Math.cos(this.pitch),
      this.distance * Math.sin(this.pitch),
      this.distance * Math.cos(this.yaw) * Math.cos(this.pitch),
    ];
  }

  aspect: number;
  constructor(aspect: number) { this.aspect = aspect; }

  get model(): Mat4 {
    return identity();
  }
}

export function attachOrbitControls(camera: Camera, canvas: HTMLCanvasElement): void {
  let dragging = false;
  let lastX = 0, lastY = 0;

  canvas.addEventListener('mousedown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    camera.yaw   -= dx * 0.005;
    camera.pitch  = Math.max(-Math.PI/2 + 0.05, Math.min(Math.PI/2 - 0.05, camera.pitch + dy * 0.005));
  });

  canvas.addEventListener('wheel', e => {
    camera.distance = Math.max(0.5, Math.min(100, camera.distance * (1 + e.deltaY * 0.001)));
  }, { passive: true });

  // Touch support
  let lastTouchDist = 0;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) { dragging = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; }
    if (e.touches.length === 2) { lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
  });
  canvas.addEventListener('touchend', () => { dragging = false; });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && dragging) {
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
