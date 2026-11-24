#include "../../ComPallete/SafetyLogic.h"
#include <assert.h>
#include <stdio.h>

int main() {
  Safety::DebouncedButton button;
  unsigned presses = 0;
  for (uint32_t now = 0; now < 600; now += 5) presses += button.update(now, now >= 10);
  assert(presses == 1); // A held button emits once, not zero or on every poll.
  button.update(610, false); button.update(655, false);
  assert(!button.update(660, true));
  assert(!button.update(675, false)); // Bounce is not a press.
  assert(!button.update(690, true));
  assert(button.update(735, true));

  Safety::DebouncedButton rollover;
  rollover.update(UINT32_MAX - 20, true);
  assert(rollover.update(25, true));

  Safety::Alarms alarms;
  alarms.raise(Safety::Sos); alarms.raise(Safety::GasWarning);
  assert(alarms.severity() == 3);
  assert(alarms.acknowledge(10, true) == 0);
  alarms.raise(Safety::Fall); // Must not be cleared by a hold already in progress.
  assert(alarms.acknowledge(2010, true) == Safety::Sos);
  assert(alarms.active() == (Safety::Fall | Safety::GasWarning));
  assert(alarms.acknowledge(5000, true) == 0);
  alarms.acknowledge(5001, false);
  alarms.acknowledge(5010, true);
  alarms.raise(Safety::Fall); // A newer generation of the same alarm survives too.
  assert(alarms.acknowledge(7010, true) == 0);
  alarms.acknowledge(7020, false); alarms.acknowledge(7030, true);
  assert(alarms.acknowledge(9030, true) == Safety::Fall);
  assert(alarms.severity() == 2); // Acknowledgement does not silence continuous gas.
  alarms.clearGas(); assert(alarms.severity() == 0);
  alarms.restore(Safety::Sos | Safety::GasCritical);
  assert(alarms.active() == Safety::Sos);

  Safety::FallDetector detector(0.5f, 2.6f, 1500);
  assert(!detector.update(0, 0.2f));
  assert(!detector.update(100, 3.0f));
  assert(!detector.update(200, 1.0f));
  assert(detector.update(1600, 1.0f));
  assert(!detector.update(1700, 1.0f));
  detector.reset(); detector.update(2000, 0.2f); detector.update(2100, 3.0f);
  detector.update(2200, 2.0f);
  assert(!detector.update(3700, 1.0f)); // Movement cancels the stillness sequence.
  detector.reset(); detector.update(4000, 0.2f); detector.update(4500, 3.0f);
  assert(!detector.update(6000, 1.0f)); // Impact outside the window is not a fall.
  detector.reset(); detector.update(7000, 0.2f); detector.update(7100, 3.0f);
  detector.update(7200, NAN, false);
  assert(!detector.update(9000, 1.0f));
  puts("Safety state-machine tests passed");
}
