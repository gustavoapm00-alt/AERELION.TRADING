const crypto = require("crypto");
const axios  = require("axios");
const WebSocket = require("ws");

const BASE = "https://api.binance.com";
const BASE_TEST = "https://testnet.binance.vision"; // paper trading endpoint

class BinanceClient {
  constructor(apiKey, apiSecret, testnet = false) {
    this.apiKey    = apiKey;
    this.apiSecret = apiSecret;
    this.base      = testnet ? BASE_TEST : BASE;
    this.testnet   = testnet;
  }

  // ── Signing ──────────────────────────────────────────────────────────────
  _sign(params) {
    const qs = new URLSearchParams({ ...params, timestamp: Date.now() }).toString();
    const sig = crypto.createHmac("sha256", this.apiSecret).update(qs).digest("hex");
    return `${qs}&signature=${sig}`;
  }

  _headers() {
    return { "X-MBX-APIKEY": this.apiKey };
  }

  // ── Account ───────────────────────────────────────────────────────────────
  async getAccount() {
    const qs = this._sign({});
    const { data } = await axios.get(`${this.base}/api/v3/account?${qs}`, { headers: this._headers() });
    return data;
  }

  async getBalance(asset = "USDT") {
    const account = await this.getAccount();
    const bal = account.balances.find(b => b.asset === asset);
    return bal ? parseFloat(bal.free) : 0;
  }

  async getBTCBalance() {
    return this.getBalance("BTC");
  }

  // ── Price ─────────────────────────────────────────────────────────────────
  async getPrice(symbol = "BTCUSDT") {
    const { data } = await axios.get(`${this.base}/api/v3/ticker/price?symbol=${symbol}`);
    return parseFloat(data.price);
  }

  async get24hr(symbol = "BTCUSDT") {
    const { data } = await axios.get(`${this.base}/api/v3/ticker/24hr?symbol=${symbol}`);
    return data;
  }

  // ── Orders ────────────────────────────────────────────────────────────────
  // Market buy — spends `quoteQty` USDT
  async marketBuy(symbol = "BTCUSDT", quoteQty) {
    const qs = this._sign({ symbol, side: "BUY", type: "MARKET", quoteOrderQty: quoteQty.toFixed(2) });
    const { data } = await axios.post(`${this.base}/api/v3/order?${qs}`, null, { headers: this._headers() });
    return data;
  }

  // Market sell — sells `qty` BTC
  async marketSell(symbol = "BTCUSDT", qty) {
    const qs = this._sign({ symbol, side: "SELL", type: "MARKET", quantity: qty.toFixed(6) });
    const { data } = await axios.post(`${this.base}/api/v3/order?${qs}`, null, { headers: this._headers() });
    return data;
  }

  // Stop-loss limit order
  async stopLoss(symbol, qty, stopPrice, limitPrice) {
    const qs = this._sign({
      symbol, side: "SELL", type: "STOP_LOSS_LIMIT",
      quantity: qty.toFixed(6),
      stopPrice: stopPrice.toFixed(2),
      price: limitPrice.toFixed(2),
      timeInForce: "GTC",
    });
    const { data } = await axios.post(`${this.base}/api/v3/order?${qs}`, null, { headers: this._headers() });
    return data;
  }

  // Cancel all open orders for symbol
  async cancelAll(symbol = "BTCUSDT") {
    const qs = this._sign({ symbol });
    try {
      const { data } = await axios.delete(`${this.base}/api/v3/openOrders?${qs}`, { headers: this._headers() });
      return data;
    } catch (_) { return []; }
  }

  // Get open orders
  async openOrders(symbol = "BTCUSDT") {
    const qs = this._sign({ symbol });
    const { data } = await axios.get(`${this.base}/api/v3/openOrders?${qs}`, { headers: this._headers() });
    return data;
  }

  // Trade history
  async myTrades(symbol = "BTCUSDT", limit = 20) {
    const qs = this._sign({ symbol, limit });
    const { data } = await axios.get(`${this.base}/api/v3/myTrades?${qs}`, { headers: this._headers() });
    return data;
  }

  // ── WebSocket Price Feed ──────────────────────────────────────────────────
  // Streams real-time trade prices — fires callback every ~100ms to ~1s
  streamPrice(symbol = "btcusdt", onPrice, onError) {
    const wsBase = this.testnet
      ? "wss://testnet.binance.vision"
      : "wss://stream.binance.com:9443";

    const ws = new WebSocket(`${wsBase}/ws/${symbol}@aggTrade`);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);
        const price = parseFloat(msg.p);
        if (!isNaN(price)) onPrice(price, msg);
      } catch (_) {}
    });

    ws.on("error", (err) => onError && onError(err));

    ws.on("close", () => {
      // Auto-reconnect after 2s
      console.log("WS disconnected — reconnecting in 2s...");
      setTimeout(() => this.streamPrice(symbol, onPrice, onError), 2000);
    });

    return ws;
  }

  // Kline/candlestick stream
  streamKlines(symbol = "btcusdt", interval = "1m", onKline) {
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@kline_${interval}`);
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);
        const k = msg.k;
        onKline({
          open:   parseFloat(k.o),
          high:   parseFloat(k.h),
          low:    parseFloat(k.l),
          close:  parseFloat(k.c),
          volume: parseFloat(k.v),
          closed: k.x,
        });
      } catch (_) {}
    });
    ws.on("close", () => setTimeout(() => this.streamKlines(symbol, interval, onKline), 2000));
    return ws;
  }
}

module.exports = BinanceClient;
