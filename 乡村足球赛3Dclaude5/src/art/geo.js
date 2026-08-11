// 极简顶点色几何构造器：所有静态场景物件塞进一个 BufferGeometry，
// 用一个 MeshLambertMaterial(vertexColors) 渲染，整片村庄只要 1 个 drawcall。

import * as THREE from "three";

const color = new THREE.Color();

export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.idx = [];
    this.matrix = new THREE.Matrix4();
    this.normalMatrix = new THREE.Matrix3();
    this.stack = [];
  }

  push(matrix) {
    this.stack.push(this.matrix.clone());
    this.matrix.multiply(matrix);
    this.normalMatrix.getNormalMatrix(this.matrix);
    return this;
  }

  pop() {
    this.matrix = this.stack.pop() || new THREE.Matrix4();
    this.normalMatrix.getNormalMatrix(this.matrix);
    return this;
  }

  at(x, y, z, rotY = 0, scale = 1) {
    const m = new THREE.Matrix4()
      .makeTranslation(x, y, z)
      .multiply(new THREE.Matrix4().makeRotationY(rotY))
      .multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
    return this.push(m);
  }

  addGeometry(geometry, hex, tint = 0) {
    const posAttr = geometry.getAttribute("position");
    const norAttr = geometry.getAttribute("normal");
    const index = geometry.getIndex();
    const base = this.pos.length / 3;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    color.set(hex);
    for (let i = 0; i < posAttr.count; i += 1) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(this.matrix);
      this.pos.push(v.x, v.y, v.z);
      if (norAttr) {
        n.fromBufferAttribute(norAttr, i).applyMatrix3(this.normalMatrix).normalize();
        this.nor.push(n.x, n.y, n.z);
      } else {
        this.nor.push(0, 1, 0);
      }
      // 每个面轻微色差，避免大色块死板
      const jitter = tint ? 1 + ((i * 37) % 11) / 11 * tint - tint / 2 : 1;
      this.col.push(color.r * jitter, color.g * jitter, color.b * jitter);
    }
    if (index) {
      for (let i = 0; i < index.count; i += 1) this.idx.push(base + index.getX(i));
    } else {
      for (let i = 0; i < posAttr.count; i += 1) this.idx.push(base + i);
    }
    geometry.dispose?.();
    return this;
  }

  box(w, h, d, hex, tint = 0.06) {
    return this.addGeometry(new THREE.BoxGeometry(w, h, d), hex, tint);
  }

  cyl(rTop, rBottom, h, hex, segments = 8, tint = 0.05) {
    return this.addGeometry(new THREE.CylinderGeometry(rTop, rBottom, h, segments), hex, tint);
  }

  sphere(r, hex, segments = 8, tint = 0.05) {
    return this.addGeometry(new THREE.SphereGeometry(r, segments, Math.max(4, segments / 2)), hex, tint);
  }

  plane(w, h, hex) {
    return this.addGeometry(new THREE.PlaneGeometry(w, h), hex, 0);
  }

  toGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    geometry.setIndex(this.idx);
    geometry.computeBoundingSphere();
    return geometry;
  }

  get triangleCount() {
    return this.idx.length / 3;
  }
}
