// Difficulty levels and world generation modes.
export const DIFFICULTY = {
  easy: { name: 'Easy', aiAggro: 0.6, coalition: 1.6, playerBonus: 2.0, aiEco: 0.95, research: 1.2, grace: 1080 },
  normal: { name: 'Normal', aiAggro: 1.0, coalition: 1.0, playerBonus: 1.0, aiEco: 1.0, research: 1.0, grace: 720 },
  hard: { name: 'Hard', aiAggro: 1.3, coalition: 0.8, playerBonus: 0.8, aiEco: 1.08, research: 0.9, grace: 360 },
  brutal: { name: 'Brutal', aiAggro: 1.7, coalition: 0.6, playerBonus: 0.6, aiEco: 1.15, research: 0.8, grace: 0 },
};

export const WORLD_MODES = {
  realistic: { name: 'Realistic', desc: 'Today’s alliances, rivalries and balance of power.' },
  shuffled: { name: 'Shuffled', desc: 'Real nations with randomized leaders, regimes, economies, armies and alliances.' },
  chaos: { name: 'World on Fire', desc: 'Shuffled world, hyper-aggressive leaders and wars already raging.' },
};

