import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Wallet,
  ExternalLink,
  Crown,
  Scroll,
  Loader2,
  Copy,
  Check,
  RefreshCw,
  Moon,
  Flame,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";

import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  GENLAYER_CHAIN,
  type JudgeResult,
  connectWallet,
  ensureChain,
  explorerAddress,
  explorerBlocks,
  explorerTx,
  fetchJudgeResult,
  pollJudgeResult,
  readGenLayerView,
  sendGenLayerTx,
  shortAddr,
  waitForJudgeTx,
} from "@/lib/genlayer";

export const Route = createFileRoute("/")({
  component: MythosArcanum,
});

const DEFAULT_CONTRACT = import.meta.env.VITE_CONTRACT_ADDRESS || "0x49e96CD413F5E5b672D332bfB507780B03F40552";

type TxRecord = { hash: string; label: string; ts: number };
type StoryBattleState = {
  submissions?: unknown[];
  is_judged?: boolean;
  is_open?: boolean;
  round_id?: number;
  prompt?: string;
};

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error !== "object" || error === null) return fallback;
  const maybeError = error as { shortMessage?: unknown; message?: unknown };
  if (typeof maybeError.shortMessage === "string") return maybeError.shortMessage;
  if (typeof maybeError.message === "string") return maybeError.message;
  return fallback;
}

function MythosArcanum() {
  const [address, setAddress] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>(DEFAULT_CONTRACT);
  const [isEditingContract, setIsEditingContract] = useState(false);
  const [tempContract, setTempContract] = useState(DEFAULT_CONTRACT);
  const [story, setStory] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [copied, setCopied] = useState(false);
  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  const [judging, setJudging] = useState(false);
  const [roundState, setRoundState] = useState<StoryBattleState | null>(null);
  const [newPrompt, setNewPrompt] = useState("");

  // Hydrate tx log from localStorage on client only
  useEffect(() => {
    try {
      setTxs(JSON.parse(localStorage.getItem("mythos:txs") ?? "[]"));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("mythos:txs", JSON.stringify(txs.slice(0, 20)));
  }, [txs]);

  useEffect(() => {
    if (window.ethereum?.selectedAddress) setAddress(window.ethereum.selectedAddress);
    const handler = (accs: string[]) => setAddress(accs[0] ?? "");
    window.ethereum?.on?.("accountsChanged", handler);
    return () => window.ethereum?.removeListener?.("accountsChanged", handler);
  }, []);

  const loadState = async () => {
    try {
      const s = await readGenLayerView<StoryBattleState>({
        contractAddress,
        method: "get_state",
      });
      if (s) setRoundState(s);
      return s;
    } catch {
      return null;
    }
  };

  // Auto-load any existing verdict + round state from the contract on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await fetchJudgeResult(contractAddress);
        if (!cancelled && v && (v.verdicts.length > 0 || v.reason || v.winner)) {
          setJudgeResult(v);
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) await loadState();
    })();
    return () => {
      cancelled = true;
    };
  }, [contractAddress]);

  const onConnect = async () => {
    try {
      setBusy("connect");
      const { address } = await connectWallet();
      setAddress(address);
      toast.success("Connection established", { description: shortAddr(address) });
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Failed to connect"));
    } finally {
      setBusy(null);
    }
  };

  const onAddNetwork = async () => {
    try {
      setBusy("network");
      await ensureChain();
      toast.success(`Aligned with ${GENLAYER_CHAIN.name}`);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Failed to switch network"));
    } finally {
      setBusy(null);
    }
  };

  const send = async (method: string, args: unknown[], label: string) => {
    if (!contractAddress) {
      toast.error("Set the contract address first");
      return;
    }
    try {
      setBusy(method);
      const hash = await sendGenLayerTx({ contractAddress, method, args });
      const rec: TxRecord = { hash, label, ts: Date.now() };
      setTxs((prev) => [rec, ...prev]);
      toast.success(`${label} cast`, {
        description: shortAddr(hash),
        action: {
          label: "Observe",
          onClick: () => window.open(explorerTx(hash), "_blank"),
        },
      });
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Ritual failed"));
    } finally {
      setBusy(null);
    }
  };

  const onSubmitStory = async () => {
    if (story.trim().length < 10) return toast.error("Offering too brief (min 10 chars)");
    if (roundState && roundState.is_open === false) {
      return toast.error("The cycle is closed", {
        description: "A new cycle must be summoned before casting new offerings.",
      });
    }
    await send("submit_story", [story.trim()], "Cast Offering");
    loadState();
  };

  const onStartNewRound = async () => {
    if (newPrompt.trim().length < 5) return toast.error("Call too short (min 5 chars)");
    await send("start_new_round", [newPrompt.trim()], "Summon New Cycle");
    setNewPrompt("");
    setJudgeResult(null);
    setJudgeError(null);
    // Give the chain a moment, then refresh
    setTimeout(loadState, 1500);
  };

  const onJudge = async () => {
    if (!contractAddress) return toast.error("Sacred contract not found");
    setJudgeError(null);
    setJudgeResult(null);
    try {
      setBusy("judge_round");
      const state = await readGenLayerView<StoryBattleState>({
        contractAddress,
        method: "get_state",
      });
      const submissionCount = Array.isArray(state?.submissions) ? state.submissions.length : 0;
      if (state?.is_judged) {
        setBusy(null);
        setJudging(true);
        const verdict = await pollJudgeResult(contractAddress, 15_000);
        if (verdict) {
          setJudgeResult(verdict);
          toast.success("Decree revealed", { description: shortAddr(verdict.winner) });
        } else {
          setJudgeError("Judgment rendered, but the decree remains veiled. Refresh shortly.");
        }
        return;
      }
      if (!state?.is_judged && submissionCount < 2) {
        const message = `The Oracle requires at least two offerings. Current: ${submissionCount}.`;
        setJudgeError(message);
        toast.error("Insufficient Offerings", {
          description: "Await a rival, then summon The Oracle.",
        });
        return;
      }
      const hash = await sendGenLayerTx({ contractAddress, method: "judge_round", args: [] });
      const rec: TxRecord = { hash, label: "Summon Oracle", ts: Date.now() };
      setTxs((prev) => [rec, ...prev]);
      toast.success("Oracle Summoned", {
        description: shortAddr(hash),
        action: { label: "Observe", onClick: () => window.open(explorerTx(hash), "_blank") },
      });
      setBusy(null);
      setJudging(true);
      const status = await waitForJudgeTx(hash, 300_000);
      await loadState();
      if (status?.undetermined) {
        setJudgeError(
          "The Oracle's vision was clouded. No decree was accepted. Summon again.",
        );
        return;
      }
      if (status && !status.succeeded) {
        setJudgeError(
          "The ritual finalized, but no decree was rendered. Summon again.",
        );
        return;
      }
      const verdict = await pollJudgeResult(contractAddress, 120_000);
      if (verdict) {
        setJudgeResult(verdict);
        toast.success("Decree Manifested", { description: shortAddr(verdict.winner) });
      } else {
        setJudgeError(
          "The ritual is complete, but the decree is still manifesting. Refresh manually.",
        );
      }
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Ritual failed"));
    } finally {
      setBusy(null);
      setJudging(false);
    }
  };

  const refreshVerdict = async () => {
    if (!contractAddress) return;
    try {
      setBusy("refresh");
      setJudgeError(null);
      const verdict = await fetchJudgeResult(contractAddress);
      if (verdict && (verdict.verdicts.length > 0 || verdict.reason || verdict.winner)) {
        setJudgeResult(verdict);
        toast.success("Decree Refreshed", {
          description: verdict.winner ? shortAddr(verdict.winner) : undefined,
        });
      } else {
        setJudgeError(
          "No decree found. The Oracle's deliberation may take some time. Try again.",
        );
      }
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Failed to read decree"));
    } finally {
      setBusy(null);
    }
  };

  const copyContract = () => {
    navigator.clipboard.writeText(contractAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="min-h-screen text-foreground font-sans">
      <Toaster richColors theme="dark" position="top-right" />

      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-8">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-glow border border-primary-glow/50">
            <Moon className="h-6 w-6" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-2xl font-bold tracking-widest">Mythos Arcanum</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
              GenLayer Oracle · {GENLAYER_CHAIN.chainId}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href={explorerBlocks}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-full border border-border bg-card/60 px-4 py-2 font-mono text-xs text-muted-foreground transition hover:text-accent sm:flex"
          >
            Ledger <ExternalLink className="h-3 w-3" />
          </a>
          {address ? (
            <a
              href={explorerAddress(address)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-full border border-accent/40 bg-accent/5 px-4 py-2 font-mono text-xs text-accent"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              {shortAddr(address)}
            </a>
          ) : (
            <Button onClick={onConnect} disabled={busy === "connect"} size="sm" className="rounded-full px-6">
              {busy === "connect" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wallet className="h-4 w-4" />
              )}
              Connect Scribe
            </Button>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pt-10 pb-16 sm:pt-20">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          className="text-center"
        >
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/5 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            <Sparkles className="h-3 w-3" /> The Oracle Judges Every Offering
          </div>
          <h1 className="font-display text-6xl font-bold leading-[1.1] sm:text-8xl bg-gradient-to-b from-foreground to-foreground/40 bg-clip-text text-transparent">
            Weave your tale.
            <br />
            <span className="text-primary italic">The Oracle</span> judges.
          </h1>
          <p className="mt-8 mx-auto max-w-2xl text-lg text-muted-foreground leading-relaxed">
            Mythos Arcanum is an ancient storytelling arena manifest as a GenLayer intelligent contract. 
            Cast your micro-tale into the void, and await the decree of the on-chain Oracle.
          </p>
        </motion.div>
      </section>

      {/* Grid sections */}
      <section className="mx-auto grid max-w-6xl gap-6 px-5 lg:grid-cols-5">
        {/* Network & Contract */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="lg:col-span-2 space-y-6"
        >
          <div className="rounded-3xl border border-border bg-card/40 p-8 backdrop-blur-md shadow-card relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Flame className="h-12 w-12 text-accent" />
            </div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-accent">
              Alignment
            </div>
            <h2 className="font-display text-2xl font-semibold mb-4">The Network</h2>
            <dl className="space-y-3 font-mono text-xs">
              <Row k="Realm ID" v={String(GENLAYER_CHAIN.chainId)} />
              <Row k="RPC Portal" v={GENLAYER_CHAIN.rpcUrl} small />
            </dl>
            <Button
              onClick={onAddNetwork}
              disabled={busy === "network"}
              variant="outline"
              className="mt-6 w-full border-accent/40 text-accent hover:bg-accent/10"
            >
              {busy === "network" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Align with GenLayer
            </Button>
          </div>

          <div className="rounded-3xl border border-border bg-card/40 p-8 backdrop-blur-md shadow-card">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-accent">
              Sacred Contract
            </div>
            <h2 className="font-display text-2xl font-semibold mb-4">StoryBattle</h2>
            <div className="mt-4 rounded-xl border border-border bg-background/60 px-4 py-3">
              {isEditingContract ? (
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={tempContract}
                    onChange={(e) => setTempContract(e.target.value)}
                    className="w-full bg-background border border-accent/20 rounded px-2 py-1 font-mono text-xs text-primary"
                    placeholder="0x..."
                  />
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      className="h-7 text-[10px]" 
                      onClick={() => {
                        setContractAddress(tempContract);
                        setIsEditingContract(false);
                      }}
                    >
                      Use Address
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="h-7 text-[10px]" 
                      onClick={() => setIsEditingContract(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <code className="truncate font-mono text-xs text-primary">{contractAddress}</code>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsEditingContract(true)}
                      className="h-8 w-8 text-muted-foreground hover:text-accent"
                      title="Change contract address"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={copyContract}
                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                    >
                      {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <a
              href={explorerAddress(contractAddress)}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-2 font-mono text-[10px] text-accent uppercase tracking-widest hover:underline"
            >
              Observe on Ledger <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </motion.div>

        {/* Offering composition */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="lg:col-span-3 rounded-3xl border border-primary/20 bg-card/60 p-8 backdrop-blur-xl shadow-card ring-1 ring-primary/10"
        >
          <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-primary">
            The Ritual · Your Offering
          </div>
          <h2 className="font-display text-4xl font-semibold mb-2">Cast your Tale</h2>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            Weave a micro-story (10–600 characters). The Oracle shall weigh your creativity, 
            imagery, and alignment with the Call.
          </p>

          {roundState && (
            <div
              className={`mb-6 rounded-2xl border px-6 py-4 ${
                roundState.is_open
                  ? "border-primary/30 bg-primary/5"
                  : "border-accent/30 bg-accent/5"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">
                  Cycle {roundState.round_id ?? "?"}
                </span>
                <span className={`font-mono text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded-full ${
                  roundState.is_open ? "bg-primary/20 text-primary" : "bg-accent/20 text-accent"
                }`}>
                  {roundState.is_open ? "Open" : "Closed"}
                </span>
              </div>
              {roundState.prompt && (
                <div className="font-display text-lg text-foreground italic">
                  “{roundState.prompt}”
                </div>
              )}
            </div>
          )}

          <Textarea
            value={story}
            onChange={(e) => setStory(e.target.value)}
            rows={8}
            maxLength={600}
            placeholder="In the heart of the void, a single flame flickered..."
            className="bg-background/40 border-border/50 focus:border-primary/50 focus:ring-primary/20 transition-all resize-none font-serif text-xl leading-relaxed italic"
          />
          
          <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>Length: {story.length}/600</span>
            {address && <span className="text-primary">Scribe: {shortAddr(address)}</span>}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button
              onClick={onSubmitStory}
              disabled={busy === "submit_story" || !address || !contractAddress}
              className="flex-1 rounded-full h-12 bg-primary hover:bg-primary-glow shadow-glow text-primary-foreground font-display font-bold tracking-widest"
            >
              {busy === "submit_story" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Scroll className="h-5 w-5" />
              )}
              Cast Offering
            </Button>
            <Button
              onClick={onJudge}
              disabled={busy === "judge_round" || judging || !address || !contractAddress}
              variant="outline"
              className="flex-1 rounded-full h-12 border-accent text-accent hover:bg-accent/10 font-display font-bold tracking-widest"
            >
              {busy === "judge_round" || judging ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Crown className="h-5 w-5" />
              )}
              Summon Oracle
            </Button>
          </div>

          <div className="mt-4 flex justify-center">
            <Button
              onClick={refreshVerdict}
              disabled={busy === "refresh" || !contractAddress}
              variant="ghost"
              className="text-muted-foreground hover:text-accent font-mono text-[10px] uppercase tracking-[0.2em]"
            >
              {busy === "refresh" ? (
                <Loader2 className="h-3 w-3 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-2" />
              )}
              Refresh Decree
            </Button>
          </div>

          {roundState && roundState.is_judged && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="mt-8 pt-8 border-t border-border/50"
            >
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
                Cycle Complete · Summon Next Call
              </div>
              <Textarea
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                rows={2}
                maxLength={200}
                placeholder="Type the next theme here (e.g., 'A journey through a dying sun')"
                className="bg-background/20 border-border/30 italic text-base"
              />
              <div className="mt-2 text-[9px] text-muted-foreground font-mono uppercase tracking-[0.1em]">
                * Requires a new Call of at least 5 characters to start the next cycle.
              </div>
              <Button
                onClick={onStartNewRound}
                disabled={busy === "start_new_round" || !address}
                variant="ghost"
                className="mt-4 w-full border border-accent/20 text-accent hover:bg-accent/5 font-display text-sm tracking-widest"
              >
                {busy === "start_new_round" ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Manifest New Cycle
              </Button>
            </motion.div>
          )}
        </motion.div>
      </section>

      {/* Eternal Records (Transactions) */}
      <section className="mx-auto max-w-6xl px-5 mt-12 pb-20">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="rounded-3xl border border-border bg-card/20 p-8 backdrop-blur-sm"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-accent mb-1">
                The Void's Memory
              </div>
              <h2 className="font-display text-2xl font-semibold">Eternal Records</h2>
            </div>
            <BookOpen className="h-6 w-6 text-muted-foreground/40" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence initial={false}>
              {txs.length === 0 ? (
                <div className="col-span-full py-12 text-center border border-dashed border-border rounded-2xl text-muted-foreground font-mono text-xs uppercase tracking-widest">
                  No records found in this era
                </div>
              ) : (
                txs.map((t) => (
                  <motion.a
                    key={t.hash}
                    href={explorerTx(t.hash)}
                    target="_blank"
                    rel="noreferrer"
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="group flex flex-col p-4 rounded-2xl border border-border/50 bg-background/20 hover:border-accent/40 hover:bg-accent/5 transition-all"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold group-hover:text-accent transition-colors">
                        {t.label}
                      </span>
                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground truncate">
                      {t.hash}
                    </div>
                    <div className="mt-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
                      {new Date(t.ts).toLocaleTimeString()}
                    </div>
                  </motion.a>
                ))
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </section>

      {/* The Oracle's Decree (Verdict) */}
      <AnimatePresence>
        {(judging || judgeResult || judgeError) && (
          <motion.section
            key="verdict"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-background/80 backdrop-blur-lg"
          >
            <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-[2.5rem] border border-accent/40 bg-card p-8 sm:p-12 shadow-2xl relative">
              <Button 
                variant="ghost" 
                size="icon" 
                className="absolute top-6 right-6 rounded-full hover:bg-accent/10"
                onClick={() => { setJudging(false); setJudgeResult(null); setJudgeError(null); }}
              >
                <span className="sr-only">Close</span>
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>

              <div className="text-center mb-10">
                <div className="inline-block p-4 rounded-full bg-accent/10 mb-4 animate-pulse-glow">
                  <Crown className="h-8 w-8 text-accent" />
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.4em] text-accent mb-2">
                  Divine Judgment
                </div>
                <h2 className="font-display text-4xl sm:text-5xl font-bold">
                  {judging && !judgeResult ? "The Oracle Deliberates…" : "The Decree is Manifest"}
                </h2>
              </div>

              {judging && !judgeResult && (
                <div className="py-20 flex flex-col items-center justify-center gap-6">
                  <Loader2 className="h-12 w-12 animate-spin text-accent" />
                  <p className="font-display text-lg italic animate-oracle">
                    Weighing the words against the eternal truth...
                  </p>
                </div>
              )}

              {judgeResult && (
                <div className="space-y-8">
                  <div className="rounded-3xl border border-accent/30 bg-accent/5 p-8 text-center ring-1 ring-accent/20">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-accent mb-4">
                      {judgeResult.winners.length > 1 ? "The Exalted Few" : "The Chosen One"}
                    </div>
                    <div className="flex justify-center flex-wrap gap-3 mb-6">
                      {(judgeResult.winners.length > 0 ? judgeResult.winners : [judgeResult.winner]).map((w) => (
                        <div key={w} className="flex items-center gap-2 px-4 py-2 rounded-full bg-accent text-accent-foreground font-mono text-xs font-bold">
                          <Crown className="h-3 w-3" />
                          {shortAddr(w)}
                        </div>
                      ))}
                    </div>
                    {judgeResult.reason && (
                      <p className="font-serif text-2xl italic leading-relaxed text-foreground">
                        “{judgeResult.reason}”
                      </p>
                    )}
                  </div>

                  <div className="space-y-6">
                    <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground border-b border-border pb-2">
                      The Scale of Offerings
                    </div>
                    {[...judgeResult.verdicts].sort((a, b) => b.total - a.total).map((v, i) => {
                      const isWinner = (judgeResult.winners.length > 0 ? judgeResult.winners : [judgeResult.winner])
                        .map(x => x.toLowerCase())
                        .includes(v.author.toLowerCase());
                      return (
                        <div key={v.author + i} className={`p-6 rounded-2xl border transition-all ${
                          isWinner ? "border-accent bg-accent/5 ring-1 ring-accent/20" : "border-border bg-background/40"
                        }`}>
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-lg text-muted-foreground/50">0{i+1}</span>
                              <span className="font-mono text-xs text-primary">{shortAddr(v.author)}</span>
                              {isWinner && <span className="bg-accent text-accent-foreground text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full">Exalted</span>}
                            </div>
                            <div className="font-mono text-xs">
                              <span className="text-xl font-bold">{v.total}</span>
                              <span className="text-muted-foreground"> / 30</span>
                            </div>
                          </div>
                          <p className="font-serif italic text-lg mb-6 leading-relaxed">"{v.story}"</p>
                          <div className="grid gap-6 sm:grid-cols-3">
                            <MythosScore label="Creativity" value={v.scores.creativity} />
                            <MythosScore label="Alignment" value={v.scores.prompt_fit} />
                            <MythosScore label="Imagery" value={v.scores.imagery} />
                          </div>
                          {v.critique && (
                            <div className="mt-6 pt-4 border-t border-border/30 text-sm text-muted-foreground italic">
                              <span className="text-accent not-italic font-bold mr-2">Oracle's Note:</span>
                              "{v.critique}"
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {judgeError && !judgeResult && (
                <div className="mt-10 p-6 rounded-2xl border border-destructive/30 bg-destructive/5 text-destructive text-center">
                  <p className="font-display tracking-widest uppercase text-sm mb-2 font-bold">Ritual Interrupted</p>
                  <p>{judgeError}</p>
                </div>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="border-t border-border/20 py-12 mt-auto">
        <div className="mx-auto flex flex-col items-center gap-4 max-w-6xl px-5 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Moon className="h-5 w-5" />
          </div>
          <div className="font-display text-lg tracking-[0.3em] font-bold text-foreground/60">Mythos Arcanum</div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Manifested on GenLayer · Intelligent Contracts · Divine Consensus
          </p>
        </div>
      </footer>
    </div>
  );
}

function Row({ k, v, small }: { k: string; v: string; small?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/30 pb-2">
      <dt className="text-muted-foreground uppercase tracking-widest text-[9px]">{k}</dt>
      <dd className={`truncate text-foreground ${small ? "max-w-[60%]" : ""}`} title={v}>
        {v}
      </dd>
    </div>
  );
}

function MythosScore({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(10, Number(value) || 0));
  const pct = (v / 10) * 100;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
        <span>{label}</span>
        <span className="text-accent font-bold">{v}/10</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted/30">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
          className="h-full rounded-full bg-accent"
        />
      </div>
    </div>
  );
}
