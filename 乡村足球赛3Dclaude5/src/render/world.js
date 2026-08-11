// 3D 世界：场景、光照、球场、球员、足球、影子和转播机位。
// 比赛核心跑 30 Hz，渲染跑设备刷新率，中间用 alpha 插值，所以低帧也不会卡顿感。

import * as THREE from "three";
import { ATLAS_PIXELS } from "../art/atlas.js";
import { buildStadium } from "../art/stadium.js";
import { buildHumanoid } from "../art/humanoid.js";
import { applyPose, createPose, evaluatePlayerPose } from "../art/animation.js";
import { paintBallTexture, paintPlayerAtlas } from "../art/textures.js";
import { BALL, PSTATE } from "../core/constants.js";
import { clamp, damp, lerp } from "../core/mathx.js";
import { maxSpeedOf } from "../core/player.js";
import { TIME_OF_DAY } from "../content/regions.js";

function hexToColor(hex) {
  return new THREE.Color(hex);
}

// 三阶灰阶：MeshToonMaterial 用它把连续光照切成"暗部 / 中间调 / 亮部"三块，
// 这是动画片的核心观感——没有渐变糊，只有干净的色块和一条明暗交界线。
function createToonGradient(platform) {
  const canvas = platform.createCanvas(4, 1);
  const ctx = canvas.getContext("2d");
  // 暗部不能压太黑，否则膝盖、肩膀这些圆面上会出现脏兮兮的深色块
  const steps = ["#9a9aa4", "#cbc8bf", "#eeeade", "#ffffff"];
  steps.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(i, 0, 1, 1);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// 反向外壳描边：同一套骨骼再画一遍，沿法线外扩、只画背面。
// 偏移写在 begin_vertex 之后，所以会一起被蒙皮，跟着骨头动。
function makeOutlineMaterial(width) {
  const material = new THREE.MeshBasicMaterial({ color: 0x231d16, side: THREE.BackSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.outlineWidth = { value: width };
    shader.vertexShader = `uniform float outlineWidth;\n${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n\ttransformed += objectNormal * outlineWidth;",
    );
  };
  return material;
}

export function createRenderer(platform, quality = "high") {
  const renderer = new THREE.WebGLRenderer({
    canvas: platform.canvas,
    antialias: quality === "high",
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(quality === "low" ? 1 : platform.dpr);
  renderer.setSize(platform.width, platform.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  return renderer;
}

export function createWorld({ platform, renderer, match, home, away, culture, timeOfDay = "noon", quality = "high" }) {

  const scene = new THREE.Scene();
  const daylight = TIME_OF_DAY[timeOfDay] || TIME_OF_DAY.noon;
  const skyTop = hexToColor(culture.sky.top).lerp(hexToColor("#F0B27A"), daylight.warm * 0.55);
  const skyBottom = hexToColor(culture.sky.bottom).lerp(hexToColor("#F6C08A"), daylight.warm * 0.4);
  if (daylight.id === "night") {
    skyTop.multiplyScalar(0.22).add(new THREE.Color(0x0a1224));
    skyBottom.multiplyScalar(0.3).add(new THREE.Color(0x101a2c));
  }
  scene.background = skyBottom.clone();
  scene.fog = new THREE.FogExp2(skyBottom.clone().lerp(skyTop, 0.35), culture.fog.density * (daylight.id === "night" ? 1.6 : 1));

  // 天空穹顶：上下渐变，比纯色背景多一层空气感
  const skyGeom = new THREE.SphereGeometry(320, 16, 10);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: skyTop },
      bottomColor: { value: skyBottom },
    },
    vertexShader: `varying float vH;void main(){vH=normalize(position).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `uniform vec3 topColor;uniform vec3 bottomColor;varying float vH;void main(){float t=clamp(vH*0.9+0.35,0.0,1.0);gl_FragColor=vec4(mix(bottomColor,topColor,t),1.0);}`,
  });
  const sky = new THREE.Mesh(skyGeom, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // 皮克斯式三点布光：暖主光定形，天地反弹光把暗部提亮，冷轮廓光把人从背景里"抠"出来。
  const ambientColor = hexToColor(culture.lighting.ambient);
  const hemi = new THREE.HemisphereLight(skyTop.getHex(), hexToColor(culture.ground.grass).getHex(), 1.05 * daylight.exposure);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(
    hexToColor(culture.sky.sun).lerp(hexToColor("#FFB56B"), daylight.warm).getHex(),
    culture.lighting.intensity * daylight.exposure * (daylight.id === "night" ? 0.35 : 1.05),
  );
  const sunAngle = daylight.sunAngle;
  sun.position.set(Math.cos(sunAngle) * 60, Math.sin(sunAngle) * 70 + 18, -34);
  scene.add(sun);
  // 轮廓光从球场另一侧偏冷地打过来
  const rim = new THREE.DirectionalLight(
    hexToColor(daylight.id === "night" ? "#8FB4E8" : "#CFE4FF").getHex(),
    (daylight.id === "night" ? 0.5 : 0.62) * daylight.exposure,
  );
  rim.position.set(-Math.cos(sunAngle) * 40, 26, 52);
  scene.add(rim);
  const fill = new THREE.AmbientLight(ambientColor.getHex(), 0.5 * daylight.exposure);
  scene.add(fill);

  const stadium = buildStadium({
    format: match.format,
    culture,
    team: home,
    rivalTeam: away,
    createCanvas: platform.createCanvas,
    quality,
  });
  scene.add(stadium.group);

  // 夜灯：村里球场的四根大灯泡
  if (daylight.id === "night") {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const lamp = new THREE.PointLight(0xffe9c0, 1.35, 70, 1.6);
        lamp.position.set(sx * (match.format.pitch.length / 2 + 4), 9, sz * (match.format.pitch.width / 2 + 4));
        scene.add(lamp);
      }
    }
  }

  const camera = new THREE.PerspectiveCamera(46, platform.width / platform.height, 0.5, 420);
  camera.position.set(0, 17, 30);
  camera.lookAt(0, 0, 0);

  // ---------------- 球员 ----------------
  const shadowGeom = new THREE.CircleGeometry(0.55, 16);
  const shadowCanvas = platform.createCanvas(64, 64);
  const shadowCtx = shadowCanvas.getContext("2d");
  const shadowGrad = shadowCtx.createRadialGradient(32, 32, 2, 32, 32, 31);
  shadowGrad.addColorStop(0, "rgba(24,26,18,0.85)");
  shadowGrad.addColorStop(0.55, "rgba(24,26,18,0.42)");
  shadowGrad.addColorStop(1, "rgba(24,26,18,0)");
  shadowCtx.fillStyle = shadowGrad;
  shadowCtx.fillRect(0, 0, 64, 64);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: 0.75, depthWrite: false });
  const toonGradient = createToonGradient(platform);
  const outlineMaterial = makeOutlineMaterial(0.016);
  const views = new Map();
  for (const player of match.players) {
    const team = player.side === "home" ? home : away;
    const spec = team.players[player.index] || team.players[0];
    const kit = player.role === "G" ? team.keeperKit : team.kit;
    const canvas = platform.createCanvas(ATLAS_PIXELS, ATLAS_PIXELS);
    paintPlayerAtlas(canvas, { ...spec, id: `${team.id}-${spec.number}` }, kit, team.shortName);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    const material = new THREE.MeshToonMaterial({ map: texture, gradientMap: toonGradient });
    const humanoid = buildHumanoid(spec.body, material);

    const root = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.add(humanoid.mesh);
    // 描边壳：共用同一副骨架，所以不需要额外的姿态计算
    const outline = new THREE.SkinnedMesh(humanoid.mesh.geometry, outlineMaterial);
    outline.bind(humanoid.skeleton, humanoid.mesh.bindMatrix);
    outline.frustumCulled = false;
    outline.renderOrder = -1;
    tilt.add(outline);
    root.add(tilt);
    scene.add(root);

    const shadow = new THREE.Mesh(shadowGeom, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    scene.add(shadow);

    views.set(player.id, {
      player,
      spec,
      root,
      tilt,
      humanoid,
      shadow,
      texture,
      material,
      pose: createPose(),
      prev: { x: player.x, z: player.z, facing: player.facing },
      next: { x: player.x, z: player.z, facing: player.facing },
      breathT: Math.random() * 10,
    });
  }

  // ---------------- 足球 ----------------
  const ballCanvas = platform.createCanvas(128, 128);
  paintBallTexture(ballCanvas, 128);
  const ballTexture = new THREE.CanvasTexture(ballCanvas);
  ballTexture.colorSpace = THREE.SRGBColorSpace;
  const ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL.radius, 18, 12),
    new THREE.MeshToonMaterial({ map: ballTexture, gradientMap: toonGradient }),
  );
  scene.add(ballMesh);
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(BALL.radius * 1.5, 10), shadowMat.clone());
  ballShadow.rotation.x = -Math.PI / 2;
  scene.add(ballShadow);
  const ballPrev = { x: 0, y: BALL.radius, z: 0 };
  const ballNext = { x: 0, y: BALL.radius, z: 0 };

  const cameraState = { x: 0, y: 17, z: 30, targetX: 0, targetZ: 0, shake: 0, clock: 0 };
  const rollAxis = new THREE.Vector3();

  function captureTick() {
    for (const view of views.values()) {
      view.prev.x = view.next.x;
      view.prev.z = view.next.z;
      view.prev.facing = view.next.facing;
      view.next.x = view.player.x;
      view.next.z = view.player.z;
      // 角度插值要走最短路径
      let delta = view.player.facing - view.prev.facing;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      view.next.facing = view.prev.facing + delta;
    }
    ballPrev.x = ballNext.x;
    ballPrev.y = ballNext.y;
    ballPrev.z = ballNext.z;
    ballNext.x = match.ball.x;
    ballNext.y = match.ball.y;
    ballNext.z = match.ball.z;
  }

  function update(alpha, dt) {
    const ballX = lerp(ballPrev.x, ballNext.x, alpha);
    const ballY = lerp(ballPrev.y, ballNext.y, alpha);
    const ballZ = lerp(ballPrev.z, ballNext.z, alpha);
    ballMesh.position.set(ballX, ballY, ballZ);
    // 滚动：角速度 = 水平速度 / 半径，转轴垂直于速度方向
    const horiz = Math.hypot(match.ball.vx, match.ball.vz);
    if (horiz > 0.05) {
      rollAxis.set(-match.ball.vz / horiz, 0, match.ball.vx / horiz);
      ballMesh.rotateOnWorldAxis(rollAxis, (horiz * dt) / BALL.radius);
    }
    ballShadow.position.set(ballX, 0.03, ballZ);
    const heightFade = clamp(1 - ballY / 6, 0.15, 1);
    ballShadow.scale.setScalar(1 + ballY * 0.35);
    ballShadow.material.opacity = 0.3 * heightFade;

    for (const view of views.values()) {
      const { player } = view;
      const x = lerp(view.prev.x, view.next.x, alpha);
      const z = lerp(view.prev.z, view.next.z, alpha);
      const facing = lerp(view.prev.facing, view.next.facing, alpha);
      view.root.position.set(x, 0, z);
      view.root.rotation.y = facing;
      view.breathT += dt;

      const dx = ballX - x;
      const dz = ballZ - z;
      const rel = Math.atan2(dx, dz) - facing;
      const ballSide = Math.sin(rel);
      evaluatePlayerPose(view.pose, player, {
        breathT: view.breathT,
        ballSide,
        ballHigh: ballY > 0.9,
        maxSpeed: maxSpeedOf(player, match.weather),
      });
      applyPose(view.humanoid.bones, view.pose, 1);
      view.tilt.position.y = view.pose.rootY;
      view.tilt.rotation.set(view.pose.pitch, view.pose.yaw, view.pose.roll);
      view.shadow.position.set(x, 0.02, z);
      const flat = player.state === PSTATE.SLIDE || player.state === PSTATE.FALL || player.state === PSTATE.DIVE;
      view.shadow.scale.set(flat ? 2.1 : 1, flat ? 1.5 : 1, 1);
    }

    updateCamera(alpha, dt, ballX, ballY, ballZ);
    renderer.render(scene, camera);
  }

  // 竖屏（手机）用"顺着球场长边、从进攻方向背后跟拍"的机位：
  // 屏幕的竖向就是球场长度，横向是球场宽度，比例天然吻合。
  // 横屏（网页/平板）用传统转播侧机位。
  function updateCamera(alpha, dt, ballX, ballY, ballZ) {
    const halfL = match.format.pitch.length / 2;
    const halfW = match.format.pitch.width / 2;
    const portrait = camera.aspect < 1;
    const attackDir = match.controlledSide === "away" ? -1 : 1;
    cameraState.clock += dt;
    if (cameraState.shake > 0) cameraState.shake = Math.max(0, cameraState.shake - dt * 2.2);
    const shakeX = cameraState.shake ? Math.sin(cameraState.clock * 47) * cameraState.shake * 0.5 : 0;
    const shakeY = cameraState.shake ? Math.cos(cameraState.clock * 39) * cameraState.shake * 0.35 : 0;

    if (portrait) {
      const lead = clamp(match.ball.vx * attackDir * 0.28, -5, 5);
      const focusX = clamp(ballX + attackDir * (3.5 + lead), -halfL + 2, halfL - 2);
      const focusZ = clamp(ballZ * 0.55, -halfW * 0.6, halfW * 0.6);
      // 机位要高过端线后面的观众，否则最近的一个人会糊在镜头上
      const back = match.format.perSide >= 7 ? 19.5 : 17;
      const height = match.format.perSide >= 7 ? 14 : 12.2;
      // 球退到本方门前时，机位就在球门后面：抬高一点越过横梁，别让球网糊住画面
      const ownGoalX = -attackDir * halfL;
      const nearOwnGoal = clamp(1 - Math.abs(ballX - ownGoalX) / 14, 0, 1);
      cameraState.targetX = damp(cameraState.targetX, focusX, 3, dt);
      cameraState.targetZ = damp(cameraState.targetZ, focusZ, 2.6, dt);
      cameraState.x = damp(cameraState.x, clamp(ballX, -halfL - 3, halfL + 3) - attackDir * back, 2.6, dt);
      cameraState.y = damp(cameraState.y, height + nearOwnGoal * 4.2, 2, dt);
      cameraState.z = damp(cameraState.z, focusZ * 0.7, 2.4, dt);
      camera.fov = damp(camera.fov, 52, 2, dt);
    } else {
      const leadX = clamp(match.ball.vx * 0.35, -6, 6);
      const focusX = clamp(ballX + leadX, -halfL - 4, halfL + 4);
      const focusZ = clamp(ballZ * 0.7, -halfW, halfW);
      // 横屏是主玩法机位。拉这么近是因为乡村队的身材、背号和村寨名才是卖点，
      // 远机位下球员只有四十几像素高，脸和球衣全白做。
      const heightBase = match.format.perSide >= 7 ? 15.5 : 13.5;
      const back = match.format.perSide >= 7 ? 18.5 : 16;
      cameraState.targetX = damp(cameraState.targetX, focusX, 3.2, dt);
      cameraState.targetZ = damp(cameraState.targetZ, focusZ, 2.6, dt);
      cameraState.x = damp(cameraState.x, focusX * 0.72, 3, dt);
      cameraState.y = damp(cameraState.y, heightBase, 2, dt);
      cameraState.z = damp(cameraState.z, focusZ * 0.35 + back, 2.4, dt);
      camera.fov = damp(camera.fov, 46, 2, dt);
    }
    camera.updateProjectionMatrix();
    // 机位硬约束：任何情况下都不许飘进村子里或钻到看台后面
    const limitX = halfL + 8;
    camera.position.set(
      clamp(cameraState.x + shakeX, -limitX, limitX),
      Math.max(6, cameraState.y + shakeY),
      cameraState.z,
    );
    // 视线略抬，让远处的村子进画面
    camera.lookAt(cameraState.targetX, 1.9 + clamp(ballY * 0.2, 0, 1.4), cameraState.targetZ);
  }

  // 屏幕方向 → 球场方向。竖屏机位是顺着长边看，横屏是侧面转播位，换算规则不同。
  function screenToWorld(sx, sy) {
    const attackDir = match.controlledSide === "away" ? -1 : 1;
    if (camera.aspect < 1) return { x: -sy * attackDir, z: sx * attackDir };
    return { x: sx, z: sy };
  }

  function shake(amount = 0.5) {
    cameraState.shake = Math.min(1.2, cameraState.shake + amount);
  }

  function resize(width, height) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function dispose() {
    for (const view of views.values()) {
      view.humanoid.mesh.geometry.dispose();
      view.material.dispose();
      view.texture.dispose();
      scene.remove(view.root);
      scene.remove(view.shadow);
    }
    views.clear();
    toonGradient.dispose();
    outlineMaterial.dispose();
    stadium.dispose();
    ballMesh.geometry.dispose();
    ballTexture.dispose();
    shadowGeom.dispose();
    shadowMat.dispose();
    shadowTexture.dispose();
    skyGeom.dispose();
    skyMat.dispose();
  }

  return { renderer, scene, camera, views, captureTick, update, resize, shake, screenToWorld, dispose, stadium };
}
