#pragma once
#include <stdint.h>
#include <math.h>

// Hardware-independent state machines used by the sampling task and native tests.
namespace Safety {
class DebouncedButton {
public:
  bool update(uint32_t now, bool pressed) {
    if (pressed != raw_) { raw_ = pressed; changedAt_ = now; }
    if (raw_ != stable_ && uint32_t(now - changedAt_) >= 40) {
      stable_ = raw_;
      return stable_;
    }
    return false;
  }
  bool pressed() const { return stable_; }
private:
  bool raw_ = false;
  bool stable_ = false;
  uint32_t changedAt_ = 0;
};

enum Alarm : uint8_t { Sos = 1, Fall = 2, GasWarning = 4, GasCritical = 8 };
class Alarms {
public:
  void raise(Alarm alarm) { active_ |= alarm; ++generation_[index(alarm)]; }
  void restore(uint8_t mask) { active_ = mask & (Sos | Fall); }
  void clearGas() { active_ &= ~(GasWarning | GasCritical); }
  uint8_t active() const { return active_; }
  uint8_t latched() const { return active_ & (Sos | Fall); }
  unsigned severity() const {
    return active_ & (Sos | Fall | GasCritical) ? 3 : (active_ & GasWarning ? 2 : 0);
  }
  // A fresh physical hold only acknowledges the SOS/fall generations present
  // at its start. Continuous hazards and alarms raised during the hold survive.
  uint8_t acknowledge(uint32_t now, bool pressed) {
    if (!pressed) { holding_ = false; completed_ = false; return 0; }
    if (!holding_) {
      holding_ = true; heldAt_ = now; captured_ = latched();
      capturedGeneration_[0] = generation_[0];
      capturedGeneration_[1] = generation_[1];
    }
    if (completed_ || uint32_t(now - heldAt_) < 2000) return 0;
    completed_ = true;
    uint8_t cleared = 0;
    for (unsigned i = 0; i < 2; ++i) {
      const uint8_t bit = 1u << i;
      if ((captured_ & bit) && generation_[i] == capturedGeneration_[i]) cleared |= bit;
    }
    active_ &= ~cleared;
    return cleared;
  }
private:
  static unsigned index(Alarm alarm) {
    return alarm == Sos ? 0 : alarm == Fall ? 1 : alarm == GasWarning ? 2 : 3;
  }
  uint8_t active_ = 0, captured_ = 0;
  uint32_t generation_[4] = {}, capturedGeneration_[2] = {}, heldAt_ = 0;
  bool holding_ = false, completed_ = false;
};

class FallDetector {
public:
  FallDetector(float freeFall, float impact, uint32_t stillness)
      : freeFall_(freeFall), impact_(impact), stillness_(stillness) {}
  bool update(uint32_t now, float magnitude, bool valid = true) {
    // A failed sample cannot complete a motion sequence or clear a latched fall.
    if (!valid || !isfinite(magnitude)) { if (state_ != Latched) state_ = Idle; return false; }
    switch (state_) {
      case Idle:
        if (magnitude < freeFall_) { state_ = Falling; started_ = now; }
        break;
      case Falling:
        if (uint32_t(now - started_) > 400) state_ = Idle;
        else if (magnitude > impact_) { state_ = Still; started_ = now; }
        break;
      case Still:
        // Require continuous stillness, not only one convenient final sample.
        if (fabsf(magnitude - 1.0f) >= 0.45f) state_ = Idle;
        else if (uint32_t(now - started_) >= stillness_) { state_ = Latched; return true; }
        break;
      case Latched: break;
    }
    return false;
  }
  void reset() { state_ = Idle; }
private:
  enum State { Idle, Falling, Still, Latched } state_ = Idle;
  float freeFall_, impact_;
  uint32_t stillness_, started_ = 0;
};
}
