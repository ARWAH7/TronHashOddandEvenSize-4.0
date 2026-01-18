
import { BlockData, BlockType, SizeType, GridCell } from '../types';

const TRON_GRID_BASE = "https://api.trongrid.io";

// Persistent memory cache for blocks to avoid re-fetching same data
const memoryCache = new Map<number, BlockData>();

export const deriveResultFromHash = (hash: string): number => {
  if (!hash) return 0;
  const digits = hash.match(/\d/g);
  if (digits && digits.length > 0) {
    return parseInt(digits[digits.length - 1], 10);
  }
  return 0;
};

export const formatTimestamp = (ts: number): string => {
  const date = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const fetchWithRetry = async (url: string, options: any, retries = 3, backoff = 500): Promise<any> => {
  try {
    const response = await fetch(url, options);
    
    if (response.status === 429) {
      if (retries > 0) {
        await wait(backoff);
        return fetchWithRetry(url, options, retries - 1, backoff * 2);
      }
      throw new Error("Rate limit exceeded (429). Please try again later.");
    }

    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    
    const data = await response.json();
    if (data.Error) throw new Error(data.Error);
    return data;
  } catch (error) {
    if (retries > 0) {
      await wait(backoff);
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw error;
  }
};

export const fetchLatestBlock = async (apiKey: string) => {
  return fetchWithRetry(`${TRON_GRID_BASE}/wallet/getnowblock`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
      'TRON-PRO-API-KEY': apiKey
    },
    body: '{}'
  });
};

export const fetchBlockByNum = async (num: number, apiKey: string) => {
  if (memoryCache.has(num)) return memoryCache.get(num);

  const data = await fetchWithRetry(`${TRON_GRID_BASE}/wallet/getblockbynum`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
      'TRON-PRO-API-KEY': apiKey
    },
    body: JSON.stringify({ num })
  });

  if (!data.blockID) throw new Error(`Block ${num} not found`);
  
  const block = transformTronBlock(data);
  memoryCache.set(num, block);
  return block;
};

export const transformTronBlock = (raw: any): BlockData => {
  const hash = raw.blockID;
  const height = raw.block_header.raw_data.number;
  const timestampRaw = raw.block_header.raw_data.timestamp;
  const resultValue = deriveResultFromHash(hash);
  
  return {
    height,
    hash,
    resultValue,
    type: resultValue % 2 === 0 ? 'EVEN' : 'ODD',
    sizeType: resultValue >= 5 ? 'BIG' : 'SMALL',
    timestamp: formatTimestamp(timestampRaw)
  };
};

/**
 * Big Road Calculation:
 * Optimized for stability: when data reaches limits, it shifts by full logical columns.
 */
export const calculateTrendGrid = (
  blocks: BlockData[], 
  typeKey: 'type' | 'sizeType',
  rows: number = 6
): GridCell[][] => {
  if (blocks.length === 0) return Array(40).fill(null).map(() => Array(rows).fill({ type: null }));
  
  // Sort chronologically for path finding
  const chronological = [...blocks].sort((a, b) => a.height - b.height);
  const columns: GridCell[][] = [];
  let currentColumn: GridCell[] = [];
  let lastVal: string | null = null;

  chronological.forEach((block) => {
    const currentVal = block[typeKey];
    // Rule for "Big Road": New column on result change OR if current column is full
    if (currentVal !== lastVal || currentColumn.length >= rows) {
      if (currentColumn.length > 0) {
        while (currentColumn.length < rows) {
          currentColumn.push({ type: null });
        }
        columns.push(currentColumn);
      }
      currentColumn = [];
      lastVal = currentVal;
    }
    currentColumn.push({ type: currentVal as any, value: block.resultValue });
  });

  if (currentColumn.length > 0) {
    while (currentColumn.length < rows) {
      currentColumn.push({ type: null });
    }
    columns.push(currentColumn);
  }

  // Ensure minimum width and alignment
  const minCols = 40;
  while (columns.length < minCols) {
    columns.push(Array(rows).fill({ type: null }));
  }

  return columns;
};

/**
 * Bead Road Calculation:
 * Fixed Column Alignment Logic. 
 * Instead of shifting by 1 block, it ensures the first block of the first column 
 * is always consistent with a modulo of the height, preventing jitter.
 */
export const calculateBeadGrid = (
  blocks: BlockData[],
  typeKey: 'type' | 'sizeType',
  rows: number = 6,
  interval: number = 1,
  startBlock: number = 0
): GridCell[][] => {
  if (blocks.length === 0) return Array(40).fill(null).map(() => Array(rows).fill({ type: null }));

  const chronological = [...blocks].sort((a, b) => a.height - b.height);
  const minHeight = chronological[0].height;
  
  // Calculate a stable anchor height for the very first cell (0,0)
  // This ensures that a block with height H always lands in the same (r, c) relative to the epoch
  const epoch = startBlock || 0;
  
  // Find the logical index of each block in the global sequence
  // Index = (Height - Epoch) / Interval
  const indexedBlocks = chronological.map(b => ({
    block: b,
    idx: Math.floor((b.height - epoch) / interval)
  }));

  // Determine the window of columns to display
  // We want to align the first column to a multiple of 'rows'
  const firstGlobalIdx = indexedBlocks[0].idx;
  const startColIdx = Math.floor(firstGlobalIdx / rows);
  const lastGlobalIdx = indexedBlocks[indexedBlocks.length - 1].idx;
  const endColIdx = Math.max(startColIdx + 39, Math.floor(lastGlobalIdx / rows));
  
  const totalCols = endColIdx - startColIdx + 1;
  const grid: GridCell[][] = Array.from({ length: totalCols }, () => 
    Array.from({ length: rows }, () => ({ type: null }))
  );

  indexedBlocks.forEach(({ block, idx }) => {
    const globalCol = Math.floor(idx / rows);
    const localCol = globalCol - startColIdx;
    const localRow = idx % rows;
    
    if (localCol >= 0 && localCol < totalCols) {
      grid[localCol][localRow] = { 
        type: block[typeKey] as any, 
        value: block.resultValue 
      };
    }
  });

  return grid;
};
