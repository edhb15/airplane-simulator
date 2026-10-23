// International Standard Atmosphere with optional temperature deviation.

export const G0 = 9.80665;
export const R_AIR = 287.053;
export const RHO0 = 1.225;
export const T0 = 288.15;
export const P0 = 101325;

export const KT = 0.514444; // m/s per knot
export const FT = 0.3048; // m per foot
export const NM = 1852; // m per nautical mile
export const FPM = 0.00508; // m/s per ft/min
export const DEG = Math.PI / 180;

const out = { rho: RHO0, T: T0, p: P0, a: 340.3, sigma: 1 };

// Returns a shared object; copy values if you need to keep them.
export function atmosphere(altitude, tempOffset = 0) {
  const h = Math.max(-500, Math.min(altitude, 30000));
  let T, p;
  if (h < 11000) {
    T = T0 - 0.0065 * h;
    p = P0 * Math.pow(T / T0, 5.25588);
  } else {
    const T11 = 216.65;
    const p11 = 22632.06;
    T = T11;
    p = p11 * Math.exp((-G0 * (h - 11000)) / (R_AIR * T11));
  }
  const Tact = T + tempOffset;
  out.T = Tact;
  out.p = p;
  out.rho = p / (R_AIR * Tact);
  out.a = Math.sqrt(1.4 * R_AIR * Tact);
  out.sigma = out.rho / RHO0;
  return out;
}

// Indicated (calibrated ~ equivalent) airspeed from true airspeed.
export function tasToIas(tas, rho) {
  return tas * Math.sqrt(rho / RHO0);
}

export function iasToTas(ias, rho) {
  return ias / Math.sqrt(rho / RHO0);
}
