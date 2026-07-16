import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const repoDir = path.resolve(projectDir, "..");
const sourceRuntime = path.join(repoDir, "public/match-runtime-min");
const sourceAnimalCup = path.join(repoDir, "public/animal-cup");
const sourceCocosAnimalFootball = path.join(repoDir, "wechat-minigame-cocos-production/assets/resources/animal_football");
const generatedDir = path.join(projectDir, "generated");
const assetsDir = path.join(projectDir, "runtime-assets");
const shellAssetsDir = path.join(projectDir, "shell-assets");
// 暂存目录必须位于微信小游戏项目根目录之外。开发者工具会实时扫描项目，
// 如果刚好在构建时抓到这些瞬态文件，真机预览随后会因原子替换而报 ENOENT。
const stagingRootDir = path.join(repoDir, ".wechat-minigame-original-runtime-latest-build");
const generatedStagingDir = path.join(stagingRootDir, "generated");
const assetsStagingDir = path.join(stagingRootDir, "runtime-assets");
const shellAssetsStagingDir = path.join(stagingRootDir, "shell-assets");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  const last = source.lastIndexOf(needle);
  if (first < 0 || first !== last) {
    throw new Error(`${label} 预期命中 1 次，实际 ${first < 0 ? 0 : "多于 1"} 次`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function disableSwigRuntimeCompiler(source, label) {
  const marker = 'new Function("_swig","_ctx","_filters","_utils","_fn",';
  const functionIndex = source.indexOf(marker);
  if (functionIndex < 0 || source.lastIndexOf(marker) !== functionIndex) {
    throw new Error(`${label} 的 Swig 动态编译点数量异常`);
  }
  const tryIndex = source.lastIndexOf("try{", functionIndex);
  const assignmentStart = tryIndex + 4;
  const assignmentPrefix = source.slice(assignmentStart, functionIndex);
  if (!/^[A-Za-z_$][\w$]*=$/.test(assignmentPrefix)) {
    throw new Error(`${label} 无法识别 Swig 赋值变量: ${assignmentPrefix}`);
  }
  const catchIndex = source.indexOf("}catch(", functionIndex);
  if (catchIndex < 0) throw new Error(`${label} 无法识别 Swig catch 边界`);
  const variable = assignmentPrefix.slice(0, -1);
  const replacement = `${variable}=function(){throw new Error("Swig runtime template compilation is disabled in the static WeChat build")}`;
  return source.slice(0, assignmentStart) + replacement + source.slice(catchIndex);
}

// ⛔ 真机根因修复（配合 src/platform/adapter.js 的 patchImage）：真机上 wx image 的
// 原生 src 属性绝不能被 defineProperty/delete（会永久摧毁原生加载回调，导致所有图片
// 静默加载失败——DevTools 正常、真机全挂）。适配层因此不再拦截 src，改为提供全新的
// __acSrc 访问器做路径归一化 + data URI 转换后普通赋值给原生 src。这里把打包产物中
// 所有 `.src=` 赋值改写为走该访问器。`.src==` 比较（负向前瞻排除）、字符串常量
// （base64 不含 "."）、`.srcset=`/`.fakeSrc=`（属性名不同）均不受影响。
function rewriteImageSrcAssignments(source, label, expectAtLeast = 0) {
  const matches = source.match(/\.src\s*=(?!=)/g) || [];
  if (matches.length < expectAtLeast) {
    throw new Error(`${label} 预期至少 ${expectAtLeast} 处 .src= 赋值，实际 ${matches.length}`);
  }
  console.log(`[build] ${label}: 已改写 ${matches.length} 处 .src= 赋值 → .__acSrc=`);
  return source.replace(/\.src\s*=(?!=)/g, ".__acSrc=");
}

function assertNoDynamicCode(source, label) {
  const newFunction = source.match(/\bnew\s+Function\s*\(/g) || [];
  const directEval = source.match(/(^|[^\w$])eval\s*\(/g) || [];
  if (newFunction.length || directEval.length) {
    throw new Error(`${label} 仍含动态代码：new Function=${newFunction.length}, eval=${directEval.length}`);
  }
}

function patchMatch(source) {
  const messageNeedle = `e.prototype.compile=function(t){return new Function("this['"+this.globalName+"']="+this.functions()+";return "+this.precompile(this.parse(t)))()}`;
  const messageReplacement = `e.prototype.compile=function(t){var e=String(t);return function(t){return e.replace(/\\{([A-Za-z0-9_$]+)\\}/g,function(e,i){return t&&Object.prototype.hasOwnProperty.call(t,i)?t[i]:e})}}`;
  source = replaceOnce(source, messageNeedle, messageReplacement, "MessageFormat 静态替换");
  source = disableSwigRuntimeCompiler(source, "match bundle");

  const stateNeedle = "n=new Function(r)()";
  const stateReplacement = `n=function State(machine,a1,a2,a3,a4,a5,a6,a7,a8){this.id=1;this.machine=machine;this.saved={};this._useSignals=false;for(var name in this)if(name.startsWith("signal:")){this["_"+name]=this[name].bind(this,this.machine.owner);this._useSignals=true}this.create(machine.owner);this.enter(machine.owner,a1,a2,a3,a4,a5,a6,a7,a8);this._connect()};try{Object.defineProperty(n,"name",{value:e,configurable:true})}catch(_nameError){}`;
  source = replaceOnce(source, stateNeedle, stateReplacement, "core/states 静态构造器替换");
  source = replaceOnce(
    source,
    'this._stadium=e,this._stadium.sectors&&M.makeSectors(this._stadium,this.baseTexture),this._stadium.fans&&M.prepare(null,this._stadium,this._redTeam,this._blueTeam,this.baseTexture,this)',
    'this._stadium=e,globalThis.__ORIGINAL_RUNTIME_MOBILE_SAFE_FANS__&&(this._stadium.fans=null),this._stadium.sectors&&M.makeSectors(this._stadium,this.baseTexture),this._stadium.fans&&M.prepare(null,this._stadium,this._redTeam,this._blueTeam,this.baseTexture,this)',
    "真机关闭高内存动态观众烘焙",
  );
  // 球场地面烘焙映射修正：原引擎把 base 层强制 scale(1,1) 烘进 4096×2048 RenderTexture，
  // 隐含约定「单张图片原始尺寸 == 烘焙纹理尺寸」。小游戏侧 base 层已改为两块 2048×2048
  // 瓦片（部分真机 wx 解码器会把 4096 大图降采样到 2048 → 地面又缩回左上角且细节减半；
  // 2048 瓦片全设备安全解码、保留全部细节）。烘焙按设计坐标系整体映射：
  // 位置与缩放都乘 0.8（=纹理4096/世界5120），与图片实际解码尺寸解耦；幂等不累乘。
  // 桌面/网页路径 fans 观众为活动精灵层，不触碰该纹理，行为不变。
  source = replaceOnce(
    source,
    'e._base[i].scale.set(1,1),this.baseTexture.render(e._base[i]);',
    'this.__acBakeBase(e._base[i]);',
    "球场 base 层烘焙映射修正(调用)",
  );
  // ⛔ 烘焙陷阱（真机血泪教训，勿回退）：v4 弃用版 RenderTexture.render(sprite) 单参
  // 调用 → legacyRenderer.render(..., skipUpdateTransform=TRUE) → 精灵的 position/scale
  // 从不参与计算，一律按恒等变换画在 (0,0) 原始像素尺寸。原版"正常"纯属巧合
  // （4096 图恒等绘制恰好填满 4096 纹理）。必须显式传 updateTransform=true（第 4 参），
  // 变换才真正生效。另：真机 GPU 不清零新建 FBO，未画满区域会显示显存残影（曾表现为
  // 选队头像巨幅糊在场地中央）——__acClearBase 先整幅纯色覆盖(clear=true)兜底。
  source = replaceOnce(
    source,
    'this.baseTexture.clear&&this.baseTexture.clear(),e._base)',
    'this.baseTexture.clear&&this.baseTexture.clear(),this.__acClearBase(),e._base)',
    "球场烘焙前显存残影清除(调用)",
  );
  source = replaceOnce(
    source,
    't.prototype.parseWalls=function(t){',
    't.prototype.__acClearBase=function(){var g=this.__acBaseCover;g||(g=new c.Graphics,g.beginFill(0x67903C,1),g.drawRect(0,0,4096,2048),g.endFill(),this.__acBaseCover=g);this.baseTexture.render(g,null,!0,!0)},t.prototype.__acBakeBase=function(t){t.__acDesign==null&&(t.__acDesign={x:t.position.x,y:t.position.y,sx:t.scale.x,sy:t.scale.y});var d=t.__acDesign;t.position.set(.8*d.x,.8*d.y),t.scale.set(.8*d.sx,.8*d.sy),this.baseTexture.render(t,null,!1,!0)},t.prototype.parseWalls=function(t){',
    "球场 base 层烘焙映射修正(实现)",
  );
  // 真机观众诊断：活动观众实际挂载数量打进 console（真机调试一眼可见）。
  source = replaceOnce(
    source,
    'var B=this._container;B&&B.addChildAt(T,1)',
    'var B=this._container;console.info("[fans] live fans placed:",T.children.length,"seats:",i.length),B&&B.addChildAt(T,1)',
    "真机观众数量诊断日志",
  );
  const criticalTextureGetter = '(window.__ORIGINAL_RUNTIME_GET_CRITICAL_TEXTURE__||globalThis.__ORIGINAL_RUNTIME_GET_CRITICAL_TEXTURE__)';
  source = replaceOnce(
    source,
    'e.Texture.fromFrame("indicators/sight.png")',
    `${criticalTextureGetter}("indicators/sight.png")`,
    "轨迹指示器绕过易失 Pixi 全局缓存",
  );
  const headerNeedle = 't.Sprite.fromFrame("indicators/header.png")';
  const headerReplacement = `new t.Sprite(${criticalTextureGetter}("indicators/header.png"))`;
  const firstHeader = source.indexOf(headerNeedle);
  const secondHeader = source.indexOf(headerNeedle, firstHeader + headerNeedle.length);
  if (firstHeader < 0 || secondHeader < 0 || source.indexOf(headerNeedle, secondHeader + headerNeedle.length) >= 0) {
    throw new Error("头顶指示器静态替换预期命中 2 次");
  }
  source = source.split(headerNeedle).join(headerReplacement);
  assertNoDynamicCode(source, "match.static.js");
  return source;
}

function patchSwig(source) {
  source = disableSwigRuntimeCompiler(source, "vendor/swig");
  assertNoDynamicCode(source, "swig.static.js");
  return source;
}

function patchShim(source) {
  source = replaceOnce(
    source,
    "window.__bundleReadText = function (p) {",
    "window.__bundleReadText = window.__bundleReadText || function (p) {",
    "保留小游戏文本资源读取器",
  );

  source = replaceOnce(
    source,
    "    const factory = registry[key];\n    if (factory) {",
    "    const entry = registry[key];\n    const factory = entry && entry.factory;\n    if (factory) {",
    "AMD registry entry",
  );

  source = replaceOnce(
    source,
    "        const ret = factory(require, moduleObj, moduleObj.exports);",
    `        const dependencies = entry.deps || [];
        const args = dependencies.map(function (dependency) {
          if (dependency === "require") return require;
          if (dependency === "exports") return moduleObj.exports;
          if (dependency === "module") return moduleObj;
          return require(dependency);
        });
        const ret = factory.apply(window, args);`,
    "AMD dependency injection",
  );

  const defineNeedle = `    if (typeof name === 'function') { factory = name; deps = []; name = null; }
    else if (Array.isArray(name)) { factory = deps; deps = name; name = null; }
    else if (typeof deps === 'function') { factory = deps; deps = []; }`;
  const defineReplacement = `    if (typeof name === 'function') { factory = name; deps = factory.length ? ['require', 'exports', 'module'] : []; name = null; }
    else if (Array.isArray(name)) { factory = deps; deps = name; name = null; }
    else if (typeof deps === 'function') { factory = deps; deps = factory.length ? ['require', 'exports', 'module'] : []; }`;
  source = replaceOnce(source, defineNeedle, defineReplacement, "AMD define signatures");
  source = replaceOnce(
    source,
    "    registry[normalize(name)] = factory;",
    "    registry[normalize(name)] = { deps: deps || [], factory: factory };\n    window.__ORIGINAL_RUNTIME_MODULE_COUNT__ = Object.keys(registry).length;",
    "AMD registry write",
  );

  const unresolvedNeedle = `    // 4. Unresolved — return empty object and warn (don't crash)
    if (!window.__unresolved.has(id)) {
      window.__unresolved.add(id);
      console.warn('[require] not found, returning {}:', id);
    }
    return {};`;
  const unresolvedReplacement = `    // 4. Unresolved modules are fatal in this project. A fake empty object
    // used to hide broken ports and later trigger misleading renderer errors.
    window.__unresolved.add(id);
    throw new Error('[original-runtime-latest] unresolved module: ' + id);`;
  source = replaceOnce(source, unresolvedNeedle, unresolvedReplacement, "禁止 unresolved 静默降级");
  assertNoDynamicCode(source, "shim.static.js");
  return source;
}

function patchStandalone(source) {
  source = replaceOnce(
    source,
    'function setupMatch(mode){var playerStates=runtime("players/states"),playerGlobals=runtime("players/global"),pitch=mode.game.pitch;',
    'function setupMatch(mode){var playerStates=runtime("players/states"),playerGlobals=runtime("players/global"),users=runtime("users"),pitch=mode.game.pitch;for(var resetUserIndex=0;resetUserIndex<users.list.length;resetUserIndex+=1){var resetUser=users.list[resetUserIndex];try{resetUser.player&&resetUser.releaseControl(null),resetUser.team&&resetUser.changeTeam(null)}catch(resetUserError){console.warn("[standalone-match] reset stale user failed",resetUserError)}}window.__ORIGINAL_RUNTIME_HUMAN_CONTROL_ACTIVE__=!1;globalThis.__ORIGINAL_RUNTIME_HUMAN_CONTROL_ACTIVE__=!1;',
    "重赛前释放上一局玩家绑定",
  );
  source = replaceOnce(
    source,
    'function first(collection){return collection&&typeof collection.all=="function"?collection.all()[0]:null}',
    `function first(collection){return collection&&typeof collection.all=="function"?collection.all()[0]:null}
function restoreStaticTextureCache(){var PIXI=runtime("pixi"),loader=PIXI&&PIXI.loader,resources=loader&&loader.resources||{},restored=0,addToCache=PIXI.Texture.addToCache||PIXI.Texture.addTextureToCache;if(typeof addToCache!="function")throw new Error("texture cache API unavailable");for(var key in resources){var resource=resources[key],textures=resource&&resource.textures;if(!textures)continue;for(var frame in textures)if(textures[frame]){addToCache.call(PIXI.Texture,textures[frame],frame);restored+=1}}var restoreCritical=window.__ORIGINAL_RUNTIME_RESTORE_CRITICAL_TEXTURES__||globalThis.__ORIGINAL_RUNTIME_RESTORE_CRITICAL_TEXTURES__;if(typeof restoreCritical=="function")restored+=restoreCritical();if(!PIXI.utils.TextureCache["indicators/sight.png"])throw new Error("critical texture cache gate failed: indicators/sight.png");console.info("[standalone-match] restored texture frames",restored);return restored}`,
    "热刷新纹理缓存恢复器",
  );
  source = replaceOnce(
    source,
    'blog("setupCollections"),setupCollections(),blog("setupCollections done");var i18n=runtime("i18n"),fans=runtime("fans"),settings=runtime("settings");',
    'blog("setupCollections"),setupCollections(),restoreStaticTextureCache(),blog("setupCollections done");var i18n=runtime("i18n"),fans=runtime("fans"),settings=runtime("settings");',
    "启动前恢复静态纹理缓存",
  );
  source = replaceOnce(
    source,
    'if(document.body.classList.add("loaded"),document.body.classList.remove("loading"),!window.__matchGame){blog("createGame"),window.__matchGame=createGame(),blog("game.start"),window.__matchGame.start();var doResize=window.__matchGame.resize.bind(window.__matchGame);doResize(),window.addEventListener("resize",doResize),window.addEventListener("orientationchange",function(){setTimeout(doResize,120),setTimeout(doResize,450)}),window.visualViewport&&window.visualViewport.addEventListener&&window.visualViewport.addEventListener("resize",doResize),blog("game started + resized")}blog("fans.load"),fans.load(settings("DEFAULTS_ROOT"),function(){blog("fans.load done \\u2192 game.load");',
    'if(document.body.classList.add("loaded"),document.body.classList.remove("loading"),window.__matchGame&&window.__matchGame.__animalCupLoaded){blog("reuse loaded game → states.change(StandaloneMatch)"),window.__matchGame.states.change(createStandaloneMatchState(options)),blog("reused states.change returned");return}if(!window.__matchGame){blog("createGame"),window.__matchGame=createGame(),blog("game.start"),window.__matchGame.start();var doResize=window.__matchGame.resize.bind(window.__matchGame);doResize(),window.addEventListener("resize",doResize),window.addEventListener("orientationchange",function(){setTimeout(doResize,120),setTimeout(doResize,450)}),window.visualViewport&&window.visualViewport.addEventListener&&window.visualViewport.addEventListener("resize",doResize),blog("game started + resized")}blog("fans.load"),fans.load(settings("DEFAULTS_ROOT"),function(){blog("fans.load done → game.load");',
    "重赛复用已加载游戏实例",
  );
  source = replaceOnce(
    source,
    'window.__matchGame.load(function(){blog("game.load done \\u2192 states.change(StandaloneMatch)"),window.__matchGame.states.change(createStandaloneMatchState(options)),blog("states.change returned")})',
    'window.__matchGame.load(function(){window.__matchGame.__animalCupLoaded=!0;blog("game.load done → states.change(StandaloneMatch)"),window.__matchGame.states.change(createStandaloneMatchState(options)),blog("states.change returned")})',
    "标记原版资源已完成首次加载",
  );
  source = replaceOnce(
    source,
    'blog("fans.load"),fans.load(settings("DEFAULTS_ROOT"),function(){blog("fans.load done → game.load");try{var loader=window.__matchGame.loader||window.PIXI&&window.PIXI.loader;loader&&loader.on&&loader.on("progress",function(ldr){var pct=Math.round(ldr.progress||0);window.__loadProgress=pct,window.dispatchEvent(new CustomEvent("ab-load-progress",{detail:pct}))})}catch{}window.__matchGame.load(function(){window.__matchGame.__animalCupLoaded=!0;blog("game.load done → states.change(StandaloneMatch)"),window.__matchGame.states.change(createStandaloneMatchState(options)),blog("states.change returned")})})',
    'var beginGameLoad=function(){if(window.__animalCupGameLoadStarted)return;window.__animalCupGameLoadStarted=!0;blog("game.load begin");try{var loader=window.__matchGame.loader||window.PIXI&&window.PIXI.loader;loader&&loader.on&&loader.on("progress",function(ldr){var pct=Math.round(ldr.progress||0);window.__loadProgress=pct,window.dispatchEvent(new CustomEvent("ab-load-progress",{detail:pct}))})}catch{}window.__matchGame.load(function(){window.__matchGame.__animalCupLoaded=!0;blog("game.load done → states.change(StandaloneMatch)"),window.__matchGame.states.change(createStandaloneMatchState(options)),blog("states.change returned")})};if(globalThis.__ORIGINAL_RUNTIME_MOBILE_SAFE_FANS__){blog("physical device: skip dynamic fans atlas"),beginGameLoad()}else{blog("fans.load");var fansSettled=!1,fansTimer=setTimeout(function(){if(fansSettled)return;fansSettled=!0,globalThis.__ORIGINAL_RUNTIME_MOBILE_SAFE_FANS__=!0,blog("fans.load timeout: continue without dynamic fans"),beginGameLoad()},12e3);fans.load(settings("DEFAULTS_ROOT"),function(){if(fansSettled)return;fansSettled=!0,clearTimeout(fansTimer),blog("fans.load done"),beginGameLoad()})}',
    "真机跳过动态观众图集并为桌面观众加载加超时",
  );
  source = replaceOnce(
    source,
    'function(){try{new URLSearchParams(window.location.search).get("play")==="1"&&(window.__acPlay=!0)}catch{}}();function acPlay(){return!!window.__acPlay}',
    'globalThis.__ORIGINAL_RUNTIME_PLAY_MODE__=globalThis.__ORIGINAL_RUNTIME_PLAY_MODE__!==!1;window.__acPlay=globalThis.__ORIGINAL_RUNTIME_PLAY_MODE__;window.__ORIGINAL_RUNTIME_FORCE_HUMAN_CONTROL__=!0;globalThis.__ORIGINAL_RUNTIME_PLAY_MODE_OK__=!0;function acPlay(){return globalThis.__ORIGINAL_RUNTIME_PLAY_MODE__!==!1}',
    "强制进入单人操控模式",
  );
  source = replaceOnce(
    source,
    "window.__touchInput=window.__touchInput||{active:!1,vx:0,vy:0,shoot:!1,sprint:!1,pass:!1,lob:!1,switchPlayer:!1,tackle:!1};",
    "window.__touchInput=globalThis.__ORIGINAL_RUNTIME_SHARED_TOUCH_INPUT__||window.__touchInput||{active:!1,vx:0,vy:0,shoot:!1,sprint:!1,pass:!1,lob:!1,switchPlayer:!1,tackle:!1};globalThis.__ORIGINAL_RUNTIME_TOUCH_BINDING_OK__=window.__touchInput===globalThis.__ORIGINAL_RUNTIME_SHARED_TOUCH_INPUT__;window.__ORIGINAL_RUNTIME_INJECT_TOUCH__=globalThis.__ORIGINAL_RUNTIME_INJECT_TOUCH__;",
    "原版触控对象绑定",
  );
  source = replaceOnce(
    source,
    "window.__touchInput2=window.__touchInput2||{active:!1,vx:0,vy:0,shoot:!1,sprint:!1,pass:!1,lob:!1,switchPlayer:!1,tackle:!1};",
    "window.__touchInput2=globalThis.__ORIGINAL_RUNTIME_SHARED_TOUCH_INPUT_2__||window.__touchInput2||{active:!1,vx:0,vy:0,shoot:!1,sprint:!1,pass:!1,lob:!1,switchPlayer:!1,tackle:!1};globalThis.__ORIGINAL_RUNTIME_TOUCH2_BINDING_OK__=window.__touchInput2===globalThis.__ORIGINAL_RUNTIME_SHARED_TOUCH_INPUT_2__;",
    "原版第二玩家远程触控对象绑定",
  );
  source = replaceOnce(
    source,
    "function acP2(){return!!window.__acP2}",
    `function acMatchSync(){return window.__ORIGINAL_RUNTIME_MATCH_SYNC__||globalThis.__ORIGINAL_RUNTIME_MATCH_SYNC__||null}
function acSyncRole(sync){return sync&&sync.role||window.__ORIGINAL_RUNTIME_SYNC_ROLE__||globalThis.__ORIGINAL_RUNTIME_SYNC_ROLE__||"off"}
function acGuestSync(sync){if(acSyncRole(sync)!=="guest")return null;if(!sync||sync.isGuestRenderOnly!==!0||typeof sync.guestTick!=="function"||typeof sync.readGuestFrame!=="function")throw new Error("guest render-only sync bridge unavailable; local simulation is forbidden");window.__ORIGINAL_RUNTIME_GUEST_PHYSICS_BLOCKED__=!0;globalThis.__ORIGINAL_RUNTIME_GUEST_PHYSICS_BLOCKED__=!0;return sync}
function acP2(){var sync=acMatchSync();return sync&&typeof sync.acceptsRemoteInput==="function"?sync.acceptsRemoteInput():!!window.__acP2}`,
    "好友局角色和客机只渲染硬闸门",
  );
  source = replaceOnce(
    source,
    "update:function(mode,elapsed){var pitch=mode.game.pitch;if(!pitch.paused){if(acPlay()){",
    "update:function(mode,elapsed){var pitch=mode.game.pitch,matchSync=acMatchSync(),guestSync=acGuestSync(matchSync);if(!pitch.paused&&!(matchSync&&matchSync.paused)){if(guestSync){guestSync.guestTick(elapsed,mode.game)}else{if(acPlay()){",
    "客机跳过本地 AI 和物理主循环",
  );
  source = replaceOnce(
    source,
    "this.stream.endWrite(pitch),users.release(),messages.step.send(mode.game,frame)}if(mode.game.stadium.update(elapsed),",
    "this.stream.endWrite(pitch),users.release(),messages.step.send(mode.game,frame),matchSync&&matchSync.hostTick(frame,elapsed,mode.game)}}if(mode.game.stadium.update(elapsed),",
    "房主导出权威帧且闭合客机分支",
  );
  source = replaceOnce(
    source,
    "render:function(mode,elapsed){if(!mode.game.pitch.paused&&!mode.game.stadium.paused){var frame=this.stream.readAll(mode.game.alpha);frame&&messages.frame.send(mode.game.stadium,frame),mode.game.stadium.render(elapsed)}}",
    "render:function(mode,elapsed){if(!mode.game.pitch.paused&&!mode.game.stadium.paused){var matchSync=acMatchSync(),guestSync=acGuestSync(matchSync),frame=guestSync?guestSync.readGuestFrame(elapsed,mode.game):this.stream.readAll(mode.game.alpha);frame&&messages.frame.send(mode.game.stadium,frame),mode.game.stadium.render(elapsed)}}",
    "客机从权威 MatchStream 插值渲染",
  );
  source = replaceOnce(
    source,
    "if(ownerMine&&movedSq>.09||movedSq>1){",
    "if(ownerMine&&movedSq>.09||movedSq>1||window.__ORIGINAL_RUNTIME_FORCE_HUMAN_CONTROL__){",
    "玩家立即认领红队",
  );
  source = replaceOnce(
    source,
    "acDriveClaim(this._st0,u0,pitch.redTeam,pitch,bpos,live,!0);",
    "acDriveClaim(this._st0,u0,pitch.redTeam,pitch,bpos,live,!0);window.__ORIGINAL_RUNTIME_HUMAN_CONTROL_ACTIVE__=!!(u0&&u0.enabled&&u0.controller&&u0.team===pitch.redTeam&&u0.player);globalThis.__ORIGINAL_RUNTIME_HUMAN_CONTROL_ACTIVE__=window.__ORIGINAL_RUNTIME_HUMAN_CONTROL_ACTIVE__;",
    "玩家操控运行时硬标记",
  );
  source = replaceOnce(
    source,
    'rendererOptions:settings("RENDERER_OPTIONS",{})',
    'rendererOptions:Object.assign({},settings("RENDERER_OPTIONS",{}),{view:window.__animalCupScreenCanvas})',
    "主 Canvas 显式注入",
  );
  // 真机清晰度：原引擎渲染分辨率封顶 2，dpr=3 的真机上画布 (逻辑宽×2) 被拉伸到
  // 物理屏幕 (逻辑宽×3)，全局 1.5 倍放大 → 用户可感的模糊。放开到 3（与适配层
  // wx 屏幕画布的 pixelRatio 上限一致），真机逐物理像素渲染。DevTools 同步变清晰。
  source = replaceOnce(
    source,
    'this.resolution=Math.min(window.devicePixelRatio||1,2)',
    'this.resolution=Math.min(window.devicePixelRatio||1,3)',
    "真机渲染分辨率放开到 dpr=3",
  );
  source = replaceOnce(
    source,
    'blog("FATAL: "+error.message)}}})();',
    'blog("FATAL: "+error.message),window.__ORIGINAL_RUNTIME_BOOT_ERROR__=error;throw error}}})();',
    "standalone 启动错误上抛",
  );
  const customEventCount = (source.match(/\bnew CustomEvent\(/g) || []).length;
  if (!customEventCount) throw new Error("[build] standalone 未找到 CustomEvent 派发点");
  source = source.replace(/\bnew CustomEvent\(/g, "window.__animalCupCustomEvent(");
  const dispatchCount = (source.match(/\bwindow\.dispatchEvent\(/g) || []).length;
  if (!dispatchCount) throw new Error("[build] standalone 未找到业务事件派发点");
  source = source.replace(/\bwindow\.dispatchEvent\(/g, "window.__animalCupEvents.dispatchEvent(");
  assertNoDynamicCode(source, "standalone.static.js");
  return source;
}

function wrapMatch(source) {
  return `const runtimeWindow = globalThis.window || globalThis;
(function(window,document,global,self){
var module=void 0;var exports=void 0;
var process=window.process;var Buffer=window.Buffer;var __dirname=window.__dirname;
var initialDefine=window.define;
function define(){return window.define.apply(window,arguments)}
define.amd=initialDefine&&initialDefine.amd;
function require(){return window.require.apply(window,arguments)}
${source}
window.__ORIGINAL_RUNTIME_MODULE_COUNT__=window.define&&window.define._modules?Object.keys(window.define._modules).length:0;
}).call(runtimeWindow,runtimeWindow,runtimeWindow.document,globalThis,runtimeWindow);
module.exports={loaded:true};
`;
}

async function copyDir(source, target) {
  await fs.cp(source, target, { recursive: true, force: true });
}

async function walkFiles(root) {
  const files = [];
  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await visit(root);
  return files;
}

async function makeDirectoryIndex(root, publicRoot) {
  const result = {};
  async function visit(current, relative) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    const publicPath = `${publicRoot}/${relative}`.replace(/\/$/, "");
    result[publicPath || "/"] = entries.map((entry) => entry.name).sort();
    for (const entry of entries) {
      if (entry.isDirectory()) await visit(path.join(current, entry.name), path.posix.join(relative, entry.name));
    }
  }
  await visit(root, "");
  return result;
}

async function buildTextIndex() {
  const textExtensions = new Set([".json", ".css", ".atlas", ".fnt", ".xml", ".txt"]);
  const assets = {};
  for (const absolute of await walkFiles(sourceRuntime)) {
    const extension = path.extname(absolute).toLowerCase();
    if (!textExtensions.has(extension)) continue;
    const relative = path.relative(sourceRuntime, absolute).split(path.sep).join("/");
    if (relative.startsWith("scripts/") || relative.startsWith("vendor/")) continue;
    if (relative === "__data-bundle.json" || relative === "__dirlist.json") continue;
    const value = await fs.readFile(absolute, "utf8");
    assets[`/match-runtime-min/${relative}`] = value;
  }

  const dirlist = await makeDirectoryIndex(path.join(sourceRuntime, "data"), "/data");
  const encodedDirlist = JSON.stringify(dirlist);
  assets["/__dirlist.json"] = encodedDirlist;
  assets["/match-runtime-min/__dirlist.json"] = encodedDirlist;
  return assets;
}

async function main() {
  // 始终先在暂存目录构建。只有所有静态替换和文件写入都成功后才替换
  // 上一次可运行产物，避免构建失败留下缺少分包 game.js 的半成品。
  await fs.rm(generatedStagingDir, { recursive: true, force: true });
  await fs.rm(assetsStagingDir, { recursive: true, force: true });
  await fs.rm(shellAssetsStagingDir, { recursive: true, force: true });
  await fs.mkdir(generatedStagingDir, { recursive: true });
  await fs.mkdir(path.join(assetsStagingDir, "match-runtime-min"), { recursive: true });
  await fs.mkdir(path.join(assetsStagingDir, "animal-cup"), { recursive: true });
  await fs.mkdir(shellAssetsStagingDir, { recursive: true });
  await fs.mkdir(path.join(shellAssetsStagingDir, "portraits"), { recursive: true });

  await Promise.all([
    copyDir(path.join(sourceRuntime, "data"), path.join(assetsStagingDir, "match-runtime-min/data")),
    copyDir(path.join(sourceRuntime, "fonts"), path.join(assetsStagingDir, "match-runtime-min/fonts")),
    copyDir(path.join(sourceRuntime, "images"), path.join(assetsStagingDir, "match-runtime-min/images")),
    copyDir(path.join(sourceRuntime, "styles"), path.join(assetsStagingDir, "match-runtime-min/styles")),
    copyDir(path.join(sourceAnimalCup, "kit-ref"), path.join(assetsStagingDir, "animal-cup/kit-ref")),
    copyDir(path.join(sourceAnimalCup, "audio"), path.join(assetsStagingDir, "animal-cup/audio")),
    fs.copyFile(path.join(sourceCocosAnimalFootball, "brand_logo.png"), path.join(shellAssetsStagingDir, "brand-logo.png")),
    fs.copyFile(path.join(sourceCocosAnimalFootball, "web_runtime/generated/ball_classic.png"), path.join(shellAssetsStagingDir, "football.png")),
    ...["england", "france", "germany", "spain", "portugal", "brazil", "argentina", "usa"].map((teamId) => (
      fs.copyFile(
        path.join(sourceCocosAnimalFootball, `portrait_${teamId}.png`),
        path.join(shellAssetsStagingDir, `portraits/${teamId}.png`),
      )
    )),
  ]);

  const [pixiSource, swigSource, shimSource, matchSource, standaloneSource, textAssets] = await Promise.all([
    fs.readFile(path.join(sourceRuntime, "vendor/pixi.min.js"), "utf8"),
    fs.readFile(path.join(sourceRuntime, "vendor/swig.min.js"), "utf8"),
    fs.readFile(path.join(sourceRuntime, "shim.js"), "utf8"),
    fs.readFile(path.join(sourceRuntime, "scripts/match.rebuilt.js"), "utf8"),
    fs.readFile(path.join(sourceRuntime, "standalone-match.js"), "utf8"),
    buildTextIndex(),
  ]);

  assertNoDynamicCode(pixiSource, "pixi.static.js");

  // 关键指示器图集 4.3KB 内联为主包内 base64 data URI。真机上分包文件路径经
  // wx.createImage() 加载偶发 onload 永不触发 → 整局卡在加载页；主包内联后立即可用。
  const criticalAtlasPng = await fs.readFile(path.join(sourceRuntime, "images/indicators.png"));
  const criticalAtlasDataUri = `data:image/png;base64,${criticalAtlasPng.toString("base64")}`;
  const criticalAtlasModule = `// 构建期自动生成：indicators.png 的 base64 内联（主包内，真机不依赖分包文件 I/O）。\nmodule.exports=${JSON.stringify(criticalAtlasDataUri)};\n`;

  const outputs = {
    "pixi.static.js": rewriteImageSrcAssignments(pixiSource, "pixi.static.js", 10),
    "swig.static.js": rewriteImageSrcAssignments(patchSwig(swigSource), "swig.static.js"),
    "shim.static.js": rewriteImageSrcAssignments(patchShim(shimSource), "shim.static.js"),
    "match.static.js": wrapMatch(rewriteImageSrcAssignments(patchMatch(matchSource), "match.static.js", 10)),
    "standalone.static.js": `${rewriteImageSrcAssignments(patchStandalone(standaloneSource), "standalone.static.js")}\nmodule.exports={loaded:true};\n`,
    "critical-atlas.static.js": criticalAtlasModule,
  };

  for (const [name, content] of Object.entries(outputs)) {
    await fs.writeFile(path.join(generatedStagingDir, name), content);
  }
  // 小游戏专属：球场底图换双 2048 瓦片（部分真机解码器把 4096 大图降采样 → 地面
  // 缩左上角+细节减半）。只改分包与文本索引里的 stadium.json，public 源与网页版不动。
  {
    const stadiumJsonKey = "/match-runtime-min/data/stadiums/international/stadium.json";
    const stagedStadiumDir = path.join(assetsStagingDir, "match-runtime-min/data/stadiums/international");
    const stadiumData = JSON.parse(textAssets[stadiumJsonKey]);
    const baseIndex = stadiumData.sprites.findIndex((sp) => sp.layer === "base" && sp.texture === "stadium.jpg");
    if (baseIndex < 0) throw new Error("stadium.json 未找到单张 base 底图，瓦片替换失败");
    stadiumData.sprites.splice(
      baseIndex,
      1,
      { texture: "stadium_left.jpg", position: [0, 0], layer: "base", scale: [1.25, 1.25] },
      { texture: "stadium_right.jpg", position: [2560, 0], layer: "base", scale: [1.25, 1.25] },
    );
    textAssets[stadiumJsonKey] = JSON.stringify(stadiumData);
    await fs.writeFile(path.join(stagedStadiumDir, "stadium.json"), textAssets[stadiumJsonKey]);
    await fs.rm(path.join(stagedStadiumDir, "stadium.jpg"), { force: true }); // 分包省 1.5MB
    for (const tile of ["stadium_left.jpg", "stadium_right.jpg"]) {
      await fs.access(path.join(stagedStadiumDir, tile)); // 瓦片必须存在（public 数据目录随 copyDir 带入）
    }
    console.info("[build] 球场底图已替换为双 2048 瓦片（仅小游戏分包）");
  }
  const textModule = `module.exports=${JSON.stringify(textAssets)};\n`;
  await fs.writeFile(path.join(assetsStagingDir, "runtime-text-assets.js"), textModule);
  await fs.writeFile(
    path.join(assetsStagingDir, "game.js"),
    "// 微信小游戏分包入口；资源索引由主包在分包加载完成后显式 require。\nmodule.exports={ready:true};\n",
  );

  const manifest = {
    identity: "original-runtime-latest",
    builtAt: new Date().toISOString(),
    source: {
      pixi: sha256(pixiSource),
      swig: sha256(swigSource),
      shim: sha256(shimSource),
      match: sha256(matchSource),
      standalone: sha256(standaloneSource),
    },
    output: Object.fromEntries(Object.entries(outputs).map(([name, content]) => [name, { bytes: Buffer.byteLength(content), sha256: sha256(content) }])),
    textAssets: { entries: Object.keys(textAssets).length, bytes: Buffer.byteLength(textModule) },
  };
  await fs.writeFile(path.join(generatedStagingDir, "build-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await fs.rm(generatedDir, { recursive: true, force: true });
  await fs.rm(assetsDir, { recursive: true, force: true });
  await fs.rm(shellAssetsDir, { recursive: true, force: true });
  await fs.rename(generatedStagingDir, generatedDir);
  await fs.rename(assetsStagingDir, assetsDir);
  await fs.rename(shellAssetsStagingDir, shellAssetsDir);
  await fs.rm(stagingRootDir, { recursive: true, force: true });
  console.info(`[build] original-runtime-latest: ${Object.keys(textAssets).length} 个文本键`);
  console.info(`[build] match=${manifest.output["match.static.js"].bytes} bytes, text-index=${manifest.textAssets.bytes} bytes`);
}

main().catch((error) => {
  console.error("[build] failed", error);
  process.exitCode = 1;
});
