
export type BlockType = 'ODD' | 'EVEN';
export type SizeType = 'BIG' | 'SMALL';

export interface BlockData {
  height: number;
  hash: string;
  resultValue: number;
  type: BlockType;
  sizeType: SizeType;
  timestamp: string;
}

export interface IntervalRule {
  id: string;
  label: string;
  value: number;
  startBlock: number; // 0 implies alignment to absolute height
  trendRows: number;  // Grid rows for Trend (Big Road) charts
  beadRows: number;   // Grid rows for Bead Road charts
  dragonThreshold?: number; // Minimum streak to show in dragon list
}

export interface FollowedPattern {
  ruleId: string;
  type: 'parity' | 'size';
  mode: 'trend' | 'bead';
  rowId?: number;
}

export interface AIPredictionResult {
  shouldPredict: boolean; // NEW: AI decides if the signal is strong enough
  nextParity: 'ODD' | 'EVEN' | 'NEUTRAL';
  parityConfidence: number;
  nextSize: 'BIG' | 'SMALL' | 'NEUTRAL';
  sizeConfidence: number;
  analysis: string;
  detectedCycle: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  entropyScore: number; // NEW: Quantitative measure of noise
  targetHeight?: number;
}

export interface PredictionHistoryItem extends AIPredictionResult {
  id: string;
  timestamp: number;
  resolved: boolean;
  actualParity?: BlockType;
  actualSize?: SizeType;
  isParityCorrect?: boolean;
  isSizeCorrect?: boolean;
}

export type IntervalType = number;

export interface GridCell {
  type: BlockType | SizeType | null;
  value?: number;
}
