/**
 * ruid Interactive Landing Page Script
 * Powers the interactive terminal simulator, mode switching, copy system, and navigation.
 */

document.addEventListener('DOMContentLoaded', () => {
  initClipboardButtons();
  initMobileMenu();
  initTerminalSimulator();
});

// Toast notification helper
function showToast(message) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  if (!toast || !toastMsg) return;

  toastMsg.textContent = message;
  toast.classList.remove('translate-y-20', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 2500);
}

// 1. One-click Copy Implementation
function initClipboardButtons() {
  const copyButtons = document.querySelectorAll('.copy-install-btn');
  
  copyButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const command = btn.getAttribute('data-command') || 'npm install -g @theruid/ruid';
      try {
        await navigator.clipboard.writeText(command);
        showToast(`Copied to clipboard: "${command}"`);
      } catch (err) {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = command;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast(`Copied: ${command}`);
      }
    });
  });
}

// 2. Mobile Responsive Menu Drawer
function initMobileMenu() {
  const menuBtn = document.getElementById('mobile-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');

  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener('click', () => {
      const isExpanded = menuBtn.getAttribute('aria-expanded') === 'true';
      menuBtn.setAttribute('aria-expanded', !isExpanded);
      mobileMenu.classList.toggle('hidden');
    });

    // Close menu on link click
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
        menuBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }
}

// 3. Interactive Terminal Simulation Engine
const TERMINAL_SCRIPTS = {
  code: [
    { type: 'input', text: 'ruid "Refactor auth middleware to use JWT verification and check rate limits"' },
    { type: 'info', text: '🔍 Exploring workspace... found 18 files in src/auth' },
    { type: 'info', text: '📖 Reading src/middleware/auth.ts (48 lines)' },
    { type: 'tool', text: '⚡ Tool Call: grep "verifyToken" in src/' },
    { type: 'code', text: 'diff --git a/src/middleware/auth.ts b/src/middleware/auth.ts\n+ import { verifyToken, checkRateLimit } from "../security";\n- function legacyAuth(req, res) { ... }\n+ export async function authMiddleware(req: Request, res: Response) {\n+   const token = req.headers.authorization?.split(" ")[1];\n+   await verifyToken(token);\n+   await checkRateLimit(req.ip);\n+ }' },
    { type: 'prompt', text: '⚠️ [CODE MODE] File write detected for src/middleware/auth.ts' },
    { type: 'confirm', text: 'Allow file modification? [y/n/a]: y (Approved by user)' },
    { type: 'success', text: '✔ Applied 1 modification turn (snapshot turn-04 created)' },
    { type: 'success', text: '✔ Tests passed: 24/24 (src/middleware/auth.test.ts)' }
  ],
  plan: [
    { type: 'input', text: 'ruid "Plan architecture for multi-tenant database migration"' },
    { type: 'info', text: '🛡️ [PLAN MODE] Read-only Architecture & System Design activated' },
    { type: 'tool', text: '⚡ Task Created #1: Inspect schema.prisma and tenant isolation boundaries' },
    { type: 'tool', text: '⚡ Task Created #2: Design foreign key cascade policies for organization_id' },
    { type: 'tool', text: '⚡ Task Created #3: Generate migration SQL and rollback test plan' },
    { type: 'info', text: '📊 Graphing dependency tree across 42 data models...' },
    { type: 'code', text: 'Architecture Decision Record (ADR-012):\n- Strategy: Shared DB, schema-per-tenant isolation\n- Rollback safety: Verified zero data loss migration paths\n- Tasks mapped to .ruid/plan.md' },
    { type: 'success', text: '✔ Plan finalized with 3 executable tasks (/tasks to inspect)' }
  ],
  auto: [
    { type: 'input', text: 'ruid "Add end-to-end WebSocket chat service with automated test suite"' },
    { type: 'info', text: '🚀 [AUTO MODE] Autonomous High-Velocity Loop activated' },
    { type: 'tool', text: '⚡ [1/4] write_file: src/services/websocket.ts (Created 85 lines)' },
    { type: 'tool', text: '⚡ [2/4] write_file: src/services/websocket.test.ts (Created 110 lines)' },
    { type: 'tool', text: '⚡ [3/4] bash foreground: npm test src/services/websocket.test.ts' },
    { type: 'warning', text: '⚠️ Test Failure: Connection timeout after 5000ms' },
    { type: 'info', text: '🔄 Self-Correction: Adjusting heartbeat interval in src/services/websocket.ts...' },
    { type: 'tool', text: '⚡ [4/4] bash foreground: npm test (Re-running test suite)' },
    { type: 'success', text: '✔ All tests passing: 8/8 test suites passed! (Execution finished in 4.2s)' }
  ]
};

function initTerminalSimulator() {
  const terminalScreen = document.getElementById('terminal-screen');
  const tabs = document.querySelectorAll('.terminal-tab');
  const promptModeEl = document.getElementById('terminal-prompt-mode');
  const activeCommandEl = document.getElementById('terminal-active-command');
  const replayBtn = document.getElementById('btn-replay-demo');

  let currentMode = 'code';
  let animationTimeout = null;

  function renderMode(mode) {
    currentMode = mode;
    clearTimeout(animationTimeout);

    // Update active tab styles
    tabs.forEach(t => {
      const isSelected = t.getAttribute('data-mode') === mode;
      t.classList.toggle('active', isSelected);
      t.setAttribute('aria-selected', isSelected);
    });

    // Update prompt indicator
    if (promptModeEl) {
      promptModeEl.textContent = `[${mode.toUpperCase()}]`;
      promptModeEl.className = mode === 'code' ? 'text-emerald-400 font-bold' : (mode === 'plan' ? 'text-blue-400 font-bold' : 'text-amber-400 font-bold');
    }

    if (activeCommandEl) {
      if (mode === 'code') activeCommandEl.textContent = 'Refactor auth middleware with rate limiting';
      if (mode === 'plan') activeCommandEl.textContent = 'Plan multi-tenant database migration';
      if (mode === 'auto') activeCommandEl.textContent = 'Add WebSocket chat with automated tests';
    }

    if (!terminalScreen) return;
    terminalScreen.innerHTML = '';

    const lines = TERMINAL_SCRIPTS[mode] || TERMINAL_SCRIPTS.code;
    let stepIndex = 0;

    function printNextStep() {
      if (stepIndex >= lines.length) return;
      const step = lines[stepIndex];
      const lineDiv = document.createElement('div');
      lineDiv.className = 'term-line animate-fade-in';

      if (step.type === 'input') {
        lineDiv.innerHTML = `<span class="term-prompt">$</span> <span class="text-slate-100 font-bold">${step.text}</span>`;
      } else if (step.type === 'info') {
        lineDiv.innerHTML = `<span class="term-info">${step.text}</span>`;
      } else if (step.type === 'tool') {
        lineDiv.innerHTML = `<span class="text-purple-400 font-medium">${step.text}</span>`;
      } else if (step.type === 'code') {
        lineDiv.innerHTML = `<pre class="bg-black/60 p-3 rounded-lg border border-white/10 text-xs text-slate-300 overflow-x-auto my-1.5 font-mono"><code>${step.text}</code></pre>`;
      } else if (step.type === 'prompt') {
        lineDiv.innerHTML = `<span class="term-warning font-semibold">${step.text}</span>`;
      } else if (step.type === 'confirm') {
        lineDiv.innerHTML = `<span class="text-slate-300 font-semibold bg-white/5 px-2 py-1 rounded inline-block my-1">${step.text}</span>`;
      } else if (step.type === 'warning') {
        lineDiv.innerHTML = `<span class="term-warning">${step.text}</span>`;
      } else if (step.type === 'success') {
        lineDiv.innerHTML = `<span class="term-success font-semibold">${step.text}</span>`;
      }

      terminalScreen.appendChild(lineDiv);
      terminalScreen.scrollTop = terminalScreen.scrollHeight;

      stepIndex++;
      animationTimeout = setTimeout(printNextStep, stepIndex === 1 ? 400 : 350);
    }

    printNextStep();
  }

  // Bind tab click events
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.getAttribute('data-mode');
      if (mode) renderMode(mode);
    });
  });

  if (replayBtn) {
    replayBtn.addEventListener('click', () => renderMode(currentMode));
  }

  // Keyboard navigation for tab key in page
  document.addEventListener('keydown', (e) => {
    // If focused within the demo or pressing Tab when terminal is active
    if (e.target && e.target.closest('#interactive-demo') && e.key === 'Tab') {
      e.preventDefault();
      const order = ['code', 'plan', 'auto'];
      const nextIdx = (order.indexOf(currentMode) + 1) % order.length;
      renderMode(order[nextIdx]);
    }
  });

  // Initial render
  renderMode('code');
}
