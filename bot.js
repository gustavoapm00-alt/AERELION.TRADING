require("dotenv").config();
const TelegramBot  = require("node-telegram-bot-api");
const Indicators   = require("./indicators");
const BinanceClient = require("./binance");
const ClaudeBrain  = require("./claude-brain");

// ─── Config ───────────────────────────────────────────────────────────────────
const {
  TELEGRAM_BOT_TOKEN,
  ANTHROPIC_API_KEY,
  BINANCE_API_KEY,
  BINANCE_API_SECRET,
  ALLOWED_TELEGRAM_USER_ID,
  TESTNET,            // set to "true" for paper trading on Binance testnet
  TRADING_ENABLED,    // set to "true" to enable real order execution
} = process.env;

const SYMBOL      = "BTCUSDT";
const COIN        = "BTC";
const PAPER_MODE  = TESTNET === "true" || TRADING_ENABLED !== "true";

if (!TELEGRAM_BOT_TOKEN || !ANTHROPIC_API_KEY) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN or ANTHROPIC_API_KEY");
  process.exit(1);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
const tg      = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const ind     = new Indicators(1000);
const brain   = new ClaudeBrain(ANTHROPIC_API_KEY);
const binance = (BINANCE_API_KEY && BINANCE_API_SECRET)
  ? new BinanceClient(BINANCE_API_KEY, BINANCE_API_SECRET, TESTNET === "true")
  : null;

// ─── State ────────────────────────────────────────────────────────────────────
let position = {
  btc:          0,
  entryPrice:   null,
  entryTime:    null,
  unrealizedPnL: 0,
  stopLoss:     null,
  takeProfit:   null,
};

let portfolio = {
  cash:         PAPER_MODE ? 1000 : 0,   // paper cash
  realizedPnL:  0,
  totalTrades:  0,
  wins:         0,
  losses:       0,
  tradeLog:     [],
};

let state = {
  lastPrice:     null,
  lastTradeTime: 0,
  botActive:     true,
  adminChatId:   null,
  tickCount:     0,
  lastClaudeAt:  0,
  claudeSignal:  null,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt  = (n) => n != null ? `$${Number(n).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
const pct  = (n) => n != null ? `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}%` : "—";
const isOk = (msg) => !ALLOWED_TELEGRAM_USER_ID || String(msg.from?.id) === String(ALLOWED_TELEGRAM_USER_ID);

function notify(text, parse_mode = "Markdown") {
  if (state.adminChatId) {
    tg.sendMessage(state.adminChatId, text, { parse_mode }).catch(() => {});
  }
}

function totalValue() {
  const holdingVal = position.btc * (state.lastPrice || 0);
  return portfolio.cash + holdingVal;
}

function winRate() {
  if (!portfolio.totalTrades) return 0;
  return ((portfolio.wins / portfolio.totalTrades) * 100).toFixed(1);
}

// ─── Trade Execution ──────────────────────────────────────────────────────────
async function executeBuy(price, reason = "") {
  const p     = brain.params;
  const spend = portfolio.cash * p.positionSize;
  if (spend < 10) return notify("⚠️ Insufficient cash to buy (min $10).");

  const qty = spend / price;

  try {
    if (!PAPER_MODE && binance) {
      const order = await binance.marketBuy(SYMBOL, spend);
      const filled = parseFloat(order.executedQty);
      const avgPrice = parseFloat(order.cummulativeQuoteQty) / filled;
      position.btc        = filled;
      position.entryPrice = avgPrice;
    } else {
      // Paper trade
      position.btc        = qty;
      position.entryPrice = price;
      portfolio.cash     -= spend;
    }

    position.entryTime  = Date.now();
    position.stopLoss   = price * (1 - p.stopLossPct);
    position.takeProfit = price * (1 + p.takeProfitPct);
    portfolio.totalTrades++;

    const msg = `🟢 *BUY EXECUTED* ${PAPER_MODE ? "(Paper)" : "✅ LIVE"}
━━━━━━━━━━━━━━━━━━
Price:       ${fmt(price)}
Qty:         ${position.btc.toFixed(6)} BTC
Spent:       ${fmt(spend)}
Stop Loss:   ${fmt(position.stopLoss)}
Take Profit: ${fmt(position.takeProfit)}
Reason: _${reason}_`;
    notify(msg);
    console.log(`[BUY] ${position.btc.toFixed(6)} BTC @ ${fmt(price)}`);

    portfolio.tradeLog.push({ action: "BUY", price, qty: position.btc, time: new Date().toISOString(), reason });
  } catch (e) {
    notify(`❌ Buy failed: ${e.message}`);
    console.error("Buy error:", e.message);
  }
}

async function executeSell(price, reason = "") {
  if (position.btc <= 0) return;
  const qty   = position.btc;
  const proceeds = qty * price;
  const pnl   = proceeds - (qty * position.entryPrice);
  const pnlPct = ((price - position.entryPrice) / position.entryPrice) * 100;

  try {
    if (!PAPER_MODE && binance) {
      await binance.marketSell(SYMBOL, qty);
    } else {
      portfolio.cash += proceeds;
    }

    portfolio.realizedPnL += pnl;
    if (pnl > 0) portfolio.wins++;
    else portfolio.losses++;

    portfolio.tradeLog.push({ action: "SELL", price, qty, pnl, time: new Date().toISOString(), reason });

    const pnlEmoji = pnl >= 0 ? "📈" : "📉";
    notify(`🔴 *SELL EXECUTED* ${PAPER_MODE ? "(Paper)" : "✅ LIVE"}
━━━━━━━━━━━━━━━━━━
Price:    ${fmt(price)}
Qty:      ${qty.toFixed(6)} BTC
Proceeds: ${fmt(proceeds)}
P&L:      ${pnlEmoji} ${pnl >= 0 ? "+" : ""}${fmt(pnl)} (${pct(pnlPct)})
Reason:   _${reason}_
━━━━━━━━━━━━━━━━━━
Total P&L: ${fmt(portfolio.realizedPnL)} | Win rate: ${winRate()}%`);

    console.log(`[SELL] ${qty.toFixed(6)} BTC @ ${fmt(price)} | P&L: ${fmt(pnl)}`);

    // Reset position
    position = { btc: 0, entryPrice: null, entryTime: null, unrealizedPnL: 0, stopLoss: null, takeProfit: null };
    state.lastTradeTime = Date.now();
  } catch (e) {
    notify(`❌ Sell failed: ${e.message}`);
    console.error("Sell error:", e.message);
  }
}

// ─── Core tick — runs on every price update (sub-second) ─────────────────────
async function onTick(price) {
  state.lastPrice = price;
  state.tickCount++;
  ind.push(price);

  // Update unrealized P&L
  if (position.btc > 0 && position.entryPrice) {
    position.unrealizedPnL = (price - position.entryPrice) * position.btc;
  }

  // Not enough data yet
  if (ind.length < 30) return;
  if (!state.botActive) return;

  const now = Date.now();
  const cooldown = brain.params.cooldownMs;

  // ── Claude re-analysis every 30s ──────────────────────────────────────
  if (now - state.lastClaudeAt > 30000) {
    state.lastClaudeAt = now;
    const snap = ind.snapshot();
    const summary = `Cash: ${fmt(portfolio.cash)} | Holdings: ${position.btc.toFixed(6)} BTC | Total P&L: ${fmt(portfolio.realizedPnL)} | Trades: ${portfolio.totalTrades}`;
    brain.analyze(snap, position, summary)
      .then(sig => { if (sig) state.claudeSignal = sig; })
      .catch(() => {});
  }

  // ── Stop loss check (highest priority, no cooldown) ───────────────────
  if (position.btc > 0 && position.stopLoss && price <= position.stopLoss) {
    return executeSell(price, `🛑 Stop loss hit @ ${fmt(position.stopLoss)}`);
  }

  // ── Take profit check ─────────────────────────────────────────────────
  if (position.btc > 0 && position.takeProfit && price >= position.takeProfit) {
    return executeSell(price, `🎯 Take profit hit @ ${fmt(position.takeProfit)}`);
  }

  // ── Cooldown guard ────────────────────────────────────────────────────
  if (now - state.lastTradeTime < cooldown) return;

  // ── Fast local strategy signal (every tick) ───────────────────────────
  const snap   = ind.snapshot();
  const signal = brain.fastSignal(snap);

  if (signal === "BUY" && position.btc === 0) {
    await executeBuy(price, buildReason(snap, "BUY"));
  } else if (signal === "SELL" && position.btc > 0) {
    await executeSell(price, buildReason(snap, "SELL"));
  }
}

function buildReason(snap, signal) {
  const parts = [];
  if (snap.rsi14)   parts.push(`RSI ${snap.rsi14.toFixed(1)}`);
  if (snap.ema9 && snap.ema21) parts.push(snap.ema9 > snap.ema21 ? "EMA bull" : "EMA bear");
  if (snap.macd)    parts.push(`MACD hist ${snap.macd.histogram?.toFixed(4)}`);
  const claudeStr = state.claudeSignal ? ` | Claude: ${state.claudeSignal.signal} ${state.claudeSignal.confidence}%` : "";
  return `${signal}: ${parts.join(", ")}${claudeStr}`;
}

// ─── Start WebSocket ──────────────────────────────────────────────────────────
function startFeed() {
  console.log(`◈ Connecting to Binance WebSocket for ${SYMBOL}...`);

  // If Binance credentials exist, use their WS client
  if (binance) {
    binance.streamPrice(SYMBOL.toLowerCase(), onTick, (err) => {
      console.error("WS error:", err.message);
    });
  } else {
    // Public WebSocket (no auth needed for price feed)
    const WebSocket = require("ws");
    const connect = () => {
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${SYMBOL.toLowerCase()}@aggTrade`);
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw);
          const price = parseFloat(msg.p);
          if (!isNaN(price)) onTick(price);
        } catch (_) {}
      });
      ws.on("close", () => { console.log("WS closed, reconnecting..."); setTimeout(connect, 2000); });
      ws.on("error", (e) => console.error("WS err:", e.message));
    };
    connect();
  }
}

// ─── Telegram Commands ───────────────────────────────────────────────────────
tg.onText(/\/start/, (msg) => {
  if (!isOk(msg)) return;
  state.adminChatId = msg.chat.id;
  tg.sendMessage(msg.chat.id,
`◈ *AERELION HFT BOT* — Live BTC/USDT
━━━━━━━━━━━━━━━━━━━━
Mode: *${PAPER_MODE ? "📄 Paper Trading" : "💸 LIVE TRADING"}*
Status: *${state.botActive ? "🟢 ACTIVE" : "🔴 PAUSED"}*

*Commands:*
/status — Live price + indicators + position
/portfolio — P&L + trade stats
/pause — Pause trading
/resume — Resume trading
/forcebuy — Manual buy now
/forcesell — Manual sell now
/params — Current strategy parameters
/trades — Last 10 trades
/claude — Last Claude AI signal
━━━━━━━━━━━━━━━━━━━━
_${PAPER_MODE ? "Paper trading — no real money at risk." : "⚠️ LIVE MODE — real funds at risk."}_`,
    { parse_mode: "Markdown" }
  );
  console.log(`Admin connected: chat ${msg.chat.id}`);
});

tg.onText(/\/status/, (msg) => {
  if (!isOk(msg)) return;
  const snap = ind.snapshot();
  const p    = state.lastPrice;
  const posStr = position.btc > 0
    ? `LONG ${position.btc.toFixed(6)} BTC\nEntry: ${fmt(position.entryPrice)} | Now: ${fmt(p)}\nUnrealized: ${fmt(position.unrealizedPnL)}\nStop: ${fmt(position.stopLoss)} | TP: ${fmt(position.takeProfit)}`
    : "FLAT";

  tg.sendMessage(msg.chat.id,
`📊 *LIVE STATUS*
━━━━━━━━━━━━━━━━━━
💰 BTC/USDT: *${fmt(p)}*
📈 RSI(14):  ${snap.rsi14?.toFixed(2) || "—"}
〰️ EMA9/21:  ${fmt(snap.ema9)} / ${fmt(snap.ema21)}
⚡ MACD Hist: ${snap.macd?.histogram?.toFixed(5) || "—"}
📉 BB:        ${fmt(snap.bb?.lower)} — ${fmt(snap.bb?.upper)}
🌡 Volatility: ${snap.vol?.toFixed(4) || "—"}%
━━━━━━━━━━━━━━━━━━
📦 Position: ${posStr}
━━━━━━━━━━━━━━━━━━
🤖 Claude: ${state.claudeSignal ? `${state.claudeSignal.signal} (${state.claudeSignal.confidence}%)` : "Pending..."}
⚡ Ticks: ${state.tickCount.toLocaleString()}
🕐 Mode: ${state.botActive ? "ACTIVE" : "PAUSED"}`,
    { parse_mode: "Markdown" }
  );
});

tg.onText(/\/portfolio/, (msg) => {
  if (!isOk(msg)) return;
  const tv = totalValue();
  tg.sendMessage(msg.chat.id,
`💼 *PORTFOLIO*
━━━━━━━━━━━━━━━━━━
💵 Cash:          ${fmt(portfolio.cash)}
₿  BTC Position:  ${position.btc.toFixed(6)} BTC
📊 Total Value:   *${fmt(tv)}*
━━━━━━━━━━━━━━━━━━
Realized P&L:  ${fmt(portfolio.realizedPnL)}
Unrealized:    ${fmt(position.unrealizedPnL)}
━━━━━━━━━━━━━━━━━━
Total Trades:  ${portfolio.totalTrades}
Wins:          ${portfolio.wins} ✅
Losses:        ${portfolio.losses} ❌
Win Rate:      ${winRate()}%`,
    { parse_mode: "Markdown" }
  );
});

tg.onText(/\/pause/, (msg) => {
  if (!isOk(msg)) return;
  state.botActive = false;
  tg.sendMessage(msg.chat.id, "⏸ *Bot paused.* No new trades will be executed.", { parse_mode: "Markdown" });
});

tg.onText(/\/resume/, (msg) => {
  if (!isOk(msg)) return;
  state.botActive = true;
  tg.sendMessage(msg.chat.id, "▶️ *Bot resumed.* Trading active.", { parse_mode: "Markdown" });
});

tg.onText(/\/forcebuy/, async (msg) => {
  if (!isOk(msg)) return;
  if (!state.lastPrice) return tg.sendMessage(msg.chat.id, "❌ No price data yet.");
  if (position.btc > 0) return tg.sendMessage(msg.chat.id, "❌ Already in a position. Sell first.");
  await executeBuy(state.lastPrice, "Manual override via Telegram");
});

tg.onText(/\/forcesell/, async (msg) => {
  if (!isOk(msg)) return;
  if (!state.lastPrice) return tg.sendMessage(msg.chat.id, "❌ No price data yet.");
  if (position.btc === 0) return tg.sendMessage(msg.chat.id, "❌ No position to sell.");
  await executeSell(state.lastPrice, "Manual override via Telegram");
});

tg.onText(/\/params/, (msg) => {
  if (!isOk(msg)) return;
  const p = brain.params;
  tg.sendMessage(msg.chat.id,
`⚙️ *STRATEGY PARAMS* (Claude-tuned)
━━━━━━━━━━━━━━━━━━
RSI Buy:      < ${p.rsiBuy}
RSI Sell:     > ${p.rsiSell}
RSI Oversold: < ${p.rsiOversold}
RSI Overbought: > ${p.rsiOverbought}
Position Size: ${(p.positionSize * 100).toFixed(0)}% of cash
Stop Loss:    ${(p.stopLossPct * 100).toFixed(2)}%
Take Profit:  ${(p.takeProfitPct * 100).toFixed(2)}%
Cooldown:     ${(p.cooldownMs / 1000).toFixed(0)}s
Min Confidence: ${p.minConfidence}%`,
    { parse_mode: "Markdown" }
  );
});

tg.onText(/\/trades/, (msg) => {
  if (!isOk(msg)) return;
  const recent = portfolio.tradeLog.slice(-10).reverse();
  if (!recent.length) return tg.sendMessage(msg.chat.id, "No trades yet.");
  let text = "📋 *RECENT TRADES*\n━━━━━━━━━━━━━━━━━━\n";
  for (const t of recent) {
    const time = new Date(t.time).toLocaleTimeString();
    const pnlStr = t.pnl != null ? ` | P&L: ${t.pnl >= 0 ? "+" : ""}${fmt(t.pnl)}` : "";
    text += `${t.action === "BUY" ? "🟢" : "🔴"} *${t.action}* ${t.qty?.toFixed(5)} BTC @ ${fmt(t.price)}${pnlStr} _${time}_\n`;
  }
  tg.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

tg.onText(/\/claude/, (msg) => {
  if (!isOk(msg)) return;
  const s = state.claudeSignal;
  if (!s) return tg.sendMessage(msg.chat.id, "🧠 Claude hasn't analyzed yet. Wait 30s after start.");
  const emoji = s.signal === "BUY" ? "🟢" : s.signal === "SELL" ? "🔴" : "🟡";
  tg.sendMessage(msg.chat.id,
`🧠 *CLAUDE AI SIGNAL*
━━━━━━━━━━━━━━━━━━
Signal:     ${emoji} *${s.signal}*
Confidence: *${s.confidence}%*
Risk:       ${s.risk}
Urgency:    ${s.urgency || "NORMAL"}
━━━━━━━━━━━━━━━━━━
_${s.reasoning}_`,
    { parse_mode: "Markdown" }
  );
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
console.log("◈ Aerelion HFT Bot starting...");
console.log(`Mode: ${PAPER_MODE ? "PAPER TRADING" : "⚠️  LIVE TRADING"}`);
console.log(`Binance: ${binance ? "connected" : "public feed only"}`);

startFeed();

// Send startup message after 3s
setTimeout(() => {
  if (state.adminChatId) {
    notify(`◈ *Bot Online* — Connecting to Binance WebSocket...`);
  }
}, 3000);

tg.on("polling_error", (e) => console.error("TG polling error:", e.message));
process.on("unhandledRejection", (e) => console.error("Unhandled:", e.message));
