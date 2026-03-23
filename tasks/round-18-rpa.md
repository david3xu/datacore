# Round 18 — OpenClaw RPA Shell Wrapper Plugin

> Assigned to: OpenClaw / Gemini
> Date: March 22, 2026
> Type: Feature Implementation

## Background
We solved the overarching multi-agent timeline in Datacore by utilizing standard plaintext JSONL files and the `get_tasks` MCP polling tool. However, GUI apps (like Claude Desktop) cannot actively poll.

The user realized that while OpenClaw natively supports running shell commands, we need a thin, dedicated OpenClaw plugin to correctly orchestrate the dynamic "briefing" payloads and prevent UI collisions.

## Objective
Build a thin OpenClaw plugin that acts as the "Manager's Dispatcher." It will dynamically template task briefings and trigger macOS AppleScript via native shell execution to formally assign work to Claude Desktop.

## The Autonomous Agency Hierarchy
1. **CEO (User/David):** Sets the initial Datacore ticket `task_created`.
2. **Project Manager (OpenClaw):** Polls Datacore for active tickets. Evaluates the workload, dynamically generates a task briefing, checks if Claude is busy, and fires the shell script.
3. **Tech Lead (Claude Desktop):** Wakes up, receives the injected context brief, queries Datacore for the raw specs, writes Markdown designs, and logs `task_completed`.
4. **Development Staff (Gemini / Codex):** Executing scripts.

## Specifications
1. **Target Environment:** Local macOS.
2. **The Plugin Logic (The Universal Dispatcher):**
   - **The Routing Map:** OpenClaw maintains a JSON dict mapping each assigned AI to its GUI process name and shortcut payload:
     ```javascript
     const teamApps = {
       "claude-desktop": { appName: "Claude", newChat: "keystroke \"n\" using command down" },
       "openai-codex": { appName: "Codex", newChat: "..." }, // Pending exact Codex shortcut
       "gemini-ide": { appName: "Antigravity", newChat: "..." } // Pending Antigravity shortcut
     }
     ```
   - **Guard Clause:** Verify the target app isn't actively generating text or blocking the screen.
   - **Templater:** Dynamically generate the briefing string: `"Task {ID} — {Title}. Query get_tasks for {ID} and execute."`
   - **Execution:** Run the shell command natively via OpenClaw's Node.js runtime (`execSync`), injecting the target `appName` and `newChat` command dynamically.

3. **The Shell Payload:**
```bash
# 1. Load the dynamic contextual briefing into the clipboard
echo "[DYNAMIC_BRIEFING_STRING]" | pbcopy

# 2. Fire the AppleScript to reset UI state and Paste
osascript <<EOF
  tell application "Claude" to activate
  delay 1
  tell application "System Events"
      keystroke "n" using command down    -- Force clean conversation state
  end tell
  delay 1
  tell application "System Events"
      keystroke "v" using command down    -- Paste the exact prompt atomically
      delay 0.3
      key code 36                         -- Return
  end tell
EOF
```

## Security & Reliability Caveats
- Bypassing proprietary MCP servers and relying purely on OpenClaw's native terminal execution guarantees system independence.
- Using `pbcopy` + `Cmd+V` brutally compresses execution time.
- The wrapper plugin guarantees Claude is not interrupted mid-thought.
