# Mythos Arcanum — The Ancient AI Storytelling Arena

**Mythos Arcanum** is a mystical, fully on-chain **AI Storytelling Battle** built on [GenLayer](https://genlayer.com). In this arena, players (Scribes) submit their offerings (tales) for a shared prompt (The Call), and **The Oracle** — an LLM running inside the GenLayer Intelligent Contract — judges the most worthy story.

---

## 🔮 The Prophecy (How it Works)

Unlike traditional "AI dApps" that process logic off-chain, Mythos Arcanum utilizes GenLayer's "Intelligent Contracts." The judgment is not a mere external API call; it is a core part of the contract execution itself.

- 🧠 **On-Chain Oracle:** The LLM call is part of the contract execution via `gl.nondet.exec_prompt`.
- ⚖️ **Semantic Consensus:** Validators reach agreement using the **Equivalence Principle**, ensuring a trust-minimized verdict on creative content.
- 🏆 **Eternal Ledger:** Wins are recorded on an immutable on-chain scoreboard.
- 🔄 **Cycle of Tales:** New rounds can be summoned by anyone once the previous judgment is rendered.

---

## 📜 The Sacred Architecture

### The Intelligent Contract — `StoryBattle.py`

A GenLayer Python contract that manages the state of the arena:

- `round_id`, `prompt`, `is_open`, `is_judged`
- `authors` + `stories` (The Scribes and their Offerings)
- `winner`, `winning_story`, `judge_reasoning`, `result`
- `scoreboard` (Cross-round legacy)

Key Entry Points:

| Method | Type | Description |
| --- | --- | --- |
| `submit_story(story)` | write | Submit your offering for the current cycle (10–600 chars). |
| `judge_round()` | write | Summons The Oracle to weigh the offerings. Requires ≥ 2 Scribes. |
| `start_new_round(prompt)` | write | Opens a new cycle with a fresh Call. |
| `get_state()` | view | Reveals the current state of the arena. |

### The Weaving (Frontend)

- **TanStack Start v1** (React 19)
- **GenLayer-JS** for the mystical connection to the chain.
- **Tailwind v4** with a custom "Mythos Arcanum" theme.

---

## 🚀 Summoning the Local Environment

### Prerequisites

- [Bun](https://bun.sh)
- A MetaMask wallet
- Two accounts (The Oracle requires at least 2 offerings to judge)

### Installation

```bash
bun install
bun run dev
```

---

## 🎭 The Ritual (How to Play)

1. **Connect your Scribe's Wallet** to the GenLayer Studio network.
2. **Weave your Tale:** Read the current prompt and submit your 10-600 character micro-story.
3. **Wait for a Rival:** At least two Scribes must submit offerings.
4. **Summon The Oracle:** Click **Trigger AI Judge** to start the consensus process.
5. **Behold the Verdict:** Once the transaction finalizes, the winner is revealed with the Oracle's reasoning.

---

Built for the GenLayer Hackathon.
