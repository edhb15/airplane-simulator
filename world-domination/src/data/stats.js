// Starting statistics for every territory (approximate mid-2020s figures).
// Columns: ISO3  population(M)  GDP($B)  government  active military(k)  navy  air  resources
//   government: D democracy, K constitutional monarchy, M absolute monarchy,
//               C communist state, A authoritarian, J military junta, T theocracy
//   navy / air: fleet and air-wing strength points ('-' = derived from GDP and manpower)
//   resources:  o oil, g gas, a gold & precious stones, u uranium, r rare earths & critical
//               minerals, i iron & steel, f food; digit = deposit size 1-3
const TABLE = `
USA 335 28800 D 1330 300 330 o3g3a2u1r1i2f3
CHN 1410 18500 C 2035 260 220 o1g1a2r3i3f3
JPN 124 4100 K 247 90 75 f1
DEU 84 4500 D 181 25 40 i1f2
IND 1440 3900 D 1455 90 120 o1g1i3r1f3u1
GBR 68 3500 K 150 70 50 o1g1f1
FRA 68 3100 D 205 70 60 f3
ITA 59 2300 D 165 45 35 f2
BRA 216 2200 D 366 35 40 o2i3a1f3r1
CAN 40 2200 K 68 25 25 o3g2u3a2i2f3r1
RUS 144 2000 A 1150 150 200 o3g3a3u2i2f2r1
MEX 129 1800 D 260 20 15 o2a2f2
KOR 52 1750 D 500 50 60 -
AUS 27 1800 K 60 25 30 o1g3a3u3i3f3r2
ESP 48 1700 K 125 30 30 f2
IDN 278 1400 D 400 40 30 o2g2a2i1f2r2
NLD 18 1100 K 34 15 15 g2f2
TUR 85 1100 A 355 45 50 f2i1
SAU 33 1100 M 257 20 45 o3g2a1
CHE 9 900 D 20 0 10 -
POL 37 840 D 200 8 20 f2
TWN 23.5 790 D 170 25 35 -
BEL 11.8 630 K 25 3 8 -
ARG 46 640 D 72 10 10 o1g2f3r2
SWE 10.5 590 K 25 8 15 i2u1
IRL 5.2 550 D 8 2 1 f1
THA 70 520 K 360 20 18 f2
AUT 9.1 520 D 23 0 6 -
NOR 5.5 480 K 25 10 8 o3g3f1
ISR 9.8 520 D 170 8 40 g1
ARE 10 530 M 63 8 25 o3g2
SGP 6 520 D 51 10 12 -
PHL 115 460 D 145 8 6 a1r1f2
VNM 100 470 C 480 15 15 o1r2f2
IRN 89 400 T 610 20 20 o3g3u1
BGD 172 450 D 163 6 5 f2
DNK 6 400 K 15 5 6 o1f2
MYS 34 420 K 113 10 8 o1g2r1f1
EGY 112 390 A 440 25 35 o1g2a1f1
COL 52 360 D 295 12 10 o2a1f2
HKG 7.5 380 C 0 0 0 -
NGA 225 250 D 143 5 5 o3g2f2
CZE 10.9 340 D 27 0 6 -
PAK 240 375 D 650 15 25 a1f2
CHL 19.6 335 D 77 8 8 r3a1
ROU 19 350 D 70 3 6 g1f2
FIN 5.6 300 D 24 3 8 i1
PER 34 270 D 81 6 4 a3r2
NZL 5.2 250 K 9 3 2 f3
IRQ 45 270 D 193 2 6 o3g1
PRT 10.4 290 D 27 6 5 -
KAZ 20 285 A 39 2 6 o3u3g1r1f1
GRC 10.4 245 D 142 12 15 -
UKR 37 180 D 900 3 15 f3i2g1
QAT 2.7 220 M 17 3 6 g3o2
DZA 46 260 A 140 8 10 o2g3
HUN 9.6 220 D 32 0 4 -
KWT 4.9 160 M 18 2 5 o3
MAR 37.5 150 K 196 4 6 r1f1
ETH 126 160 A 162 - - f1
ECU 18 120 D 41 - - o2
SVK 5.4 140 D 13 - - -
DOM 11 125 D 56 - - -
KEN 55 105 D 24 - - f1
AGO 37 85 A 107 - - o3a1
LKA 22 85 D 255 - - -
GTM 18 110 D 18 - - -
OMN 5 105 M 43 - - o2g1
BGR 6.4 110 D 37 - - -
UZB 36 100 A 48 - - g2a2u2
VEN 28 95 A 123 - - o3a1
CRI 5.2 90 D 0 - - -
LUX 0.67 90 K 1 - - -
PAN 4.5 85 D 0 - - -
HRV 3.8 90 D 15 - - -
LTU 2.9 85 D 23 - - -
SRB 6.6 80 D 28 - - -
TZA 67 80 D 27 - - a2
CIV 29 85 D 27 - - f2
GHA 34 75 D 16 - - a3o1
URY 3.4 80 D 22 - - f2
TKM 6.5 80 A 37 - - g3
BLR 9.2 72 A 48 - - f1
COD 105 70 A 135 - - r3a2
AZE 10.2 75 A 64 - - o2g2
SVN 2.1 70 D 7 - - -
UGA 48 50 A 45 - - -
LBY 7 45 A 30 - - o3
MMR 54 65 J 150 - - -
JOR 11 52 M 100 - - -
CMR 28 50 A 25 - - o1
TUN 12 50 D 36 - - -
BOL 12.4 48 D 34 - - g1r3
BHR 1.5 45 M 18 - - o1
SDN 48 30 J 104 - - a2
PRY 6.9 43 D 14 - - f2
LVA 1.9 43 D 7 - - -
EST 1.4 41 D 7 - - -
NPL 30 41 D 96 - - -
ZWE 16 35 A 29 - - a1r1
SLV 6.3 34 D 25 - - -
HND 10.6 35 D 15 - - -
KHM 17 32 A 124 - - -
ISL 0.39 31 D 0 - - -
SEN 18 31 D 14 - - -
CYP 1.3 34 D 12 - - -
ZMB 21 28 D 15 - - r3
GEO 3.7 30 D 21 - - -
PNG 10 32 K 3 - - a2g2
TTO 1.5 28 D 4 - - g2
BIH 3.2 28 D 10 - - -
BWA 2.7 20 D 9 - - a2
ALB 2.8 25 D 7 - - -
MLI 23 21 J 41 - - a2
BFA 23 20 J 12 - - a2
GAB 2.4 21 J 5 - - o2
MOZ 34 22 D 11 - - g2
ARM 2.8 25 D 45 - - -
NIC 7 18 A 12 - - -
MNG 3.5 22 D 10 - - r2a1i1
MLT 0.54 22 D 2 - - -
MDG 30 16 D 13 - - -
GIN 14 24 J 10 - - r2a1
JAM 2.8 19 D 6 - - -
BEN 13.7 21 D 12 - - -
NAM 2.6 13 D 9 - - u3a1
TCD 18 13 J 33 - - o1
MKD 1.8 16 D 8 - - -
MUS 1.3 15 D 0 - - -
BRN 0.45 15 M 7 - - o2g1
RWA 14 14 A 33 - - -
HTI 11.7 25 D 1 - - -
MDA 2.5 17 D 5 - - -
KGZ 7 14 A 11 - - a1
TJK 10 12 A 9 - - r1
NER 27 17 J 5 - - u2
COG 6 15 A 10 - - o2
GNQ 1.7 12 A 2 - - o2
SOM 18 11 A 20 - - -
MWI 21 12 D 11 - - -
MRT 4.9 10 A 16 - - i2
FJI 0.93 5.5 D 4 - - -
TGO 9 9.2 A 9 - - -
MNE 0.62 7.5 D 2 - - -
SUR 0.62 4 D 2 - - a1
SWZ 1.2 4.6 M 3 - - -
SLE 8.6 4.2 D 9 - - r1
GUY 0.8 25 D 3 - - o3
BDI 13 3 A 30 - - -
LSO 2.3 2.3 K 2 - - -
BTN 0.78 3 K 8 - - -
CAF 5.7 2.8 A 9 - - a1
LBR 5.4 4.3 D 2 - - -
DJI 1.1 4 A 10 - - -
TLS 1.4 2 D 2 - - o1
BLZ 0.41 3.2 K 1 - - -
CPV 0.52 2.6 D 1 - - -
LCA 0.18 2.5 K 0 - - -
SMR 0.034 2 D 0 - - -
SYC 0.12 2.1 D 0.4 - - -
ATG 0.094 2 K 0 - - -
GMB 2.7 2.4 D 1 - - -
GNB 2.2 2 J 4 - - -
SLB 0.74 1.7 K 0 - - -
COM 0.85 1.4 D 0.5 - - -
GRD 0.13 1.3 K 0 - - -
VUT 0.33 1.1 D 0 - - -
KNA 0.047 1.1 K 0 - - -
WSM 0.22 0.9 D 0 - - -
VCT 0.1 1.1 K 0 - - -
DMA 0.073 0.65 D 0 - - -
STP 0.23 0.7 D 0.3 - - -
TON 0.1 0.5 K 0.5 - - -
FSM 0.11 0.46 D 0 - - -
PLW 0.018 0.3 D 0 - - -
MHL 0.042 0.28 D 0 - - -
KIR 0.13 0.28 D 0 - - -
NRU 0.012 0.15 D 0 - - -
MDV 0.52 7 D 4 - - -
AND 0.08 3.7 K 0 - - -
MCO 0.039 9 K 0 - - -
LIE 0.039 7 K 0 - - -
VAT 0.0008 0.3 T 0.1 - - -
BRB 0.28 6.5 D 0.6 - - -
BHS 0.41 14 K 1.5 - - -
CUB 11 30 C 50 - - f1r1
PRK 26 20 C 1280 25 30 u1r1
SYR 23 9 A 170 - - o1
LBN 5.4 18 D 60 - - -
YEM 34 17 A 40 - - o1
AFG 41 17 T 150 - - r2
PSE 5.4 18 A 0 - - -
LAO 7.6 15 C 30 - - r1
SSD 11 6 A 55 - - o2
ERI 3.7 2.5 A 200 - - -
XKX 1.8 10 D 3 - - -
ZAF 61 380 D 74 8 10 a3r3i2u1f1
ESH 0.6 1 A 0 - - r1
GRL 0.056 3.2 K 0 - - u2r3
PRI 3.2 120 D 0 - - -
NCL 0.27 10 D 0 - - r2
PYF 0.28 6 D 0 - - -
FLK 0.004 0.3 D 0 - - o1
`;

// Strategic nuclear arsenals (1 point ~ 100 warheads, rounded up)
export const NUKES = { USA: 50, RUS: 55, CHN: 5, FRA: 3, GBR: 2, IND: 2, PAK: 2, ISR: 1, PRK: 1 };

// Defence spending as share of GDP where it is well above the default
export const MIL_SPEND = {
  USA: 3.4, RUS: 6.5, CHN: 1.7, IND: 2.4, SAU: 7.1, ISR: 5.3, UKR: 20, POL: 4.1, KOR: 2.8, GBR: 2.3,
  FRA: 2.1, PAK: 2.8, IRN: 2.1, PRK: 20, DZA: 8, OMN: 5.6, KWT: 4.8, QAT: 7, ARE: 5, JOR: 4.5,
  GRC: 3.1, EST: 3.2, LTU: 2.9, LVA: 2.4, TUR: 2.1, EGY: 1.3, ARM: 4.4, AZE: 4.8, MAR: 4, ERI: 10,
};

// Military technology head start for the established powers (tiers added on top of the economic baseline)
export const MIL_TECH_BONUS = {
  USA: 2, RUS: 2, CHN: 2, GBR: 1, FRA: 1, ISR: 2, KOR: 1, JPN: 1, IND: 1, TUR: 1, PAK: 1, PRK: 1, IRN: 1, TWN: 1, SAU: 1,
};

const RES_KEYS = { o: 'oil', g: 'gas', a: 'gold', u: 'uranium', r: 'rare', i: 'iron', f: 'food' };

export const STATS = {};
for (const line of TABLE.trim().split('\n')) {
  const [id, pop, gdp, gov, mil, navy, air, res] = line.trim().split(/\s+/);
  const r = {};
  if (res && res !== '-') for (const [, k, n] of res.matchAll(/([a-z])(\d)/g)) r[RES_KEYS[k]] = +n;
  STATS[id] = {
    pop: +pop, gdp: +gdp, gov, mil: +mil,
    navy: navy === '-' ? null : +navy, air: air === '-' ? null : +air,
    res: r,
  };
}
