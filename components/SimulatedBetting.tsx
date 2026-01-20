
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { BlockData, IntervalRule } from '../types';
import { 
  Gamepad2, Wallet, TrendingUp, History, CheckCircle2, XCircle, 
  Trash2, Clock, Settings2, PlayCircle, StopCircle, RefreshCw, 
  ChevronDown, ChevronUp, AlertTriangle, Target, ArrowRight, Percent, BarChart4,
  Plus, Layers, Activity, PauseCircle, Power
} from 'lucide-react';

interface SimulatedBettingProps {
  allBlocks: BlockData[];
  rules: IntervalRule[];
}

// ---------------------- TYPES ----------------------

type BetType = 'PARITY' | 'SIZE';
type BetTarget = 'ODD' | 'EVEN' | 'BIG' | 'SMALL';
type StrategyType = 'MANUAL' | 'MARTINGALE' | 'DALEMBERT' | 'FLAT' | 'FIBONACCI' | 'PAROLI' | '1326' | 'CUSTOM';
type AutoTargetMode = 'FIXED_ODD' | 'FIXED_EVEN' | 'FIXED_BIG' | 'FIXED_SMALL' | 'FOLLOW_LAST' | 'REVERSE_LAST';

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
  };
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
  'CUSTOM': '自定义倍投'
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

  // 2. MULTI-TASK STATE
  const [tasks, setTasks] = useState<AutoTask[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('sim_v3_tasks');
      return saved ? JSON.parse(saved) : [];
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
      customSequence: [1, 2, 4, 8, 17] // Default custom sequence
  });
  const [customSeqText, setCustomSeqText] = useState('1, 2, 4, 8, 17');

  const [activeManualRuleId, setActiveManualRuleId] = useState<string>(rules[0]?.id || '');
  const [showConfig, setShowConfig] = useState(true);

  // Derived Values
  const manualRule = useMemo(() => rules.find(r => r.id === activeManualRuleId) || rules[0], [rules, activeManualRuleId]);
  const balanceHistory = useMemo(() => [config.initialBalance, ...bets.filter(b => b.status !== 'PENDING').slice().reverse().map(b => b.balanceAfter)], [config.initialBalance, bets]);
  const pendingBets = useMemo(() => bets.filter(b => b.status === 'PENDING'), [bets]);
  const settledBets = useMemo(() => bets.filter(b => b.status !== 'PENDING'), [bets]);

  // Persist Data
  useEffect(() => {
    localStorage.setItem('sim_v3_balance', balance.toString());
    localStorage.setItem('sim_v3_bets', JSON.stringify(bets));
    localStorage.setItem('sim_v3_config', JSON.stringify(config));
    localStorage.setItem('sim_v3_tasks', JSON.stringify(tasks));
  }, [balance, bets, config, tasks]);

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
      stats: { wins: 0, losses: 0, profit: 0 }
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
    
    // 2. Clear Storage immediately
    localStorage.setItem('sim_v3_balance', defaults.initialBalance.toString());
    localStorage.setItem('sim_v3_bets', '[]');
    localStorage.setItem('sim_v3_tasks', '[]');
    localStorage.setItem('sim_v3_config', JSON.stringify(defaults));
  }, []);

  // --- THE MULTI-THREAD ENGINE ---
  useEffect(() => {
    if (allBlocks.length === 0) return;

    // We need to handle updates in a single pass to avoid race conditions with balance/bets
    let currentBalance = balance;
    let betsChanged = false;
    let tasksChanged = false;
    
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
          if (isWin) currentBalance += payout;
          
          // Identify which task owns this bet and update its state
          if (bet.taskId) {
            const taskIndex = nextTasks.findIndex(t => t.id === bet.taskId);
            if (taskIndex !== -1) {
              tasksChanged = true;
              const task = nextTasks[taskIndex];
              
              // Update Stats
              task.stats.wins += isWin ? 1 : 0;
              task.stats.losses += isWin ? 0 : 1;
              task.stats.profit += (isWin ? payout : 0) - bet.amount;

              // Update Strategy State (Martingale, etc.)
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
        if (currentBalance < task.state.currentBetAmount) {
          task.isActive = false; // Stop if bankrupt
          tasksChanged = true;
          return;
        }

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

        if (task.config.autoTarget.includes('FIXED')) {
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
           const amount = Math.floor(task.state.currentBetAmount);
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

  }, [allBlocks, rules, tasks, bets, config, checkRuleAlignment, calculateStreak, balance]);

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
         <div className="md:col-span-2 bg-white rounded-3xl p-4 shadow-sm border border-gray-100 flex flex-col relative">
            <span className="absolute top-4 left-4 text-[10px] font-black text-gray-400 uppercase tracking-wider z-10">总盈亏曲线</span>
            <div className="flex-1 pt-4 min-h-[80px]">
               <BalanceChart data={balanceHistory} width={400} height={80} />
            </div>
         </div>
      </div>

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

                   {/* Rule Selector */}
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
                   {/* Custom Sequence Input */}
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

                   {/* Target Mode */}
                   <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase ml-1">自动目标</label>
                      <div className="grid grid-cols-2 gap-2 mt-1">
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'FIXED_ODD'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'FIXED_ODD' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-400 border-gray-200'}`}>定买单</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'FIXED_EVEN'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'FIXED_EVEN' ? 'bg-teal-500 text-white border-teal-500' : 'bg-white text-gray-400 border-gray-200'}`}>定买双</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'FIXED_BIG'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'FIXED_BIG' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-400 border-gray-200'}`}>定买大</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'FIXED_SMALL'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'FIXED_SMALL' ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-gray-400 border-gray-200'}`}>定买小</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'FOLLOW_LAST'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'FOLLOW_LAST' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-400 border-gray-200'}`}>跟上期(顺)</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'REVERSE_LAST'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'REVERSE_LAST' ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-gray-400 border-gray-200'}`}>反上期(砍)</button>
                      </div>
                   </div>

                   {(draftConfig.autoTarget === 'FOLLOW_LAST' || draftConfig.autoTarget === 'REVERSE_LAST') && (
                      <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
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
                     return (
                       <div key={task.id} className={`rounded-2xl p-5 border-2 transition-all relative overflow-hidden ${task.isActive ? 'bg-white border-indigo-500 shadow-md' : 'bg-gray-50 border-gray-200 grayscale-[0.5]'}`}>
                          <div className="flex justify-between items-start mb-3">
                             <div>
                                <h4 className="font-black text-sm text-gray-900 truncate max-w-[150px]">{task.name}</h4>
                                <div className="flex items-center space-x-2 mt-1">
                                   <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded font-bold">{rule?.label}</span>
                                   <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded font-bold">{STRATEGY_LABELS[task.config.type]}</span>
                                </div>
                             </div>
                             <button onClick={() => toggleTask(task.id)} className={`p-2 rounded-full transition-colors ${task.isActive ? 'text-red-500 hover:bg-red-50' : 'text-green-500 hover:bg-green-50'}`}>
                                {task.isActive ? <PauseCircle className="w-6 h-6" /> : <PlayCircle className="w-6 h-6" />}
                             </button>
                          </div>
                          
                          <div className="grid grid-cols-3 gap-2 mb-4 bg-gray-50/50 p-2 rounded-xl">
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
