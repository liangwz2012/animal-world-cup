// 人物与动作检查台（仅开发用，不进小游戏包）：
// 把一排不同身材的村民并排摆出来，可以切换动作、正反面和图集预览。
// 用法：inspect.html?pose=run&back=1&county=520000

import * as THREE from "three";
import { createBrowserPlatform } from "./platform/browser.js";
import { ATLAS_PIXELS } from "./art/atlas.js";
import { buildHumanoid } from "./art/humanoid.js";
import { applyPose, createPose, evaluatePlayerPose } from "./art/animation.js";
import { paintPlayerAtlas } from "./art/textures.js";
import { createUiLayer } from "./ui/layer.js";
import { createTeam, countiesOf } from "./content/teams.js";
import { PSTATE } from "./core/constants.js";
import { createPlayer, setState } from "./core/player.js";

const platform = createBrowserPlatform(document.getElementById("game"));
const params = new URLSearchParams(location.search);
const poseName = params.get("pose") || "run";
const back = params.get("back") === "1";
const provinceCode = params.get("province") || "520000";
const countyCode = params.get("county") || countiesOf(provinceCode)[0].code;
const showAtlas = params.get("atlas") === "1";

const renderer = new THREE.WebGLRenderer({ canvas: platform.canvas, antialias: true });
renderer.setPixelRatio(platform.dpr);
renderer.setSize(platform.width, platform.height, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc0d8);
scene.add(new THREE.HemisphereLight(0xdff0ff, 0x4e7f3e, 1.05));
const sun = new THREE.DirectionalLight(0xfff2d0, 1.1);
sun.position.set(6, 12, 8);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: 0x4e7f3e }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const team = createTeam({ provinceCode, countyCode, townIndex: 0, perSide: 7 });
const camera = new THREE.PerspectiveCamera(38, platform.width / platform.height, 0.1, 100);
const count = Math.max(1, Math.min(Number(params.get("count")) || 7, team.players.length));
const roster = team.players.slice(Number(params.get("from")) || 0, (Number(params.get("from")) || 0) + count);

const actors = [];
roster.forEach((spec, index) => {
  const canvas = platform.createCanvas(ATLAS_PIXELS, ATLAS_PIXELS);
  paintPlayerAtlas(canvas, { ...spec, id: `${team.id}-${spec.number}` }, spec.role === "G" ? team.keeperKit : team.kit, team.shortName);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const humanoid = buildHumanoid(spec.body, new THREE.MeshLambertMaterial({ map: texture }));
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.add(humanoid.mesh);
  root.add(tilt);
  root.position.set((index - (roster.length - 1) / 2) * 1.35, 0, 0);
  root.rotation.y = back ? Math.PI : 0;
  scene.add(root);

  const player = createPlayer({ id: index, side: "home", index, role: spec.role, number: spec.number, name: spec.name, ...spec });
  actors.push({ spec, humanoid, player, pose: createPose(), tilt, texture });
});

const layer = createUiLayer(platform);
if (showAtlas) {
  const size = Math.min(platform.width, platform.height) * 0.8;
  layer.addQuad({ texture: actors[0].texture, w: size, h: size, x: 10, y: 10, anchor: "top-left", depth: 50 });
}

const label = layer.createSurface(1024, 96);
label.ctx.fillStyle = "rgba(0,0,0,0.55)";
label.ctx.fillRect(0, 0, 1024, 96);
label.ctx.fillStyle = "#F5F0E1";
label.ctx.font = 'bold 34px "PingFang SC",sans-serif';
label.ctx.textBaseline = "middle";
label.ctx.fillText(
  `${team.fullName}  ·  动作：${poseName}  ·  ${back ? "背面（看号码）" : "正面"}`,
  20,
  50,
);
label.flush();
layer.addQuad({ texture: label.texture, w: Math.min(platform.width - 20, 620), h: Math.min(platform.width - 20, 620) * (96 / 1024), x: 10, y: platform.height - 60, anchor: "top-left", depth: 50 });

let clock = 0;
function frame() {
  requestAnimationFrame(frame);
  if (platform.pollResize?.()) {
    renderer.setSize(platform.width, platform.height, false);
    camera.aspect = platform.width / platform.height;
    camera.updateProjectionMatrix();
    layer.resize(platform.width, platform.height);
  }
  clock += 1 / 60;

  for (const actor of actors) {
    const { player } = actor;
    applyDemoState(player, poseName, clock);
    evaluatePlayerPose(actor.pose, player, { breathT: clock + player.index, ballSide: 0.4, ballHigh: false, maxSpeed: 7 });
    applyPose(actor.humanoid.bones, actor.pose, 1);
    actor.tilt.position.y = actor.pose.rootY;
    actor.tilt.rotation.set(actor.pose.pitch, actor.pose.yaw, actor.pose.roll);
  }

  const spread = actors.length * 1.35;
  const dist = Number(params.get("dist")) || Math.max(3.2, spread * 0.62);
  const eye = Number(params.get("eye")) || 1.4;
  camera.position.set(0, eye, dist);
  camera.lookAt(0, Number(params.get("look")) || 0.95, 0);
  renderer.render(scene, camera);
  layer.render(renderer);
}

function applyDemoState(player, name, t) {
  const cycle = t % 2.4;
  switch (name) {
    case "idle":
      player.speed = 0;
      player.anim.legPhase = (t * 0.15) % 1;
      setState(player, PSTATE.IDLE, 0);
      break;
    case "run":
      player.speed = 4.6;
      player.anim.legPhase = (player.anim.legPhase + (4.6 / 3.2) / 60) % 1;
      setState(player, PSTATE.RUN, 0);
      break;
    case "sprint":
      player.speed = 7;
      player.sprinting = true;
      player.anim.legPhase = (player.anim.legPhase + (7 / 4.1) / 60) % 1;
      setState(player, PSTATE.SPRINT, 0);
      break;
    case "shoot":
    case "pass":
    case "tackle":
    case "slide":
    case "header":
    case "dive":
    case "trap":
    case "celebrate":
    case "throw":
    case "fall": {
      const map = {
        shoot: PSTATE.SHOOT, pass: PSTATE.PASS, tackle: PSTATE.TACKLE, slide: PSTATE.SLIDE,
        header: PSTATE.HEADER, dive: PSTATE.DIVE, trap: PSTATE.TRAP, celebrate: PSTATE.CELEBRATE,
        throw: PSTATE.THROW, fall: PSTATE.FALL,
      };
      player.speed = name === "slide" ? 5 : 1.5;
      if (cycle < 1 / 60) {
        setState(player, map[name]);
        player.anim.kickLeg = 1;
      }
      player.stateT = Math.min(cycle, player.lockTotal || 0.5);
      player.lock = Math.max(0, (player.lockTotal || 0.5) - cycle);
      break;
    }
    default:
      player.speed = 3;
      setState(player, PSTATE.RUN, 0);
      break;
  }
}

frame();
window.__inspect = { scene, camera, actors, team };
