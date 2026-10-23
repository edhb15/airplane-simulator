// Analytic steady-level-flight check: required CL/alpha, drag vs available thrust, elevator to trim.
import { AIRCRAFT } from '../src/aircraft/aircraftData.js';
import { atmosphere, KT, FT, DEG, G0 } from '../src/physics/atmosphere.js';
function wave(M, A) { const mc = A.Mcrit; if (M <= mc) return 0; if (!A.supersonic) { const d = M - mc; return 20*d*d*d + 1.5*d*d; } const pk = A.waveDrag; if (M < 1.05) { const t = (M-mc)/(1.05-mc); return pk*t*t*(3-2*t);} return pk*(0.55+0.45*1.05/M); }
function tmax(spec, atm, V) {
  const e = spec.engine; const M = V / atm.a;
  if (e.type === 'jet') { const dens = Math.pow(atm.sigma, e.densityExp); const mf = Math.max(0.35, Math.min(2.2, 1 + e.machLapse * M)); return e.list.length * (e.maxThrust + (e.abThrust||0)*0) * dens * mf; }
  const dens = e.type === 'turboprop' ? Math.min(1, 1.25*Math.pow(atm.sigma, 0.75)) : Math.max(0, (atm.sigma - 0.12)/0.88);
  return e.list.length * e.efficiency * e.maxPower * dens / Math.sqrt(V*V + e.vKnee*e.vKnee);
}
function check(spec, altFt, V, flapIdx, gear, mass) {
  const A = spec.aero; const atm = atmosphere(altFt*FT); const q = 0.5*atm.rho*V*V; const S = spec.wing.area; const b = spec.wing.span; const AR = b*b/S;
  const f = spec.flaps[flapIdx];
  const CL = mass*G0/(q*S); const alpha = (CL - A.CL0 - f.dCL)/A.CLa;
  const CD = A.CD0 + f.dCD + A.gearCD*gear + CL*CL/(Math.PI*A.e*AR) + wave(V/atm.a, A);
  const D = q*S*CD; const T = tmax(spec, atm, V);
  const de = -(A.Cm0 + A.Cma*alpha + A.CmFlap*(f.deg/spec.flaps[spec.flaps.length-1].deg||0))/A.Cme;
  const aStall = A.alphaStall + f.dStall;
  return `${altFt}ft ${(V/KT).toFixed(0)}KTAS M${(V/atm.a).toFixed(2)} flap${f.name} CL=${CL.toFixed(2)} a=${(alpha/DEG).toFixed(1)}° (stall ${aStall}°) L/D=${(CL/CD).toFixed(1)} D=${(D/1000).toFixed(1)}kN Tmax=${(T/1000).toFixed(1)}kN ratio=${(D/T).toFixed(2)} elev=${de.toFixed(2)}`;
}
function vs(spec, flapIdx, mass) { const A = spec.aero; const f = spec.flaps[flapIdx]; const CLmax = A.CL0 + f.dCL + A.CLa * (A.alphaStall + f.dStall - 0.6) * DEG; return Math.sqrt(2*mass*G0/(1.225*spec.wing.area*CLmax))/KT; }
for (const spec of AIRCRAFT) {
  const m = spec.mass.empty + spec.mass.maxFuel*0.5 + spec.mass.maxPayload*0.5;
  console.log('==', spec.name, 'mass', m, 'Vs clean', vs(spec,0,m).toFixed(0), 'Vs full', vs(spec, spec.flaps.length-1, m).toFixed(0), 'book', spec.speeds.vs);
  console.log(' ', check(spec, spec.speeds.cruiseAlt, spec.speeds.cruise*KT, 0, 0, m));
  console.log(' ', check(spec, 10000, 250*KT*1.16, 0, 0, m));
  console.log(' ', check(spec, 1000, spec.speeds.vref*KT, spec.flaps.length-1, 1, m));
  console.log(' ', check(spec, spec.speeds.ceiling*0.97, (spec.speeds.cruise*0.95)*KT, 0, 0, m));
}
