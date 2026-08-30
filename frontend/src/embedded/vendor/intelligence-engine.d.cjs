declare const engine: {
  runIntelligenceEngine: (aggregate: any, breakdown: any[], profile?: Record<string, unknown>, opts?: Record<string, unknown>) => Record<string, unknown>;
  renderEngineReport: (engine: Record<string, unknown>, profile?: Record<string, unknown>) => string;
};
export = engine;;
