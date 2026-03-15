// ─── Real-time Technical Indicators ──────────────────────────────────────────
// All calculated on a rolling price buffer updated every second via WebSocket

class Indicators {
  constructor(maxBuffer = 500) {
    this.prices = [];
    this.maxBuffer = maxBuffer;
  }

  push(price) {
    this.prices.push(price);
    if (this.prices.length > this.maxBuffer) this.prices.shift();
  }

  get length() { return this.prices.length; }

  // Exponential Moving Average
  ema(period, data = this.prices) {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  // Simple Moving Average
  sma(period) {
    if (this.prices.length < period) return null;
    const slice = this.prices.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  // RSI (Relative Strength Index)
  rsi(period = 14) {
    if (this.prices.length < period + 1) return null;
    const slice = this.prices.slice(-(period + 1));
    let gains = 0, losses = 0;
    for (let i = 1; i < slice.length; i++) {
      const delta = slice[i] - slice[i - 1];
      if (delta > 0) gains += delta;
      else losses -= delta;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  // MACD (12, 26, 9)
  macd(fast = 12, slow = 26, signal = 9) {
    if (this.prices.length < slow + signal) return null;
    const emaFast = this.ema(fast);
    const emaSlow = this.ema(slow);
    if (emaFast === null || emaSlow === null) return null;
    const macdLine = emaFast - emaSlow;

    // Signal line: EMA of MACD values
    // Approximate using recent MACD values
    const macdValues = [];
    const step = Math.floor(this.prices.length / signal);
    for (let i = 0; i < signal; i++) {
      const slice = this.prices.slice(0, Math.max(slow, (i + 1) * step));
      const ef = this.ema(fast, slice);
      const es = this.ema(slow, slice);
      if (ef !== null && es !== null) macdValues.push(ef - es);
    }
    const signalLine = macdValues.length >= signal
      ? macdValues.reduce((a, b) => a + b, 0) / macdValues.length
      : macdLine;

    return {
      macd: macdLine,
      signal: signalLine,
      histogram: macdLine - signalLine,
    };
  }

  // Bollinger Bands
  bollinger(period = 20, stdDev = 2) {
    if (this.prices.length < period) return null;
    const slice = this.prices.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    return {
      upper: mean + stdDev * std,
      middle: mean,
      lower: mean - stdDev * std,
      bandwidth: (stdDev * 2 * std) / mean,
    };
  }

  // Volatility (standard deviation of returns)
  volatility(period = 20) {
    if (this.prices.length < period + 1) return null;
    const slice = this.prices.slice(-(period + 1));
    const returns = [];
    for (let i = 1; i < slice.length; i++) {
      returns.push((slice[i] - slice[i - 1]) / slice[i - 1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    return Math.sqrt(variance) * 100; // as percentage
  }

  // All indicators snapshot
  snapshot() {
    const price = this.prices[this.prices.length - 1];
    return {
      price,
      ema9:  this.ema(9),
      ema21: this.ema(21),
      ema50: this.ema(50),
      sma20: this.sma(20),
      rsi14: this.rsi(14),
      macd:  this.macd(),
      bb:    this.bollinger(),
      vol:   this.volatility(),
      bars:  this.prices.length,
    };
  }
}

module.exports = Indicators;
