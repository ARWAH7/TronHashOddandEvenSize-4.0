
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { BlockData, IntervalRule } from '../types';
import { 
  Gamepad2, Wallet, TrendingUp, History, CheckCircle2, XCircle, 
  Trash2, Clock, Settings2, PlayCircle, StopCircle, RefreshCw, 
  ChevronDown, ChevronUp, AlertTriangle, Target, ArrowRight, Percent, BarChart4
} from 'lucide-react';

interface SimulatedBettingProps {
  allBlocks: BlockData[];
  rules: IntervalRule[];
}

// ---------------------- TYPES ----------------------

type BetType = 'PARITY' | 'SIZE';
type BetTarget = 'ODD' | 'EVEN' | 'BIG' | 'SMALL';
type StrategyType = 'MANUAL' | 'MARTINGALE' | 'DALEMBERT' | 'FLAT' | 'FIBONACCI' | 'PAROLI' | '1326';
type AutoTargetMode = 'FIXED_ODD' | 'FIXED_EVEN' | 'FIXED_BIG' | 'FIXED_SMALL' | 'FOLLOW_LAST' | 'REVERSE_LAST';

interface BetRecord {
  id: string;
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
  multiplier: number;
  step: number;
  minStreak: number;
}

interface StrategyState {
  consecutiveLosses: number;
  currentBetAmount: number;
  sequenceIndex: number; // For sequence based strategies (Fibonacci, 1-3-2-6)
}

// ---------------------- CONSTANTS & HELPERS ----------------------

const STRATEGY_LABELS: Record<string, string> = {
  'MANUAL': '手动下注',
  'FLAT': '平注策略',
  'MARTINGALE': '马丁格尔 (倍投)',
  'DALEMBERT': '达朗贝尔 (升降)',
  'FIBONACCI': '斐波那契 (数列)',
  'PAROLI': '帕罗利 (反倍投)',
  '1326': '1-3-2-6 法则'
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

// SVG Chart
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

// ---------------------- MAIN COMPONENT ----------------------

const SimulatedBetting: React.FC<SimulatedBettingProps> = ({ allBlocks, rules }) => {
  // --- STATE ---
  const [balance, setBalance] = useState<number>(10000);
  const [bets, setBets] = useState<BetRecord[]>([]);
  
  const [config, setConfig] = useState<SimConfig>({
    initialBalance: 10000,
    odds: 1.98,
    stopLoss: 0,
    takeProfit: 0,
    baseBet: 100
  });

  const [strategyConfig, setStrategyConfig] = useState<StrategyConfig>({
    type: 'FLAT',
    autoTarget: 'FIXED_ODD',
    multiplier: 2.0,
    step: 10,
    minStreak: 1
  });

  // NEW: Initialize from localStorage to persist auto-betting state across tabs
  const [isAutoRunning, setIsAutoRunning] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sim_v2_is_auto') === 'true';
    } catch { return false; }
  });

  // NEW: Initialize strategy state from localStorage to prevent martingale reset on tab switch
  const [strategyState, setStrategyState] = useState<StrategyState>(() => {
    try {
      const saved = localStorage.getItem('sim_v2_strat_state');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      consecutiveLosses: 0,
      currentBetAmount: 100,
      sequenceIndex: 0
    };
  });

  const [activeRuleId, setActiveRuleId] = useState<string>(rules[0]?.id || '');
  const [showConfig, setShowConfig] = useState(false);

  // Derived Values
  const activeRule = useMemo(() => rules.find(r => r.id === activeRuleId) || rules[0], [rules, activeRuleId]);
  const balanceHistory = useMemo(() => [config.initialBalance, ...bets.filter(b => b.status !== 'PENDING').slice().reverse().map(b => b.balanceAfter)], [config.initialBalance, bets]);
  const pendingBets = useMemo(() => bets.filter(b => b.status === 'PENDING'), [bets]);
  const settledBets = useMemo(() => bets.filter(b => b.status !== 'PENDING'), [bets]);

  // Load Data (Balance, Bets, Config)
  useEffect(() => {
    try {
      const savedBalance = localStorage.getItem('sim_v2_balance');
      const savedBets = localStorage.getItem('sim_v2_bets');
      const savedConfig = localStorage.getItem('sim_v2_config');
      const savedStratConfig = localStorage.getItem('sim_v2_strat_config');

      if (savedBalance) setBalance(parseFloat(savedBalance));
      if (savedBets) setBets(JSON.parse(savedBets));
      if (savedConfig) setConfig(JSON.parse(savedConfig));
      if (savedStratConfig) setStrategyConfig(JSON.parse(savedStratConfig));
      
      // Note: isAutoRunning and strategyState are loaded in useState initializer
    } catch(e) { console.error("Load failed", e); }
  }, []);

  // Save Data
  useEffect(() => {
    localStorage.setItem('sim_v2_balance', balance.toString());
    localStorage.setItem('sim_v2_bets', JSON.stringify(bets));
    localStorage.setItem('sim_v2_config', JSON.stringify(config));
    localStorage.setItem('sim_v2_strat_config', JSON.stringify(strategyConfig));
    // Persist running state and execution state
    localStorage.setItem('sim_v2_is_auto', isAutoRunning.toString());
    localStorage.setItem('sim_v2_strat_state', JSON.stringify(strategyState));
  }, [balance, bets, config, strategyConfig, isAutoRunning, strategyState]);

  // Sync Base Bet (Only if NOT running, to avoid resetting amount during auto run)
  useEffect(() => {
    if (!isAutoRunning) {
      setStrategyState(prev => ({ 
        ...prev, 
        currentBetAmount: config.baseBet,
        // Don't reset sequence index here necessarily, but usually safer to:
        sequenceIndex: 0,
        consecutiveLosses: 0
      }));
    }
  }, [config.baseBet, isAutoRunning]);

  // --- LOGIC ---

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

  // --- ACTIONS ---

  const placeBet = useCallback((
    targetHeight: number, 
    type: BetType, 
    target: BetTarget, 
    amount: number, 
    isAuto: boolean,
    currentBal: number
  ) => {
    if (currentBal < amount) {
      if (isAuto) setIsAutoRunning(false); 
      else alert("余额不足！");
      return false;
    }

    if (bets.some(b => b.targetHeight === targetHeight && b.ruleId === activeRule.id)) return false;

    const newBet: BetRecord = {
      id: Date.now().toString() + Math.random().toString().slice(2, 6),
      timestamp: Date.now(),
      ruleId: activeRule.id,
      ruleName: activeRule.label,
      targetHeight,
      betType: type,
      prediction: target,
      amount,
      odds: config.odds,
      status: 'PENDING',
      payout: 0,
      strategyLabel: isAuto ? (strategyConfig.type === 'MANUAL' ? 'FLAT' : strategyConfig.type) : 'MANUAL',
      balanceAfter: currentBal 
    };

    setBalance(prev => prev - amount);
    setBets(prev => [newBet, ...prev]);
    return true;
  }, [activeRule, config.odds, strategyConfig.type, bets]);

  const resetAccount = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    // Default Initial Balance
    const defaultBalance = 10000;
    const defaultBaseBet = 100;

    // 1. Force Clear Storage Immediately (Silent Mode)
    localStorage.removeItem('sim_v2_bets');
    localStorage.removeItem('sim_v2_strat_config');
    localStorage.removeItem('sim_v2_strat_state');
    localStorage.removeItem('sim_v2_is_auto');
    localStorage.removeItem('sim_v2_config'); // Clear config to defaults
    localStorage.setItem('sim_v2_balance', defaultBalance.toString());
    
    // 2. Reset State Immediately
    setBalance(defaultBalance);
    setBets([]);
    setIsAutoRunning(false);
    
    // Reset Strategy State
    setStrategyState({ 
      consecutiveLosses: 0, 
      currentBetAmount: defaultBaseBet, 
      sequenceIndex: 0 
    });
    
    // Reset Main Config
    setConfig({
      initialBalance: defaultBalance,
      odds: 1.98,
      stopLoss: 0,
      takeProfit: 0,
      baseBet: defaultBaseBet
    });

    // Reset Strategy Config
    setStrategyConfig({
      type: 'FLAT',
      autoTarget: 'FIXED_ODD',
      multiplier: 2.0,
      step: 10,
      minStreak: 1
    });
  };

  // --- AUTO ENGINE ---
  useEffect(() => {
    if (allBlocks.length === 0) return;

    let currentBalance = balance;
    let balanceChanged = false;
    let lastAutoResult: 'WIN' | 'LOSS' | null = null;

    // 1. Settle Bets
    const updatedBets = bets.map(bet => {
      if (bet.status === 'PENDING') {
        const targetBlock = allBlocks.find(b => b.height === bet.targetHeight);
        if (targetBlock) {
          balanceChanged = true;
          let isWin = false;
          let resultVal = '';

          if (bet.betType === 'PARITY') {
            isWin = targetBlock.type === bet.prediction;
            resultVal = targetBlock.type === 'ODD' ? '单' : '双';
          } else {
            isWin = targetBlock.sizeType === bet.prediction;
            resultVal = targetBlock.sizeType === 'BIG' ? '大' : '小';
          }

          if (bet.strategyLabel !== 'MANUAL') {
             lastAutoResult = isWin ? 'WIN' : 'LOSS';
          }

          const payout = isWin ? bet.amount * bet.odds : 0;
          if (isWin) currentBalance += payout;
          
          return { ...bet, status: isWin ? 'WIN' : 'LOSS', payout, resultVal, balanceAfter: currentBalance } as BetRecord;
        }
      }
      return bet;
    });

    if (balanceChanged) {
      setBets(updatedBets);
      setBalance(currentBalance);
    }

    // 2. Strategy Calculation (The Brain)
    // CRITICAL FIX: Use local variables to track next state within this cycle
    // React state updates are async, so we need to calculate the value to use *immediately* for the next bet.
    let nextBetAmount = strategyState.currentBetAmount;
    let nextSequenceIndex = strategyState.sequenceIndex;
    let nextConsecutiveLosses = strategyState.consecutiveLosses;

    if (lastAutoResult) {
       // Ensure index exists
       if (typeof nextSequenceIndex === 'undefined') nextSequenceIndex = 0;

       switch (strategyConfig.type) {
          case 'MARTINGALE':
             if (lastAutoResult === 'LOSS') {
                // Fix: Apply multiplier immediately
                nextBetAmount = nextBetAmount * strategyConfig.multiplier;
                nextConsecutiveLosses += 1;
             } else {
                nextBetAmount = config.baseBet;
                nextConsecutiveLosses = 0;
             }
             break;

          case 'DALEMBERT':
             if (lastAutoResult === 'LOSS') {
                nextBetAmount += strategyConfig.step;
                nextConsecutiveLosses += 1;
             } else {
                nextBetAmount -= strategyConfig.step;
                if (nextBetAmount < config.baseBet) nextBetAmount = config.baseBet;
                nextConsecutiveLosses = 0;
             }
             break;

          case 'FIBONACCI':
             if (lastAutoResult === 'LOSS') {
                nextSequenceIndex = Math.min(nextSequenceIndex + 1, FIB_SEQ.length - 1);
             } else {
                nextSequenceIndex = Math.max(0, nextSequenceIndex - 2);
             }
             nextBetAmount = config.baseBet * FIB_SEQ[nextSequenceIndex];
             break;

          case 'PAROLI':
             if (lastAutoResult === 'WIN') {
                nextSequenceIndex++;
                if (nextSequenceIndex >= 3) {
                   nextSequenceIndex = 0;
                   nextBetAmount = config.baseBet;
                } else {
                   nextBetAmount *= 2;
                }
             } else {
                nextSequenceIndex = 0;
                nextBetAmount = config.baseBet;
             }
             break;

          case '1326':
             if (lastAutoResult === 'WIN') {
                nextSequenceIndex++;
                if (nextSequenceIndex >= SEQ_1326.length) {
                   nextSequenceIndex = 0;
                   nextBetAmount = config.baseBet;
                } else {
                   nextBetAmount = config.baseBet * SEQ_1326[nextSequenceIndex];
                }
             } else {
                nextSequenceIndex = 0;
                nextBetAmount = config.baseBet;
             }
             break;

          case 'FLAT':
          default:
             nextBetAmount = config.baseBet;
             break;
       }

       // Update the state for persistence and UI
       setStrategyState({
           currentBetAmount: nextBetAmount,
           sequenceIndex: nextSequenceIndex,
           consecutiveLosses: nextConsecutiveLosses
       });
    }

    // 3. Auto Bet Trigger
    if (isAutoRunning) {
       const profit = currentBalance - config.initialBalance;
       if ((config.takeProfit > 0 && profit >= config.takeProfit) || 
           (config.stopLoss > 0 && profit <= -config.stopLoss)) {
          setIsAutoRunning(false);
          return;
       }

       const nextHeight = getNextTargetHeight(allBlocks[0].height, activeRule.value, activeRule.startBlock);
       
       if (updatedBets.some(b => b.targetHeight === nextHeight && b.ruleId === activeRule.id)) return;

       const ruleBlocks = allBlocks.filter(b => checkRuleAlignment(b.height, activeRule));
       
       let type: BetType = 'PARITY';
       let target: BetTarget = 'ODD';
       let shouldBet = false;
       
       if (strategyConfig.autoTarget.includes('FIXED')) {
          shouldBet = true;
          const t = strategyConfig.autoTarget.split('_')[1] as BetTarget;
          target = t;
          type = (t === 'ODD' || t === 'EVEN') ? 'PARITY' : 'SIZE';
       } else if (ruleBlocks.length > 0) {
          const streakP = calculateStreak(ruleBlocks, 'PARITY');
          
          if (strategyConfig.autoTarget === 'FOLLOW_LAST') {
             if (streakP.count >= strategyConfig.minStreak) {
                target = streakP.val as BetTarget;
                shouldBet = true;
             }
          } else if (strategyConfig.autoTarget === 'REVERSE_LAST') {
             if (streakP.count >= strategyConfig.minStreak) {
                target = streakP.val === 'ODD' ? 'EVEN' : 'ODD';
                shouldBet = true;
             }
          }
       }

       if (shouldBet) {
          // CRITICAL: Use the locally calculated nextBetAmount, not the state value which might be stale
          placeBet(nextHeight, type, target, Math.floor(nextBetAmount), true, currentBalance);
       }
    }

  }, [allBlocks, activeRule, isAutoRunning, config, strategyConfig, placeBet, strategyState.currentBetAmount, calculateStreak, checkRuleAlignment]);


  // Stats
  const stats = useMemo(() => {
    const wins = settledBets.filter(b => b.status === 'WIN').length;
    const total = settledBets.length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const profit = balance - config.initialBalance;
    const profitPercent = (profit / config.initialBalance) * 100;
    return { wins, total, winRate, profit, profitPercent };
  }, [settledBets, balance, config.initialBalance]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500 pb-20">
      
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
         </div>
         <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
            <span className="text-xs font-black text-gray-400 uppercase tracking-wider">胜率概览</span>
            <div className="flex items-end space-x-2 mt-2">
               <span className="text-3xl font-black text-blue-600">{stats.winRate.toFixed(1)}%</span>
               <span className="text-xs text-gray-400 font-bold mb-1.5">{stats.wins}/{stats.total}</span>
            </div>
            <div className="w-full bg-gray-100 h-1.5 rounded-full mt-3 overflow-hidden">
               <div className="bg-blue-600 h-full rounded-full transition-all duration-500" style={{ width: `${stats.winRate}%` }}></div>
            </div>
         </div>
         <div className="md:col-span-2 bg-white rounded-3xl p-4 shadow-sm border border-gray-100 flex flex-col relative">
            <span className="absolute top-4 left-4 text-[10px] font-black text-gray-400 uppercase tracking-wider z-10">盈亏曲线</span>
            <div className="flex-1 pt-4 min-h-[80px]">
               <BalanceChart data={balanceHistory} width={400} height={80} />
            </div>
         </div>
      </div>

      {/* 2. MAIN LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT: SETTINGS */}
        <div className="space-y-6">
           <div className="bg-white rounded-[2rem] p-6 shadow-xl border border-indigo-50">
              <div className="flex justify-between items-center mb-6">
                 <div className="flex items-center space-x-2">
                    <Settings2 className="w-5 h-5 text-indigo-600" />
                    <h3 className="font-black text-gray-900">参数配置</h3>
                 </div>
                 <button onClick={() => setShowConfig(!showConfig)} className="text-xs font-bold text-gray-400 hover:text-indigo-600 flex items-center">
                    {showConfig ? '收起' : '展开'} {showConfig ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                 </button>
              </div>

              {/* General Config */}
              {showConfig && (
                <div className="grid grid-cols-2 gap-3 mb-6 animate-in slide-in-from-top-2">
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
              )}

              {/* Strategy Form */}
              <div className="space-y-4">
                 <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100/50">
                    <label className="text-[10px] font-black text-gray-400 uppercase block mb-2">选择下注规则</label>
                    <select 
                      value={activeRuleId} 
                      onChange={e => setActiveRuleId(e.target.value)}
                      className="w-full bg-white text-indigo-900 rounded-xl px-3 py-2 text-xs font-black border border-indigo-100 outline-none cursor-pointer shadow-sm"
                    >
                       {rules.map(r => (
                         <option key={r.id} value={r.id}>{r.label} (步长: {r.value})</option>
                       ))}
                    </select>
                 </div>

                 <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase ml-1">资金策略</label>
                    <select 
                      value={strategyConfig.type} 
                      onChange={e => setStrategyConfig({...strategyConfig, type: e.target.value as StrategyType})}
                      className="w-full bg-gray-50 text-gray-800 rounded-xl px-3 py-2.5 text-xs font-black border border-transparent focus:border-indigo-500 outline-none mt-1"
                    >
                       <option value="FLAT">平注 (Flat)</option>
                       <option value="MARTINGALE">马丁格尔 (倍投)</option>
                       <option value="DALEMBERT">达朗贝尔 (升降)</option>
                       <option value="FIBONACCI">斐波那契 (数列)</option>
                       <option value="PAROLI">帕罗利 (反倍投/胜进)</option>
                       <option value="1326">1-3-2-6 法则</option>
                    </select>
                 </div>
                 
                 {strategyConfig.type === 'MARTINGALE' && (
                    <div className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-xl">
                       <span className="text-[10px] font-bold text-gray-500">倍投系数</span>
                       <input type="number" step="0.1" value={strategyConfig.multiplier} onChange={e => setStrategyConfig({...strategyConfig, multiplier: parseFloat(e.target.value)})} className="w-16 text-center bg-white rounded-lg text-xs font-black" />
                    </div>
                 )}
                 {strategyConfig.type === 'DALEMBERT' && (
                    <div className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-xl">
                       <span className="text-[10px] font-bold text-gray-500">升降步长</span>
                       <input type="number" value={strategyConfig.step} onChange={e => setStrategyConfig({...strategyConfig, step: parseFloat(e.target.value)})} className="w-16 text-center bg-white rounded-lg text-xs font-black" />
                    </div>
                 )}
                 {/* Descriptions for new strategies */}
                 {strategyConfig.type === 'FIBONACCI' && (
                    <div className="bg-amber-50 px-3 py-2 rounded-xl text-[10px] text-amber-700 font-medium">
                       输则进1 (1,1,2,3,5...)，赢则退2。适合抗震荡。
                    </div>
                 )}
                 {strategyConfig.type === 'PAROLI' && (
                    <div className="bg-emerald-50 px-3 py-2 rounded-xl text-[10px] text-emerald-700 font-medium">
                       赢则翻倍，3连胜或输则重置。以小博大。
                    </div>
                 )}
                 {strategyConfig.type === '1326' && (
                    <div className="bg-blue-50 px-3 py-2 rounded-xl text-[10px] text-blue-700 font-medium">
                       赢则按 1-3-2-6 比例下注，输则重置。均衡策略。
                    </div>
                 )}


                 <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase ml-1">自动目标</label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                       <button onClick={() => setStrategyConfig({...strategyConfig, autoTarget: 'FIXED_ODD'})} className={`py-2 rounded-lg text-[10px] font-bold border ${strategyConfig.autoTarget === 'FIXED_ODD' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-400 border-gray-200'}`}>定买单</button>
                       <button onClick={() => setStrategyConfig({...strategyConfig, autoTarget: 'FIXED_EVEN'})} className={`py-2 rounded-lg text-[10px] font-bold border ${strategyConfig.autoTarget === 'FIXED_EVEN' ? 'bg-teal-500 text-white border-teal-500' : 'bg-white text-gray-400 border-gray-200'}`}>定买双</button>
                       <button onClick={() => setStrategyConfig({...strategyConfig, autoTarget: 'FOLLOW_LAST'})} className={`py-2 rounded-lg text-[10px] font-bold border ${strategyConfig.autoTarget === 'FOLLOW_LAST' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-400 border-gray-200'}`}>跟上期(顺)</button>
                       <button onClick={() => setStrategyConfig({...strategyConfig, autoTarget: 'REVERSE_LAST'})} className={`py-2 rounded-lg text-[10px] font-bold border ${strategyConfig.autoTarget === 'REVERSE_LAST' ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-gray-400 border-gray-200'}`}>反上期(砍)</button>
                    </div>
                 </div>

                 {(strategyConfig.autoTarget === 'FOLLOW_LAST' || strategyConfig.autoTarget === 'REVERSE_LAST') && (
                    <div className="flex items-center justify-between bg-amber-50 px-3 py-2 rounded-xl border border-amber-100 animate-in fade-in">
                       <div className="flex items-center space-x-2">
                          <AlertTriangle className="w-3 h-3 text-amber-500" />
                          <span className="text-[10px] font-bold text-amber-700">起投连数</span>
                       </div>
                       <input 
                         type="number" min="1" 
                         value={strategyConfig.minStreak} 
                         onChange={e => setStrategyConfig({...strategyConfig, minStreak: Math.max(1, parseInt(e.target.value) || 1)})} 
                         className="w-16 text-center bg-white rounded-lg text-xs font-black border border-amber-200 text-amber-600" 
                       />
                    </div>
                 )}

                 <div className="pt-4 border-t border-gray-100 mt-2">
                    <div className="flex items-center justify-between mb-3">
                       <span className="text-xs font-bold text-gray-500">基础注额</span>
                       <input type="number" value={config.baseBet} onChange={(e) => setConfig({...config, baseBet: parseFloat(e.target.value)})} className="w-20 text-right bg-gray-50 px-2 py-1 rounded-lg text-xs font-black" />
                    </div>
                    <button 
                      onClick={() => setIsAutoRunning(!isAutoRunning)}
                      className={`w-full py-3.5 rounded-xl font-black text-sm flex items-center justify-center transition-all shadow-lg active:scale-95 ${
                        isAutoRunning ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {isAutoRunning ? <><StopCircle className="w-4 h-4 mr-2" /> 停止托管</> : <><PlayCircle className="w-4 h-4 mr-2" /> 启动托管</>}
                    </button>
                    {isAutoRunning && <p className="text-[10px] text-center text-indigo-400 font-bold mt-2 animate-pulse">策略运行中 - 正在监控区块...</p>}
                 </div>
              </div>
           </div>
        </div>

        {/* CENTER: MANUAL BETTING */}
        <div className="lg:col-span-2 space-y-6">
           <div className={`bg-white rounded-[2rem] p-8 shadow-xl border transition-colors relative ${isAutoRunning ? 'border-indigo-200 bg-indigo-50/10' : 'border-gray-100'}`}>
              {isAutoRunning && (
                 <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center rounded-[2rem]">
                    <div className="bg-white px-5 py-2.5 rounded-full shadow-xl border border-indigo-100 flex items-center text-indigo-600 font-black text-xs">
                       <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" /> 自动托管中，手动面板已锁定
                    </div>
                 </div>
              )}
              
              <div className="flex justify-between items-center mb-6">
                 <h3 className="text-lg font-black text-gray-900 flex items-center">
                    <Gamepad2 className="w-5 h-5 mr-2 text-amber-500" /> 手动下注
                 </h3>
                 <div className="text-xs font-bold text-gray-400 bg-gray-100 px-3 py-1 rounded-lg">
                    {activeRule.label} 下期: #{allBlocks.length > 0 ? getNextTargetHeight(allBlocks[0].height, activeRule.value, activeRule.startBlock) : '---'}
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <div className="flex gap-2">
                       <button onClick={() => placeBet(getNextTargetHeight(allBlocks[0].height, activeRule.value, activeRule.startBlock), 'PARITY', 'ODD', config.baseBet, false, balance)} className="flex-1 py-3 bg-red-500 text-white rounded-xl font-black text-lg shadow-md hover:bg-red-600 active:scale-95 transition-all">单</button>
                       <button onClick={() => placeBet(getNextTargetHeight(allBlocks[0].height, activeRule.value, activeRule.startBlock), 'PARITY', 'EVEN', config.baseBet, false, balance)} className="flex-1 py-3 bg-teal-500 text-white rounded-xl font-black text-lg shadow-md hover:bg-teal-600 active:scale-95 transition-all">双</button>
                    </div>
                 </div>
                 <div className="space-y-2">
                    <div className="flex gap-2">
                       <button onClick={() => placeBet(getNextTargetHeight(allBlocks[0].height, activeRule.value, activeRule.startBlock), 'SIZE', 'BIG', config.baseBet, false, balance)} className="flex-1 py-3 bg-orange-500 text-white rounded-xl font-black text-lg shadow-md hover:bg-orange-600 active:scale-95 transition-all">大</button>
                       <button onClick={() => placeBet(getNextTargetHeight(allBlocks[0].height, activeRule.value, activeRule.startBlock), 'SIZE', 'SMALL', config.baseBet, false, balance)} className="flex-1 py-3 bg-indigo-500 text-white rounded-xl font-black text-lg shadow-md hover:bg-indigo-600 active:scale-95 transition-all">小</button>
                    </div>
                 </div>
              </div>
              <div className="flex justify-center gap-2 mt-5">
                 {[10, 50, 100, 500, 1000].map(amt => (
                    <button key={amt} onClick={() => setConfig({...config, baseBet: amt})} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${config.baseBet === amt ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{amt}</button>
                 ))}
              </div>
           </div>

           {pendingBets.length > 0 && (
              <div className="space-y-3">
                 <div className="flex items-center space-x-2 text-xs font-black text-gray-400 uppercase px-2">
                    <Clock className="w-3.5 h-3.5" /> <span>进行中</span>
                 </div>
                 {pendingBets.map(bet => (
                    <div key={bet.id} className="bg-white p-4 rounded-2xl border border-indigo-100 shadow-sm flex justify-between items-center relative overflow-hidden">
                       <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400 animate-pulse"></div>
                       <div className="flex items-center space-x-3 pl-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-black ${bet.strategyLabel !== 'MANUAL' ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-500'}`}>
                             {STRATEGY_LABELS[bet.strategyLabel || 'MANUAL'] || bet.strategyLabel}
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

      {/* 3. HISTORY */}
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
                     <th className="pb-2">策略</th>
                     <th className="pb-2">下注</th>
                     <th className="pb-2">结果</th>
                     <th className="pb-2">盈亏</th>
                     <th className="pb-2 pr-2 text-right">余额</th>
                  </tr>
               </thead>
               <tbody className="text-xs font-medium text-gray-600">
                  {settledBets.length === 0 ? (
                     <tr><td colSpan={6} className="py-8 text-center text-gray-300 font-bold">暂无记录</td></tr>
                  ) : (
                     settledBets.slice(0, 30).map(bet => (
                        <tr key={bet.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                           <td className="py-3 pl-2">
                              <span className="font-black text-gray-800 block">#{bet.targetHeight}</span>
                              <span className="text-[9px] text-gray-400">{bet.ruleName}</span>
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
