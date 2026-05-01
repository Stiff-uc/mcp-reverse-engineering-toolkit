/**
 * MCP Proxy configuration module.
 *
 * Provides server port constants, logging infrastructure, and response size limits.
 * All logs are written both to console and to a rotating file in logs/mcp-proxy.log.
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Resolve the directory of this module (ESM equivalent of __dirname)
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', '..', 'logs');
const LOG_FILE = join(LOG_DIR, 'mcp-proxy.log');

/** Port for the Express / MCP HTTP server (overridable via EXPRESS_PORT env var) */
const EXPRESS_PORT = parseInt(process.env.EXPRESS_PORT, 10) || 3100;

/** Port for the WebSocket server connecting to JS Agent (overridable via WS_PORT env var) */
const WS_PORT = parseInt(process.env.WS_PORT, 10) || 3101;

/** Minimum log level to output (overridable via LOG_LEVEL env var) */
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

/** Maximum allowed size (in bytes) for MCP tool responses before truncation */
const MAX_RESPONSE_SIZE = 50 * 1024;

// Ensure the logs directory exists before creating the write stream
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

// Append-only write stream for persistent log file output
const logStream = createWriteStream(LOG_FILE, { flags: 'a' });

/**
 * Unified logging function that writes to both console and log file.
 *
 * Format: [ISO-8601 timestamp] [level] [tag] message (optional JSON data)
 *
 * @param {'info'|'debug'|'warn'|'error'} level - Log severity level
 * @param {string} tag - Contextual tag identifying the source module (e.g. 'MCP-Proxy', 'WS-Bridge')
 * @param {string} message - Human-readable log message
 * @param {*} [data] - Optional structured data serialized as JSON
 */
function log(level, tag, message, data) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level}] [${tag}]`;
  let line;
  if (data) {
    line = `${prefix} ${message} ${JSON.stringify(data)}`;
  } else {
    line = `${prefix} ${message}`;
  }
  console.log(line);
  logStream.write(line + '\n');
}

/**
 * Flush and close the log write stream before process exit.
 * Ensures all buffered log entries are persisted to disk.
 *
 * @param {Function} [callback] - Optional callback invoked after the stream closes
 */
function flushLogStream(callback) {
  logStream.end(callback);
}

export { EXPRESS_PORT, WS_PORT, LOG_LEVEL, LOG_FILE, MAX_RESPONSE_SIZE, log, flushLogStream };