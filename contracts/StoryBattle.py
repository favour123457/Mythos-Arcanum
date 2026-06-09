# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *

import json
import typing


class JudgeCompleted(gl.Event):
    def __init__(self, result: str, /): ...


class StoryBattle(gl.Contract):
    """
    AI Storytelling Battle
    ----------------------
    Players submit short stories for a shared prompt.
    When the round is judged, an LLM (via gl.nondet.exec_prompt) reads
    every submission and picks the most creative story as the winner.

    Each player accumulates points across rounds — fully on-chain,
    judged by the equivalence-principle consensus of GenLayer validators.
    """

    # ---- state ----
    round_id: u256
    prompt: str
    is_open: bool
    is_judged: bool
    winner: Address
    winning_story: str
    judge_reasoning: str
    result: str
    # Per-story rich verdict for the latest judged round (JSON list)
    verdicts_json: str
    # All winners (tied at top score) for the latest round
    winners: DynArray[Address]

    # submissions for the current round: address -> story
    authors: DynArray[Address]
    stories: TreeMap[Address, str]

    # global scoreboard across all rounds
    scoreboard_keys: DynArray[Address]
    scores: TreeMap[Address, u256]

    def __init__(self, prompt: str):
        """
        Initializes the battle with the first story prompt.
        """
        self.round_id = u256(1)
        self.prompt = prompt
        self.is_open = True
        self.is_judged = False
        self.winner = Address(b"\x00" * 20)
        self.winning_story = ""
        self.judge_reasoning = ""
        self.result = ""
        self.verdicts_json = ""
        self.winners = DynArray[Address]()
        self.authors = DynArray[Address]()
        self.stories = TreeMap[Address, str]()
        self.scoreboard_keys = DynArray[Address]()
        self.scores = TreeMap[Address, u256]()

    # -------------------------------------------------------------
    # Player actions
    # -------------------------------------------------------------
    @gl.public.write
    def submit_story(self, story: str) -> None:
        """
        Submit (or overwrite) your story for the current round.
        """
        if not self.is_open:
            raise Exception("Round is closed")
        if len(story) < 10:
            raise Exception("Story too short (min 10 chars)")
        if len(story) > 600:
            raise Exception("Story too long (max 600 chars)")

        sender = gl.message.sender_address
        if sender not in self.stories:
            self.authors.append(sender)
        self.stories[sender] = story

    # -------------------------------------------------------------
    # AI judging (intelligent contract)
    # -------------------------------------------------------------
    @gl.public.write
    def judge_round(self) -> str:
        """
        Closes the current round and asks the LLM to pick the winner.
        Anyone can call this once at least 2 stories have been submitted.
        """
        if self.is_judged:
            raise Exception("Round already judged")
        if len(self.authors) < 2:
            raise Exception("Need at least 2 submissions")

        self.is_open = False

        # Build the judging prompt — score every story individually
        entries = []
        for i, addr in enumerate(self.authors):
            entries.append(f"Story #{i + 1} by {addr.as_hex}:\n{self.stories[addr]}")
        joined = "\n\n".join(entries)

        valid_addrs = []
        for addr in self.authors:
            valid_addrs.append(addr.as_hex)

        task = f"""You are The Oracle of Mythos Arcanum, weighing the tales of mortality against the eternal truth.

The Call for this cycle is:
"{self.prompt}"

Below are the offerings from the Scribes. Weigh every tale individually on a 0-10 scale for:
- creativity (originality, surprise)
- alignment (how well it answers the Call)
- imagery (vivid sensory language and emotion)

Also write a one-sentence decree for each offering.
The contract will deterministically sum the scores and award the win.

Offerings:
{joined}

Respond ONLY with strict JSON in this exact shape, no markdown, no prose:
{{
  "verdicts": [
    {{
      "author": "<exact author address from the list>",
      "scores": {{"creativity": <int 0-10>, "prompt_fit": <int 0-10>, "imagery": <int 0-10>}},
      "critique": "<one short decree summarizing the tale's worth>"
    }}
  ],
  "reason": "<one short sentence summarizing why these tales were chosen>"
}}

Valid author addresses: {valid_addrs}
Include exactly one verdict object per offering.
"""

        def judge() -> str:
            return gl.nondet.exec_prompt(task, response_format="json")

        raw = gl.eq_principle.prompt_comparative(
            judge,
            "Both outputs must be valid JSON listing exactly one verdict per submitted story. "
            "Every verdict must use a valid author address and integer 0-10 scores for "
            "creativity, prompt_fit, and imagery. Score numbers, critique wording, overall "
            "ranking, and any winner-like wording may differ because the contract computes "
            "the winners deterministically after parsing the accepted scorecard.",
        )

        # Parse the model's JSON response safely.
        parsed: typing.Any = None
        try:
            if isinstance(raw, dict):
                parsed = raw
            else:
                cleaned = str(raw).strip()
                if cleaned.startswith("```"):
                    cleaned = cleaned.strip("`").strip()
                    if cleaned.lower().startswith("json"):
                        cleaned = cleaned[4:].strip()
                start = cleaned.find("{")
                end = cleaned.rfind("}")
                if start != -1 and end != -1:
                    parsed = json.loads(cleaned[start : end + 1])
        except Exception:
            parsed = None

        addr_lower_to_addr = {}
        for addr in self.authors:
            addr_lower_to_addr[addr.as_hex.lower()] = addr

        raw_verdicts = []
        if isinstance(parsed, dict) and isinstance(parsed.get("verdicts"), list):
            raw_verdicts = parsed["verdicts"]

        verdict_by_author = {}
        for v in raw_verdicts:
            if not isinstance(v, dict):
                continue
            author_str = str(v.get("author", "")).lower()
            if author_str not in addr_lower_to_addr:
                continue
            raw_scores = v.get("scores", {})
            if not isinstance(raw_scores, dict):
                raw_scores = {}
            sc = {}
            for key in ["creativity", "prompt_fit", "imagery"]:
                try:
                    n = int(raw_scores.get(key, 0))
                except Exception:
                    n = 0
                if n < 0:
                    n = 0
                if n > 10:
                    n = 10
                sc[key] = n
            critique = str(v.get("critique", v.get("reason", "")))
            verdict_by_author[author_str] = {"scores": sc, "critique": critique}

        verdicts_list = []
        totals = {}
        for addr in self.authors:
            key = addr.as_hex.lower()
            entry = verdict_by_author.get(
                key,
                {"scores": {"creativity": 0, "prompt_fit": 0, "imagery": 0}, "critique": ""},
            )
            sc = entry["scores"]
            total = sc["creativity"] + sc["prompt_fit"] + sc["imagery"]
            totals[key] = total
            verdicts_list.append(
                {
                    "author": addr.as_hex,
                    "story": self.stories[addr],
                    "scores": sc,
                    "total": total,
                    "critique": entry["critique"],
                }
            )

        max_total = -1
        for key in totals:
            if totals[key] > max_total:
                max_total = totals[key]

        winner_keys = []
        for key in totals:
            if totals[key] == max_total and max_total > 0:
                winner_keys.append(key)
        if len(winner_keys) == 0:
            winner_keys.append(self.authors[0].as_hex.lower())

        while len(self.winners) > 0:
            self.winners.pop()
        primary_winner = self.authors[0]
        ordered_winners = []
        for addr in self.authors:
            if addr.as_hex.lower() in winner_keys:
                self.winners.append(addr)
                ordered_winners.append(addr.as_hex)
                if addr not in self.scores:
                    self.scoreboard_keys.append(addr)
                    self.scores[addr] = u256(0)
                self.scores[addr] = u256(int(self.scores[addr]) + 1)
        if len(self.winners) > 0:
            primary_winner = self.winners[0]

        reason = ""
        if isinstance(parsed, dict):
            reason = str(parsed.get("reason", ""))
        if len(reason) == 0:
            if len(ordered_winners) > 1:
                reason = "Multiple stories tied for the top score."
            else:
                reason = "AI selected the most compelling story."

        self.winner = primary_winner
        self.winning_story = self.stories[primary_winner]
        self.judge_reasoning = reason

        top_scores = verdicts_list[0]["scores"]
        for v in verdicts_list:
            if v["author"].lower() == primary_winner.as_hex.lower():
                top_scores = v["scores"]
        final_result = {
            "winner": primary_winner.as_hex,
            "winners": ordered_winners,
            "scores": top_scores,
            "reason": reason,
            "verdicts": verdicts_list,
        }
        self.result = json.dumps(final_result, separators=(",", ":"))
        self.verdicts_json = json.dumps(verdicts_list, separators=(",", ":"))
        self.is_judged = True

        JudgeCompleted(self.result).emit()
        return self.result


    @gl.public.write
    def start_new_round(self, new_prompt: str) -> None:
        """
        After a round has been judged, start a fresh round with a new prompt.
        """
        if not self.is_judged:
            raise Exception("Current round not judged yet")
        if len(new_prompt) < 5:
            raise Exception("Prompt too short")

        # reset round state
        self.round_id = u256(int(self.round_id) + 1)
        self.prompt = new_prompt
        self.is_open = True
        self.is_judged = False
        self.winner = Address(b"\x00" * 20)
        self.winning_story = ""
        self.judge_reasoning = ""
        self.result = ""
        self.verdicts_json = ""
        while len(self.winners) > 0:
            self.winners.pop()

        # clear submissions
        for addr in list(self.authors):
            del self.stories[addr]
        while len(self.authors) > 0:
            self.authors.pop()

    # -------------------------------------------------------------
    # Read-only views
    # -------------------------------------------------------------
    @gl.public.view
    def get_state(self) -> typing.Any:
        subs = []
        for addr in self.authors:
            subs.append({"author": addr.as_hex, "story": self.stories[addr]})

        board = []
        for addr in self.scoreboard_keys:
            board.append({"player": addr.as_hex, "wins": int(self.scores[addr])})

        winners_out = []
        for addr in self.winners:
            winners_out.append(addr.as_hex)

        verdicts_out: typing.Any = []
        if len(self.verdicts_json) > 0:
            try:
                verdicts_out = json.loads(self.verdicts_json)
            except Exception:
                verdicts_out = []

        return {
            "round_id": int(self.round_id),
            "prompt": self.prompt,
            "is_open": self.is_open,
            "is_judged": self.is_judged,
            "winner": self.winner.as_hex,
            "winners": winners_out,
            "winning_story": self.winning_story,
            "judge_reasoning": self.judge_reasoning,
            "result": self.result,
            "verdicts": verdicts_out,
            "submissions": subs,
            "scoreboard": board,
        }

    @gl.public.view
    def getResult(self) -> str:
        return self.result
