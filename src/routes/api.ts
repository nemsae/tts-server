import { IncomingMessage, ServerResponse } from 'http';
import { generateTwisters } from '../services/twister-generator.js';
import { logger } from '../utils/logger.js';
import type { TwisterLength } from '../types/index.js';

interface GenerateRequest {
  topic: string;
  length: TwisterLength;
  customLength?: number;
  rounds?: number;
}

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',');

function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // Allow all origins for development; restrict in production
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
}

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: any): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { method, url } = req;
  
  // Handle CORS preflight
  if (method === 'OPTIONS' && url === '/api/generate') {
    setCorsHeaders(req, res);
    res.writeHead(204);
    res.end();
    return true;
  }
  
  // Only handle POST /api/generate
  if (method === 'POST' && url === '/api/generate') {
    setCorsHeaders(req, res);
    try {
      const body = await parseJsonBody(req);
      
      // Validate required fields
      if (!body.topic || typeof body.topic !== 'string') {
        sendJson(res, 400, { error: 'Missing or invalid topic' });
        return true;
      }
      
      const allowedLengths: TwisterLength[] = ['short', 'medium', 'long', 'custom'];
      if (!body.length || !allowedLengths.includes(body.length)) {
        sendJson(res, 400, { error: 'Invalid length. Must be one of: short, medium, long, custom' });
        return true;
      }
      
      if (body.length === 'custom' && (typeof body.customLength !== 'number' || body.customLength <= 0)) {
        sendJson(res, 400, { error: 'Custom length must be a positive number' });
        return true;
      }
      
      const rounds = body.rounds && typeof body.rounds === 'number' && body.rounds > 0 ? Math.floor(body.rounds) : 1;
      
      const twisters = await generateTwisters(
        body.topic,
        body.length,
        body.customLength,
        rounds
      );
      
      logger.info('API', 'Generated twisters via REST', { topic: body.topic, length: body.length, rounds, count: twisters.length });
      
      sendJson(res, 200, { twisters });
      return true;
    } catch (error) {
      logger.error('API', 'Failed to generate twisters', { error: error instanceof Error ? error.message : String(error) });
      sendJson(res, 500, { error: 'Internal server error' });
      return true;
    }
  }
  
  // Not our API endpoint
  return false;
}