
import React, { useMemo, memo, useCallback, useState } from 'react';
import { BlockData, IntervalRule, FollowedPattern } from '../types';
import { Info, ChevronRight, Grid3X3, BarChart3, Heart, Star, Filter } from 'lucide-react';

interface DragonListProps {
  allBlocks: BlockData[];
  rules: IntervalRule[];
  followedPatterns: FollowedPattern[];
  onToggleFollow: (pattern: FollowedPattern) => void;
  onJumpToChart?: (ruleId: string, type: 'parity' | 'size', mode: 'trend' | 'bead') => void;
}

interface DragonInfo {
  ruleId: string;
  ruleName: string;
  type: 'parity' | 'size';
  mode: 'trend' | 'bead';
  value: string;
  rawType: 'ODD' | 'EVEN' | 'BIG' | 'SMALL';
  count: number;
  color: string;
  threshold: number;
  nextHeight: number;
  rowId?: number; // Only for Bead Row Dragons
}

type DragonFilter = 'ALL' | 'ODD' | 'EVEN' | 'BIG' | 'SMALL';

const DragonList: React.FC<DragonListProps> = memo(({ allBlocks, rules, followedPatterns, onToggleFollow, onJumpToChart }) => {
  const [activeFilter, setActiveFilter] = useState<DragonFilter>('ALL');

  const { trendDragons, beadRowDragons, followedResults } = useMemo(() => {
    const trendResults: DragonInfo[] = [];
    const beadResults: DragonInfo[] = [];
    const watchResults: DragonInfo[] = [];

    if (allBlocks.length === 0) return { trendDragons: [], beadRowDragons: [], followedResults: [] };

    rules.forEach(rule => {
      const epoch = rule.startBlock || 0;
      const interval = rule.value;
      const rows = rule.beadRows || 6;

      const checkAlignment = (height: number) => {
        if (interval <= 1) return true;
        if (epoch > 0) {
          return height >= epoch && (height - epoch) % interval === 0;
        }
        return height % interval === 0;
      };

      // 过滤符合采样规则的区块，按高度从大到小排序（最新在前）
      const filtered = allBlocks.filter(b => checkAlignment(b.height)).sort((a, b) => b.height - a.height);
      if (filtered.length === 0) return;

      const threshold = rule.dragonThreshold || 3;
      const latestHeight = filtered[0].height;
      const nextHeight = latestHeight + interval;

      // 1. 走势图长龙 (Big Road)
      const calculateStreak = (key: 'type' | 'sizeType') => {
        let count = 0;
        const firstVal = filtered[0][key];
        for (const b of filtered) {
          if (b[key] === firstVal) count++;
          else break;
        }
        return { value: firstVal, count };
      };

      const addTrendDragon = (type: 'parity' | 'size', streak: any) => {
        const info: DragonInfo = {
          ruleId: rule.id,
          ruleName: rule.label,
          type,
          mode: 'trend',
          rawType: streak.value,
          value: type === 'parity' ? (streak.value === 'ODD' ? '单' : '双') : (streak.value === 'BIG' ? '大' : '小'),
          count: streak.count,
          color: streak.value === 'ODD' || streak.value === 'BIG' ? (type === 'parity' ? 'var(--color-odd)' : 'var(--color-big)') : (type === 'parity' ? 'var(--color-even)' : 'var(--color-small)'),
          threshold,
          nextHeight
        };
        
        const matchesFilter = activeFilter === 'ALL' || info.rawType === activeFilter;
        if (streak.count >= threshold && matchesFilter) trendResults.push(info);

        const isFollowed = followedPatterns.find(fp => 
          fp.ruleId === rule.id && fp.type === type && fp.mode === 'trend'
        );
        if (isFollowed && matchesFilter) watchResults.push(info);
      };

      addTrendDragon('parity', calculateStreak('type'));
      addTrendDragon('size', calculateStreak('sizeType'));

      // 2. 珠盘路行级长龙 (Bead Row)
      // 使用与 BeadRoad 组件一致的物理对齐逻辑进行行扫描
      for (let r = 0; r < rows; r++) {
        // 筛选出属于物理第 r 行的区块（r=0 为第一行）
        const rowItems = filtered.filter(b => {
          const logicalIdx = Math.floor((b.height - epoch) / interval);
          return (logicalIdx % rows) === r;
        });
        
        if (rowItems.length === 0) continue;
        
        // rowItems 已经是从最新到最旧排序
        const calcRowStreak = (key: 'type' | 'sizeType') => {
          let count = 0;
          const firstVal = rowItems[0][key];
          for (const b of rowItems) {
            if (b[key] === firstVal) count++;
            else break;
          }
          return { value: firstVal, count };
        };

        const rpStreak = calcRowStreak('type');
        const rsStreak = calcRowStreak('sizeType');
        
        // 该行下一个出球的预期高度
        const rowNextHeight = rowItems[0].height + (interval * rows);

        const addBeadDragon = (type: 'parity' | 'size', streak: any) => {
          const info: DragonInfo = {
            ruleId: rule.id,
            ruleName: rule.label,
            type,
            mode: 'bead',
            rawType: streak.value,
            value: type === 'parity' ? (streak.value === 'ODD' ? '单' : '双') : (streak.value === 'BIG' ? '大' : '小'),
            count: streak.count,
            color: streak.value === 'ODD' || streak.value === 'BIG' ? (type === 'parity' ? 'var(--color-odd)' : 'var(--color-big)') : (type === 'parity' ? 'var(--color-even)' : 'var(--color-small)'),
            threshold,
            nextHeight: rowNextHeight,
            rowId: r + 1 // 物理行号 (1-indexed)
          };
          
          const matchesFilter = activeFilter === 'ALL' || info.rawType === activeFilter;
          if (streak.count >= threshold && matchesFilter) beadResults.push(info);

          const isFollowed = followedPatterns.find(fp => 
            fp.ruleId === rule.id && fp.type === type && fp.mode === 'bead' && fp.rowId === (r + 1)
          );
          if (isFollowed && matchesFilter) watchResults.push(info);
        };

        addBeadDragon('parity', rpStreak);
        addBeadDragon('size', rsStreak);
      }
    });

    return { 
      trendDragons: trendResults.sort((a, b) => b.count - a.count),
      beadRowDragons: beadResults.sort((a, b) => b.count - a.count),
      followedResults: watchResults.sort((a, b) => b.count - a.count)
    };
  }, [allBlocks, rules, followedPatterns, activeFilter]);

  const renderDragonCard = useCallback((dragon: DragonInfo, index: number, isFollowedView: boolean = false) => {
    const isFollowed = !!followedPatterns.find(fp => 
      fp.ruleId === dragon.ruleId && 
      fp.type === dragon.type && 
      fp.mode === dragon.mode && 
      fp.rowId === dragon.rowId
    );

    const handleFollowClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleFollow({
        ruleId: dragon.ruleId,
        type: dragon.type,
        mode: dragon.mode,
        rowId: dragon.rowId
      });
    };

    const handleCardClick = () => {
      if (onJumpToChart) {
        onJumpToChart(dragon.ruleId, dragon.type, dragon.mode);
      }
    };

    return (
      <div 
        key={`${dragon.ruleName}-${dragon.type}-${dragon.mode}-${dragon.rowId || 't'}-${index}-${isFollowedView ? 'v' : 'm'}`}
        onClick={handleCardClick}
        className={`group relative bg-white rounded-2xl p-4 border transition-all duration-300 cursor-pointer ${
          dragon.count >= 5 ? 'border-amber-200 shadow-md ring-1 ring-amber-100' : 'border-gray-100 hover:shadow-lg'
        } ${isFollowedView ? 'border-blue-100 bg-blue-50/10' : ''}`}
      >
        <div className="flex justify-between items-start mb-3">
          <div className="flex flex-col">
            <span className="px-2 py-0.5 bg-gray-50 rounded-lg text-[9px] font-black text-gray-400 uppercase tracking-tighter border border-gray-100 inline-block w-fit">
              {dragon.ruleName}
            </span>
            {dragon.rowId && (
              <span className="mt-1 ml-0.5 text-[8px] font-black text-indigo-500 uppercase">
                珠盘第 {dragon.rowId} 行
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
             <button 
                onClick={handleFollowClick}
                className={`p-1.5 rounded-full transition-all active:scale-90 ${
                  isFollowed ? 'text-red-500 bg-red-50' : 'text-gray-300 hover:text-gray-400 hover:bg-gray-100'
                }`}
             >
                <Heart className={`w-4 h-4 ${isFollowed ? 'fill-current' : ''}`} />
             </button>
             <span className="text-[9px] font-black text-gray-400 uppercase">实时</span>
          </div>
        </div>

        <div className="flex items-end justify-between border-b border-gray-200/50 pb-4 mb-4">
          <div>
            <div className="flex items-center space-x-2">
              <div 
                style={{ backgroundColor: dragon.color }}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-base font-black shadow-md"
              >
                {dragon.value}
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1">
                  {dragon.type === 'parity' ? '单双' : '大小'}
                </span>
                <span className="text-xl font-black text-gray-800 leading-none">
                  {dragon.value}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end">
            <span className="text-[9px] font-black text-gray-400 uppercase mb-0.5">连出</span>
            <div className="flex items-baseline space-x-0.5">
              <span className="text-3xl font-black tabular-nums" style={{ color: dragon.color }}>{dragon.count}</span>
              <span className="text-[10px] font-black text-gray-400">期</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[8px] font-black text-gray-400 uppercase tracking-wider">预期区块</span>
            <span className="text-xs font-black text-blue-600 tabular-nums flex items-center">
              {dragon.nextHeight}
              <ChevronRight className="w-2.5 h-2.5 ml-0.5" />
            </span>
          </div>
          <div className="px-1.5 py-0.5 bg-gray-50 rounded-md border border-gray-100 text-[8px] font-black text-gray-300 uppercase">
            {dragon.mode === 'trend' ? '走势' : '珠盘'}
          </div>
        </div>

        {dragon.count >= 8 && (
          <div className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-md shadow-md rotate-12 animate-bounce uppercase">
            大龙
          </div>
        )}
      </div>
    );
  }, [followedPatterns, onToggleFollow, onJumpToChart]);

  const FilterButton = ({ type, label }: { type: DragonFilter, label: string }) => (
    <button
      onClick={() => setActiveFilter(type)}
      className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all border-2 ${
        activeFilter === type
          ? 'bg-blue-600 text-white border-blue-600 shadow-md'
          : 'bg-white text-gray-400 border-gray-100 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row items-center justify-between bg-white/60 backdrop-blur-md rounded-[2rem] p-4 px-8 border border-white shadow-sm gap-4">
        <div className="flex items-center space-x-3">
          <Filter className="w-4 h-4 text-gray-400" />
          <span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">龙榜筛选器</span>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <FilterButton type="ALL" label="全部显示" />
          <FilterButton type="ODD" label="单 (ODD)" />
          <FilterButton type="EVEN" label="双 (EVEN)" />
          <FilterButton type="BIG" label="大 (BIG)" />
          <FilterButton type="SMALL" label="小 (SMALL)" />
        </div>
      </div>

      <section className="bg-white/80 backdrop-blur-md rounded-[2.5rem] p-8 shadow-xl border border-blue-50">
        <div className="flex items-center justify-between mb-8 px-2">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-red-50 rounded-2xl">
              <Heart className="w-6 h-6 text-red-500 fill-current" />
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-black text-gray-900">我的关注</h2>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mt-1">
                实时追踪核心规则走势 · 已关注 {followedPatterns.length} 项 {activeFilter !== 'ALL' && `(已应用筛选: ${activeFilter})`}
              </p>
            </div>
          </div>
        </div>

        {followedResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-gray-50/50 rounded-3xl border border-dashed border-gray-200">
            <div className="bg-white p-4 rounded-full shadow-sm mb-4">
               <Star className="w-8 h-8 text-gray-200" />
            </div>
            <p className="text-gray-400 font-black text-xs uppercase tracking-widest text-center px-6">
               {activeFilter === 'ALL' ? '目前还没有关注任何趋势' : `目前没有匹配 "${activeFilter}" 的关注项`}<br/>
               <span className="text-[10px] opacity-60 mt-1 block">点击下方长龙卡片上的爱心图标即可快速添加</span>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {followedResults.map((dragon, idx) => renderDragonCard(dragon, idx, true))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
        <div className="bg-white rounded-[2.5rem] p-8 shadow-xl border border-gray-100 flex flex-col min-h-[500px]">
          <div className="flex items-center space-x-3 mb-8 px-1">
            <div className="p-2.5 bg-amber-50 rounded-2xl">
              <BarChart3 className="w-6 h-6 text-amber-500" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900">1. 单双/大小走势长龙</h2>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                基于各采样步长的最新序列连出提醒
              </p>
            </div>
          </div>

          {trendDragons.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-50/50 rounded-3xl border border-dashed border-gray-200 py-24">
              <Info className="w-6 h-6 text-gray-300 mb-2" />
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                {activeFilter === 'ALL' ? '暂无序列长龙' : `暂无匹配 "${activeFilter}" 的序列长龙`}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {trendDragons.map((d, i) => renderDragonCard(d, i))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-[2.5rem] p-8 shadow-xl border border-gray-100 flex flex-col min-h-[500px]">
          <div className="flex items-center space-x-3 mb-8 px-1">
            <div className="p-2.5 bg-indigo-50 rounded-2xl">
              <Grid3X3 className="w-6 h-6 text-indigo-500" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900">2. 珠盘路行级长龙</h2>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                基于珠盘路左右横向行的连出提醒
              </p>
            </div>
          </div>

          {beadRowDragons.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-50/50 rounded-3xl border border-dashed border-gray-200 py-24">
              <Info className="w-6 h-6 text-gray-300 mb-2" />
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                 {activeFilter === 'ALL' ? '暂无珠盘行龙' : `暂无匹配 "${activeFilter}" 的珠盘行龙`}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {beadRowDragons.map((d, i) => renderDragonCard(d, i))}
            </div>
          )}
        </div>
      </div>
      
      <div className="p-6 bg-blue-50/50 rounded-[2.5rem] border border-blue-100/50 flex items-start space-x-5">
         <div className="p-3 bg-blue-100 rounded-2xl shrink-0 shadow-sm">
           <Info className="w-5 h-5 text-blue-500" />
         </div>
         <div className="space-y-1">
           <p className="text-xs text-blue-600 font-black uppercase tracking-wider">
             长龙关注与提醒逻辑说明：
           </p>
           <ul className="text-[11px] text-blue-600/80 font-medium space-y-1 list-disc pl-4">
             <li><strong>物理对齐</strong>：珠盘路行提醒严格采用 (高度 - 偏移) / 步长 % 行数 的物理逻辑，确保与盘面显示的行号 100% 一致。</li>
             <li><strong>智能跳转</strong>：直接点击任何长龙卡片，系统将为您切换至对应规则的实战分析界面。</li>
             <li><strong>多维筛选</strong>：使用顶部的筛选器可以快速定位特定结果。</li>
             <li><strong>动态高亮</strong>：当关注项连出数较多时卡片会有特殊视觉提示。</li>
           </ul>
         </div>
      </div>
    </div>
  );
});

DragonList.displayName = 'DragonList';

export default DragonList;
