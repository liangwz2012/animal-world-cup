"use strict";

const MAGIC = [0x41, 0x43, 0x4d, 0x46]; // ACMF
const VERSION = 1;
const HEADER_BYTES = 12;
const MAX_FRAME_BYTES = 256 * 1024;

function asUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("权威帧必须是 ArrayBuffer 或 Uint8Array");
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

class FrameWriter {
  constructor(initialBytes) {
    this.bytes = new Uint8Array(Math.max(256, Number(initialBytes) || 4096));
    this.view = new DataView(this.bytes.buffer);
    this.offset = 0;
  }

  _reserve(size) {
    const start = this.offset;
    const required = start + size;
    if (required > MAX_FRAME_BYTES) throw new RangeError("权威帧超过 256 KiB 上限");
    if (required > this.bytes.byteLength) {
      let capacity = this.bytes.byteLength;
      while (capacity < required) capacity = Math.min(MAX_FRAME_BYTES, capacity * 2);
      const next = new Uint8Array(capacity);
      next.set(this.bytes);
      this.bytes = next;
      this.view = new DataView(next.buffer);
    }
    this.offset = required;
    return start;
  }

  setUint8(value) {
    const at = this._reserve(1);
    this.view.setUint8(at, finiteNumber(value, 0));
    return at;
  }

  setInt8(value) {
    const at = this._reserve(1);
    this.view.setInt8(at, finiteNumber(value, 0));
    return at;
  }

  setUint16(value) {
    const at = this._reserve(2);
    this.view.setUint16(at, finiteNumber(value, 0), false);
    return at;
  }

  setInt16(value) {
    const at = this._reserve(2);
    this.view.setInt16(at, finiteNumber(value, 0), false);
    return at;
  }

  setUint32(value) {
    const at = this._reserve(4);
    this.view.setUint32(at, finiteNumber(value, 0) >>> 0, false);
    return at;
  }

  setFloat32(value) {
    const at = this._reserve(4);
    this.view.setFloat32(at, finiteNumber(value, 0), false);
    return at;
  }

  setFlags() {
    let flags = 0;
    for (let index = 0; index < arguments.length && index < 8; index += 1) {
      if (arguments[index]) flags |= 1 << index;
    }
    return this.setUint8(flags);
  }

  setNormal(value) {
    return this.setInt16(Math.round(clamp(finiteNumber(value, 0), -3.2767, 3.2767) * 10000));
  }

  setVector2(value) {
    this.setFloat32(value && value.x);
    this.setFloat32(value && value.y);
  }

  setVector2Normal(value) {
    this.setInt16(Math.round(clamp(finiteNumber(value && value.x, 0), -1, 1) * 32767));
    this.setInt16(Math.round(clamp(finiteNumber(value && value.y, 0), -1, 1) * 32767));
  }

  setVector2Quantized16(scale, value) {
    const multiplier = finiteNumber(scale, 1) || 1;
    this.setInt16(Math.round(clamp(finiteNumber(value && value.x, 0) * multiplier, -32768, 32767)));
    this.setInt16(Math.round(clamp(finiteNumber(value && value.y, 0) * multiplier, -32768, 32767)));
  }

  setVector3(value) {
    this.setFloat32(value && value.x);
    this.setFloat32(value && value.y);
    this.setFloat32(value && value.z);
  }

  setVector3Quantized16(scale, value) {
    const multiplier = finiteNumber(scale, 1) || 1;
    this.setInt16(Math.round(clamp(finiteNumber(value && value.x, 0) * multiplier, -32768, 32767)));
    this.setInt16(Math.round(clamp(finiteNumber(value && value.y, 0) * multiplier, -32768, 32767)));
    this.setInt16(Math.round(clamp(finiteNumber(value && value.z, 0) * multiplier, -32768, 32767)));
  }

  setRotation16(value) {
    this.setInt16(Math.round(clamp(finiteNumber(value && value.x, 0), -1, 1) * 32767));
    this.setInt16(Math.round(clamp(finiteNumber(value && value.y, 0), -1, 1) * 32767));
    this.setInt16(Math.round(clamp(finiteNumber(value && value.z, 0), -1, 1) * 32767));
    this.setInt16(Math.round(clamp(finiteNumber(value && value.w, 1), -1, 1) * 32767));
  }

  finish() {
    return this.bytes.slice(0, this.offset);
  }
}

class FrameReader {
  constructor(value) {
    this.bytes = asUint8Array(value);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.offset = 0;
  }

  _take(size) {
    const at = this.offset;
    if (at + size > this.bytes.byteLength) throw new RangeError("权威帧数据截断");
    this.offset += size;
    return at;
  }

  getUint8() { return this.view.getUint8(this._take(1)); }
  getInt8() { return this.view.getInt8(this._take(1)); }
  getUint16() { return this.view.getUint16(this._take(2), false); }
  getInt16() { return this.view.getInt16(this._take(2), false); }
  getUint32() { return this.view.getUint32(this._take(4), false); }
  getFloat32() { return this.view.getFloat32(this._take(4), false); }
  getFlags() { return this.getUint8(); }
  getNormal() { return this.getInt16() / 10000; }

  getVector2(target) {
    target.x = this.getFloat32();
    target.y = this.getFloat32();
    return target;
  }

  getVector2Normal(target) {
    target.x = this.getInt16() / 32767;
    target.y = this.getInt16() / 32767;
    return target;
  }

  getVector2Quantized16(scale, target) {
    const divisor = finiteNumber(scale, 1) || 1;
    target.x = this.getInt16() / divisor;
    target.y = this.getInt16() / divisor;
    return target;
  }

  getVector3(target) {
    target.x = this.getFloat32();
    target.y = this.getFloat32();
    target.z = this.getFloat32();
    return target;
  }

  getVector3Quantized16(scale, target) {
    const divisor = finiteNumber(scale, 1) || 1;
    target.x = this.getInt16() / divisor;
    target.y = this.getInt16() / divisor;
    target.z = this.getInt16() / divisor;
    return target;
  }

  getRotation16(target) {
    target.x = this.getInt16() / 32767;
    target.y = this.getInt16() / 32767;
    target.z = this.getInt16() / 32767;
    target.w = this.getInt16() / 32767;
    return target;
  }

  get remaining() {
    return this.bytes.byteLength - this.offset;
  }
}

function writePacketHeader(writer, options) {
  for (const byte of MAGIC) writer.setUint8(byte);
  writer.setUint8(VERSION);
  writer.setUint8(options && options.sessionKind === "warmup" ? 1 : 2);
  writer.setUint16(0);
  writer.setUint32(options && options.sequence);
}

function readPacketHeader(reader) {
  for (const expected of MAGIC) {
    if (reader.getUint8() !== expected) throw new Error("权威帧魔数错误");
  }
  const version = reader.getUint8();
  if (version !== VERSION) throw new Error(`权威帧版本不兼容: ${version}`);
  const sessionCode = reader.getUint8();
  reader.getUint16();
  return {
    version,
    sessionKind: sessionCode === 1 ? "warmup" : "friend",
    sequence: reader.getUint32(),
  };
}

function encodeAuthoritativeFrame(frame, options) {
  if (!frame || typeof frame.pack !== "function") throw new TypeError("原版 Frame.pack 不可用");
  const writer = new FrameWriter();
  writePacketHeader(writer, options || {});
  const oldSteps = frame.steps;
  const oldElapsed = frame._elapsed;
  const requestedSteps = Number(options && options.steps);
  frame.steps = clamp(Number.isFinite(requestedSteps) ? Math.round(requestedSteps) : oldSteps || 1, 1, 255);
  frame._elapsed = -1;
  try {
    frame.pack(writer);
  } finally {
    frame.steps = oldSteps;
    frame._elapsed = oldElapsed;
  }
  return writer.finish();
}

function decodeAuthoritativeFrame(payload, stream) {
  if (!stream || typeof stream.unpackFrame !== "function") {
    throw new TypeError("原版 MatchStream.unpackFrame 不可用");
  }
  const bytes = asUint8Array(payload);
  if (bytes.byteLength < HEADER_BYTES || bytes.byteLength > MAX_FRAME_BYTES) {
    throw new RangeError(`权威帧长度非法: ${bytes.byteLength}`);
  }
  const reader = new FrameReader(bytes);
  const header = readPacketHeader(reader);
  const frame = stream.unpackFrame(reader);
  if (reader.remaining !== 0) throw new Error(`权威帧存在 ${reader.remaining} 字节尾数据`);
  return { ...header, frame, bytes: bytes.byteLength };
}

function inspectAuthoritativeFrame(payload) {
  const bytes = asUint8Array(payload);
  if (bytes.byteLength < HEADER_BYTES || bytes.byteLength > MAX_FRAME_BYTES) {
    throw new RangeError(`权威帧长度非法: ${bytes.byteLength}`);
  }
  return readPacketHeader(new FrameReader(bytes));
}

module.exports = {
  FrameReader,
  FrameWriter,
  HEADER_BYTES,
  MAGIC,
  MAX_FRAME_BYTES,
  VERSION,
  asUint8Array,
  decodeAuthoritativeFrame,
  encodeAuthoritativeFrame,
  inspectAuthoritativeFrame,
};
