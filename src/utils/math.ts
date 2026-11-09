/**
 * Mathematical utilities for the Digital Grandfather Clock
 */

/**
 * Calculates Simple Harmonic Motion angle for pendulum:
 * θ(t) = θ_max * cos((2π / T) * t)
 *
 * @param t Current time in seconds (locked to epoch time)
 * @param periodSeconds Period T in seconds
 * @param maxAngleDeg Maximum deflection angle θ_max in degrees
 * @returns Current angle in degrees
 */
export function calculatePendulumAngle(
  t: number,
  periodSeconds: number,
  maxAngleDeg: number
): number {
  if (periodSeconds <= 0) return 0;
  const omega = (2 * Math.PI) / periodSeconds;
  return maxAngleDeg * Math.cos(omega * t);
}

/**
 * Calculates exact rotation angles for clock hands given a timestamp
 */
export interface HandAngles {
  hour: number;
  minute: number;
  second: number;
}

export function calculateHandAngles(
  date: Date,
  secondMode: 'tick' | 'sweep' = 'tick'
): HandAngles {
  const hours = date.getHours() % 12;
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const milliseconds = date.getMilliseconds();

  // Second hand angle
  let secondAngle: number;
  if (secondMode === 'tick') {
    secondAngle = seconds * 6; // 360 / 60 = 6 deg/sec
  } else {
    // Sweep mode: continuous sub-second interpolation
    const continuousSeconds = seconds + milliseconds / 1000;
    secondAngle = continuousSeconds * 6;
  }

  // Minute hand angle (continuous progression with seconds & ms)
  const continuousMinutes = minutes + seconds / 60 + milliseconds / 60000;
  const minuteAngle = continuousMinutes * 6;

  // Hour hand angle (continuous progression with minutes & seconds)
  const continuousHours = hours + minutes / 60 + seconds / 3600;
  const hourAngle = continuousHours * 30; // 360 / 12 = 30 deg/hour

  return {
    hour: hourAngle,
    minute: minuteAngle,
    second: secondAngle
  };
}

