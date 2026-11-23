import * as THREE from 'three';

// Planar reflection of the scene about a horizontal plane (the wet street).
// Objects on layer 1 only (ground, rain, decals) are skipped by the mirror camera.
export class PlanarReflection {
  constructor(renderer, scale = 0.5) {
    this.scale = scale;
    this.planeY = 0;
    this.tilted = false;                      // when true, the plane is given by normal + point
    this.normal = new THREE.Vector3(0, 1, 0);
    this.point = new THREE.Vector3();
    this.camera = new THREE.PerspectiveCamera();
    this.textureMatrix = new THREE.Matrix4();
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this._v = {
      plane: new THREE.Plane(), normal: new THREE.Vector3(0, 1, 0), pp: new THREE.Vector3(),
      cam: new THREE.Vector3(), rot: new THREE.Matrix4(), look: new THREE.Vector3(),
      view: new THREE.Vector3(), target: new THREE.Vector3(), clip: new THREE.Vector4(), q: new THREE.Vector4(),
    };
    this.setSize(renderer);
  }

  setSize(renderer) {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt.setSize(Math.max(2, Math.floor(s.x * this.scale)), Math.max(2, Math.floor(s.y * this.scale)));
  }

  update(renderer, scene, camera) {
    const { plane, normal, pp, cam, rot, look, view, target, clip, q } = this._v;
    const vc = this.camera;
    cam.setFromMatrixPosition(camera.matrixWorld);
    if (!this.tilted) { this.normal.set(0, 1, 0); this.point.set(0, this.planeY, 0); }
    normal.copy(this.normal);
    pp.copy(cam).addScaledVector(normal, -normal.dot(view.subVectors(cam, this.point)));
    view.subVectors(pp, cam);
    if (view.dot(normal) > 0) return;
    view.reflect(normal).negate().add(pp);
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(cam);
    target.subVectors(pp, look).reflect(normal).negate().add(pp);
    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    vc.lookAt(target);
    vc.near = camera.near; vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);

    // Oblique near plane so nothing below the street leaks into the mirror image.
    plane.setFromNormalAndCoplanarPoint(normal, pp).applyMatrix4(vc.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = vc.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + pm[8]) / pm[0];
    q.y = (Math.sign(clip.y) + pm[9]) / pm[5];
    q.z = -1;
    q.w = (1 + pm[10]) / pm[14];
    clip.multiplyScalar(2 / clip.dot(q));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1 - 0.003; pm[14] = clip.w;

    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, vc);
    renderer.setRenderTarget(prevRT);
  }
}
