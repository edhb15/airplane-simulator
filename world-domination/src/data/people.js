// Leader name pools, government types and personality traits.
// Leaders are fictional and generated fresh every game.

const POOLS = {
  anglo: {
    first: 'James Robert Michael William David Sarah Emily Olivia Grace Thomas Daniel Matthew Laura Claire Henry Charlotte Amelia Jack Ethan Rachel Andrew Victoria Nathan Eleanor Harriet Simon Fiona Marcus Megan Owen',
    last: 'Whitmore Ashford Caldwell Harrington Blackwood Pembroke Sinclair Thornton Mercer Hollis Langley Prescott Radcliffe Sterling Carver Bennett Fairfax Holloway Kingsley Lockhart Dunmore Garrison Wexley Ellison Hawthorne Barrow Calloway Stanton Winslow Reeve',
  },
  latin: {
    first: 'Alejandro Carlos Javier Luis Miguel Rafael Andrés Diego Sofía Valentina Camila Lucía Gabriela Isabel Mariana Fernanda Joaquín Mateo Tomás Esteban Paula Daniela Ximena Rodrigo Emilio Renata Bruno Inés Gonzalo Pilar',
    last: 'Montoya Salazar Echeverría Valdés Cordero Fuentes Ibarra Navarro Quintero Restrepo Saavedra Villalobos Arriaga Belmonte Cifuentes Duarte Escobedo Galindo Herrera Lozano Medina Ortega Paredes Robles Serrano Toledo Urrutia Vargas Zamora Aguirre',
  },
  lusophone: {
    first: 'João Pedro Lucas Gabriel Rafael Thiago Ana Beatriz Mariana Larissa Juliana Fernanda Rodrigo Caio Vinícius Helena Luiza Marcelo Eduardo Renata',
    last: 'Albuquerque Bragança Carvalho Damasceno Figueiredo Guimarães Medeiros Nogueira Pacheco Queiroz Rezende Sampaio Teixeira Vasconcelos Azevedo Barreto Cardoso Moreira Siqueira Tavares',
  },
  french: {
    first: 'Jean Pierre Louis Antoine Mathieu Julien Nicolas Camille Élise Margaux Sophie Claire Chloé Hélène Benoît Laurent Olivier Agathe Céline Théo',
    last: 'Delacroix Fontaine Marchand Beaumont Rousseau Lefebvre Moreau Garnier Chevalier Durand Bertrand Lambert Mercier Girard Faure Barbier Renaud Dumont Vasseur Lacroix',
  },
  german: {
    first: 'Lukas Felix Maximilian Jonas Friedrich Matthias Stefan Anna Lena Katharina Johanna Sabine Ursula Henrik Annika Sven Lars Ingrid Astrid Nils',
    last: 'Brandt Hoffmann Weber Krüger Lindqvist Schreiber Vogel Albrecht Brenner Falk Hartmann Keller Lorenz Neumann Richter Sorensen Ekström Halvorsen Jansen de Vries',
  },
  mediterranean: {
    first: 'Marco Giovanni Alessandro Luca Matteo Giulia Francesca Chiara Elena Nikos Dimitris Kostas Eleni Sofia Andreas Giorgos Paolo Lorenzo Rosa Stavros',
    last: 'Rinaldi Bianchi Conti Moretti Ferraro Galli Lombardi Marchetti Esposito Papadakis Karamanlis Andreou Georgiou Konstantinou Vitale Santoro Caruso Pellegrini Barbieri Demetriou',
  },
  slavic: {
    first: 'Aleksandr Dmitri Sergei Nikolai Viktor Mikhail Pavel Andrei Yuri Oleg Natalia Irina Svetlana Olga Tatiana Elena Anna Bogdan Tomasz Jakub Piotr Katarzyna Milan Dragan Vesna',
    last: 'Volkov Petrov Sokolov Morozov Lebedev Kozlov Novak Kowalski Zielinski Wojcik Horvat Kovačević Marković Dvořák Svoboda Belov Orlov Gromov Kuznetsov Zhukov Bondarenko Shevchenko Tkachenko Ivanić Radek',
  },
  arab: {
    first: 'Mohammed Ahmed Khalid Omar Faisal Hassan Youssef Tariq Karim Salman Nasser Rashid Layla Fatima Noor Amira Huda Samira Zayed Hamad Saeed Walid Adel Mansour Jamal',
    last: 'Al-Rashid Al-Mansouri Al-Hashimi Haddad Khoury Nasrallah Al-Farsi Saleh Abdullah Bin Zayed Al-Qasimi El-Sayed Mahmoud Hamdan Jaber Al-Najjar Barakat Darwish Fakhoury Al-Tamimi Rahman Suleiman Qureshi Aziz Kassab',
  },
  persianTurkic: {
    first: 'Reza Ali Hossein Dariush Kourosh Farhad Mehdi Shirin Parisa Leila Mehmet Ahmet Mustafa Emre Kemal Selin Aylin Nursultan Timur Bakhyt Rustam Aziz Dilnoza Murat Erlan',
    last: 'Tehrani Rostami Karimi Farahani Mousavi Hosseini Yilmaz Demir Kaya Aydin Öztürk Çelik Şahin Nazarbek Karimov Tokayev Aliyev Rakhmonov Bekov Sultanov Nurlanov Abdulov Ismailov Yusupov Mirzaev',
  },
  african: {
    first: 'Kwame Kofi Ama Abena Chinedu Ngozi Adebayo Folake Amara Jabari Tendai Thabo Nomsa Sipho Zanele Mamadou Aminata Ousmane Fatoumata Moussa Wanjiru Kamau Baraka Imani Juma Nia Tafari Lindiwe Oluwaseun Kagiso',
    last: 'Mensah Owusu Adeyemi Okonkwo Nwosu Mbeki Ndlovu Dlamini Mokoena Diallo Traoré Coulibaly Keita Touré Kenyatta Otieno Mwangi Mutua Banda Phiri Mutasa Moyo Kabila Tshisekedi Abubakar Bello Danjuma Ekwueme Nkemelu Okafor',
  },
  southAsian: {
    first: 'Arjun Rohan Vikram Rahul Aditya Sanjay Anil Priya Ananya Kavya Meera Lakshmi Sunita Imran Farhan Bilal Ayesha Sana Zara Nadia Rajesh Devendra Gaurav Shreya Kiran',
    last: 'Sharma Verma Iyer Reddy Nair Kapoor Mehta Chatterjee Banerjee Rao Desai Malhotra Choudhury Khan Siddiqui Chaudhry Bhutto Rahman Hossain Perera Fernando Thapa Shrestha Rana Gill',
  },
  chinese: {
    first: 'Wei Jian Hao Ming Lei Jun Tao Yong Feng Bo Li Na Mei Xiu Ying Hua Lan Jing Yan Chen Zhi Guo Hong Qiang Long',
    last: 'Wang Li Zhang Liu Chen Yang Zhao Huang Zhou Wu Xu Sun Ma Zhu Hu Guo He Lin Gao Luo',
  },
  japaneseKorean: {
    first: 'Hiroshi Takeshi Kenji Haruto Yuto Sota Akira Yuki Sakura Aoi Haruka Emi Min-jun Seo-jun Ji-ho Ha-eun Seo-yeon Ji-woo Hyun-woo Sung-min Kaito Rin Daichi Naoki Eun-ji',
    last: 'Takahashi Watanabe Yamamoto Nakamura Kobayashi Sato Suzuki Tanaka Ishikawa Fujimoto Matsuda Mori Kim Lee Park Choi Jung Kang Cho Yoon Jang Lim Han Shin Kwon',
  },
  southeastAsian: {
    first: 'Nguyen Minh Thanh Anh Somchai Siriporn Kittisak Arif Budi Dewi Putri Rizal Agus Maria Jose Ramon Rosario Hamzah Aziz Farah Sokha Dara Thida Aung Kyaw',
    last: 'Tran Le Pham Hoang Vu Srisai Chaiyaporn Wongsakul Santoso Wijaya Hartono Pratama Reyes Santos Cruz Bautista Mendoza Rahman Ismail Abdullah Sok Chea Thein Win Aung',
  },
  pacific: {
    first: 'Sione Tevita Losa Mele Ratu Josaia Litia Manu Tui Aroha Kahu Moana Hemi Talia Semisi Viliami Ana Fetu Leilani Kalani',
    last: 'Tupou Fifita Vaipulu Bainimarama Rabuka Taufa Faleolo Lealaiauloto Tuilagi Matagi Kauhalalalo Ngata Parata Waititi Moengangongo Tavita Soliai Ioane Mataafa Pohiva',
  },
};

const SUB_POOL = {
  'Northern America': 'anglo', 'Australia and New Zealand': 'anglo', 'Caribbean': 'anglo',
  'South America': 'latin', 'Central America': 'latin',
  'Western Europe': 'french', 'Northern Europe': 'german', 'Central Europe': 'german',
  'Southern Europe': 'mediterranean', 'Southeast Europe': 'slavic', 'Eastern Europe': 'slavic',
  'Northern Africa': 'arab', 'Western Asia': 'arab', 'Central Asia': 'persianTurkic', 'Southern Asia': 'southAsian',
  'Eastern Asia': 'chinese', 'South-Eastern Asia': 'southeastAsian',
  'Western Africa': 'african', 'Eastern Africa': 'african', 'Middle Africa': 'african', 'Southern Africa': 'african',
  'Melanesia': 'pacific', 'Polynesia': 'pacific', 'Micronesia': 'pacific',
};
const ISO_POOL = {
  GBR: 'anglo', IRL: 'anglo', USA: 'anglo', CAN: 'anglo', BRA: 'lusophone', PRT: 'lusophone', AGO: 'lusophone', MOZ: 'lusophone',
  CPV: 'lusophone', GNB: 'lusophone', STP: 'lusophone', TLS: 'lusophone', ESP: 'latin', MEX: 'latin', CUB: 'latin', DOM: 'latin',
  PRI: 'latin', JPN: 'japaneseKorean', KOR: 'japaneseKorean', PRK: 'japaneseKorean', IRN: 'persianTurkic', TUR: 'persianTurkic',
  AZE: 'persianTurkic', AFG: 'persianTurkic', ISR: 'mediterranean', GRC: 'mediterranean', CYP: 'mediterranean', ITA: 'mediterranean',
  MLT: 'mediterranean', DEU: 'german', AUT: 'german', CHE: 'german', NLD: 'german', BEL: 'french', LUX: 'french', FRA: 'french',
  MCO: 'french', HTI: 'french', SEN: 'african', CIV: 'african', MDG: 'african', HUN: 'slavic', ROU: 'slavic', LTU: 'slavic',
  LVA: 'slavic', EST: 'german', FIN: 'german', MNG: 'persianTurkic', SOM: 'arab', DJI: 'arab', SDN: 'arab', MRT: 'arab',
  PHL: 'southeastAsian', SGP: 'chinese', TWN: 'chinese', HKG: 'chinese', GEO: 'slavic', ARM: 'slavic',
};

export function namePoolFor(iso, subregion) {
  return POOLS[ISO_POOL[iso] || SUB_POOL[subregion] || 'anglo'];
}

export function randomLeaderName(rng, iso, subregion) {
  const p = namePoolFor(iso, subregion);
  const first = p.first.split(' ');
  const last = p.last.split(' ');
  return `${rng.pick(first)} ${rng.pick(last)}`;
}

export const GOVS = {
  D: { name: 'Democracy', title: 'President', democratic: true, pc: 2.5, taxEff: 1.0, stabilityBase: 55, repression: 0, electionYears: 4, color: '#4c8bf5' },
  K: { name: 'Constitutional Monarchy', title: 'Prime Minister', democratic: true, pc: 2.5, taxEff: 1.0, stabilityBase: 62, repression: 0, electionYears: 4, color: '#7aa6ff' },
  M: { name: 'Absolute Monarchy', title: 'King', democratic: false, pc: 3.5, taxEff: 0.85, stabilityBase: 58, repression: 0.4, color: '#d9a441' },
  C: { name: 'Communist State', title: 'General Secretary', democratic: false, pc: 3.5, taxEff: 0.9, stabilityBase: 55, repression: 0.6, color: '#d64545' },
  A: { name: 'Authoritarian Regime', title: 'President', democratic: false, pc: 3.5, taxEff: 0.8, stabilityBase: 50, repression: 0.5, color: '#9b6bd3' },
  J: { name: 'Military Junta', title: 'General', democratic: false, pc: 3, taxEff: 0.7, stabilityBase: 42, repression: 0.7, color: '#6f7d3a' },
  T: { name: 'Theocracy', title: 'Supreme Leader', democratic: false, pc: 3, taxEff: 0.75, stabilityBase: 52, repression: 0.6, color: '#2fa58c' },
};

export const TITLE_OVERRIDES = { GBR: 'Prime Minister', JPN: 'Prime Minister', DEU: 'Chancellor', IND: 'Prime Minister', ITA: 'Prime Minister', ESP: 'Prime Minister', CAN: 'Prime Minister', AUS: 'Prime Minister', CHN: 'Chairman', PRK: 'Supreme Leader', SAU: 'King', ARE: 'Emir', QAT: 'Emir', KWT: 'Emir', OMN: 'Sultan', BRN: 'Sultan', VAT: 'Pope' };

// Personality axes 0..1: aggression, expansion, diplomacy, caution, honor, paranoia, ideology, economy, science
export const TRAITS = {
  Warmonger: { desc: 'Seeks glory on the battlefield.', aggression: 0.35, caution: -0.2 },
  Expansionist: { desc: 'Dreams of a greater nation with wider borders.', expansion: 0.35, aggression: 0.15 },
  Diplomat: { desc: 'Prefers treaties and summits to tanks.', diplomacy: 0.35, aggression: -0.15 },
  Cautious: { desc: 'Avoids risk at nearly any cost.', caution: 0.35, aggression: -0.15 },
  Isolationist: { desc: 'Wants nothing to do with foreign entanglements.', diplomacy: -0.25, expansion: -0.2 },
  Opportunist: { desc: 'Strikes when others are weak.', aggression: 0.15, honor: -0.15, expansion: 0.1 },
  Ideologue: { desc: 'Judges other nations by their system of government.', ideology: 0.45 },
  Paranoid: { desc: 'Sees enemies everywhere and arms accordingly.', paranoia: 0.4, diplomacy: -0.1 },
  Industrialist: { desc: 'Obsessed with growth and production.', economy: 0.35 },
  Populist: { desc: 'Governs by the mood of the crowd.', economy: -0.05, diplomacy: -0.05 },
  Honorable: { desc: 'Keeps every promise, remembers every betrayal.', honor: 0.4 },
  Treacherous: { desc: 'Treaties are just paper.', honor: -0.4 },
  Scholar: { desc: 'Pours money into science and education.', science: 0.4 },
  Pragmatist: { desc: 'Does whatever works.', ideology: -0.25, diplomacy: 0.1 },
  Hawk: { desc: 'Believes peace comes through strength.', paranoia: 0.2, aggression: 0.1 },
  Reformer: { desc: 'Wants to modernise everything.', science: 0.2, economy: 0.2 },
};
export const TRAIT_NAMES = Object.keys(TRAITS);
const OPPOSED = [['Warmonger', 'Diplomat'], ['Cautious', 'Warmonger'], ['Honorable', 'Treacherous'], ['Isolationist', 'Expansionist'], ['Isolationist', 'Diplomat'], ['Ideologue', 'Pragmatist']];

export function randomTraits(rng, gov, count = 2) {
  const weights = TRAIT_NAMES.map((t) => {
    let w = 1;
    if (!GOVS[gov]?.democratic && (t === 'Warmonger' || t === 'Expansionist' || t === 'Paranoid' || t === 'Ideologue')) w = 1.6;
    if (GOVS[gov]?.democratic && (t === 'Diplomat' || t === 'Pragmatist' || t === 'Industrialist' || t === 'Populist')) w = 1.6;
    return w;
  });
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < 50) {
    const t = rng.weighted(TRAIT_NAMES, weights);
    if (out.includes(t)) continue;
    if (OPPOSED.some(([a, b]) => (a === t && out.includes(b)) || (b === t && out.includes(a)))) continue;
    out.push(t);
  }
  return out;
}

export function personalityOf(traits) {
  const p = { aggression: 0.3, expansion: 0.3, diplomacy: 0.5, caution: 0.5, honor: 0.5, paranoia: 0.3, ideology: 0.3, economy: 0.5, science: 0.4 };
  for (const t of traits) for (const [k, v] of Object.entries(TRAITS[t] || {})) if (k !== 'desc') p[k] = Math.max(0, Math.min(1, p[k] + v));
  return p;
}

// Candidates for governors and puppet leaders
export const OFFICIAL_TRAITS = {
  Administrator: { desc: '+50% integration speed, -10% unrest', integration: 1.5, unrest: -0.1 },
  Enforcer: { desc: 'Crushes dissent: -40% unrest, -5% output', unrest: -0.4, output: -0.05 },
  Economist: { desc: '+15% territory output', output: 0.15 },
  Beloved: { desc: 'Popular with locals: -25% unrest, +loyalty', unrest: -0.25, loyalty: 10 },
  Loyalist: { desc: 'Utterly loyal: +25 loyalty, never rebels', loyalty: 25 },
  Corrupt: { desc: 'Cheap to appoint but skims 10% of output', output: -0.1, cost: 0.3 },
  Militarist: { desc: '+30% garrison strength, +5% unrest', garrison: 0.3, unrest: 0.05 },
  Reformer: { desc: '+1 infrastructure growth, +integration', infra: 1, integration: 1.2 },
};
