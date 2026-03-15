const axios = require("axios");

class ClaudeBrain {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.lastSignal = null;
    this.lastAnalysis = null;
    this.analyzing = false;

    // Strategy params Claude can tune dynamically
    this.params = {
      rsiBuy:       35,   // RSI below this → consider buy
      rsiSell:      68,   // RSI above this → consider sell
      rsiOverbought: 78,  // RSI above this → strong sell
      rsiOversold:   25,  // RSI below this → strong buy
      emaCrossBull:  true,  // require EMA9 > EMA21 to buy
      emaCrossBear:  true,  // require EMA9 < EMA21 to sell
      bbBuy:         true,  // buy near lower bollinger band
      bbSell:        true,  // sell near upper bollinger band
      macdConfirm:   true,  // require MACD histogram agreement
      positionSize:  0.25,  // % of cash to deploy per trade (0.25 = 25%)
      stopLossPct:   0.015, // 1.5% stop loss
      takeProfitPct: 0.025, // 2.5% take profit
      cooldownMs:    45000, // min ms between trades
      minConfidence: 60,    // minimum Claude confidence to trade
    };
  }

  // ── Main analysis called every 30s ───────────────────────────────────────
  async analyze(snapshot, position, portfolioSummary) {
    if (this.analyzing) return this.lastSignal;
    this.analyzing = true;

    try {
      const { price, ema9, ema21, ema50, rsi14, macd, bb, vol, bars } = snapshot;
      if (bars < 30) {
        this.analyzing = false;
        return null;
      }

      const prompt = `You are an expert high-frequency crypto trading AI managing a live BTC/USDT bot on Binance.

CURRENT MARKET DATA:
Price:     $${price?.toFixed(2)}
RSI(14):   ${rsi14?.toFixed(2)}
EMA9:      $${ema9?.toFixed(2)}
EMA21:     $${ema21?.toFixed(2)}
EMA50:     $${ema50?.toFixed(2)}
MACD:      ${macd?.macd?.toFixed(4)} | Signal: ${macd?.signal?.toFixed(4)} | Hist: ${macd?.histogram?.toFixed(4)}
BB Upper:  $${bb?.upper?.toFixed(2)} | Mid: $${bb?.middle?.toFixed(2)} | Lower: $${bb?.lower?.toFixed(2)}
Volatility: ${vol?.toFixed(4)}%
Data bars:  ${bars}

CURRENT POSITION:
${position.btc > 0
  ? `LONG: ${position.btc.toFixed(6)} BTC @ avg entry $${position.entryPrice?.toFixed(2)} | Unrealized P&L: $${position.unrealizedPnL?.toFixed(2)}`
  : "FLAT: No position"
}

PORTFOLIO: ${portfolioSummary}

YOUR JOB:
1. Analyze the indicators and give a trading signal
2. Optionally tune the strategy parameters if market conditions warrant it
3. Be aggressive but not reckless — this is real money

Return ONLY raw JSON, no markdown:
{
  "signal": "BUY" | "SELL" | "HOLD",
  "confidence": 0-100,
  "reasoning": "1-2 sentences max",
  "risk": "LOW" | "MEDIUM" | "HIGH",
  "urgency": "NORMAL" | "URGENT",
  "tune": {
    "rsiBuy": number,
    "rsiSell": number,
    "positionSize": 0.1-0.5,
    "stopLossPct": 0.005-0.04,
    "takeProfitPct": 0.01-0.06,
    "cooldownMs": 15000-120000
  }
}`;

      const { data } = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          system: "You are a high-frequency crypto trading AI. Return raw JSON only, no markdown, no explanation.",
          messages: [{ role: "user", content: prompt }],
        },
        {
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );

      const text = data.content[0].text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(text);

      // Apply tuned params from Claude
      if (parsed.tune) {
        const t = parsed.tune;
        if (t.rsiBuy)         this.params.rsiBuy         = Math.max(20, Math.min(50, t.rsiBuy));
        if (t.rsiSell)        this.params.rsiSell        = Math.max(55, Math.min(85, t.rsiSell));
        if (t.positionSize)   this.params.positionSize   = Math.max(0.05, Math.min(0.5, t.positionSize));
        if (t.stopLossPct)    this.params.stopLossPct    = Math.max(0.005, Math.min(0.04, t.stopLossPct));
        if (t.takeProfitPct)  this.params.takeProfitPct  = Math.max(0.01,  Math.min(0.06, t.takeProfitPct));
        if (t.cooldownMs)     this.params.cooldownMs     = Math.max(15000, Math.min(120000, t.cooldownMs));
      }

      this.lastSignal   = parsed;
      this.lastAnalysis = new Date();
      return parsed;
    } catch (e) {
      console.error("Claude error:", e.message);
      return this.lastSignal; // return last known signal on error
    } finally {
      this.analyzing = false;
    }
  }

  // ── Fast local strategy (runs every second) ────────────────────────────
  // Uses Claude's tuned params + real-time indicators
  fastSignal(snapshot) {
    const { price, ema9, ema21, rsi14, macd, bb } = snapshot;
    const p = this.params;

    if (!rsi14 || !ema9 || !ema21) return "HOLD";

    let buyScore  = 0;
    let sellScore = 0;

    // RSI signals
    if (rsi14 < p.rsiOversold)  buyScore  += 3;
    else if (rsi14 < p.rsiBuy)  buyScore  += 1;
    if (rsi14 > p.rsiOverbought) sellScore += 3;
    else if (rsi14 > p.rsiSell)  sellScore += 1;

    // EMA cross
    if (ema9 > ema21) buyScore  += 1;
    else              sellScore += 1;

    // MACD histogram
    if (macd) {
      if (macd.histogram > 0 && macd.macd > macd.signal) buyScore  += 1;
      if (macd.histogram < 0 && macd.macd < macd.signal) sellScore += 1;
    }

    // Bollinger bands
    if (bb) {
      if (price <= bb.lower * 1.002) buyScore  += 2;
      if (price >= bb.upper * 0.998) sellScore += 2;
    }

    // Claude's directional bias
    if (this.lastSignal) {
      if (this.lastSignal.signal === "BUY"  && this.lastSignal.confidence > p.minConfidence) buyScore  += 2;
      if (this.lastSignal.signal === "SELL" && this.lastSignal.confidence > p.minConfidence) sellScore += 2;
    }

    if (buyScore  >= 4 && buyScore  > sellScore) return "BUY";
    if (sellScore >= 4 && sellScore > buyScore)  return "SELL";
    return "HOLD";
  }
}

module.exports = ClaudeBrain;
