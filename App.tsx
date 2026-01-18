
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, RotateCcw, Settings, X, Loader2, ShieldCheck, AlertCircle, BarChart3, PieChart, Plus, Trash2, Edit3, Grid3X3, LayoutDashboard, Palette, Flame, Layers, SortAsc, SortDesc, CheckSquare, Square, Filter, ChevronRight, ChevronLeft, BrainCircuit, Activity, Gamepad2 } from 'lucide-react';
import { BlockData, IntervalRule, FollowedPattern } from './types';
import { fetchLatestBlock, fetchBlockByNum, transformTronBlock } from './utils/helpers';
import TrendChart from './components/TrendChart';
import BeadRoad from './components/BeadRoad';
import DataTable from './components/DataTable';
import DragonList from './components/DragonList';
import AIPrediction from './components/AIPrediction';
import SimulatedBetting from './components/SimulatedBetting';

type TabType = 'dashboard' | 'parity-trend' | 'size-trend' | 'parity-bead' | 'size-bead' | 'dragon-list' | 'ai-prediction' | 'simulated-betting';

interface ThemeColors {
  odd: string;
  even: string;
  big: string;
  small: string;
}

const DEFAULT_COLORS: ThemeColors = {
  odd: '#ef4444',   // red-500
  even: '#14b8a6',  // teal-500
  big: '#f97316',   // orange-500
  small: '#6366f1', // indigo-500
};

const DEFAULT_RULES: IntervalRule[] = [
  { id: '1', label: '单区块', value: 1, startBlock: 0, trendRows: 6, beadRows: 6, dragonThreshold: 3 },
  { id: '20', label: '20区块', value: 20, startBlock: 0, trendRows: 6, beadRows: 6, dragonThreshold: 3 },
  { id: '60', label: '60区块', value: 60, startBlock: 0, trendRows: 6, beadRows: 6, dragonThreshold: 3 },
  { id: '100', label: '100区块', value: 100, startBlock: 0, trendRows: 6, beadRows: 6, dragonThreshold: 3 },
];

const App: React.FC = () => {
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('tron_api_key') || '');
  const [showSettings, setShowSettings] = useState(() => !localStorage.getItem('tron_api_key'));
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  
  const [themeColors, setThemeColors] = useState<ThemeColors>(() => {
    const saved = localStorage.getItem('theme_colors');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { return DEFAULT_COLORS; }
    }
    return DEFAULT_COLORS;
  });

  const [rules, setRules] = useState<IntervalRule[]>(() => {
    const saved = localStorage.getItem('interval_rules');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.map((r: any) => ({
          ...r,
          trendRows: r.trendRows || r.gridRows || 6,
          beadRows: r.beadRows || r.gridRows || 6,
          dragonThreshold: r.dragonThreshold || 3
        }));
      } catch (e) {
        return DEFAULT_RULES;
      }
    }
    return DEFAULT_RULES;
  });
  const [activeRuleId, setActiveRuleId] = useState<string>(rules[0]?.id || '');

  const [followedPatterns, setFollowedPatterns] = useState<FollowedPattern[]>(() => {
    const saved = localStorage.getItem('followed_patterns');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { return []; }
    }
    return [];
  });
  
  const [ruleSearchQuery, setRuleSearchQuery] = useState('');
  const [switcherSearchQuery, setSwitcherSearchQuery] = useState('');
  const [ruleSortBy, setRuleSortBy] = useState<'value' | 'label'>('value');
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(new Set());
  
  const [editingRule, setEditingRule] = useState<IntervalRule | null>(null);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [allBlocks, setAllBlocks] = useState<BlockData[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const blocksRef = useRef<BlockData[]>([]);
  const isPollingBusy = useRef(false);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--color-odd', themeColors.odd);
    root.style.setProperty('--color-even', themeColors.even);
    root.style.setProperty('--color-big', themeColors.big);
    root.style.setProperty('--color-small', themeColors.small);
    localStorage.setItem('theme_colors', JSON.stringify(themeColors));
  }, [themeColors]);

  useEffect(() => {
    blocksRef.current = allBlocks;
    localStorage.setItem('interval_rules', JSON.stringify(rules));
  }, [allBlocks, rules]);

  useEffect(() => {
    localStorage.setItem('followed_patterns', JSON.stringify(followedPatterns));
  }, [followedPatterns]);

  const activeRule = useMemo(() => 
    rules.find(r => r.id === activeRuleId) || rules[0]
  , [rules, activeRuleId]);

  const checkAlignment = (height: number, rule: IntervalRule) => {
    if (!rule) return false;
    if (rule.value <= 1) return true;
    if (rule.startBlock > 0) {
      return height >= rule.startBlock && (height - rule.startBlock) % rule.value === 0;
    }
    return height % rule.value === 0;
  };

  const ruleFilteredBlocks = useMemo(() => {
    if (!activeRule) return [];
    return allBlocks.filter(b => checkAlignment(b.height, activeRule));
  }, [allBlocks, activeRule]);

  const displayBlocks = useMemo(() => {
    if (searchQuery) {
      return ruleFilteredBlocks.filter(b => 
        b.height.toString().includes(searchQuery) || 
        b.hash.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    return ruleFilteredBlocks;
  }, [ruleFilteredBlocks, searchQuery]);

  const saveApiKey = useCallback((key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return;
    localStorage.setItem('tron_api_key', trimmed);
    setApiKey(trimmed);
    setShowSettings(false);
    setError(null);
    setAllBlocks([]);
  }, []);

  const fillDataForInterval = useCallback(async (rule: IntervalRule) => {
    if (!apiKey || !rule) return;
    setIsLoading(true);
    setError(null);
    try {
      const latestRaw = await fetchLatestBlock(apiKey);
      const latest = transformTronBlock(latestRaw);
      
      let currentHeight = latest.height;
      if (rule.value > 1) {
        if (rule.startBlock > 0) {
          const diff = currentHeight - rule.startBlock;
          currentHeight = rule.startBlock + Math.floor(diff / rule.value) * rule.value;
        } else {
          currentHeight = Math.floor(currentHeight / rule.value) * rule.value;
        }
      }

      const count = 100;
      const targetHeights: number[] = [];
      for (let i = 0; i < count; i++) {
        const h = currentHeight - (i * rule.value);
        if (h > 0 && (rule.startBlock === 0 || h >= rule.startBlock)) {
          targetHeights.push(h);
        }
      }

      const results: BlockData[] = [];
      for (const num of targetHeights) {
        try {
          const b = await fetchBlockByNum(num, apiKey);
          results.push(b);
        } catch (e) {
          console.error(`Fetch error:`, e);
        }
      }

      setAllBlocks(prev => {
        const combined = [...results, ...prev];
        const uniqueMap = new Map();
        for (const b of combined) {
          if (!uniqueMap.has(b.height)) uniqueMap.set(b.height, b);
        }
        return Array.from(uniqueMap.values())
          .sort((a, b) => b.height - a.height)
          .slice(0, 3000);
      });
    } catch (err: any) {
      setError("数据同步异常，请检查 TronGrid API Key。");
    } finally {
      setIsLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    if (apiKey && activeRule && ruleFilteredBlocks.length < 50 && !isLoading) {
      fillDataForInterval(activeRule);
    }
  }, [activeRuleId, apiKey, fillDataForInterval, ruleFilteredBlocks.length, activeRule]);

  // High Frequency Polling Logic - 1000ms
  useEffect(() => {
    if (!apiKey || isLoading) return;

    const poll = async () => {
      if (isPollingBusy.current) return;
      isPollingBusy.current = true;
      try {
        const latestRaw = await fetchLatestBlock(apiKey);
        const latest = transformTronBlock(latestRaw);
        const currentTopHeight = blocksRef.current[0]?.height || 0;
        
        if (latest.height > currentTopHeight) {
          setIsSyncing(true);
          const newBlocks: BlockData[] = [];
          for (let h = currentTopHeight + 1; h <= latest.height; h++) {
            try {
              const b = await fetchBlockByNum(h, apiKey);
              newBlocks.push(b);
            } catch (e) {}
          }
          if (newBlocks.length > 0) {
            setAllBlocks(prev => {
              const combined = [...newBlocks, ...prev];
              const uniqueMap = new Map();
              for (const b of combined) {
                if (!uniqueMap.has(b.height)) uniqueMap.set(b.height, b);
              }
              return Array.from(uniqueMap.values())
                .sort((a, b) => b.height - a.height)
                .slice(0, 3000); 
            });
          }
          setIsSyncing(false);
        }
      } catch (e) {
        console.error("Polling error:", e);
      } finally {
        isPollingBusy.current = false;
      }
    };

    const pollingId = window.setInterval(poll, 1000);

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        poll(); 
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(pollingId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [apiKey, isLoading]);

  const handleSaveRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRule) return;
    if (rules.find(r => r.id === editingRule.id)) {
      setRules(prev => prev.map(r => r.id === editingRule.id ? editingRule : r));
    } else {
      setRules(prev => [...prev, editingRule]);
    }
    setEditingRule(null);
  };

  const deleteRule = (id: string) => {
    if (rules.length <= 1) return;
    setRules(prev => {
      const filtered = prev.filter(r => r.id !== id);
      if (activeRuleId === id) setActiveRuleId(filtered[0]?.id || '');
      return filtered;
    });
  };

  const deleteSelectedRules = () => {
    if (selectedRuleIds.size === 0) return;
    if (selectedRuleIds.size >= rules.length) {
      alert('至少保留一条采样规则');
      return;
    }
    const confirmed = window.confirm(`确定删除选中的 ${selectedRuleIds.size} 条规则吗？`);
    if (!confirmed) return;

    setRules(prev => {
      const filtered = prev.filter(r => !selectedRuleIds.has(r.id));
      if (selectedRuleIds.has(activeRuleId)) setActiveRuleId(filtered[0]?.id || '');
      return filtered;
    });
    setSelectedRuleIds(new Set());
  };

  const toggleRuleSelection = (id: string) => {
    setSelectedRuleIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllRules = (filteredRules: IntervalRule[]) => {
    if (selectedRuleIds.size === filteredRules.length) {
      setSelectedRuleIds(new Set());
    } else {
      setSelectedRuleIds(new Set(filteredRules.map(r => r.id)));
    }
  };

  const batchUpdateDragonThreshold = (val: number) => {
    setRules(prev => prev.map(r => ({ ...r, dragonThreshold: val })));
    alert(`已将所有规则的长龙提醒阈值批量设置为: ${val}连`);
  };

  const handleBatchRuleSave = () => {
    try {
      const lines = batchText.trim().split('\n');
      const newRules: IntervalRule[] = lines.map((line, idx) => {
        const parts = line.split(',').map(s => s.trim());
        const label = parts[0] || '未命名';
        const value = parseInt(parts[1]) || 1;
        const start = parseInt(parts[2]) || 0;
        const trend = parseInt(parts[3]) || 6;
        const bead = parseInt(parts[4]) || 6;
        const dragon = parseInt(parts[5]) || 3;
        
        return {
          id: `rule-${Date.now()}-${idx}`,
          label,
          value,
          startBlock: start,
          trendRows: trend,
          beadRows: bead,
          dragonThreshold: dragon
        };
      });
      if (newRules.length > 0) {
        setRules(newRules);
        setActiveRuleId(newRules[0].id);
        setShowBatchModal(false);
        alert('批量导入规则成功！');
      }
    } catch (e) {
      alert('解析失败，请检查格式：名称,步长,偏移,走势行,珠盘行,龙阈值 (逗号分隔)');
    }
  };

  const filteredAndSortedRules = useMemo(() => {
    let result = rules.filter(r => 
      r.label.toLowerCase().includes(ruleSearchQuery.toLowerCase()) || 
      r.value.toString().includes(ruleSearchQuery)
    );

    result.sort((a, b) => {
      if (ruleSortBy === 'value') return a.value - b.value;
      return a.label.localeCompare(b.label);
    });

    return result;
  }, [rules, ruleSearchQuery, ruleSortBy]);

  const switcherFilteredRules = useMemo(() => {
    if (!switcherSearchQuery) return rules.sort((a,b) => a.value - b.value);
    return rules.filter(r => 
      r.label.toLowerCase().includes(switcherSearchQuery.toLowerCase()) || 
      r.value.toString().includes(switcherSearchQuery)
    ).sort((a,b) => a.value - b.value);
  }, [rules, switcherSearchQuery]);

  const toggleFollow = useCallback((pattern: FollowedPattern) => {
    setFollowedPatterns(prev => {
      const exists = prev.find(p => 
        p.ruleId === pattern.ruleId && 
        p.type === pattern.type && 
        p.mode === pattern.mode && 
        p.rowId === pattern.rowId
      );
      if (exists) {
        return prev.filter(p => 
          !(p.ruleId === pattern.ruleId && 
            p.type === pattern.type && 
            p.mode === pattern.mode && 
            p.rowId === pattern.rowId)
        );
      }
      return [...prev, pattern];
    });
  }, []);

  const handleJumpToChart = useCallback((ruleId: string, type: 'parity' | 'size', mode: 'trend' | 'bead') => {
    setActiveRuleId(ruleId);
    if (mode === 'bead') {
      setActiveTab(type === 'parity' ? 'parity-bead' : 'size-bead');
    } else {
      setActiveTab(type === 'parity' ? 'parity-trend' : 'size-trend');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const TABS = [
    { id: 'dashboard', label: '综合盘面', icon: LayoutDashboard, color: 'text-blue-500' },
    { id: 'parity-trend', label: '单双走势', icon: BarChart3, color: 'text-red-500' },
    { id: 'size-trend', label: '大小走势', icon: PieChart, color: 'text-indigo-500' },
    { id: 'parity-bead', label: '单双珠盘', icon: Grid3X3, color: 'text-teal-500' },
    { id: 'size-bead', label: '大小珠盘', icon: Grid3X3, color: 'text-orange-500' },
    { id: 'dragon-list', label: '长龙提醒', icon: Flame, color: 'text-amber-500' },
    { id: 'ai-prediction', label: 'AI 数据预测', icon: BrainCircuit, color: 'text-purple-600' },
    { id: 'simulated-betting', label: '模拟下注', icon: Gamepad2, color: 'text-pink-500' },
  ] as const;

  const handleColorChange = (key: keyof ThemeColors, value: string) => {
    setThemeColors(prev => ({ ...prev, [key]: value }));
  };

  const resetColors = () => {
    setThemeColors(DEFAULT_COLORS);
  };

  return (
    <div className="max-w-[1600px] mx-auto p-4 md:p-6 pb-24 min-h-screen antialiased">
      <header className="mb-6 flex flex-col items-center">
        <div className="w-full flex justify-between items-center mb-6">
          <div className="w-10"></div>
          <h1 className="text-2xl md:text-4xl font-black text-blue-600 tracking-tight text-center">
            Tron哈希走势图
          </h1>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-3 bg-white shadow-sm border border-gray-100 hover:bg-gray-50 rounded-2xl transition-all text-gray-500 active:scale-95"
          >
            <Settings className="w-6 h-6" />
          </button>
        </div>
        
        <p className="bg-white px-5 py-2 rounded-full shadow-sm border border-gray-50 text-gray-400 text-[10px] font-black items-center flex uppercase tracking-widest">
          <ShieldCheck className="w-3.5 h-3.5 mr-2 text-green-500" />
          波场主网实时监听中 (高速同步模式)
        </p>
      </header>

      {/* Main Tab Navigation */}
      <div className="flex justify-center mb-8 sticky top-4 z-[40]">
        <div className="inline-flex bg-white/80 backdrop-blur-md p-1.5 rounded-2xl shadow-xl border border-white/50 w-full max-w-5xl overflow-x-auto no-scrollbar">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex-1 flex items-center justify-center space-x-2 py-3 px-4 rounded-xl text-xs md:text-sm font-black transition-all duration-300 whitespace-nowrap ${
                  isActive ? 'bg-blue-600 text-white shadow-lg scale-105' : 'text-gray-400 hover:bg-gray-50'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : tab.color}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Horizontal Rule Navigator with Quick Switcher */}
      <div className="relative group max-w-6xl mx-auto mb-10 px-12">
        <button 
          onClick={() => setShowQuickSwitcher(true)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-2.5 bg-white border border-gray-100 rounded-xl shadow-lg text-blue-600 hover:bg-blue-50 transition-all active:scale-90"
          title="全量搜索切换器"
        >
          <Grid3X3 className="w-5 h-5" />
        </button>

        <div className="relative flex items-center overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-gray-50 to-transparent pointer-events-none z-[5]"></div>
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-gray-50 to-transparent pointer-events-none z-[5]"></div>
          
          <div 
            ref={navRef}
            className="flex items-center space-x-2 w-full overflow-x-auto no-scrollbar py-2 scroll-smooth"
          >
            {rules.map((rule) => (
              <button
                key={rule.id}
                onClick={() => setActiveRuleId(rule.id)}
                className={`px-4 py-2.5 rounded-xl text-[11px] font-black transition-all duration-300 border-2 shrink-0 ${
                  activeRuleId === rule.id
                    ? 'bg-blue-600 text-white border-blue-600 shadow-md scale-105'
                    : 'bg-white text-gray-400 border-transparent hover:border-blue-100 hover:text-blue-500'
                }`}
              >
                {rule.label}
              </button>
            ))}
            <button 
              onClick={() => setEditingRule({ id: Date.now().toString(), label: '新规则', value: 10, startBlock: 0, trendRows: 6, beadRows: 6, dragonThreshold: 3 })}
              className="px-4 py-2.5 rounded-xl text-[11px] font-black bg-gray-100 text-gray-400 border-2 border-dashed border-gray-200 hover:bg-white hover:text-blue-500 transition-all shrink-0"
            >
              +
            </button>
          </div>
        </div>

        <button 
          onClick={() => navRef.current?.scrollBy({ left: -250, behavior: 'smooth' })}
          className="absolute -left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-white border rounded-full hidden md:block"
        >
          <ChevronLeft className="w-4 h-4 text-gray-400" />
        </button>
        <button 
          onClick={() => navRef.current?.scrollBy({ left: 250, behavior: 'smooth' })}
          className="absolute -right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-white border rounded-full hidden md:block"
        >
          <ChevronRight className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {/* Main View Area */}
      <div className="mb-12">
        {activeTab === 'dashboard' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12 animate-in fade-in zoom-in-95 duration-500">
            {/* dashboard modules */}
            <div className="h-fit p-1 bg-slate-100 rounded-3xl shadow-inner border border-slate-200">
              <TrendChart 
                key={`parity-trend-dashboard-${activeRuleId}`}
                blocks={ruleFilteredBlocks} mode="parity" title="单双走势" rows={activeRule?.trendRows || 6} />
            </div>
            <div className="h-fit p-1 bg-slate-100 rounded-3xl shadow-inner border border-slate-200">
              <TrendChart 
                key={`size-trend-dashboard-${activeRuleId}`}
                blocks={ruleFilteredBlocks} mode="size" title="大小走势" rows={activeRule?.trendRows || 6} />
            </div>
            <div className="h-fit p-1 bg-slate-100 rounded-3xl shadow-inner border border-slate-200">
              <BeadRoad 
                key={`parity-bead-dashboard-${activeRuleId}`}
                blocks={ruleFilteredBlocks} mode="parity" rule={activeRule} title="单双珠盘" rows={activeRule?.beadRows || 6} />
            </div>
            <div className="h-fit p-1 bg-slate-100 rounded-3xl shadow-inner border border-slate-200">
              <BeadRoad 
                key={`size-bead-dashboard-${activeRuleId}`}
                blocks={ruleFilteredBlocks} mode="size" rule={activeRule} title="大小珠盘" rows={activeRule?.beadRows || 6} />
            </div>
          </div>
        ) : activeTab === 'dragon-list' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
             <DragonList 
                allBlocks={allBlocks} 
                rules={rules} 
                followedPatterns={followedPatterns} 
                onToggleFollow={toggleFollow}
                onJumpToChart={handleJumpToChart}
             />
          </div>
        ) : activeTab === 'ai-prediction' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
             <AIPrediction allBlocks={allBlocks} rules={rules} />
          </div>
        ) : activeTab === 'simulated-betting' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
             <SimulatedBetting allBlocks={allBlocks} rules={rules} />
          </div>
        ) : (
          <div className="bg-white rounded-[2.5rem] p-6 md:p-10 shadow-xl border border-gray-100 mb-12 animate-in fade-in slide-in-from-bottom-4 duration-500 h-auto">
            <div className="flex items-center space-x-3 mb-8 px-2">
               <div className="p-2 bg-blue-50 rounded-xl">
                 {activeTab.includes('parity') ? <BarChart3 className="w-6 h-6 text-red-500" /> : <PieChart className="w-6 h-6 text-indigo-500" />}
               </div>
               <h2 className="text-xl md:text-2xl font-black text-gray-800">
                {TABS.find(t => t.id === activeTab)?.label} 深度分析
              </h2>
            </div>
            <div className="h-fit">
              {activeTab === 'parity-trend' && <TrendChart key={`parity-trend-full-${activeRuleId}`} blocks={ruleFilteredBlocks} mode="parity" title="单双走势" rows={activeRule?.trendRows || 6} />}
              {activeTab === 'size-trend' && <TrendChart key={`size-trend-full-${activeRuleId}`} blocks={ruleFilteredBlocks} mode="size" title="大小走势" rows={activeRule?.trendRows || 6} />}
              {activeTab === 'parity-bead' && <BeadRoad key={`parity-bead-full-${activeRuleId}`} blocks={ruleFilteredBlocks} mode="parity" rule={activeRule} title="单双珠盘" rows={activeRule?.beadRows || 6} />}
              {activeTab === 'size-bead' && <BeadRoad key={`size-bead-full-${activeRuleId}`} blocks={ruleFilteredBlocks} mode="size" rule={activeRule} title="大小珠盘" rows={activeRule?.beadRows || 6} />}
            </div>
          </div>
        )}

        {/* Global Data Controls & Table (Universal) */}
        <div className="mt-12 space-y-6">
          <div className="flex flex-col md:flex-row items-center gap-4 bg-white p-5 rounded-[2.5rem] border border-gray-100 shadow-sm">
            <div className="flex-1 w-full relative group">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索区块号、哈希值..."
                className="w-full pl-6 pr-14 py-4 rounded-2xl bg-gray-50 border-0 focus:outline-none focus:ring-4 focus:ring-blue-50 transition-all text-sm font-medium"
              />
              <Search className="absolute right-6 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300 group-focus-within:text-blue-400 transition-colors" />
            </div>
            <button 
              onClick={() => {setSearchQuery(''); if(activeRule) fillDataForInterval(activeRule);}} 
              className="w-full md:w-auto flex items-center justify-center px-10 py-4 bg-gray-100 text-gray-500 rounded-2xl border border-gray-200 hover:bg-gray-200 transition-all active:scale-95"
            >
              <RotateCcw className="w-5 h-5 mr-2" />
              <span className="text-xs font-black uppercase">强制刷新</span>
            </button>
          </div>
          <DataTable blocks={displayBlocks} />
        </div>
      </div>

      {/* Quick Switcher Modal */}
      {showQuickSwitcher && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xl animate-in fade-in duration-200">
           <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-4xl p-8 max-h-[85vh] flex flex-col relative animate-in zoom-in-95 duration-200">
              <button 
                onClick={() => setShowQuickSwitcher(false)} 
                className="absolute top-8 right-8 p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="mb-8">
                 <h2 className="text-2xl font-black text-gray-900 flex items-center">
                    <Grid3X3 className="w-6 h-6 mr-3 text-blue-600" />
                    全量采样规则搜索
                    <span className="ml-4 px-3 py-1 bg-blue-50 text-blue-600 text-xs rounded-full">{rules.length} 条</span>
                 </h2>
                 <p className="text-gray-400 text-sm mt-1 font-medium">快速在大量规则中跳转</p>
              </div>

              <div className="relative mb-6">
                 <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300" />
                 <input 
                  autoFocus
                  type="text" 
                  placeholder="搜索规则名称、步长 (如: 120)..."
                  value={switcherSearchQuery}
                  onChange={(e) => setSwitcherSearchQuery(e.target.value)}
                  className="w-full pl-16 pr-8 py-5 bg-gray-50 border-2 border-transparent focus:border-blue-500 rounded-2xl outline-none font-black text-lg transition-all"
                 />
              </div>

              <div className="flex-1 overflow-y-auto no-scrollbar grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 pb-4">
                 {switcherFilteredRules.map(r => (
                   <button 
                    key={r.id}
                    onClick={() => {
                      setActiveRuleId(r.id);
                      setShowQuickSwitcher(false);
                      setSwitcherSearchQuery('');
                    }}
                    className={`p-4 rounded-2xl text-left border-2 transition-all group ${
                      activeRuleId === r.id 
                      ? 'bg-blue-600 border-blue-600 text-white shadow-lg scale-105' 
                      : 'bg-white border-gray-100 hover:border-blue-200 text-gray-700'
                    }`}
                   >
                     <p className={`text-[10px] font-black uppercase mb-1 ${activeRuleId === r.id ? 'text-blue-100' : 'text-gray-400'}`}>
                        步长: {r.value}
                     </p>
                     <p className="text-xs font-black truncate">{r.label}</p>
                   </button>
                 ))}
                 {switcherFilteredRules.length === 0 && (
                   <div className="col-span-full py-20 text-center">
                      <Filter className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                      <p className="text-gray-400 font-black uppercase tracking-widest text-sm">未找到匹配规则</p>
                   </div>
                 )}
              </div>
           </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md overflow-y-auto">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-4xl my-auto p-8 md:p-10 relative animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto no-scrollbar">
            <button onClick={() => setShowSettings(false)} className="absolute top-8 right-8 p-2 hover:bg-gray-100 rounded-full text-gray-400">
              <X className="w-6 h-6" />
            </button>
            <div className="text-center mb-8">
              <h2 className="text-2xl font-black text-gray-900">核心配置</h2>
              <p className="text-gray-500 text-sm mt-2">管理 API、采样与主题配色</p>
            </div>
            <div className="space-y-10">
              <section className="bg-gray-50 p-6 rounded-3xl border border-gray-100">
                <label className="block text-[10px] font-black text-gray-400 uppercase mb-3 tracking-[0.2em] ml-2">TRONGRID API KEY</label>
                <div className="flex gap-4">
                  <input
                    type="text"
                    defaultValue={apiKey}
                    id="api-key-input"
                    className="flex-1 px-6 py-4 rounded-2xl bg-white border-2 border-transparent focus:border-blue-500 outline-none transition-all font-mono text-sm"
                  />
                  <button
                    onClick={() => {
                      const input = document.getElementById('api-key-input') as HTMLInputElement;
                      saveApiKey(input.value);
                    }}
                    className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black text-sm active:scale-95 transition-all"
                  >
                    保存
                  </button>
                </div>
              </section>

              <section className="bg-white p-6 rounded-3xl border border-gray-100">
                <div className="flex justify-between items-center mb-6">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center">
                    <Palette className="w-3 h-3 mr-2" /> 配色方案
                  </label>
                  <button onClick={resetColors} className="text-[10px] font-black text-blue-600 uppercase">恢复默认</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  {[
                    { label: '单 (ODD)', key: 'odd' },
                    { label: '双 (EVEN)', key: 'even' },
                    { label: '大 (BIG)', key: 'big' },
                    { label: '小 (SMALL)', key: 'small' },
                  ].map(({ label, key }) => (
                    <div key={key} className="flex flex-col items-center">
                      <input 
                        type="color" 
                        value={themeColors[key as keyof ThemeColors]} 
                        onChange={(e) => handleColorChange(key as keyof ThemeColors, e.target.value)}
                        className="w-12 h-12 rounded-full border-4 border-white shadow-md cursor-pointer mb-2 overflow-hidden"
                      />
                      <span className="text-[10px] font-black text-gray-500 text-center uppercase">{label}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">采样规则管理 ({rules.length})</label>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                       <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                       <input 
                        type="text" 
                        placeholder="检索规则..."
                        value={ruleSearchQuery}
                        onChange={(e) => setRuleSearchQuery(e.target.value)}
                        className="pl-9 pr-4 py-1.5 bg-gray-50 border border-gray-100 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-100 w-32 md:w-48 transition-all"
                       />
                    </div>
                    <div className="flex border border-gray-100 rounded-lg overflow-hidden bg-gray-50">
                       <button 
                        onClick={() => setRuleSortBy('value')}
                        className={`p-1.5 transition-colors ${ruleSortBy === 'value' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-blue-500'}`}
                        title="按步长排序"
                       >
                         <SortAsc className="w-3.5 h-3.5" />
                       </button>
                       <button 
                        onClick={() => setRuleSortBy('label')}
                        className={`p-1.5 transition-colors ${ruleSortBy === 'label' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-blue-500'}`}
                        title="按名称排序"
                       >
                         <SortDesc className="w-3.5 h-3.5" />
                       </button>
                    </div>
                    <button 
                      onClick={() => {
                        const csv = rules.map(r => `${r.label},${r.value},${r.startBlock},${r.trendRows},${r.beadRows},${r.dragonThreshold}`).join('\n');
                        setBatchText(csv);
                        setShowBatchModal(true);
                      }}
                      className="text-indigo-600 flex items-center text-xs font-black hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Layers className="w-3 h-3 mr-1" /> 批量编辑
                    </button>
                    <button 
                      onClick={() => setEditingRule({ id: Date.now().toString(), label: '新规则', value: 10, startBlock: 0, trendRows: 6, beadRows: 6, dragonThreshold: 3 })}
                      className="text-blue-600 flex items-center text-xs font-black hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Plus className="w-3 h-3 mr-1" /> 新增
                    </button>
                  </div>
                </div>

                {selectedRuleIds.size > 0 && (
                  <div className="bg-red-50 p-3 rounded-2xl border border-red-100 flex items-center justify-between animate-in slide-in-from-top-2">
                    <div className="flex items-center space-x-3">
                      <CheckSquare className="w-4 h-4 text-red-500" />
                      <span className="text-xs font-black text-red-700">已选中 {selectedRuleIds.size} 条规则</span>
                    </div>
                    <button 
                      onClick={deleteSelectedRules}
                      className="bg-red-500 text-white px-4 py-1.5 rounded-lg text-[10px] font-black uppercase hover:bg-red-600 transition-colors shadow-sm"
                    >
                      批量删除
                    </button>
                  </div>
                )}

                <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                   <div className="flex items-center space-x-2">
                     <Flame className="w-4 h-4 text-amber-500" />
                     <span className="text-[10px] font-black text-amber-700 uppercase">全规则龙提醒批量设置</span>
                   </div>
                   <div className="flex space-x-1.5">
                     {[2, 3, 5, 8, 10, 15].map(v => (
                       <button 
                        key={v}
                        onClick={() => batchUpdateDragonThreshold(v)}
                        className="w-8 h-8 bg-white rounded-lg border border-amber-200 text-[10px] font-black text-amber-600 hover:bg-amber-100 transition-colors shadow-sm"
                       >
                         {v}
                       </button>
                     ))}
                   </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-3xl overflow-hidden shadow-inner">
                  <div className="bg-gray-50/50 p-4 border-b border-gray-100 flex items-center justify-between sticky top-0 z-10 backdrop-blur-sm">
                    <button 
                      onClick={() => selectAllRules(filteredAndSortedRules)}
                      className="flex items-center space-x-2 text-[10px] font-black text-gray-500 hover:text-blue-600 transition-colors"
                    >
                      {selectedRuleIds.size === filteredAndSortedRules.length && filteredAndSortedRules.length > 0 ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4" />}
                      <span>全选本页</span>
                    </button>
                    <span className="text-[10px] font-black text-gray-300 uppercase">列表管理视图</span>
                  </div>
                  
                  <div className="max-h-[500px] overflow-y-auto no-scrollbar pb-4 divide-y divide-gray-50">
                    {filteredAndSortedRules.length === 0 ? (
                      <div className="py-12 text-center text-gray-400 text-xs font-bold italic">未检索到相关规则</div>
                    ) : (
                      filteredAndSortedRules.map(r => (
                        <div key={r.id} className="group hover:bg-blue-50/30 transition-all flex items-center p-4">
                          <button 
                            onClick={() => toggleRuleSelection(r.id)}
                            className="mr-4 text-gray-300 hover:text-blue-500 transition-colors"
                          >
                            {selectedRuleIds.has(r.id) ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4" />}
                          </button>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <p className="font-black text-sm text-gray-800 truncate">{r.label}</p>
                              {r.id === activeRuleId && <span className="bg-blue-100 text-blue-600 text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-tighter">当前激活</span>}
                            </div>
                            <div className="flex flex-wrap gap-2 mt-1">
                               <span className="text-[9px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-black">步长: {r.value}</span>
                               <span className="text-[9px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-black">走势: {r.trendRows}R</span>
                               <span className="text-[9px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-black">珠盘: {r.beadRows}R</span>
                               <span className="text-[9px] bg-amber-100 text-amber-600 px-2 py-0.5 rounded font-black">龙提醒: {r.dragonThreshold}连</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => setEditingRule(r)} 
                              className="p-2.5 text-gray-400 hover:text-blue-600 hover:bg-white rounded-xl transition-all shadow-sm"
                              title="编辑"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => deleteRule(r.id)} 
                              className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-white rounded-xl transition-all shadow-sm"
                              title="删除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {editingRule && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md p-8 animate-in slide-in-from-bottom-4 duration-300">
            <h3 className="text-xl font-black mb-6 text-gray-800">编辑采样规则</h3>
            <form onSubmit={handleSaveRule} className="space-y-5">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">规则名称</label>
                <input 
                  required
                  value={editingRule.label}
                  onChange={e => setEditingRule({...editingRule, label: e.target.value})}
                  className="w-full px-5 py-3 rounded-xl bg-gray-50 border-0 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">区块步长</label>
                  <input 
                    type="number" min="1" required
                    value={editingRule.value}
                    onChange={e => setEditingRule({...editingRule, value: parseInt(e.target.value) || 1})}
                    className="w-full px-5 py-3 rounded-xl bg-gray-50 border-0 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">起始偏移</label>
                  <input 
                    type="number" min="0"
                    value={editingRule.startBlock || ''}
                    onChange={e => setEditingRule({...editingRule, startBlock: parseInt(e.target.value) || 0})}
                    className="w-full px-5 py-3 rounded-xl bg-gray-50 border-0 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setEditingRule(null)} className="flex-1 py-3 font-black text-sm text-gray-400 hover:bg-gray-50 rounded-xl transition-all">取消</button>
                <button type="submit" className="flex-1 py-3 font-black text-sm bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-100 active:scale-95 transition-all">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBatchModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl p-8 md:p-10 animate-in zoom-in-95 duration-200">
             <div className="flex justify-between items-center mb-6">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-indigo-50 rounded-xl">
                    <Layers className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-gray-900">批量配置采样规则</h3>
                  </div>
                </div>
                <button onClick={() => setShowBatchModal(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
                  <X className="w-5 h-5" />
                </button>
             </div>
             <textarea 
               value={batchText}
               onChange={(e) => setBatchText(e.target.value)}
               className="w-full h-[300px] px-6 py-5 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-indigo-500 outline-none transition-all font-mono text-sm no-scrollbar resize-none mb-6"
               placeholder="名称,步长,偏移,走势行,珠盘行,龙阈值 (逗号分隔)"
             />
             <div className="flex gap-4">
                <button onClick={() => setShowBatchModal(false)} className="flex-1 py-4 font-black text-sm text-gray-400 hover:bg-gray-50 rounded-2xl">取消</button>
                <button onClick={handleBatchRuleSave} className="flex-1 bg-indigo-600 text-white py-4 rounded-2xl font-black text-sm shadow-xl active:scale-95 transition-all">保存更新</button>
             </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-8 bg-red-50 border-l-8 border-red-500 p-6 rounded-2xl flex items-start text-red-700 shadow-sm animate-in fade-in duration-300">
          <AlertCircle className="w-6 h-6 mr-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-black text-sm mb-1 uppercase tracking-wider">连接异常</h4>
            <p className="text-xs font-medium opacity-80">{error}</p>
          </div>
          <button onClick={() => activeRule && fillDataForInterval(activeRule)} className="ml-4 px-5 py-2.5 bg-red-100 rounded-xl text-xs font-black uppercase hover:bg-red-200 transition-colors">重新同步</button>
        </div>
      )}

      {isLoading && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-white/60 backdrop-blur-sm pointer-events-none">
          <div className="bg-white p-8 rounded-[2rem] shadow-2xl flex flex-col items-center border border-gray-100 animate-in zoom-in-90 duration-200">
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-4" />
            <p className="text-xs font-black text-gray-500 uppercase tracking-[0.3em]">正在同步区块数据...</p>
          </div>
        </div>
      )}

      {/* Persistent Sync Status Bar */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-500 opacity-90 hover:opacity-100 scale-110">
        <div className="bg-slate-900/95 backdrop-blur-xl shadow-2xl rounded-full px-8 py-4 border border-white/10 flex items-center space-x-6 text-white">
          <div className="flex items-center space-x-2.5">
            <div className="relative flex h-3.5 w-3.5">
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${apiKey && !error ? 'animate-ping bg-green-400' : 'bg-red-400'}`}></span>
              <span className={`relative inline-flex rounded-full h-3.5 w-3.5 ${apiKey && !error ? 'bg-green-500' : 'bg-red-500'}`}></span>
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest">
              {apiKey && !error ? '实时同步开启' : '离线状态'}
            </span>
          </div>
          {isSyncing && (
            <div className="flex items-center space-x-2 border-l border-white/10 pl-6">
              <Activity className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
              <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">最新高度捕获中</span>
            </div>
          )}
          <div className="flex items-center space-x-2 border-l border-white/10 pl-6">
             <span className="text-[10px] font-black text-white/40 uppercase">区块高度</span>
             <span className="text-xs font-black tabular-nums">{allBlocks[0]?.height || '---'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
