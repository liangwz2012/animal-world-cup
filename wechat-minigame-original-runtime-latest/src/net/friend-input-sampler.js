const PULSE_ACTIONS = ["pass", "lob", "tackle", "switchPlayer"];

function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : 0;
}

function createFriendInputSampler() {
  const pulseSeq = Object.create(null);
  for (const action of PULSE_ACTIONS) pulseSeq[action] = 0;
  let frame = 0;

  function reset() {
    frame = 0;
    for (const action of PULSE_ACTIONS) pulseSeq[action] = 0;
  }

  function sample(source) {
    const input = source || {};
    let vx = clamp(input.vx, -1, 1);
    let vy = clamp(input.vy, -1, 1);
    const magnitude = Math.hypot(vx, vy);
    if (magnitude > 1) {
      vx /= magnitude;
      vy /= magnitude;
    }
    const packet = {
      active: input.active !== false,
      vx,
      vy,
      shoot: !!input.shoot,
      sprint: !!input.sprint,
      pass: false,
      lob: false,
      tackle: false,
      switchPlayer: false,
      pulseSeq: {},
    };
    for (const action of PULSE_ACTIONS) {
      if (!input[action]) continue;
      pulseSeq[action] += 1;
      packet[action] = true;
      packet.pulseSeq[action] = pulseSeq[action];
      // 正式好友客机不运行本地 acApplyInput，必须由采样器消费单次动作，
      // 否则一次点击会在每个 30 Hz 网络包中重复发送。
      input[action] = false;
    }
    frame += 1;
    return { frame, input: packet };
  }

  function neutral() {
    return {
      frame: ++frame,
      input: {
        active: false,
        vx: 0,
        vy: 0,
        shoot: false,
        sprint: false,
        pass: false,
        lob: false,
        tackle: false,
        switchPlayer: false,
        pulseSeq: {},
      },
    };
  }

  return { sample, neutral, reset, get frame() { return frame; } };
}

module.exports = { PULSE_ACTIONS, createFriendInputSampler };
