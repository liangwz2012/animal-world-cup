export class XorShift32 {
  private value: number;

  constructor(seed: number) {
    const normalized = seed >>> 0;
    this.value = normalized === 0 ? 0x6d2b79f5 : normalized;
  }

  nextUint32(): number {
    let value = this.value;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.value = value >>> 0;
    return this.value;
  }

  nextFloat(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  get state(): number {
    return this.value >>> 0;
  }

  set state(value: number) {
    this.value = value >>> 0 || 0x6d2b79f5;
  }
}
