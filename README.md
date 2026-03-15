# ◈ Aerelion HFT Bot — AI Crypto Trading Bot

**Claude AI + Binance WebSocket + Telegram = Sub-second BTC trading**

---

## Architecture

```
Binance WebSocket ──→ Price Tick (every ~100ms)
                          │
                          ▼
                   Indicators Engine
                   RSI + EMA + MACD + BB
                          │
                          ├──→ Fast Signal (every tick)
                          │    Local rules → BUY/SELL/HOLD
                          │
                          └──→ Claude AI (every 30s)
                               Analyzes all indicators
                               Returns signal + tunes params
                                    │
                                    ▼
                            Order Execution
                            Binance API (real) or Paper
                                    │
                                    ▼
                            Telegram Notification
                            You get alerted instantly
```

---

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome + command list |
| `/status` | Live price, all indicators, current position |
| `/portfolio` | Cash, holdings, realized P&L, win rate |
| `/pause` | Pause all trading |
| `/resume` | Resume trading |
| `/forcebuy` | Manual buy at market price |
| `/forcesell` | Manual sell at market price |
| `/params` | Current Claude-tuned strategy parameters |
| `/trades` | Last 10 trades |
| `/claude` | Latest Claude AI signal + reasoning |

---

## Setup

### Step 1 — Create Telegram Bot
1. Message **@BotFather** on Telegram
2. `/newbot` → name it → copy the token

### Step 2 — Binance API Keys

**For testnet (recommended first):**
1. Go to https://testnet.binance.vision
2. Log in with GitHub
3. Generate API key + secret
4. Get free testnet funds from the faucet

**For live trading:**
1. Go to https://www.binance.com → Account → API Management
2. Create API key
3. Enable: ✅ Spot & Margin Trading
4. Disable: ❌ Withdrawals (security)
5. Whitelist your server IP

### Step 3 — Anthropic API Key
Get from: https://console.anthropic.com → API Keys

### Step 4 — Configure .env
```bash
cp .env.example .env
# Fill in all keys
# Keep TESTNET=true and TRADING_ENABLED=false to paper trade first
```

### Step 5 — Run locally
```bash
npm install
node bot.js
```

---

## Deploy to Railway (free 24/7)

1. Push this folder to a **GitHub repo**
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Go to **Variables** tab → add all keys from .env.example
4. Railway auto-detects `npm start` → deploys instantly

**Recommended Railway variables for live trading:**
```
TELEGRAM_BOT_TOKEN=...
ANTHROPIC_API_KEY=...
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
TESTNET=false
TRADING_ENABLED=true
ALLOWED_TELEGRAM_USER_ID=...
```

---

## Safety / Risk Management

| Feature | Default |
|---------|---------|
| Stop Loss | 1.5% below entry |
| Take Profit | 2.5% above entry |
| Position size | 25% of cash per trade |
| Trade cooldown | 45 seconds between trades |
| Min AI confidence | 60% before trading |

Claude AI automatically tunes all these parameters based on real-time market conditions.

---

## Going Live Checklist

- [ ] Tested on testnet with TESTNET=true
- [ ] Paper traded for at least 24 hours
- [ ] Set ALLOWED_TELEGRAM_USER_ID (security)
- [ ] Binance API key has IP whitelist
- [ ] Start with small amount ($100-200)
- [ ] Monitor first live trades manually

---

## ⚠️ Risk Warning

This is a real trading bot that can lose real money. Crypto markets are volatile. Start with the smallest amount you can afford to lose entirely. This is not financial advice.

---

_Aerelion Systems LLC — AI Automation_
