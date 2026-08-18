import crypto from "node:crypto";

export const PROTOCOL_VERSION = 1;
export const SNAPSHOT_HEADER_BYTES = 64;
export const SNAPSHOT_MAGIC = "RFFS";
export const SNAPSHOT_KIND = 1;
export const MAX_JSON_BYTES = 64 * 1024;
export const MAX_SNAPSHOT_BYTES = 256 * 1024;

export const TEAM_IDS = new Set([
  "england",
  "france",
  "germany",
  "spain",
  "portugal",
  "brazil",
  "argentina",
  "usa",
]);

export const FORMATION_IDS = new Set([
  "2-3-1",
  "3-2-1",
  "2-2-2",
  "3-1-2",
  "1-3-2",
  "2-1-3",
]);

const CONFIG_KEYS = new Set([
  "redTeam",
  "blueTeam",
  "redFormation",
  "blueFormation",
  "ai",
  "time",
  "redLabel",
  "blueLabel",
  "redCustom",
  "blueCustom",
]);

const CREATE_CONFIG_KEYS = new Set([...CONFIG_KEYS, "mode", "side", "roomId"]);
const HOST_CONFIG_KEYS = new Set(["redTeam", "redFormation", "ai", "time", "redLabel", "redCustom"]);
const GUEST_CONFIG_KEYS = new Set(["blueTeam", "blueFormation", "blueLabel", "blueCustom"]);

export const DEFAULT_ROOM_CONFIG = Object.freeze({
  redTeam: "argentina",
  blueTeam: "portugal",
  redFormation: "2-3-1",
  blueFormation: "3-2-1",
  ai: 1,
  time: 6,
  redLabel: "镇隆",
  blueLabel: "水口",
  redCustom: false,
  blueCustom: false,
});

export class ProtocolError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.details = details;
  }
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("base64url");
}

export function assertPlainObject(value, code = "INVALID_PAYLOAD", label = "载荷") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolError(code, `${label}必须是对象`);
  }
  return value;
}

export function assertKnownFields(value, allowed, label = "消息") {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ProtocolError("UNKNOWN_FIELD", `${label}包含未知字段：${key}`);
    }
  }
}

function assertEnum(value, allowed, field) {
  if (!allowed.has(value)) throw new ProtocolError("INVALID_CONFIG", `${field} 不在允许范围内`);
  return value;
}

function safeTeamLabel(value, field) {
  const text = typeof value === "string" ? Array.from(value.trim()).slice(0, 12).join("") : "";
  if (!text || !/^[\p{Script=Han}A-Za-z0-9·._-]{1,12}$/u.test(text)) {
    throw new ProtocolError("INVALID_TEAM_LABEL", `${field} 只能包含 1 至 12 个中英文、数字或常用连接符`);
  }
  return text;
}

function validateConfigValues(config) {
  assertEnum(config.redTeam, TEAM_IDS, "redTeam");
  assertEnum(config.blueTeam, TEAM_IDS, "blueTeam");
  if (config.redTeam === config.blueTeam) {
    throw new ProtocolError("TEAM_CONFLICT", "双方球队不能相同");
  }
  assertEnum(config.redFormation, FORMATION_IDS, "redFormation");
  assertEnum(config.blueFormation, FORMATION_IDS, "blueFormation");
  if (![0, 1, 2].includes(config.ai)) throw new ProtocolError("INVALID_CONFIG", "ai 不在允许范围内");
  if (![4, 6, 10].includes(config.time)) throw new ProtocolError("INVALID_CONFIG", "time 不在允许范围内");
  config.redLabel = safeTeamLabel(config.redLabel, "redLabel");
  config.blueLabel = safeTeamLabel(config.blueLabel, "blueLabel");
  if (typeof config.redCustom !== "boolean" || typeof config.blueCustom !== "boolean") {
    throw new ProtocolError("INVALID_CONFIG", "自定义队名标记必须为布尔值");
  }
  return config;
}

export function normalizeInitialConfig(input) {
  const source = input == null ? {} : assertPlainObject(input, "INVALID_CONFIG", "房间配置");
  assertKnownFields(source, CREATE_CONFIG_KEYS, "房间配置");
  const config = { ...DEFAULT_ROOM_CONFIG };
  for (const key of CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) config[key] = source[key];
  }
  config.ai = Number(config.ai);
  config.time = Number(config.time);
  config.redCustom = config.redCustom === true;
  config.blueCustom = config.blueCustom === true;
  return validateConfigValues(config);
}

export function applyConfigPatch(current, patch, role) {
  const source = assertPlainObject(patch, "INVALID_CONFIG", "配置变更");
  const allowed = role === "host" ? HOST_CONFIG_KEYS : GUEST_CONFIG_KEYS;
  if (Object.keys(source).length === 0) throw new ProtocolError("INVALID_CONFIG", "配置变更不能为空");
  assertKnownFields(source, allowed, role === "host" ? "房主配置变更" : "好友配置变更");
  const next = { ...current, ...source };
  if (Object.prototype.hasOwnProperty.call(source, "ai")) next.ai = Number(source.ai);
  if (Object.prototype.hasOwnProperty.call(source, "time")) next.time = Number(source.time);
  if (Object.prototype.hasOwnProperty.call(source, "redCustom")) next.redCustom = source.redCustom === true;
  if (Object.prototype.hasOwnProperty.call(source, "blueCustom")) next.blueCustom = source.blueCustom === true;
  return validateConfigValues(next);
}

export function sanitizeInput(input, pulseState = Object.create(null)) {
  const source = assertPlainObject(input, "INVALID_INPUT", "输入");
  const allowed = new Set([
    "active", "vx", "vy", "sprint", "shoot", "pass", "lob", "tackle", "switchPlayer", "pulseSeq",
  ]);
  assertKnownFields(source, allowed, "输入");
  const vx = Number(source.vx ?? 0);
  const vy = Number(source.vy ?? 0);
  if (!Number.isFinite(vx) || vx < -1 || vx > 1 || !Number.isFinite(vy) || vy < -1 || vy > 1) {
    throw new ProtocolError("INVALID_INPUT", "方向输入必须位于 -1 到 1");
  }
  for (const key of ["active", "sprint", "shoot", "pass", "lob", "tackle", "switchPlayer"]) {
    if (source[key] != null && typeof source[key] !== "boolean") {
      throw new ProtocolError("INVALID_INPUT", `${key} 必须是布尔值`);
    }
  }

  let pulseSeq = {};
  if (source.pulseSeq != null) {
    pulseSeq = assertPlainObject(source.pulseSeq, "INVALID_INPUT", "pulseSeq");
    assertKnownFields(pulseSeq, new Set(["pass", "lob", "tackle", "switchPlayer"]), "pulseSeq");
  }

  const sanitized = {
    active: source.active !== false,
    vx,
    vy,
    sprint: !!source.sprint,
    shoot: !!source.shoot,
    pass: false,
    lob: false,
    tackle: false,
    switchPlayer: false,
  };
  for (const action of ["pass", "lob", "tackle", "switchPlayer"]) {
    if (!source[action]) continue;
    if (!Object.prototype.hasOwnProperty.call(pulseSeq, action)) {
      sanitized[action] = true;
      continue;
    }
    const actionSeq = Number(pulseSeq[action]);
    if (!Number.isSafeInteger(actionSeq) || actionSeq < 0) {
      throw new ProtocolError("INVALID_INPUT", `pulseSeq.${action} 必须是非负整数`);
    }
    const previous = pulseState[action] ?? -1;
    if (actionSeq > previous) {
      pulseState[action] = actionSeq;
      sanitized[action] = true;
    }
  }
  return sanitized;
}

function assertWireId(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(value)) {
    throw new ProtocolError("INVALID_SNAPSHOT", `${field} 格式错误`);
  }
  return value;
}

export function encodeSnapshotPacket({ roomId, matchId, seq, payload }) {
  assertWireId(roomId, "roomId");
  assertWireId(matchId, "matchId");
  if (!Number.isSafeInteger(seq) || seq < 0 || seq > 0xffffffff) {
    throw new ProtocolError("INVALID_SEQUENCE", "snapshot seq 格式错误");
  }
  const body = Buffer.isBuffer(payload)
    ? payload
    : payload instanceof Uint8Array
      ? Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
      : payload instanceof ArrayBuffer
        ? Buffer.from(payload)
        : null;
  if (!body) throw new ProtocolError("INVALID_SNAPSHOT", "snapshot payload 必须是二进制");
  if (body.byteLength > MAX_SNAPSHOT_BYTES) throw new ProtocolError("PAYLOAD_TOO_LARGE", "snapshot 超过大小限制");

  const packet = Buffer.allocUnsafe(SNAPSHOT_HEADER_BYTES + body.byteLength);
  packet.write(SNAPSHOT_MAGIC, 0, 4, "ascii");
  packet.writeUInt8(PROTOCOL_VERSION, 4);
  packet.writeUInt8(SNAPSHOT_KIND, 5);
  packet.writeUInt16BE(SNAPSHOT_HEADER_BYTES, 6);
  packet.write(roomId, 8, 22, "ascii");
  packet.write(matchId, 30, 22, "ascii");
  packet.writeUInt32BE(seq, 52);
  packet.writeUInt32BE(body.byteLength, 56);
  packet.writeUInt32BE(0, 60);
  body.copy(packet, SNAPSHOT_HEADER_BYTES);
  return packet;
}

export function decodeSnapshotPacket(raw) {
  const packet = Buffer.isBuffer(raw)
    ? raw
    : raw instanceof Uint8Array
      ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
      : raw instanceof ArrayBuffer
        ? Buffer.from(raw)
        : null;
  if (!packet || packet.byteLength < SNAPSHOT_HEADER_BYTES) {
    throw new ProtocolError("INVALID_SNAPSHOT", "snapshot 数据不完整");
  }
  if (packet.toString("ascii", 0, 4) !== SNAPSHOT_MAGIC) {
    throw new ProtocolError("INVALID_SNAPSHOT", "snapshot 魔数错误");
  }
  if (packet.readUInt8(4) !== PROTOCOL_VERSION || packet.readUInt8(5) !== SNAPSHOT_KIND) {
    throw new ProtocolError("VERSION_MISMATCH", "snapshot 协议版本或类型不兼容");
  }
  if (packet.readUInt16BE(6) !== SNAPSHOT_HEADER_BYTES || packet.readUInt32BE(60) !== 0) {
    throw new ProtocolError("INVALID_SNAPSHOT", "snapshot 固定头格式错误");
  }
  const payloadLength = packet.readUInt32BE(56);
  if (payloadLength > MAX_SNAPSHOT_BYTES) throw new ProtocolError("PAYLOAD_TOO_LARGE", "snapshot 超过大小限制");
  if (packet.byteLength !== SNAPSHOT_HEADER_BYTES + payloadLength) {
    throw new ProtocolError("INVALID_SNAPSHOT", "snapshot 长度不一致");
  }
  const roomId = assertWireId(packet.toString("ascii", 8, 30), "roomId");
  const matchId = assertWireId(packet.toString("ascii", 30, 52), "matchId");
  return {
    roomId,
    matchId,
    seq: packet.readUInt32BE(52),
    payload: packet.subarray(SNAPSHOT_HEADER_BYTES),
    packet,
  };
}

export function jsonByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
