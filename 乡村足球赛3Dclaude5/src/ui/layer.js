// UI 层：正交相机 + 一组贴图四边形。像素坐标以左上角为原点、y 轴向下。
// 需要每帧移动的元素（摇杆、按键）只改变换矩阵，不重传贴图；
// 需要改内容的元素（比分、提示、菜单）才调用 flush() 重新上传。

import * as THREE from "three";

export function createUiLayer(platform) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, platform.width, 0, platform.height, -100, 100);
  camera.position.z = 10;
  const quads = [];
  const geometry = new THREE.PlaneGeometry(1, 1);

  function project(x, y) {
    return [x, y];
  }

  function addQuad({ texture, w, h, x = 0, y = 0, anchor = "center", opacity = 1, depth = 0, color = 0xffffff }) {
    const material = new THREE.MeshBasicMaterial({
      map: texture || null,
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      // 正交相机是"上小下大"的翻转 Y（top=0、bottom=height），投影矩阵行列式为负，
      // 三角形绕序因此整体反转。用双面渲染避免被背面剔除吃掉。
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = depth;
    scene.add(mesh);
    const quad = {
      mesh,
      material,
      w,
      h,
      anchor,
      setSize(nw, nh) {
        quad.w = nw;
        quad.h = nh;
        quad.setPosition(quad.x, quad.y);
      },
      setPosition(nx, ny) {
        quad.x = nx;
        quad.y = ny;
        const ax = anchor === "center" ? 0 : anchor.includes("left") ? quad.w / 2 : -quad.w / 2;
        const ay = anchor === "center" ? 0 : anchor.includes("top") ? quad.h / 2 : -quad.h / 2;
        mesh.position.set(nx + ax, ny + ay, 0);
        // 负的 Y 缩放把贴图翻回来：正交相机本身是 Y 向下的，两次翻转正好抵消
        mesh.scale.set(quad.w, -quad.h, 1);
      },
      setOpacity(value) {
        material.opacity = value;
      },
      setVisible(value) {
        mesh.visible = value;
      },
      setColor(hex) {
        material.color.set(hex);
      },
      setTexture(texture2) {
        material.map = texture2;
        material.needsUpdate = true;
      },
      dispose() {
        scene.remove(mesh);
        material.dispose();
      },
      x,
      y,
    };
    quad.setPosition(x, y);
    quads.push(quad);
    return quad;
  }

  function createSurface(w, h) {
    const canvas = platform.createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return {
      canvas,
      ctx,
      texture,
      width: w,
      height: h,
      clear() {
        ctx.clearRect(0, 0, w, h);
      },
      flush() {
        texture.needsUpdate = true;
      },
      dispose() {
        texture.dispose();
      },
    };
  }

  function resize(width, height) {
    camera.right = width;
    camera.bottom = height;
    camera.updateProjectionMatrix();
  }

  function render(renderer) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(scene, camera);
    renderer.autoClear = true;
  }

  function dispose() {
    for (const quad of quads) quad.dispose();
    geometry.dispose();
  }

  return { scene, camera, addQuad, createSurface, resize, render, dispose, project };
}
