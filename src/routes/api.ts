import { Router } from 'express';
import { generateTwisters } from '../services/twister-generator.js';
import { roomManager } from '../services/room-manager.js';
import { logger } from '../utils/logger.js';
import type { TwisterLength } from '../types/index.js';

const router = Router();

router.get('/lobby/active-players', (req, res) => {
  const count = roomManager.getActiveLobbyPlayerCount();
  res.json({ count });
});

router.post('/generate', async (req, res) => {
  const body = req.body as {
    topic?: unknown;
    length?: unknown;
    customLength?: unknown;
    rounds?: unknown;
  };

  const topic = body.topic;
  const length = body.length;
  const customLength = body.customLength;
  const rawRounds = body.rounds;

  if (!topic || typeof topic !== 'string') {
    res.status(400).json({ error: 'Missing or invalid topic' });
    return;
  }

  const allowedLengths: TwisterLength[] = ['short', 'medium', 'long', 'custom'];
  if (!length || !allowedLengths.includes(length as TwisterLength)) {
    res.status(400).json({ error: 'Invalid length. Must be one of: short, medium, long, custom' });
    return;
  }

  if (length === 'custom' && (typeof customLength !== 'number' || customLength <= 0)) {
    res.status(400).json({ error: 'Custom length must be a positive number' });
    return;
  }

  const rounds = rawRounds && typeof rawRounds === 'number' && rawRounds > 0 ? Math.floor(rawRounds) : 1;

  try {
    const twisters = await generateTwisters(
      topic,
      length as TwisterLength,
      typeof customLength === 'number' ? customLength : undefined,
      rounds,
    );
    logger.info('API', 'Generated twisters via REST', { topic, length, rounds, count: twisters.length });
    res.json({ twisters });
  } catch (error) {
    logger.error('API', 'Failed to generate twisters', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
