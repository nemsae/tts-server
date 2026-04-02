import { Logger } from '@nestjs/common';

const logger = new Logger('Validation');

const MAX_TOPIC_LENGTH = 80;
const MAX_ROUNDS = 10;
const MAX_CUSTOM_LENGTH = 20;
const MAX_PLAYER_NAME_LENGTH = 20;

const DANGEROUS_PATTERNS = [
  /```/g,
  /<\|/g,
  /\|>/g,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /\[SYSTEM\]/gi,
  /\[\/SYSTEM\]/gi,
  /\[HUMAN\]/gi,
  /\[\/HUMAN\]/gi,
  /\[AI\]/gi,
  /\[\/AI\]/gi,
  /^system:/gi,
  /^user:/gi,
  /^assistant:/gi,
  /^human:/gi,
  /^ai:/gi,
  /^bot:/gi,
  /^model:/gi,
  /ignore\s+(?:previous|above|all|earlier)\s+(?:instructions|rules|prompts|text|content)/gi,
  /disregard\s+(?:previous|above|all|earlier)/gi,
  /forget\s+(?:previous|above|all|earlier)/gi,
  /override\s+(?:previous|above|all|earlier)/gi,
  /new\s+(?:instructions|rules|persona|role)/gi,
  /you\s+are\s+now/gi,
  /act\s+as\s+(?:if|though|a|an)/gi,
  /pretend\s+(?:to\s+be|you\s+are)/gi,
  /roleplay\s+as/gi,
  /from\s+now\s+on/gi,
  /from\s+this\s+point/gi,
  /sudo/gi,
  /rm\s+-rf/gi,
  /chmod/gi,
  /exec/gi,
  /eval/gi,
  /system\s*\(/gi,
  /exec\s*\(/gi,
  /api[_\s]?key/gi,
  /secret/gi,
  /password/gi,
  /token/gi,
  /credential/gi,
  /^\s*-{3,}\s*$/gm,
  /^\s*={3,}\s*$/gm,
  /^\s*\*{3,}\s*$/gm,
];

export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  let sanitized = input.trim();

  DANGEROUS_PATTERNS.forEach((pattern) => {
    sanitized = sanitized.replace(pattern, ' ');
  });

  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  return sanitized;
}

export function validateTopic(topic: string): { isValid: boolean; sanitized: string; error?: string } {
  if (typeof topic !== 'string') {
    return { isValid: false, sanitized: '', error: 'Topic must be a string' };
  }

  const sanitized = sanitizeInput(topic);

  if (sanitized.length === 0) {
    return { isValid: false, sanitized: '', error: 'Topic cannot be empty' };
  }

  if (sanitized.length > MAX_TOPIC_LENGTH) {
    return {
      isValid: false,
      sanitized: sanitized.slice(0, MAX_TOPIC_LENGTH),
      error: `Topic exceeds maximum length of ${MAX_TOPIC_LENGTH} characters`,
    };
  }

  const injectionPatterns = [
    /(?:ignore|disregard|forget|override)\s+(?:the\s+)?(?:previous|above|all|earlier|existing)\s+(?:instructions|rules|prompts|text|content|guidelines)/i,
    /(?:you\s+are\s+now|act\s+as|pretend\s+(?:to\s+be|you\s+are)|roleplay\s+as|from\s+now\s+on|from\s+this\s+point)/i,
    /(?:show\s+(?:me\s+)?(?:your|the)\s+)?(?:instructions|rules|prompts|system\s+message|system\s+prompt)/i,
    /(?:execute|run|eval|exec|sudo|chmod|rm\s+-rf)\s*[(/]/i,
    /(?:api[_\s]?key|secret|password|token|credential|auth)/i,
    /(?:```|<\/?[a-z]+>|^\s*[-=]{3,}|^\s*\*{3,})/i,
    /[?!]{3,}/,
    /(.{3,})\1{2,}/i,
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(sanitized)) {
      logger.warn(`Potential prompt injection attempt detected, topic: ${sanitized.substring(0, 50)}, pattern: ${pattern.toString()}`);
      if (
        pattern.source.includes('ignore|disregard|forget|override') ||
        pattern.source.includes('you are now|act as|pretend')
      ) {
        return {
          isValid: false,
          sanitized: '',
          error: 'Topic contains prohibited content. Please use a different topic.',
        };
      }
    }
  }

  return { isValid: true, sanitized };
}

export function validateRounds(rounds: number): { isValid: boolean; validated: number; error?: string } {
  if (typeof rounds !== 'number' || isNaN(rounds)) {
    return { isValid: false, validated: 1, error: 'Rounds must be a number' };
  }

  const validated = Math.floor(rounds);

  if (validated < 1) {
    return { isValid: false, validated: 1, error: 'Rounds must be at least 1' };
  }

  if (validated > MAX_ROUNDS) {
    return { isValid: false, validated: MAX_ROUNDS, error: `Rounds cannot exceed ${MAX_ROUNDS}` };
  }

  return { isValid: true, validated };
}

export function validateCustomLength(customLength: number): { isValid: boolean; validated: number; error?: string } {
  if (typeof customLength !== 'number' || isNaN(customLength)) {
    return { isValid: false, validated: 5, error: 'Custom length must be a number' };
  }

  const validated = Math.floor(customLength);

  if (validated < 1) {
    return { isValid: false, validated: 1, error: 'Custom length must be at least 1 word' };
  }

  if (validated > MAX_CUSTOM_LENGTH) {
    return {
      isValid: false,
      validated: MAX_CUSTOM_LENGTH,
      error: `Custom length cannot exceed ${MAX_CUSTOM_LENGTH} words`,
    };
  }

  return { isValid: true, validated };
}

export function validateGameSettings(settings: {
  topic: string;
  length: string;
  customLength?: number;
  rounds: number;
}): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  const topicValidation = validateTopic(settings.topic);
  if (!topicValidation.isValid) {
    errors.push(topicValidation.error || 'Invalid topic');
  }

  const roundsValidation = validateRounds(settings.rounds);
  if (!roundsValidation.isValid) {
    errors.push(roundsValidation.error || 'Invalid rounds');
  }

  if (settings.length === 'custom' && settings.customLength !== undefined) {
    const customLengthValidation = validateCustomLength(settings.customLength);
    if (!customLengthValidation.isValid) {
      errors.push(customLengthValidation.error || 'Invalid custom length');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function validatePlayerName(name: string): { isValid: boolean; sanitized: string; error?: string } {
  if (typeof name !== 'string') {
    return { isValid: false, sanitized: '', error: 'Player name must be a string' };
  }

  let sanitized = name.replace(/<[^>]*>/g, '').trim();
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  if (sanitized.length === 0) {
    return { isValid: false, sanitized: '', error: 'Player name cannot be empty' };
  }

  if (sanitized.length > MAX_PLAYER_NAME_LENGTH) {
    return {
      isValid: false,
      sanitized: sanitized.slice(0, MAX_PLAYER_NAME_LENGTH),
      error: `Player name exceeds maximum length of ${MAX_PLAYER_NAME_LENGTH} characters`,
    };
  }

  return { isValid: true, sanitized };
}

const MAX_TRANSCRIPT_LENGTH = 500;

export function validateTranscript(transcript: string): { isValid: boolean; sanitized: string; error?: string } {
  if (typeof transcript !== 'string') {
    return { isValid: false, sanitized: '', error: 'Transcript must be a string' };
  }

  // eslint-disable-next-line no-control-regex
  const controlChars = new RegExp('[\\x00-\\x1F\\x7F]', 'g');
  let sanitized = transcript.replace(controlChars, '').replace(/\s+/g, ' ').trim();

  if (sanitized.length === 0) {
    return { isValid: false, sanitized: '', error: 'Transcript cannot be empty' };
  }

  if (sanitized.length > MAX_TRANSCRIPT_LENGTH) {
    sanitized = sanitized.slice(0, MAX_TRANSCRIPT_LENGTH);
  }

  return { isValid: true, sanitized };
}
