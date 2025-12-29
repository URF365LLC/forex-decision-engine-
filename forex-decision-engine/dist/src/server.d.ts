/**
 * Forex Decision Engine - API Server
 *
 * Endpoints:
 * GET  /api/health          - Health check
 * GET  /api/universe        - Get available symbols
 * GET  /api/status          - Cache and rate limiter status
 * POST /api/analyze         - Analyze single symbol
 * POST /api/scan            - Scan multiple symbols
 * GET  /api/signals         - Get signal history
 * PUT  /api/signals/:id     - Update signal result
 */
import 'dotenv/config';
