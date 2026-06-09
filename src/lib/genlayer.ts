import { ethers } from "ethers";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import {
  ExecutionResult,
  TransactionStatus,
  type GenLayerTransaction,
  type TransactionHash,
} from "genlayer-js/types";

export const GENLAYER_CHAIN = {
  chainId: 61999,
  chainIdHex: "0xF22F",
  name: "GenLayer Studio",
  rpcUrl: "https://studio.genlayer.com/api",
  explorer: "https://explorer-studio.genlayer.com",
  currency: { name: "Ether", symbol: "ETH", decimals: 18 },
} as const;

export const explorerTx = (hash: string) => `${GENLAYER_CHAIN.explorer}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${GENLAYER_CHAIN.explorer}/address/${addr}`;
export const explorerBlocks = `${GENLAYER_CHAIN.explorer}/blocks/`;

export function shortAddr(addr: string | undefined | null) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function requestWalletAccount(): Promise<string> {
  if (!window.ethereum) throw new Error("No wallet detected. Please install MetaMask.");

  const requested = await window.ethereum.request({ method: "eth_requestAccounts" });
  const accounts = Array.isArray(requested) ? requested : [];
  const fallback = window.ethereum.selectedAddress;
  const from = accounts.find((account) => ethers.isAddress(account)) ?? fallback;

  if (!from || !ethers.isAddress(from)) {
    throw new Error("No wallet account available. Please reconnect your wallet.");
  }

  return ethers.getAddress(from);
}

declare global {
  interface Window {
    ethereum?: any;
  }
}

export async function ensureChain() {
  if (!window.ethereum) throw new Error("No wallet found. Install MetaMask.");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: GENLAYER_CHAIN.chainIdHex }],
    });
  } catch (err: any) {
    if (err?.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: GENLAYER_CHAIN.chainIdHex,
            chainName: GENLAYER_CHAIN.name,
            nativeCurrency: GENLAYER_CHAIN.currency,
            rpcUrls: [GENLAYER_CHAIN.rpcUrl],
            blockExplorerUrls: [GENLAYER_CHAIN.explorer],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export async function connectWallet(): Promise<{ address: string; provider: ethers.BrowserProvider }> {
  if (!window.ethereum) throw new Error("No wallet detected. Please install MetaMask.");
  await ensureChain();
  const provider = new ethers.BrowserProvider(window.ethereum);
  const address = await requestWalletAccount();
  return { address, provider };
}

/**
 * GenLayer transactions are sent as raw ETH transfers carrying contract calldata
 * to the contract address. The studio handles the intelligent execution; we just
 * need to send a transaction the user can verify on the explorer.
 *
 * For demo purposes — submitting a story / judging — we embed an ABI-like
 * payload as hex calldata. This produces a real, explorer-verifiable tx hash
 * on the GenLayer testnet chain.
 */
export async function sendGenLayerTx(opts: {
  contractAddress: string;
  method: string;
  args: unknown[];
}): Promise<string> {
  const { contractAddress, method, args } = opts;
  if (!ethers.isAddress(contractAddress)) {
    throw new Error("Invalid contract address");
  }
  if (!window.ethereum) throw new Error("No wallet detected. Please install MetaMask.");
  await ensureChain();

  const from = await requestWalletAccount();
  const client = createClient({
    chain: studionet,
    account: from as `0x${string}`,
    provider: window.ethereum,
  });

  const hash = await client.writeContract({
    address: contractAddress as `0x${string}`,
    functionName: method,
    args: args as any[],
    value: BigInt(0),
  });

  if (typeof hash !== "string") throw new Error("Wallet did not return a transaction hash");
  return hash;
}

// ---------------------------------------------------------------------------
// Read helpers — call read-only contract methods via the GenLayer Studio RPC
// and poll for transaction results.
// ---------------------------------------------------------------------------

async function rpc<T = any>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(GENLAYER_CHAIN.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return json.result as T;
}

/** Call a read-only @gl.public.view method on a GenLayer contract. */
export async function readGenLayerView<T = unknown>(opts: {
  contractAddress: string;
  method: string;
  args?: unknown[];
  from?: string;
}): Promise<T> {
  if (!ethers.isAddress(opts.contractAddress)) {
    throw new Error("Invalid contract address");
  }

  const client = createClient({ chain: studionet });
  return client.readContract({
    address: opts.contractAddress as `0x${string}`,
    functionName: opts.method,
    args: (opts.args ?? []) as any[],
  }) as Promise<T>;
}

export type StoryScores = { creativity: number; prompt_fit: number; imagery: number };

export type StoryVerdict = {
  author: string;
  story: string;
  scores: StoryScores;
  total: number;
  critique: string;
};

export type JudgeResult = {
  winner: string;
  winners: string[];
  scores: StoryScores;
  reason: string;
  verdicts: StoryVerdict[];
};

export type JudgeTxStatus = {
  hash: string;
  status?: string;
  execution?: string;
  finalized: boolean;
  succeeded: boolean;
  undetermined: boolean;
};

function normalizeScores(s: any): StoryScores {
  const o = s ?? {};
  return {
    creativity: Number(o.creativity ?? 0) || 0,
    prompt_fit: Number(o.prompt_fit ?? o.promptFit ?? 0) || 0,
    imagery: Number(o.imagery ?? 0) || 0,
  };
}

function normalizeVerdicts(v: any): StoryVerdict[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const scores = normalizeScores(x.scores);
      const total =
        Number(x.total ?? scores.creativity + scores.prompt_fit + scores.imagery) || 0;
      return {
        author: String(x.author ?? ""),
        story: String(x.story ?? ""),
        scores,
        total,
        critique: String(x.critique ?? x.reason ?? ""),
      };
    });
}

function judgeResultFromObject(parsed: any): JudgeResult | null {
  if (!parsed || typeof parsed !== "object") return null;
  const winners = Array.isArray(parsed.winners)
    ? parsed.winners.map((w: unknown) => String(w))
    : parsed.winner
      ? [String(parsed.winner)]
      : [];
  return {
    winner: String(parsed.winner ?? winners[0] ?? ""),
    winners,
    scores: normalizeScores(parsed.scores),
    reason: String(parsed.reason ?? parsed.reasoning ?? ""),
    verdicts: normalizeVerdicts(parsed.verdicts),
  };
}

function safeParseJudgeResult(raw: unknown): JudgeResult | null {
  if (raw && typeof raw === "object") return judgeResultFromObject(raw);
  if (!raw || typeof raw !== "string") return null;
  let cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/g, "").replace(/```\s*$/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object") return null;
    const winners = Array.isArray(parsed.winners)
      ? parsed.winners.map((w: unknown) => String(w))
      : parsed.winner
        ? [String(parsed.winner)]
        : [];
    return {
      winner: String(parsed.winner ?? winners[0] ?? ""),
      winners,
      scores: normalizeScores(parsed.scores),
      reason: String(parsed.reason ?? parsed.reasoning ?? ""),
      verdicts: normalizeVerdicts(parsed.verdicts),
    };
  } catch {
    return null;
  }
}

function statusName(tx: GenLayerTransaction): string | undefined {
  if (tx.statusName) return String(tx.statusName);
  return tx.status == null ? undefined : String(tx.status);
}

function executionName(tx: GenLayerTransaction): string | undefined {
  if (tx.txExecutionResultName) return String(tx.txExecutionResultName);
  return tx.txExecutionResult == null ? undefined : String(tx.txExecutionResult);
}

export async function waitForJudgeTx(
  hash: string,
  timeoutMs = 300_000,
): Promise<JudgeTxStatus | null> {
  const client = createClient({ chain: studionet });
  const retries = Math.max(1, Math.ceil(timeoutMs / 3_000));

  try {
    const tx = await client.waitForTransactionReceipt({
      hash: hash as TransactionHash,
      status: TransactionStatus.FINALIZED,
      interval: 3_000,
      retries,
    });
    const status = statusName(tx);
    const execution = executionName(tx);
    return {
      hash,
      status,
      execution,
      finalized: status === TransactionStatus.FINALIZED,
      succeeded: execution === ExecutionResult.FINISHED_WITH_RETURN,
      undetermined: status === TransactionStatus.UNDETERMINED,
    };
  } catch (err) {
    console.warn("[mythos-arcanum] waitForJudgeTx failed:", err);
    return null;
  }
}

/**
 * After a judge_round tx, poll for the final AI verdict.
 * Tries `getResult()` first, then falls back to fields in `get_state()`.
 * Returns null if the contract hasn't produced a verdict yet.
 */
export async function fetchJudgeResult(contractAddress: string): Promise<JudgeResult | null> {
  // Strategy 1 — getResult() (newer contract revision)
  try {
    const raw = await readGenLayerView<unknown>({ contractAddress, method: "getResult" });
    if (raw != null && (typeof raw !== "string" || raw.length > 0)) {
      const parsed = safeParseJudgeResult(raw);
      if (parsed && (parsed.winner || parsed.verdicts.length > 0 || parsed.reason)) return parsed;
    }
  } catch (err) {
    console.warn("[inkwell] getResult() failed:", err);
  }

  // Strategy 2 — get_state() and assemble a result from its fields
  try {
    const state = await readGenLayerView<any>({ contractAddress, method: "get_state" });
    if (state && typeof state === "object") {
      const rawResult = state.result;
      if (rawResult != null && (typeof rawResult !== "string" || rawResult.length > 0)) {
        const parsed = safeParseJudgeResult(rawResult);
        if (parsed) {
          if (parsed.verdicts.length === 0 && Array.isArray(state.verdicts)) {
            parsed.verdicts = normalizeVerdicts(state.verdicts);
          }
          if (parsed.winners.length === 0 && Array.isArray(state.winners)) {
            parsed.winners = state.winners.map((w: unknown) => String(w));
          }
          if (!parsed.winner && parsed.winners.length > 0) parsed.winner = parsed.winners[0];
          if (
            !parsed.scores.creativity &&
            !parsed.scores.prompt_fit &&
            !parsed.scores.imagery &&
            parsed.winner &&
            parsed.verdicts.length > 0
          ) {
            const winnerVerdict = parsed.verdicts.find(
              (v) => v.author.toLowerCase() === parsed.winner.toLowerCase(),
            );
            if (winnerVerdict) parsed.scores = winnerVerdict.scores;
          }
          return parsed;
        }
      }
      if (state.is_judged) {
        const verdicts = normalizeVerdicts(state.verdicts);
        const winners = Array.isArray(state.winners)
          ? state.winners.map((w: unknown) => String(w))
          : state.winner
            ? [String(state.winner)]
            : [];
        return {
          winner: String(state.winner ?? winners[0] ?? ""),
          winners,
          scores: { creativity: 0, prompt_fit: 0, imagery: 0 },
          reason: String(state.judge_reasoning ?? "Round judged on-chain."),
          verdicts,
        };
      }
    }
  } catch (err) {
    console.warn("[mythos-arcanum] get_state() failed:", err);
  }

  return null;
}

/** Poll the standard Ethereum receipt until the tx is mined (or timeout). */
export async function waitForReceipt(hash: string, timeoutMs = 60_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const receipt = await rpc<any>("eth_getTransactionReceipt", [hash]);
      if (receipt) return receipt;
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return null;
}

/** Poll fetchJudgeResult until a verdict appears (or timeout). */
export async function pollJudgeResult(
  contractAddress: string,
  timeoutMs = 240_000,
): Promise<JudgeResult | null> {
  const deadline = Date.now() + timeoutMs;
  let last: JudgeResult | null = null;
  while (Date.now() < deadline) {
    const r = await fetchJudgeResult(contractAddress);
    if (
      r &&
      (r.verdicts.length > 0 ||
        r.scores.creativity ||
        r.scores.prompt_fit ||
        r.scores.imagery ||
        r.reason)
    ) {
      return r;
    }
    if (r) last = r;
    await new Promise((res) => setTimeout(res, 3_000));
  }
  return last;
}
