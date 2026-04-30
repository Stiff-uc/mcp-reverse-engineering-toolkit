import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', '..', 'logs');
const LOG_FILE = join(LOG_DIR, 'mcp-proxy.log');

const EXPRESS_PORT = parseInt(process.env.EXPRESS_PORT, 10) || 3100;
const WS_PORT = parseInt(process.env.WS_PORT, 10) || 3101;
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}
const logStream = createWriteStream(LOG_FILE, { flags: 'a' });

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

function flushLogStream(callback) {
  logStream.end(callback);
}

export { EXPRESS_PORT, WS_PORT, LOG_LEVEL, LOG_FILE, log, flushLogStream };