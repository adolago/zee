/**
 * Investing Finance Plugin
 *
 * Domain-specific plugin for Investing, the financial data agent.
 * Provides integrations with financial data sources and APIs.
 *
 * Features:
 * - Plaid integration for banking data
 * - Market data APIs (Alpha Vantage, Yahoo Finance)
 * - Financial calculations and analysis
 * - Transaction categorization
 */

import type {
  PluginFactory,
  PluginContext,
  PluginInstance,
  AuthProvider,
  ToolDefinition,
} from '../../plugin';
import { z } from 'zod';

export interface InvestingFinanceConfig {
  /** Plaid client ID */
  plaidClientId?: string;
  /** Plaid secret */
  plaidSecret?: string;
  /** Plaid environment */
  plaidEnv?: 'sandbox' | 'development' | 'production';
  /** Alpha Vantage API key */
  alphaVantageKey?: string;
  /** Yahoo Finance API key (optional) */
  yahooFinanceKey?: string;
  /** Default currency */
  defaultCurrency?: string;
}

/**
 * Investing Finance Plugin Factory
 */
export const InvestingFinancePlugin: PluginFactory = async (
  ctx: PluginContext
): Promise<PluginInstance> => {
  const config: InvestingFinanceConfig = {
    plaidClientId: ctx.config.get('investing.plaid.clientId') || process.env.PLAID_CLIENT_ID,
    plaidSecret: ctx.config.get('investing.plaid.secret') || process.env.PLAID_SECRET,
    plaidEnv: ctx.config.get('investing.plaid.env') || 'sandbox',
    alphaVantageKey: ctx.config.get('investing.alphaVantage.key') || process.env.ALPHA_VANTAGE_API_KEY,
    yahooFinanceKey: ctx.config.get('investing.yahooFinance.key') || process.env.YAHOO_FINANCE_KEY,
    defaultCurrency: ctx.config.get('investing.defaultCurrency') || 'USD',
  };

  // Cache for API responses
  const cache = new Map<string, { data: unknown; expiresAt: number }>();

  /**
   * Fetch with caching
   */
  async function fetchWithCache(
    url: string,
    options: RequestInit = {},
    cacheTtl = 300000 // 5 minutes
  ): Promise<unknown> {
    const cacheKey = `${url}:${JSON.stringify(options)}`;
    const cached = cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    cache.set(cacheKey, { data, expiresAt: Date.now() + cacheTtl });

    return data;
  }

  // Plaid auth provider
  const plaidAuthProvider: AuthProvider | null = config.plaidClientId
    ? {
        provider: 'plaid',
        displayName: 'Plaid Banking',
        methods: [
          {
            type: 'api',
            label: 'Connect Bank Account',
            prompts: [
              {
                type: 'text',
                key: 'publicToken',
                message: 'Enter Plaid public token from Link',
                placeholder: 'public-sandbox-...',
              },
            ],
            async authorize(inputs) {
              if (!inputs?.publicToken) {
                return { type: 'failed' };
              }

              try {
                // Exchange public token for access token
                const plaidEnvUrl =
                  config.plaidEnv === 'production'
                    ? 'https://production.plaid.com'
                    : config.plaidEnv === 'development'
                      ? 'https://development.plaid.com'
                      : 'https://sandbox.plaid.com';

                const response = await fetch(`${plaidEnvUrl}/item/public_token/exchange`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    client_id: config.plaidClientId,
                    secret: config.plaidSecret,
                    public_token: inputs.publicToken,
                  }),
                });

                if (!response.ok) {
                  return { type: 'failed' };
                }

                const data = await response.json();

                return {
                  type: 'success',
                  key: data.access_token,
                  provider: 'plaid',
                };
              } catch {
                return { type: 'failed' };
              }
            },
          },
        ],
      }
    : null;

  // Tool definitions
  const tools: Record<string, ToolDefinition> = {
    get_stock_quote: {
      description: 'Get current stock quote for a symbol',
      args: {
        symbol: z.string().describe('Stock symbol (e.g., AAPL, GOOGL)'),
      },
      async execute(args) {
        if (!config.alphaVantageKey) {
          return 'Alpha Vantage API key not configured';
        }

        const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${args.symbol}&apikey=${config.alphaVantageKey}`;
        const data = (await fetchWithCache(url, {}, 60000)) as Record<string, unknown>;

        const quote = data['Global Quote'] as Record<string, string> | undefined;
        if (!quote) {
          return `No quote data found for ${args.symbol}`;
        }

        return JSON.stringify(
          {
            symbol: quote['01. symbol'],
            price: quote['05. price'],
            change: quote['09. change'],
            changePercent: quote['10. change percent'],
            volume: quote['06. volume'],
            latestTradingDay: quote['07. latest trading day'],
          },
          null,
          2
        );
      },
    },

    get_stock_history: {
      description: 'Get historical stock data for a symbol',
      args: {
        symbol: z.string().describe('Stock symbol'),
        interval: z
          .enum(['daily', 'weekly', 'monthly'])
          .optional()
          .describe('Data interval'),
        outputSize: z
          .enum(['compact', 'full'])
          .optional()
          .describe('compact=100 data points, full=20+ years'),
      },
      async execute(args) {
        if (!config.alphaVantageKey) {
          return 'Alpha Vantage API key not configured';
        }

        const functionName =
          args.interval === 'weekly'
            ? 'TIME_SERIES_WEEKLY'
            : args.interval === 'monthly'
              ? 'TIME_SERIES_MONTHLY'
              : 'TIME_SERIES_DAILY';

        const url = `https://www.alphavantage.co/query?function=${functionName}&symbol=${args.symbol}&outputsize=${args.outputSize || 'compact'}&apikey=${config.alphaVantageKey}`;
        const data = (await fetchWithCache(url, {}, 300000)) as Record<string, unknown>;

        // Extract time series data
        const seriesKey = Object.keys(data).find((k) => k.includes('Time Series'));
        if (!seriesKey) {
          return `No historical data found for ${args.symbol}`;
        }

        const series = data[seriesKey] as Record<string, Record<string, string>>;
        const entries = Object.entries(series).slice(0, 10); // Last 10 data points

        return JSON.stringify(
          entries.map(([date, values]) => ({
            date,
            open: values['1. open'],
            high: values['2. high'],
            low: values['3. low'],
            close: values['4. close'],
            volume: values['5. volume'],
          })),
          null,
          2
        );
      },
    },

    calculate_compound_interest: {
      description: 'Calculate compound interest',
      args: {
        principal: z.number().describe('Initial investment amount'),
        rate: z.number().describe('Annual interest rate (as decimal, e.g., 0.05 for 5%)'),
        time: z.number().describe('Time period in years'),
        compoundingFrequency: z
          .enum(['annually', 'semi-annually', 'quarterly', 'monthly', 'daily'])
          .optional()
          .describe('How often interest is compounded'),
        monthlyContribution: z.number().optional().describe('Additional monthly contribution'),
      },
      async execute(args) {
        const n =
          {
            annually: 1,
            'semi-annually': 2,
            quarterly: 4,
            monthly: 12,
            daily: 365,
          }[args.compoundingFrequency || 'annually'] || 1;

        const P = args.principal;
        const r = args.rate;
        const t = args.time;
        const PMT = args.monthlyContribution || 0;

        // A = P(1 + r/n)^(nt) + PMT * (((1 + r/n)^(nt) - 1) / (r/n))
        const compoundFactor = Math.pow(1 + r / n, n * t);
        const principalGrowth = P * compoundFactor;

        let contributionGrowth = 0;
        if (PMT > 0 && r > 0) {
          // Convert monthly contribution to match compounding frequency
          const adjustedPMT = PMT * (12 / n);
          contributionGrowth = adjustedPMT * ((compoundFactor - 1) / (r / n));
        } else if (PMT > 0) {
          contributionGrowth = PMT * 12 * t;
        }

        const finalAmount = principalGrowth + contributionGrowth;
        const totalContributions = P + PMT * 12 * t;
        const totalInterest = finalAmount - totalContributions;

        return JSON.stringify(
          {
            initialPrincipal: P.toFixed(2),
            totalContributions: totalContributions.toFixed(2),
            totalInterest: totalInterest.toFixed(2),
            finalAmount: finalAmount.toFixed(2),
            effectiveAnnualRate: ((Math.pow(1 + r / n, n) - 1) * 100).toFixed(2) + '%',
          },
          null,
          2
        );
      },
    },

    categorize_transaction: {
      description: 'Categorize a financial transaction',
      args: {
        description: z.string().describe('Transaction description'),
        amount: z.number().describe('Transaction amount'),
        merchant: z.string().optional().describe('Merchant name if known'),
      },
      async execute(args) {
        // Simple rule-based categorization
        const description = args.description.toLowerCase();
        const merchant = (args.merchant || '').toLowerCase();
        const text = `${description} ${merchant}`;

        const categories: Record<string, string[]> = {
          'Food & Dining': [
            'restaurant',
            'cafe',
            'coffee',
            'food',
            'doordash',
            'uber eats',
            'grubhub',
            'mcdonalds',
            'starbucks',
          ],
          Groceries: ['grocery', 'supermarket', 'whole foods', 'trader joe', 'kroger', 'safeway'],
          Transportation: ['uber', 'lyft', 'gas', 'fuel', 'parking', 'transit', 'metro'],
          Shopping: ['amazon', 'target', 'walmart', 'costco', 'retail', 'store'],
          Entertainment: ['netflix', 'spotify', 'hulu', 'movie', 'theater', 'concert', 'gaming'],
          Utilities: ['electric', 'water', 'gas bill', 'internet', 'phone', 'utility'],
          Healthcare: ['pharmacy', 'doctor', 'hospital', 'medical', 'dental', 'health'],
          Travel: ['airline', 'hotel', 'airbnb', 'booking', 'travel', 'flight'],
          Subscriptions: ['subscription', 'membership', 'monthly', 'annual fee'],
          Income: ['deposit', 'payroll', 'salary', 'transfer in', 'refund'],
        };

        for (const [category, keywords] of Object.entries(categories)) {
          if (keywords.some((kw) => text.includes(kw))) {
            return JSON.stringify({
              category,
              confidence: 0.85,
              amount: args.amount,
              isExpense: args.amount < 0 || category !== 'Income',
            });
          }
        }

        return JSON.stringify({
          category: 'Other',
          confidence: 0.5,
          amount: args.amount,
          isExpense: args.amount < 0,
        });
      },
    },
  };

  return {
    metadata: {
      name: 'investing-finance',
      version: '1.0.0',
      description: 'Financial data and analysis tools for Investing',
      author: 'Agent Core',
      tags: ['finance', 'investing', 'domain'],
    },

    lifecycle: {
      async init() {
        ctx.logger.info('Investing Finance plugin initialized', {
          hasPlaid: !!config.plaidClientId,
          hasAlphaVantage: !!config.alphaVantageKey,
        });
      },

      async destroy() {
        cache.clear();
        ctx.logger.info('Investing Finance plugin destroyed');
      },
    },

    auth: plaidAuthProvider ? [plaidAuthProvider] : [],
    tools,

    hooks: {
      'chat.message': async (input, output) => {
        // Enhance financial queries with context
        if (input.agentId?.toLowerCase() === 'investing') {
          // Could add financial context or defaults here
          return {
            ...output,
            parts: [
              ...output.parts,
              {
                type: 'text',
                content: `[Financial context: Currency=${config.defaultCurrency}]`,
              },
            ],
          };
        }
        return output;
      },
    },
  };
};

export default InvestingFinancePlugin;
