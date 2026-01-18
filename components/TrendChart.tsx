
import React, { useMemo, useRef, useEffect, memo } from 'react';
import { BlockData } from '../types';
import { calculateTrendGrid } from '../utils/helpers';
import { Flame } from 'lucide-react';

interface TrendChartProps {
  blocks: BlockData[];
  mode: 'parity' | 'size';
  title?: string;
  rows?: number;
}

const TrendChart: React.FC<TrendChartProps> = memo(({ blocks, mode, title, rows = 6 }) => {
  const grid = useMemo(() => {
    return calculateTrendGrid(blocks, mode === 'parity' ? 'type' : 'sizeType', rows);
  }, [blocks, mode, rows]);

  const containerRef = useRef<HTMLDivElement>(null);
  const isFirstDataLoad = useRef(true);
  const lastBlocksCount = useRef(blocks.length);

  // Intelligent Scroll Logic
  useEffect(() => {
    const container = containerRef.current;
    if (!container || blocks.length === 0) return;

    const scrollToEnd = () => {
      if (container) {
        container.scrollLeft = container.scrollWidth;
      }
    };

    const BUFFER = 60;
    const isAtEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - BUFFER;

    // First time data arrives after component mount (or rule switch remount)
    if (isFirstDataLoad.current) {
      scrollToEnd();
      // Ensure it scrolls correctly after the grid is rendered in the DOM
      const raf = requestAnimationFrame(() => {
        scrollToEnd();
        setTimeout(scrollToEnd, 150);
      });
      isFirstDataLoad.current = false;
      lastBlocksCount.current = blocks.length;
      return () => cancelAnimationFrame(raf);
    } 
    
    // Real-time update logic: follow only if user is at the latest data
    if (blocks.length > lastBlocksCount.current) {
      if (isAtEnd) {
        scrollToEnd();
      }
      lastBlocksCount.current = blocks.length;
    }
  }, [grid, blocks.length]);

  // Calculate current streak
  const streakInfo = useMemo(() => {
    if (blocks.length === 0) return null;
    const sorted = [...blocks].sort((a, b) => b.height - a.height);
    const key = mode === 'parity' ? 'type' : 'sizeType';
    const firstVal = sorted[0][key];
    let count = 0;
    for (const b of sorted) {
      if (b[key] === firstVal) count++;
      else break;
    }
    
    const labelMap: Record<string, string> = {
      'ODD': '单', 'EVEN': '双', 'BIG': '大', 'SMALL': '小'
    };
    
    const colorMap: Record<string, string> = {
      'ODD': 'var(--color-odd)', 'EVEN': 'var(--color-even)', 
      'BIG': 'var(--color-big)', 'SMALL': 'var(--color-small)'
    };

    return {
      label: labelMap[firstVal as string],
      count,
      color: colorMap[firstVal as string]
    };
  }, [blocks, mode]);

  const stats = useMemo(() => {
    if (mode === 'parity') {
      const odd = blocks.filter(b => b.type === 'ODD').length;
      return {
        labelA: '单', countA: odd, colorVarA: 'var(--color-odd)',
        labelB: '双', countB: blocks.length - odd, colorVarB: 'var(--color-even)'
      };
    } else {
      const big = blocks.filter(b => b.sizeType === 'BIG').length;
      return {
        labelA: '大', countA: big, colorVarA: 'var(--color-big)',
        labelB: '小', countB: blocks.length - big, colorVarB: 'var(--color-small)'
      };
    }
  }, [blocks, mode]);

  const renderCell = (type: any, colIdx: number, rowIdx: number) => {
    if (!type) return <div key={`${colIdx}-${rowIdx}`} className="w-8 h-8 border-r border-b border-gray-100/30 shrink-0" />;
    
    const isParity = mode === 'parity';
    const label = isParity ? (type === 'ODD' ? '单' : '双') : (type === 'BIG' ? '大' : '小');
    const colorVar = isParity 
      ? (type === 'ODD' ? 'var(--color-odd)' : 'var(--color-even)')
      : (type === 'BIG' ? 'var(--color-big)' : 'var(--color-small)');

    return (
      <div 
        key={`${colIdx}-${rowIdx}`} 
        className="w-8 h-8 border-r border-b border-gray-100/30 flex items-center justify-center shrink-0"
      >
        <div 
          style={{ backgroundColor: colorVar }}
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-black shadow-sm"
        >
          {label}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 flex flex-col h-fit overflow-hidden">
      <div className="flex justify-between items-center mb-3 px-1 shrink-0">
        <div className="flex flex-col">
          <h3 className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em]">
            {title || (mode === 'parity' ? '单双走势 (大路)' : '大小走势 (大路)')}
          </h3>
          {streakInfo && streakInfo.count >= 2 && (
            <div className="flex items-center mt-1 space-x-1 animate-in fade-in slide-in-from-left-2 duration-300">
              <Flame className="w-3 h-3 text-amber-500 fill-amber-500" />
              <span className="text-[10px] font-black text-gray-800">
                当前: <span style={{ color: streakInfo.color }}>{streakInfo.label}</span> {streakInfo.count}连
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center space-x-3 text-[10px] font-black">
          <div className="flex items-center space-x-1.5">
            <span style={{ backgroundColor: stats.colorVarA }} className="w-4 h-4 rounded flex items-center justify-center text-white text-[9px]">{stats.labelA}</span>
            <span className="text-gray-500 tabular-nums">{stats.countA}</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span style={{ backgroundColor: stats.colorVarB }} className="w-4 h-4 rounded flex items-center justify-center text-white text-[9px]">{stats.labelB}</span>
            <span className="text-gray-500 tabular-nums">{stats.countB}</span>
          </div>
        </div>
      </div>

      <div 
        ref={containerRef}
        className="overflow-auto custom-scrollbar rounded-lg border border-gray-100 bg-gray-50/20 h-auto min-h-0"
      >
        <div className="flex h-max w-max">
          {grid.map((column, colIdx) => (
            <div key={colIdx} className="flex flex-col">
              {column.map((cell, rowIdx) => renderCell(cell.type, colIdx, rowIdx))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

TrendChart.displayName = 'TrendChart';

export default TrendChart;
