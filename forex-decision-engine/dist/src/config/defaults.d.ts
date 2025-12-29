/**
 * Default Settings - E8 Markets Prop Firm Rules
 * Based on $10,000 account with standard E8 rules
 */
export declare const DEFAULTS: {
    readonly account: {
        readonly size: 10000;
        readonly currency: "USD";
    };
    readonly risk: {
        readonly perTrade: 0.5;
        readonly dailyLossLimit: 4;
        readonly maxDrawdown: 6;
        readonly maxLotForex: 50;
        readonly maxLotGold: 20;
        readonly maxOrders: 100;
    };
    readonly leverage: {
        readonly forex: 50;
        readonly indices: 25;
        readonly crypto: 2;
    };
    readonly style: "intraday";
    readonly timezone: "America/Chicago";
};
export declare const RISK_OPTIONS: readonly [{
    readonly value: 0.25;
    readonly label: "0.25% (Conservative)";
}, {
    readonly value: 0.5;
    readonly label: "0.5% (Recommended)";
}, {
    readonly value: 1;
    readonly label: "1% (Standard)";
}, {
    readonly value: 2;
    readonly label: "2% (Aggressive)";
}];
export declare const VALIDATION: {
    readonly account: {
        readonly min: 100;
        readonly max: 1000000;
    };
    readonly risk: {
        readonly min: 0.1;
        readonly max: 5;
    };
};
export declare const LOT_SIZES: {
    readonly standard: 100000;
    readonly mini: 10000;
    readonly micro: 1000;
};
export declare const PIP_VALUES: {
    readonly standard: 10;
    readonly mini: 1;
    readonly micro: 0.1;
};
