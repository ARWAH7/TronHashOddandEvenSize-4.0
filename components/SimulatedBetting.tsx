
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { BlockData, IntervalRule } from '../types';
import { 
  Gamepad2, Wallet, TrendingUp, History, CheckCircle2, XCircle, 
  Trash2, Clock, Settings2, PlayCircle, StopCircle, RefreshCw, 
  ChevronDown, ChevronUp, AlertTriangle, Target, ArrowRight, Percent, BarChart4,
  Plus, Layers, Activity, PauseCircle, Power, TrendingDown, BrainCircuit, ShieldAlert,
  ZoomIn, X, Maximize2, MoveHorizontal, Sparkles, Scale
} from 'lucide-react';

interface SimulatedBettingProps {
  allBlocks: BlockData[];
  rules: IntervalRule[];
}

// ---------------------- TYPES ----------------------

type BetType = 'PARITY' | 'SIZE';
type BetTarget = 'ODD' | 'EVEN' | 'BIG' | 'SMALL';
type StrategyType = 'MANUAL' | 'MARTINGALE' | 'DALEMBERT' | 'FLAT' | 'FIBONACCI' | 'PAROLI' | '1326' | 'CUSTOM' | 'AI_KELLY';
type AutoTargetMode = 'FIXED_ODD' | 'FIXED_EVEN' | 'FIXED_BIG' | 'FIXED_SMALL' | 'FOLLOW_LAST' | 'REVERSE_LAST' | 'GLOBAL_TREND_DRAGON' | 'GLOBAL_BEAD_DRAGON' | 'AI_PREDICTION' | 'GLOBAL_AI_FULL_SCAN';

interface BetRecord {
  id: string;
  taskId?: string; // ID of the auto-task (if auto)
  taskName?: string; // Name of the auto-task
  timestamp: number;
  ruleId: string;
  ruleName: string;
  targetHeight: number;
  betType: BetType;
  prediction: BetTarget;
  amount: number;
  odds: number;
  status: 'PENDING' | 'WIN' | 'LOSS';
  payout: number;
  resultVal?: string;
  strategyLabel?: string;
  balanceAfter: number;
}

interface SimConfig {
  initialBalance: number;
  odds: number;
  stopLoss: number;
  takeProfit: number;
  baseBet: number;
}

interface StrategyConfig {
  type: StrategyType;
  autoTarget: AutoTargetMode;
  targetType: 'PARITY' | 'SIZE';
  multiplier: number;
  maxCycle: number;
  step: number;
  minStreak: number;
  customSequence?: number[]; // Added for Custom Strategy
  kellyFraction?: number; // 0.1 to 1.0
}

interface StrategyState {
  consecutiveLosses: number;
  currentBetAmount: number;
  sequenceIndex: number;
}

// NEW: Interface for a single auto-betting task
interface AutoTask {
  id: string;
  name: string;
  createTime: number;
  ruleId: string; // The rule this task follows (e.g., 3s, 6s)
  config: StrategyConfig; // Snapshot of strategy config
  baseBet: number; // Snapshot of base bet
  state: StrategyState; // Runtime state (martingale progress, etc.)
  isActive: boolean;
  stats: {
    wins: number;
    losses: number;
    profit: number;
    maxProfit: number; // Highest profit reached
    maxLoss: number;   // Lowest profit reached (Max Drawdown)
    totalBetAmount: number; // Total volume wagered
    peakProfit: number; // High water mark for profit (for drawdown calc)
    maxDrawdown: number; // Max drawdown amount
  };
}

interface GlobalMetrics {
  peakBalance: number;
  maxDrawdown: number;
}

interface ChartPoint {
  value: number;
  timestamp: number;
  label?: string;
}

// ---------------------- CONSTANTS & HELPERS ----------------------

const STRATEGY_LABELS: Record<string, string> = {
  'MANUAL': '手动下注',
  'FLAT': '平注策略',
  'MARTINGALE': '马丁格尔',
  'DALEMBERT': '达朗贝尔',
  'FIBONACCI': '斐波那契',
  'PAROLI': '帕罗利',
  '1326': '1-3-2-6',
  'CUSTOM': '自定义倍投',
  'AI_KELLY': 'AI 动态凯利'
};

const FIB_SEQ = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610];
const SEQ_1326 = [1, 3, 2, 6];

const getNextTargetHeight = (currentHeight: number, step: number, startBlock: number) => {
  const offset = startBlock || 0;
  if (step <= 1) return currentHeight + 1;
  const diff = currentHeight - offset;
  const nextMultiplier = Math.floor(diff / step) + 1;
  const nextHeight = offset + (nextMultiplier * step);
  return nextHeight > currentHeight ? nextHeight : nextHeight + step;
};

// Helper: Get blocks belonging to a specific Bead Road Row
const getBeadRowBlocks = (blocks: BlockData[], rule: IntervalRule, rowIdx: number) => {
    const epoch = rule.startBlock || 0;
    const interval = rule.value;
    const rows = rule.beadRows || 6;
    
    return blocks.filter(b => {
        // Alignment check first
        if(rule.value > 1) {
            if(rule.startBlock > 0 && b.height < rule.startBlock) return false;
            if(rule.startBlock > 0 && (b.height - rule.startBlock) % rule.value !== 0) return false;
            if(rule.startBlock === 0 && b.height % rule.value !== 0) return false;
        }
        
        const h = b.height;
        const logicalIdx = Math.floor((h - epoch) / interval);
        return (logicalIdx % rows) === rowIdx;
    }).sort((a, b) => b.height - a.height);
};

// Helper: AI Analysis (Embedded from AIPrediction logic for self-containment)
const runAIAnalysis = (blocks: BlockData[], rule: IntervalRule) => {
  const checkAlignment = (h: number) => {
    if (rule.value <= 1) return true;
    if (rule.startBlock > 0) return h >= rule.startBlock && (h - rule.startBlock) % rule.value === 0;
    return h % rule.value === 0;
  };

  const ruleBlocks = blocks.filter(b => checkAlignment(b.height)).slice(0, 80);
  if (ruleBlocks.length < 24) return { shouldPredict: false, nextP: null, confP: 0, nextS: null, confS: 0 };

  const pSeq = ruleBlocks.slice(0, 12).map(b => b.type === 'ODD' ? 'O' : 'E').join('');
  const sSeq = ruleBlocks.slice(0, 12).map(b => b.sizeType === 'BIG' ? 'B' : 'S').join('');
  const oddCount = ruleBlocks.filter(b => b.type === 'ODD').length;
  const bigCount = ruleBlocks.filter(b => b.sizeType === 'BIG').length;
  const pBias = (oddCount / ruleBlocks.length);
  const sBias = (bigCount / ruleBlocks.length);

  let nextP: 'ODD'|'EVEN'|null = null;
  let confP = 50;
  let nextS: 'BIG'|'SMALL'|null = null;
  let confS = 50;

  const getBayesianConf = (bias: number) => {
    const deviation = Math.abs(bias - 0.5);
    if (deviation > 0.18) return 94;
    if (deviation > 0.12) return 88;
    return 50;
  };

  const checkPeriodicity = (seq: string) => {
    if (seq.startsWith('OEOEOE') || seq.startsWith('EOEOEO')) return { match: true, val: seq[0] === 'O' ? 'EVEN' : 'ODD', conf: 93 };
    if (seq.startsWith('OOEEOO') || seq.startsWith('EEOOEE')) return { match: true, val: seq[0] === 'O' ? 'EVEN' : 'ODD', conf: 91 };
    if (seq.startsWith('BSBSBS') || seq.startsWith('SBSBSB')) return { match: true, val: seq[0] === 'B' ? 'SMALL' : 'BIG', conf: 93 };
    if (seq.startsWith('BBSSBB') || seq.startsWith('SSBBSS')) return { match: true, val: seq[0] === 'B' ? 'SMALL' : 'BIG', conf: 91 };
    return { match: false, val: null, conf: 0 };
  };

  const checkDensity = (seq: string) => {
    if (seq.startsWith('OOOO')) return { match: true, val: 'ODD', conf: 95 }; 
    if (seq.startsWith('EEEE')) return { match: true, val: 'EVEN', conf: 95 };
    if (seq.startsWith('BBBB')) return { match: true, val: 'BIG', conf: 95 };
    if (seq.startsWith('SSSS')) return { match: true, val: 'SMALL', conf: 95 };
    return { match: false, val: null, conf: 0 };
  };

  const pPeriod = checkPeriodicity(pSeq);
  const pDensity = checkDensity(pSeq);
  const pBayesConf = getBayesianConf(pBias);

  if (pPeriod.match) { nextP = pPeriod.val as any; confP = pPeriod.conf; }
  else if (pDensity.match) { nextP = pDensity.val as any; confP = pDensity.conf; }
  else if (pBayesConf > 90) { nextP = pBias > 0.5 ? 'EVEN' : 'ODD'; confP = pBayesConf; }

  const sPeriod = checkPeriodicity(sSeq);
  const sDensity = checkDensity(sSeq);
  const sBayesConf = getBayesianConf(sBias);

  if (sPeriod.match) { nextS = sPeriod.val as any; confS = sPeriod.conf; }
  else if (sDensity.match) { nextS = sDensity.val as any; confS = sDensity.conf; }
  else if (sBayesConf > 90) { nextS = sBias > 0.5 ? 'SMALL' : 'BIG'; confS = sBayesConf; }

  // OPTIMIZATION: Enforce Single Best Result (Mutual Exclusion)
  // Ensure we only output the one result with the highest confidence
  if (confP > confS) {
      nextS = null;
      confS = 0;
  } else if (confS > confP) {
      nextP = null;
      confP = 0;
  } else {
      // Tie-breaker: if both equal and valid, default to Parity; if invalid, clear both
      if (confP >= 90) {
          nextS = null;
          confS = 0;
      } else {
          nextP = null; confP = 0;
          nextS = null; confS = 0;
      }
  }

  const entropy = Math.round(Math.random() * 20 + 10);
  const shouldPredict = (confP >= 92 || confS >= 92) && entropy < 40;

  return { shouldPredict, nextP, confP, nextS, confS };
};

// New Helper for path generation to reuse between main and mini charts
const generateChartPath = (
  data: ChartPoint[], 
  width: number, 
  height: number, 
  padding: { top: number, right: number, bottom: number, left: number },
  hidePoints = false
) => {
  if (data.length < 2) return { path: '', area: '', points: [], xTicks: [], yTicks: [], scales: null };

  const graphW = Math.max(0, width - padding.left - padding.right);
  const graphH = Math.max(0, height - padding.top - padding.bottom);

  const times = data.map(d => d.timestamp);
  const values = data.map(d => d.value);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);

  const timeRange = maxTime - minTime || 1;
  const valRange = maxVal - minVal || 1; 
  const effectiveValRange = valRange === 0 ? 100 : valRange;
  const effectiveMinVal = valRange === 0 ? minVal - 50 : minVal;

  const getX = (t: number) => padding.left + ((t - minTime) / timeRange) * graphW;
  const getY = (v: number) => (height - padding.bottom) - ((v - effectiveMinVal) / effectiveValRange) * graphH;

  const pathD = data.map((d, i) => {
     const x = getX(d.timestamp);
     const y = getY(d.value);
     return `${i===0?'M':'L'} ${x} ${y}`;
  }).join(' ');

  const areaD = `${pathD} L ${getX(maxTime)} ${height - padding.bottom} L ${getX(minTime)} ${height - padding.bottom} Z`;

  // Ticks
  const xTicks = [];
  const tickCountX = 6;
  for(let i=0; i<=tickCountX; i++) {
     const t = minTime + (timeRange * (i/tickCountX));
     xTicks.push({ val: t, x: getX(t) });
  }

  const yTicks = [];
  const tickCountY = 5;
  for(let i=0; i<=tickCountY; i++) {
     const v = effectiveMinVal + (effectiveValRange * (i/tickCountY));
     yTicks.push({ val: v, y: getY(v) });
  }

  const pointCoords = hidePoints ? [] : data.map(d => ({
      x: getX(d.timestamp),
      y: getY(d.value),
      data: d
  }));

  return { path: pathD, area: areaD, xTicks, yTicks, points: pointCoords, scales: { getX, getY, minTime, maxTime } };
};

// Simplified SVG Chart for small view
const BalanceChart = ({ data, width, height }: { data: number[], width: number, height: number }) => {
  if (data.length < 2) return <div className="flex items-center justify-center h-full text-gray-300 text-xs font-medium">暂无足够数据</div>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const padding = (max - min) * 0.1 || 10;
  const plotMin = min - padding;
  const plotMax = max + padding;
  const range = plotMax - plotMin || 1;
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - ((val - plotMin) / range) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline fill="none" stroke="#6366f1" strokeWidth="2" points={points} strokeLinecap="round" strokeLinejoin="round" />
      <polygon fill="url(#chartGradient)" points={`${0},${height} ${points} ${width},${height}`} opacity="0.5" />
      {data.length > 0 && (
        <circle cx={width} cy={height - ((data[data.length - 1] - plotMin) / range) * height} r="4" fill="#fff" stroke="#6366f1" strokeWidth="2" />
      )}
    </svg>
  );
};

// Updated DetailedChart with Brush
const DetailedChart = ({ data, onClose }: { data: ChartPoint[], onClose: () => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const miniMapRef = useRef<HTMLDivElement>(null);
  const [mainDims, setMainDims] = useState({ w: 0, h: 0 });
  const [miniDims, setMiniDims] = useState({ w: 0, h: 0 });
  
  // Selection range: [startPercentage, endPercentage] (0.0 to 1.0)
  const [range, setRange] = useState<[number, number]>([0, 1]);
  const dragInfo = useRef<{ startX: number; startRange: [number, number]; mode: 'left' | 'right' | 'move' } | null>(null);

  useEffect(() => {
    if (containerRef.current) {
      const ro = new ResizeObserver(entries => {
        for (let entry of entries) setMainDims({ w: entry.contentRect.width, h: entry.contentRect.height });
      });
      ro.observe(containerRef.current);
      return () => ro.disconnect();
    }
  }, []);

  useEffect(() => {
    if (miniMapRef.current) {
      const ro = new ResizeObserver(entries => {
        for (let entry of entries) setMiniDims({ w: entry.contentRect.width, h: entry.contentRect.height });
      });
      ro.observe(miniMapRef.current);
      return () => ro.disconnect();
    }
  }, []);

  // Filter data
  const totalPoints = data.length;
  // If we have very few points, don't filter too aggressively
  const safeRange = [range[0], Math.max(range[0] + 0.01, range[1])];
  const startIndex = Math.floor(safeRange[0] * (totalPoints - 1));
  const endIndex = Math.ceil(safeRange[1] * (totalPoints - 1));
  const filteredData = data.slice(startIndex, endIndex + 1);

  // Formatting
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
  };

  // Mouse Handlers for Brush
  const handleMouseDown = (e: React.MouseEvent, mode: 'left' | 'right' | 'move') => {
    e.preventDefault();
    e.stopPropagation();
    dragInfo.current = { startX: e.clientX, startRange: [...range] as [number, number], mode };
    document.body.style.cursor = mode === 'move' ? 'grabbing' : 'col-resize';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragInfo.current || !miniMapRef.current) return;
    const { startX, startRange, mode } = dragInfo.current;
    const rect = miniMapRef.current.getBoundingClientRect();
    const deltaX = e.clientX - startX;
    const deltaPercent = deltaX / rect.width;

    let newRange = [...startRange] as [number, number];
    const MIN_GAP = 0.05; // 5% minimum zoom window

    if (mode === 'move') {
      const span = startRange[1] - startRange[0];
      let start = startRange[0] + deltaPercent;
      let end = start + span;
      
      if (start < 0) { start = 0; end = span; }
      if (end > 1) { end = 1; start = 1 - span; }
      
      newRange = [start, end];
    } else if (mode === 'left') {
      newRange[0] = Math.max(0, Math.min(startRange[1] - MIN_GAP, startRange[0] + deltaPercent));
    } else if (mode === 'right') {
      newRange[1] = Math.min(1, Math.max(startRange[0] + MIN_GAP, startRange[1] + deltaPercent));
    }
    
    setRange(newRange);
  }, []);

  const handleMouseUp = useCallback(() => {
    dragInfo.current = null;
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);

  // Chart Graphics
  const mainChart = useMemo(() => 
    generateChartPath(filteredData, mainDims.w, mainDims.h, { top: 40, right: 40, bottom: 40, left: 60 }),
    [filteredData, mainDims]
  );

  const miniChart = useMemo(() => 
    generateChartPath(data, miniDims.w, miniDims.h, { top: 5, right: 0, bottom: 5, left: 0 }, true),
    [data, miniDims]
  );

  return (
    <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col p-6 animate-in zoom-in-95 relative border border-gray-100">
        <button onClick={onClose} className="absolute top-6 right-6 p-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors z-20">
            <X className="w-6 h-6 text-gray-500" />
        </button>
        <div className="mb-2 shrink-0">
            <h3 className="text-2xl font-black text-gray-900 flex items-center">
                <Activity className="w-6 h-6 mr-3 text-indigo-600" />
                资金池盈亏趋势详单
            </h3>
            <p className="text-sm text-gray-400 font-bold mt-1 pl-1">
                区间: {filteredData.length > 0 ? formatTime(filteredData[0].timestamp) : '--'} - {filteredData.length > 0 ? formatTime(filteredData[filteredData.length-1].timestamp) : '--'} 
                <span className="mx-2">|</span> 
                点数: {filteredData.length}
            </p>
        </div>

        {/* MAIN CHART */}
        <div className="flex-1 w-full relative overflow-hidden mb-4" ref={containerRef}>
            {mainDims.w > 0 && mainChart.path && (
                <svg width={mainDims.w} height={mainDims.h} className="overflow-visible">
                    {mainChart.yTicks.map(tick => (
                        <React.Fragment key={tick.val}>
                            <line x1={60} y1={tick.y} x2={mainDims.w - 40} y2={tick.y} stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
                            <text x={48} y={tick.y + 4} textAnchor="end" className="text-[10px] font-bold fill-gray-400 select-none">${tick.val.toFixed(0)}</text>
                        </React.Fragment>
                    ))}
                    {mainChart.xTicks.map(tick => (
                        <React.Fragment key={tick.val}>
                            <line x1={tick.x} y1={40} x2={tick.x} y2={mainDims.h - 40} stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
                            <text x={tick.x} y={mainDims.h - 15} textAnchor="middle" className="text-[10px] font-bold fill-gray-400 select-none">{formatTime(tick.val)}</text>
                        </React.Fragment>
                    ))}
                    <path d={mainChart.area} fill="url(#mainGradient)" opacity="0.1" />
                    <defs>
                        <linearGradient id="mainGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.8" />
                            <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    <path d={mainChart.path} fill="none" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    {mainChart.points.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r="3" fill="white" stroke="#4f46e5" strokeWidth="2" className="hover:r-6 transition-all cursor-crosshair">
                            <title>{`Time: ${new Date(p.data.timestamp).toLocaleTimeString()}\nBalance: $${p.data.value.toFixed(2)}\nLabel: ${p.data.label}`}</title>
                        </circle>
                    ))}
                </svg>
            )}
        </div>

        {/* MINI MAP & BRUSH */}
        <div className="h-20 shrink-0 w-full relative select-none" ref={miniMapRef}>
            {/* Background Chart */}
            <div className="absolute inset-0 bg-gray-50 rounded-lg overflow-hidden border border-gray-100">
                {miniDims.w > 0 && miniChart.path && (
                    <svg width={miniDims.w} height={miniDims.h} className="overflow-visible block">
                        <path d={miniChart.area} fill="#e2e8f0" />
                        <path d={miniChart.path} fill="none" stroke="#94a3b8" strokeWidth="1" />
                    </svg>
                )}
            </div>

            {/* Brush Overlay */}
            {miniDims.w > 0 && (
                <div className="absolute inset-0">
                    {/* Unselected Left */}
                    <div 
                        className="absolute top-0 bottom-0 left-0 bg-gray-900/10 backdrop-blur-[1px] border-r border-gray-300"
                        style={{ width: `${range[0] * 100}%` }}
                    ></div>
                    
                    {/* Unselected Right */}
                    <div 
                        className="absolute top-0 bottom-0 right-0 bg-gray-900/10 backdrop-blur-[1px] border-l border-gray-300"
                        style={{ width: `${(1 - range[1]) * 100}%` }}
                    ></div>

                    {/* Active Window */}
                    <div 
                        className="absolute top-0 bottom-0 group cursor-grab active:cursor-grabbing hover:bg-indigo-500/5 transition-colors"
                        style={{ left: `${range[0] * 100}%`, width: `${(range[1] - range[0]) * 100}%` }}
                        onMouseDown={(e) => handleMouseDown(e, 'move')}
                    >
                        {/* Drag Handle Left */}
                        <div 
                            className="absolute top-0 bottom-0 -left-1.5 w-3 cursor-col-resize flex items-center justify-center z-10 hover:scale-110 active:scale-110 transition-transform"
                            onMouseDown={(e) => handleMouseDown(e, 'left')}
                        >
                            <div className="w-1.5 h-8 bg-indigo-500 rounded-full shadow-md"></div>
                        </div>

                        {/* Top/Bottom Borders */}
                        <div className="absolute top-0 left-0 right-0 h-0.5 bg-indigo-500/50"></div>
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500/50"></div>

                        {/* Center Drag Indicator */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoveHorizontal className="w-4 h-4 text-indigo-400" />
                        </div>

                        {/* Drag Handle Right */}
                        <div 
                            className="absolute top-0 bottom-0 -right-1.5 w-3 cursor-col-resize flex items-center justify-center z-10 hover:scale-110 active:scale-110 transition-transform"
                            onMouseDown={(e) => handleMouseDown(e, 'right')}
                        >
                            <div className="w-1.5 h-8 bg-indigo-500 rounded-full shadow-md"></div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    </div>
  );
};

// ---------------------- MAIN COMPONENT ----------------------

const SimulatedBetting: React.FC<SimulatedBettingProps> = ({ allBlocks, rules }) => {
  
  // 1. GLOBAL BALANCE & BETS
  const [balance, setBalance] = useState<number>(() => {
    if (typeof window === 'undefined') return 10000;
    try {
      const saved = localStorage.getItem('sim_v3_balance');
      return saved ? parseFloat(saved) : 10000;
    } catch { return 10000; }
  });

  const [bets, setBets] = useState<BetRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('sim_v3_bets');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  
  const [config, setConfig] = useState<SimConfig>(() => {
    const defaults = {
      initialBalance: 10000,
      odds: 1.98,
      stopLoss: 0,
      takeProfit: 0,
      baseBet: 100
    };
    if (typeof window === 'undefined') return defaults;
    try {
      const saved = localStorage.getItem('sim_v3_config');
      return saved ? JSON.parse(saved) : defaults;
    } catch { return defaults; }
  });

  const [globalMetrics, setGlobalMetrics] = useState<GlobalMetrics>(() => {
    if (typeof window === 'undefined') return { peakBalance: 10000, maxDrawdown: 0 };
    try {
      const saved = localStorage.getItem('sim_v3_global_metrics');
      return saved ? JSON.parse(saved) : { peakBalance: 10000, maxDrawdown: 0 };
    } catch { return { peakBalance: 10000, maxDrawdown: 0 }; }
  });

  const [showFullChart, setShowFullChart] = useState(false);

  // 2. MULTI-TASK STATE
  const [tasks, setTasks] = useState<AutoTask[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('sim_v3_tasks');
      if (saved) {
        // Migration support: ensure new fields exist
        const parsed: AutoTask[] = JSON.parse(saved);
        return parsed.map(t => ({
          ...t,
          stats: {
            ...t.stats,
            maxProfit: t.stats.maxProfit ?? 0,
            maxLoss: t.stats.maxLoss ?? 0,
            totalBetAmount: t.stats.totalBetAmount ?? 0,
            peakProfit: t.stats.peakProfit ?? Math.max(0, t.stats.profit),
            maxDrawdown: t.stats.maxDrawdown ?? 0
          }
        }));
      }
      return [];
    } catch { return []; }
  });

  // 3. DRAFT CONFIG (For creating new tasks)
  const [draftName, setDraftName] = useState('我的托管策略');
  const [draftRuleId, setDraftRuleId] = useState<string>(rules[0]?.id || '');
  const [draftConfig, setDraftConfig] = useState<StrategyConfig>({
      type: 'FLAT',
      autoTarget: 'FIXED_ODD',
      targetType: 'PARITY',
      multiplier: 2.0,
      maxCycle: 10,
      step: 10,
      minStreak: 1,
      customSequence: [1, 2, 4, 8, 17], // Default custom sequence
      kellyFraction: 0.2 // Default 20%
  });
  const [customSeqText, setCustomSeqText] = useState('1, 2, 4, 8, 17');

  const [activeManualRuleId, setActiveManualRuleId] = useState<string>(rules[0]?.id || '');
  const [showConfig, setShowConfig] = useState(true);

  // Derived Values
  const manualRule = useMemo(() => rules.find(r => r.id === activeManualRuleId) || rules[0], [rules, activeManualRuleId]);
  
  // PREPARE CHART DATA (With Timestamps)
  const chartData: ChartPoint[] = useMemo(() => {
    const settled = bets.filter(b => b.status !== 'PENDING');
    // bets are newest first, so we reverse to get chronological order
    const reversed = [...settled].reverse();
    
    // Estimate start time slightly before first bet if exists, else now
    const startTime = reversed.length > 0 ? reversed[0].timestamp - 1000 : Date.now();
    
    const initialPoint: ChartPoint = { 
        value: config.initialBalance, 
        timestamp: startTime, 
        label: 'Initial' 
    };

    const points = reversed.map(b => ({
        value: b.balanceAfter,
        timestamp: b.timestamp,
        label: `#${b.targetHeight}`
    }));

    return [initialPoint, ...points];
  }, [bets, config.initialBalance]);

  const pendingBets = useMemo(() => bets.filter(b => b.status === 'PENDING'), [bets]);
  const settledBets = useMemo(() => bets.filter(b => b.status !== 'PENDING'), [bets]);

  // Persist Data
  useEffect(() => {
    localStorage.setItem('sim_v3_balance', balance.toString());
    localStorage.setItem('sim_v3_bets', JSON.stringify(bets));
    localStorage.setItem('sim_v3_config', JSON.stringify(config));
    localStorage.setItem('sim_v3_tasks', JSON.stringify(tasks));
    localStorage.setItem('sim_v3_global_metrics', JSON.stringify(globalMetrics));
  }, [balance, bets, config, tasks, globalMetrics]);

  // --- LOGIC HELPERS ---

  const checkRuleAlignment = useCallback((height: number, rule: IntervalRule) => {
    if (rule.value <= 1) return true;
    if (rule.startBlock > 0) return height >= rule.startBlock && (height - rule.startBlock) % rule.value === 0;
    return height % rule.value === 0;
  }, []);

  const calculateStreak = useCallback((blocks: BlockData[], type: BetType) => {
    if (blocks.length === 0) return { val: null, count: 0 };
    const key = type === 'PARITY' ? 'type' : 'sizeType';
    const firstVal = blocks[0][key];
    let count = 0;
    for (const b of blocks) {
      if (b[key] === firstVal) count++;
      else break;
    }
    return { val: firstVal, count };
  }, []);

  // --- CORE ACTIONS ---

  const placeBet = useCallback((
    targetHeight: number, 
    type: BetType, 
    target: BetTarget, 
    amount: number, 
    source: 'MANUAL' | 'AUTO',
    rule: IntervalRule,
    taskId?: string,
    taskName?: string,
    strategyType?: string
  ) => {
    const isDuplicate = bets.some(b => 
      b.targetHeight === targetHeight && 
      b.ruleId === rule.id && 
      (source === 'MANUAL' ? !b.taskId : b.taskId === taskId)
    );
    
    if (isDuplicate) return false;

    const newBet: BetRecord = {
      id: Date.now().toString() + Math.random().toString().slice(2, 6),
      timestamp: Date.now(),
      ruleId: rule.id,
      ruleName: rule.label,
      targetHeight,
      betType: type,
      prediction: target,
      amount,
      odds: config.odds,
      status: 'PENDING',
      payout: 0,
      strategyLabel: strategyType || 'MANUAL',
      balanceAfter: 0, // Calculated on settlement
      taskId,
      taskName
    };

    setBalance(prev => prev - amount);
    setBets(prev => [newBet, ...prev]);
    return true;
  }, [bets, config.odds]);

  const createTask = () => {
    const newTask: AutoTask = {
      id: Date.now().toString(),
      name: draftName || `托管任务 ${tasks.length + 1}`,
      createTime: Date.now(),
      ruleId: draftRuleId,
      config: { ...draftConfig },
      baseBet: config.baseBet,
      state: {
        consecutiveLosses: 0,
        currentBetAmount: draftConfig.type === 'CUSTOM' && draftConfig.customSequence ? config.baseBet * draftConfig.customSequence[0] : config.baseBet,
        sequenceIndex: 0
      },
      isActive: false, // Default to paused
      stats: { 
        wins: 0, 
        losses: 0, 
        profit: 0,
        maxProfit: 0,
        maxLoss: 0,
        totalBetAmount: 0,
        peakProfit: 0,
        maxDrawdown: 0
      }
    };
    setTasks(prev => [...prev, newTask]);
    // Reset draft name
    setDraftName(`托管任务 ${tasks.length + 2}`);
  };

  const toggleTask = (taskId: string) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, isActive: !t.isActive } : t));
  };

  const startAllTasks = useCallback(() => {
    setTasks(prev => prev.map(t => ({ ...t, isActive: true })));
  }, []);

  const stopAllTasks = useCallback(() => {
    setTasks(prev => prev.map(t => ({ ...t, isActive: false })));
  }, []);

  const deleteTask = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
  };

  // Fixed Reset Account: Immediate action, no confirmation dialog
  const resetAccount = useCallback((e?: React.MouseEvent) => {
    if (e) {
       e.preventDefault();
       e.stopPropagation();
    }
    
    // Defaults
    const defaults = {
      initialBalance: 10000,
      odds: 1.98,
      stopLoss: 0,
      takeProfit: 0,
      baseBet: 100
    };

    // 1. Reset States
    setBalance(defaults.initialBalance);
    setConfig(defaults);
    setBets([]);
    setTasks([]); 
    setGlobalMetrics({ peakBalance: defaults.initialBalance, maxDrawdown: 0 });
    
    // 2. Clear Storage immediately
    localStorage.setItem('sim_v3_balance', defaults.initialBalance.toString());
    localStorage.setItem('sim_v3_bets', '[]');
    localStorage.setItem('sim_v3_tasks', '[]');
    localStorage.setItem('sim_v3_global_metrics', JSON.stringify({ peakBalance: defaults.initialBalance, maxDrawdown: 0 }));
    localStorage.setItem('sim_v3_config', JSON.stringify(defaults));
  }, []);

  // --- THE MULTI-THREAD ENGINE ---
  useEffect(() => {
    if (allBlocks.length === 0) return;

    // We need to handle updates in a single pass to avoid race conditions with balance/bets
    let currentBalance = balance;
    let betsChanged = false;
    let tasksChanged = false;
    let metricsChanged = false;

    // Metrics temporary tracking
    let tempPeak = globalMetrics.peakBalance;
    let tempMaxDD = globalMetrics.maxDrawdown;
    
    const nextTasks = [...tasks]; // Clone for mutation
    
    // 1. SETTLE PENDING BETS & UPDATE TASK STATES
    const updatedBets = bets.map(bet => {
      if (bet.status === 'PENDING') {
        const targetBlock = allBlocks.find(b => b.height === bet.targetHeight);
        if (targetBlock) {
          betsChanged = true;
          let isWin = false;
          let resultVal = '';

          if (bet.betType === 'PARITY') {
            isWin = targetBlock.type === bet.prediction;
            resultVal = targetBlock.type === 'ODD' ? '单' : '双';
          } else {
            isWin = targetBlock.sizeType === bet.prediction;
            resultVal = targetBlock.sizeType === 'BIG' ? '大' : '小';
          }

          const payout = isWin ? bet.amount * bet.odds : 0;
          currentBalance += payout; // Add winnings (initial deduction already happened)

          // Global Drawdown Calculation
          if (currentBalance > tempPeak) {
             tempPeak = currentBalance;
          }
          const currentDD = tempPeak - currentBalance;
          if (currentDD > tempMaxDD) {
             tempMaxDD = currentDD;
             metricsChanged = true;
          }
          
          // Identify which task owns this bet and update its state
          if (bet.taskId) {
            const taskIndex = nextTasks.findIndex(t => t.id === bet.taskId);
            if (taskIndex !== -1) {
              tasksChanged = true;
              const task = nextTasks[taskIndex];
              
              // Update Stats
              const sessionProfit = (isWin ? payout : 0) - bet.amount;
              const newTotalProfit = task.stats.profit + sessionProfit;

              task.stats.wins += isWin ? 1 : 0;
              task.stats.losses += isWin ? 0 : 1;
              task.stats.profit = newTotalProfit;
              
              // Update Max/Min Records & Total Bet
              task.stats.maxProfit = Math.max(task.stats.maxProfit, newTotalProfit);
              task.stats.maxLoss = Math.min(task.stats.maxLoss, newTotalProfit);
              task.stats.totalBetAmount = (task.stats.totalBetAmount || 0) + bet.amount;

              // Task Drawdown Calculation
              task.stats.peakProfit = Math.max(task.stats.peakProfit, newTotalProfit);
              const taskDD = task.stats.peakProfit - newTotalProfit;
              task.stats.maxDrawdown = Math.max(task.stats.maxDrawdown, taskDD);

              // Update Strategy State (Martingale, etc.)
              // AI_KELLY is stateless regarding sequences, it recalculates each time based on balance/confidence
              if (task.config.type !== 'AI_KELLY') {
                  let { currentBetAmount, consecutiveLosses, sequenceIndex } = task.state;
                  
                  switch (task.config.type) {
                    case 'MARTINGALE':
                      if (!isWin) {
                        const nextLosses = consecutiveLosses + 1;
                        if (nextLosses >= task.config.maxCycle) {
                          currentBetAmount = task.baseBet; // Reset
                          consecutiveLosses = 0;
                        } else {
                          currentBetAmount *= task.config.multiplier;
                          consecutiveLosses = nextLosses;
                        }
                      } else {
                        currentBetAmount = task.baseBet;
                        consecutiveLosses = 0;
                      }
                      break;
                    case 'DALEMBERT':
                       if (!isWin) {
                          currentBetAmount += task.config.step;
                          consecutiveLosses++;
                       } else {
                          currentBetAmount -= task.config.step;
                          if(currentBetAmount < task.baseBet) currentBetAmount = task.baseBet;
                          consecutiveLosses = 0;
                       }
                       break;
                    case 'FIBONACCI':
                       if (!isWin) {
                          sequenceIndex = Math.min(sequenceIndex + 1, FIB_SEQ.length - 1);
                       } else {
                          sequenceIndex = Math.max(0, sequenceIndex - 2);
                       }
                       currentBetAmount = task.baseBet * FIB_SEQ[sequenceIndex];
                       break;
                    case 'PAROLI':
                       if(isWin) {
                          sequenceIndex++;
                          if(sequenceIndex >= 3) {
                             sequenceIndex = 0;
                             currentBetAmount = task.baseBet;
                          } else {
                             currentBetAmount *= 2;
                          }
                       } else {
                          sequenceIndex = 0;
                          currentBetAmount = task.baseBet;
                       }
                       break;
                    case '1326':
                       if(isWin) {
                          sequenceIndex++;
                          if(sequenceIndex >= SEQ_1326.length) {
                             sequenceIndex = 0;
                             currentBetAmount = task.baseBet;
                          } else {
                             currentBetAmount = task.baseBet * SEQ_1326[sequenceIndex];
                          }
                       } else {
                          sequenceIndex = 0;
                          currentBetAmount = task.baseBet;
                       }
                       break;
                    case 'CUSTOM':
                        const cSeq = task.config.customSequence || [1];
                        if (!isWin) {
                           // Loss: move to next multiplier
                           if (sequenceIndex + 1 >= cSeq.length) {
                              sequenceIndex = 0; // End of sequence, reset
                           } else {
                              sequenceIndex++;
                           }
                        } else {
                           // Win: reset to start
                           sequenceIndex = 0;
                        }
                        currentBetAmount = task.baseBet * cSeq[sequenceIndex];
                        break;
                    default:
                       currentBetAmount = task.baseBet;
                  }
                  // Apply State
                  task.state = { currentBetAmount: Math.floor(currentBetAmount), consecutiveLosses, sequenceIndex };
              } else {
                  // For AI_KELLY, we can reset state to base just to keep it clean, though we calculate dynamically
                  task.state = { currentBetAmount: task.baseBet, consecutiveLosses: 0, sequenceIndex: 0 };
              }
            }
          }

          return { ...bet, status: isWin ? 'WIN' : 'LOSS', payout, resultVal, balanceAfter: currentBalance } as BetRecord;
        }
      }
      return bet;
    });

    // 2. PROCESS ACTIVE TASKS (PLACE NEW BETS)
    const finalBets = [...updatedBets];
    
    // Check stop loss/take profit globally? Or per task? 
    // Usually global balance check for protection
    const profit = currentBalance - config.initialBalance;
    const globalStop = (config.takeProfit > 0 && profit >= config.takeProfit) || (config.stopLoss > 0 && profit <= -config.stopLoss);

    if (!globalStop) {
      nextTasks.forEach(task => {
        if (!task.isActive) return;
        // Basic bankruptcy check (for non-kelly, or kelly min)
        if (currentBalance < task.baseBet) {
          task.isActive = false; // Stop if bankrupt
          tasksChanged = true;
          return;
        }

        // GLOBAL FULL AI SCAN MODE
        if (task.config.autoTarget === 'GLOBAL_AI_FULL_SCAN') {
            const hasPending = finalBets.some(b => b.taskId === task.id && b.status === 'PENDING');
            if (hasPending) return;

            let bestCandidate = { 
                confidence: 0, 
                rule: null as IntervalRule | null, 
                type: 'PARITY' as BetType, 
                target: 'ODD' as BetTarget, 
                height: 0, 
                desc: '' 
            };

            // Scan ALL rules
            rules.forEach(rule => {
                const analysis = runAIAnalysis(allBlocks, rule);
                if (!analysis.shouldPredict) return;

                const nextH = getNextTargetHeight(allBlocks[0].height, rule.value, rule.startBlock);
                
                // Parity Check
                if (analysis.nextP && analysis.confP > bestCandidate.confidence) {
                     bestCandidate = {
                         confidence: analysis.confP,
                         rule,
                         type: 'PARITY',
                         target: analysis.nextP as BetTarget,
                         height: nextH,
                         desc: `(AI全域 P:${analysis.confP}%)`
                     };
                }
                // Size Check
                if (analysis.nextS && analysis.confS > bestCandidate.confidence) {
                     bestCandidate = {
                         confidence: analysis.confS,
                         rule,
                         type: 'SIZE',
                         target: analysis.nextS as BetTarget,
                         height: nextH,
                         desc: `(AI全域 S:${analysis.confS}%)`
                     };
                }
            });

            // Threshold for Global Scan: stricter than usual
            if (bestCandidate.rule && bestCandidate.confidence >= 94) {
                 // Check if we already have this exact bet in finalBets (from other tasks or previous cycle logic)
                 const isDupe = finalBets.some(b => b.targetHeight === bestCandidate.height && b.ruleId === bestCandidate.rule!.id && b.taskId === task.id);
                 if (!isDupe) {
                      let amount = Math.floor(task.state.currentBetAmount);
                      
                      // AI KELLY CALCULATION
                      if (task.config.type === 'AI_KELLY') {
                          const b_odds = config.odds - 1;
                          const p = bestCandidate.confidence / 100; // Probability
                          const q = 1 - p;
                          const f = (b_odds * p - q) / b_odds; // Kelly Formula
                          
                          if (f > 0) {
                              const fraction = task.config.kellyFraction || 0.2;
                              amount = Math.floor(currentBalance * f * fraction);
                          } else {
                              amount = config.baseBet; // Fallback or 0
                          }
                          // Clamp amount
                          amount = Math.max(config.baseBet, amount);
                          amount = Math.min(amount, currentBalance);
                      }

                      const newBet: BetRecord = {
                          id: Date.now().toString() + Math.random().toString().slice(2, 6) + task.id,
                          taskId: task.id,
                          taskName: `${task.name} ${bestCandidate.desc}`,
                          timestamp: Date.now(),
                          ruleId: bestCandidate.rule.id,
                          ruleName: bestCandidate.rule.label,
                          targetHeight: bestCandidate.height,
                          betType: bestCandidate.type,
                          prediction: bestCandidate.target,
                          amount,
                          odds: config.odds,
                          status: 'PENDING',
                          payout: 0,
                          strategyLabel: task.config.type,
                          balanceAfter: 0
                      };
                      currentBalance -= amount;
                      finalBets.unshift(newBet);
                      betsChanged = true;
                 }
            }
            return;
        }

        // GLOBAL TASKS: Scan all rules
        if (task.config.autoTarget.startsWith('GLOBAL') && task.config.autoTarget !== 'GLOBAL_AI_FULL_SCAN') {
            // Check if this task already has a pending bet (Strict sequential betting)
            const hasPending = finalBets.some(b => b.taskId === task.id && b.status === 'PENDING');
            if (hasPending) return;

            let bestCandidate = { streak: 0, rule: null as IntervalRule | null, type: 'PARITY' as BetType, target: 'ODD' as BetTarget, height: 0, desc: '' };

            rules.forEach(rule => {
                if (task.config.autoTarget === 'GLOBAL_TREND_DRAGON') {
                    const ruleBlocks = allBlocks.filter(b => checkRuleAlignment(b.height, rule));
                    if (ruleBlocks.length === 0) return;
                    
                    const nextH = getNextTargetHeight(allBlocks[0].height, rule.value, rule.startBlock);
                    
                    // Parity
                    const pStreak = calculateStreak(ruleBlocks, 'PARITY');
                    if (pStreak.count > bestCandidate.streak) {
                        bestCandidate = { streak: pStreak.count, rule, type: 'PARITY', target: pStreak.val as BetTarget, height: nextH, desc: `(走势${pStreak.count}连)` };
                    }
                    // Size
                    const sStreak = calculateStreak(ruleBlocks, 'SIZE');
                    if (sStreak.count > bestCandidate.streak) {
                        bestCandidate = { streak: sStreak.count, rule, type: 'SIZE', target: sStreak.val as BetTarget, height: nextH, desc: `(走势${sStreak.count}连)` };
                    }

                } else if (task.config.autoTarget === 'GLOBAL_BEAD_DRAGON') {
                    const rows = rule.beadRows || 6;
                    for(let r=0; r<rows; r++) {
                         const rowBlocks = getBeadRowBlocks(allBlocks, rule, r);
                         if (rowBlocks.length === 0) continue;
                         
                         // Check Parity
                         const pStreak = calculateStreak(rowBlocks, 'PARITY');
                         if (pStreak.count > bestCandidate.streak) {
                             const lastH = rowBlocks[0].height;
                             const nextH = lastH + (rule.value * rows); // Physics of bead road
                             if (nextH > allBlocks[0].height) {
                                 bestCandidate = { streak: pStreak.count, rule, type: 'PARITY', target: pStreak.val as BetTarget, height: nextH, desc: `(珠盘R${r+1} ${pStreak.count}连)` };
                             }
                         }
                         // Check Size
                         const sStreak = calculateStreak(rowBlocks, 'SIZE');
                         if (sStreak.count > bestCandidate.streak) {
                             const lastH = rowBlocks[0].height;
                             const nextH = lastH + (rule.value * rows);
                             if (nextH > allBlocks[0].height) {
                                 bestCandidate = { streak: sStreak.count, rule, type: 'SIZE', target: sStreak.val as BetTarget, height: nextH, desc: `(珠盘R${r+1} ${sStreak.count}连)` };
                             }
                         }
                    }
                }
            });

            // If we found a candidate satisfying min streak
            if (bestCandidate.streak >= task.config.minStreak && bestCandidate.rule) {
                // Double check if we already have this exact bet in finalBets (from other tasks or previous cycle logic)
                const isDupe = finalBets.some(b => b.targetHeight === bestCandidate.height && b.ruleId === bestCandidate.rule!.id && b.taskId === task.id);
                if (!isDupe) {
                     let amount = Math.floor(task.state.currentBetAmount);
                     
                     // AI KELLY CALCULATION (Fallback for non-AI targets)
                     if (task.config.type === 'AI_KELLY') {
                          // Assume a moderate confidence for following dragons (e.g., 60%)
                          const confidence = 60;
                          const b_odds = config.odds - 1;
                          const p = confidence / 100;
                          const q = 1 - p;
                          const f = (b_odds * p - q) / b_odds;
                          
                          if (f > 0) {
                              const fraction = task.config.kellyFraction || 0.2;
                              amount = Math.floor(currentBalance * f * fraction);
                          } else {
                              amount = config.baseBet;
                          }
                          amount = Math.max(config.baseBet, amount);
                          amount = Math.min(amount, currentBalance);
                     }

                     const newBet: BetRecord = {
                         id: Date.now().toString() + Math.random().toString().slice(2, 6) + task.id,
                         taskId: task.id,
                         taskName: `${task.name} ${bestCandidate.desc}`,
                         timestamp: Date.now(),
                         ruleId: bestCandidate.rule.id,
                         ruleName: bestCandidate.rule.label,
                         targetHeight: bestCandidate.height,
                         betType: bestCandidate.type,
                         prediction: bestCandidate.target,
                         amount,
                         odds: config.odds,
                         status: 'PENDING',
                         payout: 0,
                         strategyLabel: task.config.type,
                         balanceAfter: 0
                     };
                     currentBalance -= amount;
                     finalBets.unshift(newBet);
                     betsChanged = true;
                }
            }
            return; // End of Global Task Logic for this task
        }

        // STANDARD TASKS (Single Rule)
        const rule = rules.find(r => r.id === task.ruleId);
        if (!rule) return;

        const nextHeight = getNextTargetHeight(allBlocks[0].height, rule.value, rule.startBlock);
        
        // Check if THIS task already bet on this height
        if (finalBets.some(b => b.targetHeight === nextHeight && b.ruleId === rule.id && b.taskId === task.id)) return;

        // Determine Bet
        const ruleBlocks = allBlocks.filter(b => checkRuleAlignment(b.height, rule));
        let type: BetType = 'PARITY';
        let target: BetTarget = 'ODD';
        let shouldBet = false;
        
        // Context for Kelly
        let currentConfidence = 60; // Default for manual/fixed

        if (task.config.autoTarget === 'AI_PREDICTION') {
            const analysis = runAIAnalysis(allBlocks, rule);
            if (analysis.shouldPredict) {
                if (analysis.confP >= analysis.confS && analysis.confP >= 92 && analysis.nextP) {
                    type = 'PARITY';
                    target = analysis.nextP as BetTarget;
                    shouldBet = true;
                    currentConfidence = analysis.confP;
                } else if (analysis.confS > analysis.confP && analysis.confS >= 92 && analysis.nextS) {
                    type = 'SIZE';
                    target = analysis.nextS as BetTarget;
                    shouldBet = true;
                    currentConfidence = analysis.confS;
                }
            }
        } else if (task.config.autoTarget.includes('FIXED')) {
          shouldBet = true;
          const t = task.config.autoTarget.split('_')[1] as BetTarget;
          target = t;
          type = (t === 'ODD' || t === 'EVEN') ? 'PARITY' : 'SIZE';
        } else if (ruleBlocks.length > 0) {
           const targetType = task.config.targetType || 'PARITY';
           const streak = calculateStreak(ruleBlocks, targetType);
           type = targetType;
           
           if (task.config.autoTarget === 'FOLLOW_LAST') {
             if (streak.count >= task.config.minStreak) {
               target = streak.val as BetTarget;
               shouldBet = true;
             }
           } else if (task.config.autoTarget === 'REVERSE_LAST') {
             if (streak.count >= task.config.minStreak) {
                if (targetType === 'PARITY') target = streak.val === 'ODD' ? 'EVEN' : 'ODD';
                else target = streak.val === 'BIG' ? 'SMALL' : 'BIG';
                shouldBet = true;
             }
           }
        }

        if (shouldBet) {
           let amount = Math.floor(task.state.currentBetAmount);
           
           // AI KELLY CALCULATION
           if (task.config.type === 'AI_KELLY') {
                const b_odds = config.odds - 1;
                const p = currentConfidence / 100;
                const q = 1 - p;
                const f = (b_odds * p - q) / b_odds;
                
                if (f > 0) {
                    const fraction = task.config.kellyFraction || 0.2;
                    amount = Math.floor(currentBalance * f * fraction);
                } else {
                    amount = config.baseBet;
                }
                amount = Math.max(config.baseBet, amount);
                amount = Math.min(amount, currentBalance);
           }

           const newBet: BetRecord = {
             id: Date.now().toString() + Math.random().toString().slice(2, 6) + task.id,
             taskId: task.id,
             taskName: task.name,
             timestamp: Date.now(),
             ruleId: rule.id,
             ruleName: rule.label,
             targetHeight: nextHeight,
             betType: type,
             prediction: target,
             amount,
             odds: config.odds,
             status: 'PENDING',
             payout: 0,
             strategyLabel: task.config.type,
             balanceAfter: 0
           };
           currentBalance -= amount;
           finalBets.unshift(newBet); // Add to top
           betsChanged = true;
        }
      });
    } else {
       // Stop all tasks if global stop hit
       if (nextTasks.some(t => t.isActive)) {
          nextTasks.forEach(t => t.isActive = false);
          tasksChanged = true;
       }
    }

    // 3. COMMIT UPDATES
    if (betsChanged) {
       setBets(finalBets);
       setBalance(currentBalance);
    }
    if (tasksChanged) {
       setTasks(nextTasks);
    }
    if (metricsChanged || tempPeak !== globalMetrics.peakBalance) {
        setGlobalMetrics({ peakBalance: tempPeak, maxDrawdown: tempMaxDD });
    }

  }, [allBlocks, rules, tasks, bets, config, checkRuleAlignment, calculateStreak, balance, globalMetrics]);

  // Stats
  const stats = useMemo(() => {
    const wins = settledBets.filter(b => b.status === 'WIN').length;
    const total = settledBets.length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const profit = balance - config.initialBalance;
    const profitPercent = (profit / config.initialBalance) * 100;
    const ddRate = globalMetrics.peakBalance > 0 ? (globalMetrics.maxDrawdown / globalMetrics.peakBalance) * 100 : 0;
    return { wins, total, winRate, profit, profitPercent, ddRate, maxDrawdown: globalMetrics.maxDrawdown };
  }, [settledBets, balance, config.initialBalance, globalMetrics]);

  return (
    <div className="max-w-[1600px] mx-auto space-y-6 animate-in fade-in duration-500 pb-20">
      
      {/* 1. TOP DASHBOARD */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
         <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity"><Wallet className="w-16 h-16" /></div>
            <span className="text-xs font-black text-gray-400 uppercase tracking-wider">模拟资金池</span>
            <div className="text-3xl font-black text-gray-900 mt-2">${balance.toFixed(2)}</div>
            <div className={`text-xs font-bold mt-2 flex items-center ${stats.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
               <TrendingUp className={`w-3 h-3 mr-1 ${stats.profit < 0 ? 'rotate-180' : ''}`} />
               {stats.profit >= 0 ? '+' : ''}{stats.profit.toFixed(2)} ({stats.profitPercent > 0 ? '+' : ''}{stats.profitPercent.toFixed(2)}%)
            </div>
            <div className="mt-2 text-[10px] font-black text-red-500 flex items-center border-t border-gray-50 pt-2">
               <ShieldAlert className="w-3 h-3 mr-1" />
               最大回撤: -${stats.maxDrawdown.toFixed(0)} (-{stats.ddRate.toFixed(1)}%)
            </div>
         </div>
         <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
            <span className="text-xs font-black text-gray-400 uppercase tracking-wider">总胜率概览</span>
            <div className="flex items-end space-x-2 mt-2">
               <span className="text-3xl font-black text-blue-600">{stats.winRate.toFixed(1)}%</span>
               <span className="text-xs text-gray-400 font-bold mb-1.5">{stats.wins}/{stats.total}</span>
            </div>
            <div className="w-full bg-gray-100 h-1.5 rounded-full mt-3 overflow-hidden">
               <div className="bg-blue-600 h-full rounded-full transition-all duration-500" style={{ width: `${stats.winRate}%` }}></div>
            </div>
         </div>
         <div 
           className="md:col-span-2 bg-white rounded-3xl p-4 shadow-sm border border-gray-100 flex flex-col relative group cursor-pointer transition-colors hover:bg-gray-50/50"
           onClick={() => setShowFullChart(true)}
         >
            <span className="absolute top-4 left-4 text-[10px] font-black text-gray-400 uppercase tracking-wider z-10">总盈亏曲线</span>
            <div className="absolute top-4 right-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 backdrop-blur-sm px-2 py-1 rounded-full text-[10px] font-black text-indigo-600 flex items-center shadow-sm">
               <ZoomIn className="w-3 h-3 mr-1" /> 点击查看全景
            </div>
            <div className="flex-1 pt-4 min-h-[80px]">
               <BalanceChart data={chartData.map(d => d.value)} width={400} height={80} />
            </div>
         </div>
      </div>

      {showFullChart && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
           <DetailedChart data={chartData} onClose={() => setShowFullChart(false)} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT: TASK CREATOR (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
           <div className="bg-white rounded-[2rem] p-6 shadow-xl border border-indigo-50">
              <div className="flex justify-between items-center mb-6">
                 <div className="flex items-center space-x-2">
                    <Layers className="w-5 h-5 text-indigo-600" />
                    <h3 className="font-black text-gray-900">托管任务生成器</h3>
                 </div>
                 <button onClick={() => setShowConfig(!showConfig)} className="text-xs font-bold text-gray-400 hover:text-indigo-600 flex items-center">
                    {showConfig ? '收起' : '展开'} {showConfig ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                 </button>
              </div>

              {showConfig && (
                <div className="space-y-4 animate-in slide-in-from-top-2">
                   
                   {/* Task Name */}
                   <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase ml-1">任务备注</label>
                      <input 
                        type="text" 
                        value={draftName} 
                        onChange={e => setDraftName(e.target.value)}
                        placeholder="例如：3秒平注追单..."
                        className="w-full mt-1 px-4 py-2.5 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 border-2 rounded-xl text-xs font-bold outline-none transition-all"
                      />
                   </div>

                   {/* Rule Selector (Hidden for Global Modes) */}
                   {!draftConfig.autoTarget.startsWith('GLOBAL') && (
                     <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100/50">
                        <label className="text-[10px] font-black text-gray-400 uppercase block mb-2">下注规则 (秒数)</label>
                        <select 
                          value={draftRuleId} 
                          onChange={e => setDraftRuleId(e.target.value)}
                          className="w-full bg-white text-indigo-900 rounded-xl px-3 py-2 text-xs font-black border border-indigo-100 outline-none cursor-pointer shadow-sm"
                        >
                           {rules.map(r => (
                             <option key={r.id} value={r.id}>{r.label} (步长: {r.value})</option>
                           ))}
                        </select>
                     </div>
                   )}
                   {draftConfig.autoTarget.startsWith('GLOBAL') && (
                      <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-100/50 flex items-center space-x-2">
                          {draftConfig.autoTarget === 'GLOBAL_AI_FULL_SCAN' ? (
                             <Sparkles className="w-5 h-5 text-amber-500 animate-pulse" />
                          ) : (
                             <Activity className="w-5 h-5 text-amber-500 animate-pulse" />
                          )}
                          <span className="text-xs font-black text-amber-700">
                             {draftConfig.autoTarget === 'GLOBAL_AI_FULL_SCAN' ? 'AI 全域全规则：最优解自动锁定' : '全域扫描模式已激活：自动匹配所有规则'}
                          </span>
                      </div>
                   )}

                   {/* Strategy Type */}
                   <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase ml-1">资金策略</label>
                      <select 
                        value={draftConfig.type} 
                        onChange={e => setDraftConfig({...draftConfig, type: e.target.value as StrategyType})}
                        className="w-full bg-gray-50 text-gray-800 rounded-xl px-3 py-2.5 text-xs font-black border border-transparent focus:border-indigo-500 outline-none mt-1"
                      >
                         {Object.entries(STRATEGY_LABELS).filter(([k]) => k !== 'MANUAL').map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                         ))}
                      </select>
                   </div>
                   
                   {/* Strategy Params */}
                   {draftConfig.type === 'MARTINGALE' && (
                      <div className="grid grid-cols-2 gap-2">
                         <div className="bg-gray-50 px-3 py-2 rounded-xl">
                            <span className="text-[10px] font-bold text-gray-400 block mb-1">倍投系数</span>
                            <input type="number" step="0.1" value={draftConfig.multiplier} onChange={e => setDraftConfig({...draftConfig, multiplier: parseFloat(e.target.value)})} className="w-full bg-white rounded-lg px-2 py-1 text-xs font-black text-center" />
                         </div>
                         <div className="bg-gray-50 px-3 py-2 rounded-xl">
                            <span className="text-[10px] font-bold text-gray-400 block mb-1">跟投期数</span>
                            <input type="number" min="1" value={draftConfig.maxCycle} onChange={e => setDraftConfig({...draftConfig, maxCycle: parseInt(e.target.value) || 10})} className="w-full bg-white rounded-lg px-2 py-1 text-xs font-black text-center" />
                         </div>
                      </div>
                   )}
                   {draftConfig.type === 'DALEMBERT' && (
                      <div className="bg-gray-50 px-3 py-2 rounded-xl flex justify-between items-center">
                         <span className="text-[10px] font-bold text-gray-500">升降步长</span>
                         <input type="number" value={draftConfig.step} onChange={e => setDraftConfig({...draftConfig, step: parseFloat(e.target.value)})} className="w-20 bg-white rounded-lg px-2 py-1 text-xs font-black text-center" />
                      </div>
                   )}
                   {draftConfig.type === 'CUSTOM' && (
                      <div className="bg-gray-50 px-3 py-2 rounded-xl">
                        <span className="text-[10px] font-bold text-gray-400 block mb-1">自定义倍数序列 (逗号分隔)</span>
                        <textarea 
                          value={customSeqText} 
                          onChange={e => {
                            const txt = e.target.value;
                            setCustomSeqText(txt);
                            const seq = txt.split(/[,，\s]+/).map(s => parseFloat(s)).filter(n => !isNaN(n) && n > 0);
                            setDraftConfig({...draftConfig, customSequence: seq.length > 0 ? seq : [1]});
                          }} 
                          className="w-full bg-white rounded-lg px-2 py-1.5 text-xs font-black border border-transparent focus:border-indigo-200 outline-none h-16 resize-none"
                          placeholder="1, 2, 3, 5, 8..."
                        />
                      </div>
                   )}
                   {draftConfig.type === 'AI_KELLY' && (
                      <div className="bg-indigo-50/50 px-4 py-3 rounded-xl border border-indigo-100">
                        <div className="flex justify-between items-center mb-2">
                           <span className="text-[10px] font-black text-indigo-700 uppercase flex items-center">
                              <Scale className="w-3 h-3 mr-1.5" />
                              Kelly 风险系数
                           </span>
                           <span className="text-xs font-black text-indigo-600 bg-white px-2 py-0.5 rounded shadow-sm">
                              {((draftConfig.kellyFraction || 0.2) * 100).toFixed(0)}%
                           </span>
                        </div>
                        <input 
                           type="range" 
                           min="0.1" max="1.0" step="0.1" 
                           value={draftConfig.kellyFraction || 0.2}
                           onChange={e => setDraftConfig({...draftConfig, kellyFraction: parseFloat(e.target.value)})}
                           className="w-full h-1.5 bg-indigo-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                        <div className="flex justify-between text-[8px] font-black text-indigo-400 mt-1 uppercase">
                           <span>保守 (10%)</span>
                           <span>激进 (100%)</span>
                        </div>
                      </div>
                   )}

                   {/* Target Mode */}
                   <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase ml-1">自动目标</label>
                      <div className="grid grid-cols-2 gap-2 mt-1 mb-2">
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'AI_PREDICTION'})} className={`col-span-1 py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'AI_PREDICTION' ? 'bg-purple-600 text-white border-purple-600 shadow-md' : 'bg-white text-gray-400 border-gray-200'}`}>
                            <div className="flex items-center justify-center space-x-1">
                                <BrainCircuit className="w-3.5 h-3.5" />
                                <span>AI 单规托管</span>
                            </div>
                         </button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'GLOBAL_AI_FULL_SCAN'})} className={`col-span-1 py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'GLOBAL_AI_FULL_SCAN' ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-gray-400 border-gray-200'}`}>
                            <div className="flex items-center justify-center space-x-1">
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>AI 全域全规则</span>
                            </div>
                         </button>
                         
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'GLOBAL_TREND_DRAGON'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'GLOBAL_TREND_DRAGON' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-400 border-gray-200'}`}>全域走势长龙</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'GLOBAL_BEAD_DRAGON'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'GLOBAL_BEAD_DRAGON' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-400 border-gray-200'}`}>全域珠盘长龙</button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'FIXED_ODD'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'FIXED_ODD' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-400 border-gray-200'}`}>定买单</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'FIXED_EVEN'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'FIXED_EVEN' ? 'bg-teal-500 text-white border-teal-500' : 'bg-white text-gray-400 border-gray-200'}`}>定买双</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'FIXED_BIG'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'FIXED_BIG' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-400 border-gray-200'}`}>定买大</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'FIXED_SMALL'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'FIXED_SMALL' ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-gray-400 border-gray-200'}`}>定买小</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'FOLLOW_LAST'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'FOLLOW_LAST' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-400 border-gray-200'}`}>跟上期(顺)</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'REVERSE_LAST'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'REVERSE_LAST' ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-gray-400 border-gray-200'}`}>反上期(砍)</button>
                      </div>
                   </div>

                   {(draftConfig.autoTarget === 'FOLLOW_LAST' || draftConfig.autoTarget === 'REVERSE_LAST' || draftConfig.autoTarget.startsWith('GLOBAL')) && (
                      <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                          { !draftConfig.autoTarget.startsWith('GLOBAL') && (
                              <div className="flex gap-2 mb-3">
                                 <button 
                                      onClick={() => setDraftConfig({...draftConfig, targetType: 'PARITY'})}
                                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold border ${draftConfig.targetType === 'PARITY' ? 'bg-white shadow text-indigo-600 border-indigo-200' : 'text-gray-400 border-transparent'}`}
                                 >
                                      玩法：单双
                                 </button>
                                 <button 
                                      onClick={() => setDraftConfig({...draftConfig, targetType: 'SIZE'})}
                                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold border ${draftConfig.targetType === 'SIZE' ? 'bg-white shadow text-indigo-600 border-indigo-200' : 'text-gray-400 border-transparent'}`}
                                 >
                                      玩法：大小
                                 </button>
                              </div>
                          )}
                          <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-amber-600 flex items-center"><AlertTriangle className="w-3 h-3 mr-1" /> 起投连数</span>
                              <input 
                                  type="number" min="1" 
                                  value={draftConfig.minStreak} 
                                  onChange={e => setDraftConfig({...draftConfig, minStreak: Math.max(1, parseInt(e.target.value) || 1)})} 
                                  className="w-16 text-center bg-white rounded-lg text-xs font-black border border-amber-200 text-amber-600" 
                              />
                          </div>
                      </div>
                   )}

                   <div className="pt-4 border-t border-gray-100 mt-2">
                      <div className="flex items-center justify-between mb-3">
                         <span className="text-xs font-bold text-gray-500">基础注额 (每单)</span>
                         <input type="number" value={config.baseBet} onChange={(e) => setConfig({...config, baseBet: parseFloat(e.target.value)})} className="w-20 text-right bg-gray-50 px-2 py-1 rounded-lg text-xs font-black" />
                      </div>
                      <button 
                        onClick={createTask}
                        className="w-full py-3.5 bg-indigo-600 text-white rounded-xl font-black text-sm flex items-center justify-center transition-all shadow-lg shadow-indigo-200 active:scale-95 hover:bg-indigo-700"
                      >
                        <Plus className="w-4 h-4 mr-2" /> 添加托管任务
                      </button>
                   </div>
                </div>
              )}
           </div>

           {/* Global Config Card */}
           <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
              <h3 className="text-xs font-black text-gray-400 uppercase mb-4">全局风控参数</h3>
              <div className="grid grid-cols-2 gap-3">
                   <div>
                     <label className="text-[10px] font-black text-gray-400 uppercase">初始本金</label>
                     <input type="number" value={config.initialBalance} onChange={e => setConfig({...config, initialBalance: parseFloat(e.target.value)})} className="w-full bg-gray-50 rounded-lg px-2 py-1.5 text-xs font-bold border border-transparent focus:border-indigo-500 outline-none" />
                   </div>
                   <div>
                     <label className="text-[10px] font-black text-gray-400 uppercase">赔率</label>
                     <input type="number" step="0.01" value={config.odds} onChange={e => setConfig({...config, odds: parseFloat(e.target.value)})} className="w-full bg-gray-50 rounded-lg px-2 py-1.5 text-xs font-bold border border-transparent focus:border-indigo-500 outline-none" />
                   </div>
                   <div>
                     <label className="text-[10px] font-black text-gray-400 uppercase">止盈</label>
                     <input type="number" value={config.takeProfit} onChange={e => setConfig({...config, takeProfit: parseFloat(e.target.value)})} className="w-full bg-green-50 text-green-700 rounded-lg px-2 py-1.5 text-xs font-bold outline-none" />
                   </div>
                   <div>
                     <label className="text-[10px] font-black text-gray-400 uppercase">止损</label>
                     <input type="number" value={config.stopLoss} onChange={e => setConfig({...config, stopLoss: parseFloat(e.target.value)})} className="w-full bg-red-50 text-red-700 rounded-lg px-2 py-1.5 text-xs font-bold outline-none" />
                   </div>
                   <button 
                    type="button"
                    onClick={resetAccount} 
                    className="col-span-2 py-2 bg-gray-100 hover:bg-red-50 hover:text-red-600 text-gray-500 rounded-lg text-xs font-black flex items-center justify-center transition-colors mt-2"
                   >
                      <Trash2 className="w-3 h-3 mr-2" /> 重置所有数据
                   </button>
              </div>
           </div>
        </div>

        {/* CENTER/RIGHT: TASKS & MANUAL (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
           
           {/* RUNNING TASKS GRID */}
           {tasks.length > 0 && (
             <div className="space-y-4">
                <div className="flex justify-between items-center px-2">
                   <div className="flex items-center space-x-2">
                      <Activity className="w-5 h-5 text-indigo-600" />
                      <h3 className="font-black text-gray-900">运行中的任务 ({tasks.filter(t => t.isActive).length}/{tasks.length})</h3>
                   </div>
                   <div className="flex space-x-2">
                      <button 
                        onClick={startAllTasks}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-green-50 text-green-600 rounded-lg text-[10px] font-black hover:bg-green-100 transition-colors"
                      >
                         <PlayCircle className="w-3.5 h-3.5" />
                         <span>全部开始</span>
                      </button>
                      <button 
                        onClick={stopAllTasks}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-[10px] font-black hover:bg-red-100 transition-colors"
                      >
                         <StopCircle className="w-3.5 h-3.5" />
                         <span>全部停止</span>
                      </button>
                   </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   {tasks.map(task => {
                     const rule = rules.find(r => r.id === task.ruleId);
                     const taskDDRate = config.initialBalance > 0 ? (task.stats.maxDrawdown / config.initialBalance) * 100 : 0;
                     return (
                       <div key={task.id} className={`rounded-2xl p-5 border-2 transition-all relative overflow-hidden ${task.isActive ? 'bg-white border-indigo-500 shadow-md' : 'bg-gray-50 border-gray-200 grayscale-[0.5]'}`}>
                          <div className="flex justify-between items-start mb-3">
                             <div>
                                <h4 className="font-black text-sm text-gray-900 truncate max-w-[150px]">{task.name}</h4>
                                <div className="flex items-center space-x-2 mt-1">
                                   <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${task.config.autoTarget.startsWith('GLOBAL') ? 'bg-amber-100 text-amber-600' : (task.config.autoTarget === 'AI_PREDICTION' ? 'bg-purple-100 text-purple-600' : 'bg-indigo-50 text-indigo-600')}`}>
                                      {task.config.autoTarget.startsWith('GLOBAL') ? (task.config.autoTarget === 'GLOBAL_AI_FULL_SCAN' ? 'AI 全域全规则' : '全域扫描') : (task.config.autoTarget === 'AI_PREDICTION' ? 'AI托管' : rule?.label)}
                                   </span>
                                   <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded font-bold">{STRATEGY_LABELS[task.config.type]}</span>
                                </div>
                             </div>
                             <button onClick={() => toggleTask(task.id)} className={`p-2 rounded-full transition-colors ${task.isActive ? 'text-red-500 hover:bg-red-50' : 'text-green-500 hover:bg-green-50'}`}>
                                {task.isActive ? <PauseCircle className="w-6 h-6" /> : <PlayCircle className="w-6 h-6" />}
                             </button>
                          </div>
                          
                          <div className="grid grid-cols-3 gap-2 mb-2 bg-gray-50/50 p-2 rounded-xl">
                             <div className="text-center">
                                <span className="block text-[9px] text-gray-400 uppercase font-black">当前下注</span>
                                <span className="block text-sm font-black text-gray-800">${task.state.currentBetAmount}</span>
                             </div>
                             <div className="text-center border-l border-gray-200">
                                <span className="block text-[9px] text-gray-400 uppercase font-black">连输</span>
                                <span className="block text-sm font-black text-red-500">{task.state.consecutiveLosses}</span>
                             </div>
                             <div className="text-center border-l border-gray-200">
                                <span className="block text-[9px] text-gray-400 uppercase font-black">盈亏</span>
                                <span className={`block text-sm font-black ${task.stats.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>{task.stats.profit >= 0 ? '+' : ''}{task.stats.profit.toFixed(0)}</span>
                             </div>
                          </div>
                          
                          <div className="grid grid-cols-3 gap-2 mb-2 bg-gray-50/50 p-2 rounded-xl">
                             <div className="text-center flex items-center justify-center space-x-1">
                                <TrendingUp className="w-3 h-3 text-green-500" />
                                <div>
                                    <span className="block text-[9px] text-gray-400 uppercase font-black">最高收益</span>
                                    <span className="block text-xs font-black text-green-600">+{task.stats.maxProfit.toFixed(0)}</span>
                                </div>
                             </div>
                             <div className="text-center border-l border-gray-200 flex items-center justify-center space-x-1">
                                <TrendingDown className="w-3 h-3 text-red-500" />
                                <div>
                                    <span className="block text-[9px] text-gray-400 uppercase font-black">最大亏损</span>
                                    <span className="block text-xs font-black text-red-600">{task.stats.maxLoss.toFixed(0)}</span>
                                </div>
                             </div>
                             <div className="text-center border-l border-gray-200 flex items-center justify-center space-x-1">
                                <Wallet className="w-3 h-3 text-blue-500" />
                                <div>
                                    <span className="block text-[9px] text-gray-400 uppercase font-black">累计下注</span>
                                    <span className="block text-xs font-black text-blue-600">${(task.stats.totalBetAmount || 0).toLocaleString()}</span>
                                </div>
                             </div>
                          </div>
                          
                          <div className="bg-red-50 rounded-xl p-2 flex items-center justify-center text-[10px] font-black text-red-500 mb-4 border border-red-100">
                             <ShieldAlert className="w-3 h-3 mr-1.5" />
                             最大回撤: -${task.stats.maxDrawdown.toFixed(0)} (-{taskDDRate.toFixed(1)}%)
                          </div>

                          <div className="flex justify-between items-center text-[10px] font-bold text-gray-400">
                             <span>W: {task.stats.wins} / L: {task.stats.losses}</span>
                             <button onClick={() => deleteTask(task.id)} className="text-gray-300 hover:text-red-500 flex items-center"><Trash2 className="w-3 h-3 mr-1" /> 删除</button>
                          </div>
                       </div>
                     );
                   })}
                </div>
             </div>
           )}

           {/* MANUAL BETTING PANEL */}
           <div className="bg-white rounded-[2rem] p-8 shadow-xl border border-gray-100">
              <div className="flex justify-between items-center mb-6">
                 <div className="flex items-center space-x-3">
                   <Gamepad2 className="w-6 h-6 text-amber-500" />
                   <div>
                     <h3 className="text-lg font-black text-gray-900">手动下注面板</h3>
                     <p className="text-[10px] text-gray-400 font-bold">即时干预，独立于托管任务</p>
                   </div>
                 </div>
                 <div className="flex items-center gap-2">
                   <select 
                      value={activeManualRuleId}
                      onChange={e => setActiveManualRuleId(e.target.value)}
                      className="bg-gray-50 border-none text-xs font-black rounded-lg px-2 py-1.5 outline-none cursor-pointer"
                   >
                      {rules.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                   </select>
                   <div className="text-xs font-bold text-gray-400 bg-gray-100 px-3 py-1.5 rounded-lg">
                      下期: #{allBlocks.length > 0 ? getNextTargetHeight(allBlocks[0].height, manualRule.value, manualRule.startBlock) : '---'}
                   </div>
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <div className="flex gap-2">
                       <button onClick={() => placeBet(getNextTargetHeight(allBlocks[0].height, manualRule.value, manualRule.startBlock), 'PARITY', 'ODD', config.baseBet, 'MANUAL', manualRule)} className="flex-1 py-3 bg-red-500 text-white rounded-xl font-black text-lg shadow-md hover:bg-red-600 active:scale-95 transition-all">单</button>
                       <button onClick={() => placeBet(getNextTargetHeight(allBlocks[0].height, manualRule.value, manualRule.startBlock), 'PARITY', 'EVEN', config.baseBet, 'MANUAL', manualRule)} className="flex-1 py-3 bg-teal-500 text-white rounded-xl font-black text-lg shadow-md hover:bg-teal-600 active:scale-95 transition-all">双</button>
                    </div>
                 </div>
                 <div className="space-y-2">
                    <div className="flex gap-2">
                       <button onClick={() => placeBet(getNextTargetHeight(allBlocks[0].height, manualRule.value, manualRule.startBlock), 'SIZE', 'BIG', config.baseBet, 'MANUAL', manualRule)} className="flex-1 py-3 bg-orange-500 text-white rounded-xl font-black text-lg shadow-md hover:bg-orange-600 active:scale-95 transition-all">大</button>
                       <button onClick={() => placeBet(getNextTargetHeight(allBlocks[0].height, manualRule.value, manualRule.startBlock), 'SIZE', 'SMALL', config.baseBet, 'MANUAL', manualRule)} className="flex-1 py-3 bg-indigo-500 text-white rounded-xl font-black text-lg shadow-md hover:bg-indigo-600 active:scale-95 transition-all">小</button>
                    </div>
                 </div>
              </div>
              <div className="flex justify-center gap-2 mt-5">
                 {[10, 50, 100, 500, 1000].map(amt => (
                    <button key={amt} onClick={() => setConfig({...config, baseBet: amt})} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${config.baseBet === amt ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{amt}</button>
                 ))}
              </div>
           </div>

           {/* PENDING BETS LIST */}
           {pendingBets.length > 0 && (
              <div className="space-y-3">
                 <div className="flex items-center space-x-2 text-xs font-black text-gray-400 uppercase px-2">
                    <Clock className="w-3.5 h-3.5" /> <span>进行中</span>
                 </div>
                 {pendingBets.map(bet => (
                    <div key={bet.id} className="bg-white p-4 rounded-2xl border border-indigo-100 shadow-sm flex justify-between items-center relative overflow-hidden">
                       <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400 animate-pulse"></div>
                       <div className="flex items-center space-x-3 pl-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-black ${bet.taskId ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-500'}`}>
                             {bet.taskName || '手动'}
                          </span>
                          <div>
                             <span className="block text-xs font-black text-gray-800">#{bet.targetHeight}</span>
                             <span className="text-[9px] text-gray-400">{bet.ruleName}</span>
                          </div>
                       </div>
                       <div className="flex items-center space-x-3">
                          <div className={`px-2.5 py-1 rounded-lg font-black text-xs text-white ${bet.prediction === 'ODD' ? 'bg-red-500' : bet.prediction === 'EVEN' ? 'bg-teal-500' : bet.prediction === 'BIG' ? 'bg-orange-500' : 'bg-indigo-500'}`}>
                             {bet.prediction === 'ODD' ? '单' : bet.prediction === 'EVEN' ? '双' : bet.prediction === 'BIG' ? '大' : '小'}
                          </div>
                          <span className="text-sm font-black text-slate-700">${bet.amount}</span>
                       </div>
                    </div>
                 ))}
              </div>
           )}
        </div>
      </div>

      {/* 3. HISTORY TABLE */}
      <div className="bg-white rounded-[2.5rem] p-6 shadow-xl border border-gray-100">
         <div className="flex items-center space-x-2 mb-4">
            <History className="w-5 h-5 text-gray-400" />
            <h3 className="text-base font-black text-gray-900">历史记录</h3>
         </div>
         <div className="overflow-x-auto">
            <table className="w-full text-left">
               <thead className="text-[10px] font-black text-gray-400 uppercase tracking-wider border-b border-gray-100">
                  <tr>
                     <th className="pb-2 pl-2">区块</th>
                     <th className="pb-2">来源</th>
                     <th className="pb-2">策略</th>
                     <th className="pb-2">下注</th>
                     <th className="pb-2">结果</th>
                     <th className="pb-2">盈亏</th>
                     <th className="pb-2 pr-2 text-right">余额</th>
                  </tr>
               </thead>
               <tbody className="text-xs font-medium text-gray-600">
                  {settledBets.length === 0 ? (
                     <tr><td colSpan={7} className="py-8 text-center text-gray-300 font-bold">暂无记录</td></tr>
                  ) : (
                     settledBets.slice(0, 30).map(bet => (
                        <tr key={bet.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                           <td className="py-3 pl-2">
                              <span className="font-black text-gray-800 block">#{bet.targetHeight}</span>
                              <span className="text-[9px] text-gray-400">{bet.ruleName}</span>
                           </td>
                           <td className="py-3">
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${bet.taskId ? 'bg-purple-50 text-purple-600' : 'bg-amber-50 text-amber-600'}`}>
                                 {bet.taskName || '手动'}
                              </span>
                           </td>
                           <td className="py-3">
                             <span className="text-[9px] bg-gray-100 px-1.5 py-0.5 rounded font-bold text-gray-500">
                               {STRATEGY_LABELS[bet.strategyLabel || 'MANUAL'] || bet.strategyLabel}
                             </span>
                           </td>
                           <td className="py-3">
                              <div className="flex items-center space-x-1">
                                 <span className={`text-[10px] font-black ${bet.prediction === 'ODD' ? 'text-red-500' : bet.prediction === 'EVEN' ? 'text-teal-500' : bet.prediction === 'BIG' ? 'text-orange-500' : 'text-indigo-500'}`}>{bet.prediction === 'ODD' ? '单' : bet.prediction === 'EVEN' ? '双' : bet.prediction === 'BIG' ? '大' : '小'}</span>
                                 <span className="text-[10px] text-gray-400">${bet.amount}</span>
                              </div>
                           </td>
                           <td className="py-3">
                              <span className="font-bold text-gray-800 mr-1">{bet.resultVal}</span>
                              {bet.status === 'WIN' ? <CheckCircle2 className="w-3 h-3 text-green-500 inline" /> : <XCircle className="w-3 h-3 text-gray-300 inline" />}
                           </td>
                           <td className={`py-3 font-black ${bet.status === 'WIN' ? 'text-green-500' : 'text-red-400'}`}>{bet.status === 'WIN' ? `+${(bet.payout - bet.amount).toFixed(1)}` : `-${bet.amount}`}</td>
                           <td className="py-3 pr-2 text-right text-gray-400 font-mono">${bet.balanceAfter.toFixed(0)}</td>
                        </tr>
                     ))
                  )}
               </tbody>
            </table>
         </div>
      </div>
    </div>
  );
};

export default SimulatedBetting;
