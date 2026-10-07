class OnlineTabularRegressor {
  constructor(options = {}) {
    this.seasons = options.seasons || ['Spring', 'Summer', 'Autumn', 'Winter'];
    this.days = options.days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    this.learningRate = options.learningRate || 0.05;
    this.storageKey = options.storageKey || 'tabular_model_state';
    
    // Feature vector length: 4 seasons + 1 normalized time + 7 days = 12 features
this.numFeatures = this.seasons.length + 96 + this.days.length;
    this.loadState();
  }

  // Convert (S, t, d) into a numeric feature array
  encode(season, time, day) {
    
    const x = new Array(this.numFeatures).fill(0);
    
    // 1. One-hot Season
    const sIdx = this.seasons.indexOf(season);
    if (sIdx !== -1) x[sIdx] = 1;

    // In model.js: normalize 15-minute bucket (0 to 95)
    const bucket = Math.max(0, Math.min(95, Math.round(parseFloat(time) || 0)));
x[this.seasons.length + bucket] = 1;

    // 3. One-hot Day
    const dIdx = this.days.indexOf(day);
    if (dIdx !== -1) x[this.seasons.length + 1 + dIdx] = 1;
    return x;
  }

  // Predict F given inputs (returns float prediction)
  predict(season, time, day) {
    const x = this.encode(season, time, day);
    let yHat = this.bias;
    for (let i = 0; i < this.numFeatures; i++) {
      yHat += this.weights[i] * x[i];
    }
    return yHat;
  }

  // Online learning update using stochastic gradient descent
  learn(season, time, day, correctF, persist = true) {
    const x = this.encode(season, time, day);
    const pred = this.predict(season, time, day);
    const error = pred - parseFloat(correctF);

    // Update weights and bias
    for (let i = 0; i < this.numFeatures; i++) {
      this.weights[i] -= this.learningRate * error * x[i];
    }
    this.bias -= this.learningRate * error;

    if (persist) this.saveState();
    return Math.abs(error);
  }

  // Persist weights in browser local storage
  saveState() {
    localStorage.setItem(this.storageKey, JSON.stringify({
      weights: this.weights,
      bias: this.bias
    }));
  }

  loadState() {
    const saved = localStorage.getItem(this.storageKey);
    if (saved) {
      const data = JSON.parse(saved);
      this.weights = data.weights;
      this.bias = data.bias;
    } else {
      this.reset();
    }
  }

  reset() {
    this.weights = new Array(this.numFeatures).fill(0.0);
    this.bias = 0.0;
    this.saveState();
  }
}