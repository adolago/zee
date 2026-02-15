-- Stanley Database Initialization Script
-- This script runs automatically when the PostgreSQL container is first created

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create schemas
CREATE SCHEMA IF NOT EXISTS market_data;
CREATE SCHEMA IF NOT EXISTS institutional;
CREATE SCHEMA IF NOT EXISTS portfolio;
CREATE SCHEMA IF NOT EXISTS research;
CREATE SCHEMA IF NOT EXISTS signals;

-- Grant permissions to stanley user
GRANT ALL PRIVILEGES ON SCHEMA market_data TO stanley;
GRANT ALL PRIVILEGES ON SCHEMA institutional TO stanley;
GRANT ALL PRIVILEGES ON SCHEMA portfolio TO stanley;
GRANT ALL PRIVILEGES ON SCHEMA research TO stanley;
GRANT ALL PRIVILEGES ON SCHEMA signals TO stanley;

-- Market data tables
CREATE TABLE IF NOT EXISTS market_data.price_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    open DECIMAL(18, 4),
    high DECIMAL(18, 4),
    low DECIMAL(18, 4),
    close DECIMAL(18, 4),
    volume BIGINT,
    adj_close DECIMAL(18, 4),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(symbol, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_price_history_symbol_ts
ON market_data.price_history(symbol, timestamp DESC);

-- Institutional holdings table
CREATE TABLE IF NOT EXISTS institutional.holdings_13f (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manager_cik VARCHAR(20) NOT NULL,
    manager_name VARCHAR(255),
    symbol VARCHAR(20) NOT NULL,
    cusip VARCHAR(20),
    shares_held BIGINT,
    value_held DECIMAL(18, 2),
    filing_date DATE NOT NULL,
    report_date DATE NOT NULL,
    change_from_prior DECIMAL(18, 2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(manager_cik, symbol, report_date)
);

CREATE INDEX IF NOT EXISTS idx_holdings_symbol
ON institutional.holdings_13f(symbol);

CREATE INDEX IF NOT EXISTS idx_holdings_manager
ON institutional.holdings_13f(manager_cik);

-- Portfolio tracking
CREATE TABLE IF NOT EXISTS portfolio.positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    portfolio_id UUID NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    shares DECIMAL(18, 6) NOT NULL,
    average_cost DECIMAL(18, 4),
    entry_date TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Signals table
CREATE TABLE IF NOT EXISTS signals.generated_signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    signal_type VARCHAR(50) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL, -- 'long', 'short', 'neutral'
    strength DECIMAL(5, 4), -- 0.0 to 1.0
    confidence DECIMAL(5, 4),
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_symbol_type
ON signals.generated_signals(symbol, signal_type, generated_at DESC);

-- Research notes
CREATE TABLE IF NOT EXISTS research.notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20),
    title VARCHAR(255) NOT NULL,
    content TEXT,
    note_type VARCHAR(50),
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_symbol
ON research.notes(symbol);

-- Log initialization
DO $$
BEGIN
    RAISE NOTICE 'Stanley database initialized successfully';
END $$;
