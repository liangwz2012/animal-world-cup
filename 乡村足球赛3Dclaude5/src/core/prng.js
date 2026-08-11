// 确定性随机：同一 seed + 同一输入序列 => 同一局比赛。
// 比赛核心禁止使用 Math.random，回放/联机/测试都依赖这一点。

export function createPrng(seed = 1) {
  let state = (seed >>> 0) || 1;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range(min, max) {
      return min + (max - min) * next();
    },
    int(min, max) {
      return Math.floor(min + (max - min + 1) * next());
    },
    pick(list) {
      return list[Math.floor(next() * list.length) % list.length];
    },
    chance(p) {
      return next() < p;
    },
    // 稳定的正负偏移，用于射门/传球误差
    signed(scale = 1) {
      return (next() * 2 - 1) * scale;
    },
    get state() {
      return state;
    },
    set state(value) {
      state = (value >>> 0) || 1;
    },
  };
}

// 由字符串（如村名、队名）得到稳定 seed，保证同一地区每次生成同样的人和场
export function hashSeed(text) {
  let hash = 2166136261;
  const value = String(text ?? "");
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}
