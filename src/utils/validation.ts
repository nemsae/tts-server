import { logger } from './logger.js';

/**
 * Security validation and sanitization utilities for OpenAI prompts
 * IMPORTANT: Since topics are user-provided custom text prompts that go directly into
 * OpenAI system/user messages, we must apply strict validation to prevent:
 * 1. Prompt injection attacks
 * 2. Token limit abuse
 * 3. Malicious content generation
 */

const MAX_TOPIC_LENGTH = 80; // characters - kept short for security
const MAX_ROUNDS = 10; // maximum number of rounds
const MAX_CUSTOM_LENGTH = 20; // maximum words for custom length
const MAX_PLAYER_NAME_LENGTH = 20; // characters

/**
 * Characters that could potentially be used for prompt injection
 * We remove sequences that could break out of the prompt context
 */
const DANGEROUS_PATTERNS = [
  // Code blocks and special tokens
  /```/g, // backticks that could be used for code blocks
  /<\|/g, // special tokens that some models use
  /\|>/g, // special tokens that some models use
  
  // Instruction markers
  /\[INST\]/gi, // instruction markers
  /\[\/INST\]/gi, // instruction markers
  /\[SYSTEM\]/gi, // system markers
  /\[\/SYSTEM\]/gi, // system markers
  /\[HUMAN\]/gi, // human markers
  /\[\/HUMAN\]/gi, // human markers
  /\[AI\]/gi, // AI markers
  /\[\/AI\]/gi, // AI markers
  
  // Prompt role indicators
  /^system:/gi, // system prompt indicators at start
  /^user:/gi, // user prompt indicators at start
  /^assistant:/gi, // assistant prompt indicators at start
  /^human:/gi, // Human prompt indicators at start
  /^ai:/gi, // AI prompt indicators at start
  /^bot:/gi, // Bot prompt indicators at start
  /^model:/gi, // Model prompt indicators at start
  
  // Instruction manipulation attempts
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
  
  // System command attempts
  /sudo/gi,
  /rm\s+-rf/gi,
  /chmod/gi,
  /exec/gi,
  /eval/gi,
  /system\s*\(/gi,
  /exec\s*\(/gi,
  
  // Data exfiltration attempts
  /api[_\s]?key/gi,
  /secret/gi,
  /password/gi,
  /token/gi,
  /credential/gi,
  
  // Formatting that could confuse the model
  /^\s*-{3,}\s*$/gm, // horizontal rules
  /^\s*={3,}\s*$/gm, // horizontal rules
  /^\s*\*{3,}\s*$/gm, // horizontal rules
];

/**
 * Allowed characters for topics - whitelist approach for maximum security
 * We allow: letters, numbers, spaces, basic punctuation, and some special chars
 */
const ALLOWED_TOPIC_CHARACTERS = /^[a-zA-Z0-9\s.,!?'"()-]+$/;

/**
 * Sanitize a string by removing potentially dangerous patterns
 * and normalizing whitespace
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  let sanitized = input.trim();
  
  // Remove dangerous patterns
  DANGEROUS_PATTERNS.forEach(pattern => {
    sanitized = sanitized.replace(pattern, ' ');
  });
  
  // Normalize multiple spaces to single space
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  
  return sanitized;
}

/**
 * Validate and sanitize the topic for OpenAI prompts
 * Topics are user-provided custom text that goes directly into OpenAI prompts,
 * so we apply strict validation to prevent prompt injection attacks.
 */
export function validateTopic(topic: string): { isValid: boolean; sanitized: string; error?: string } {
  if (typeof topic !== 'string') {
    return { isValid: false, sanitized: '', error: 'Topic must be a string' };
  }
  
  // First sanitize the input
  const sanitized = sanitizeInput(topic);
  
  if (sanitized.length === 0) {
    return { isValid: false, sanitized: '', error: 'Topic cannot be empty' };
  }
  
  if (sanitized.length > MAX_TOPIC_LENGTH) {
    return { 
      isValid: false, 
      sanitized: sanitized.slice(0, MAX_TOPIC_LENGTH), 
      error: `Topic exceeds maximum length of ${MAX_TOPIC_LENGTH} characters` 
    };
  }
  
  // Additional security checks for prompt injection attempts
  const injectionPatterns = [
    // Attempt to override instructions
    /(?:ignore|disregard|forget|override)\s+(?:the\s+)?(?:previous|above|all|earlier|existing)\s+(?:instructions|rules|prompts|text|content|guidelines)/i,
    
    // Attempt to change role/identity
    /(?:you\s+are\s+now|act\s+as|pretend\s+(?:to\s+be|you\s+are)|roleplay\s+as|from\s+now\s+on|from\s+this\s+point)/i,
    
    // Attempt to access system information
    /(?:show\s+(?:me\s+)?(?:your|the)\s+)?(?:instructions|rules|prompts|system\s+message|system\s+prompt)/i,
    
    // Attempt to execute code or commands
    /(?:execute|run|eval|exec|sudo|chmod|rm\s+-rf)\s*[\(\/]/i,
    
    // Attempt to extract sensitive information
    /(?:api[_\s]?key|secret|password|token|credential|auth)/i,
    
    // Attempt to use delimiters to break out of context
    /(?:```|<\/?[a-z]+>|^\s*[-=]{3,}|^\s*\*{3,})/i,
    
    // Multiple question marks or exclamation marks (could be spam)
    /[?!]{3,}/,
    
    // Excessive repetition
    /(.{3,})\1{2,}/i,
  ];
  
  for (const pattern of injectionPatterns) {
    if (pattern.test(sanitized)) {
      logger.warn('Validation', 'Potential prompt injection attempt detected', { 
        topic: sanitized.substring(0, 50), 
        pattern: pattern.toString() 
      });
      // Return error for clear injection attempts
      if (pattern.source.includes('ignore|disregard|forget|override') || 
          pattern.source.includes('you are now|act as|pretend')) {
        return { 
          isValid: false, 
          sanitized: '', 
          error: 'Topic contains prohibited content. Please use a different topic.' 
        };
      }
      // For less severe patterns, just log but allow
    }
  }
  
  return { isValid: true, sanitized };
}

/**
 * Validate the number of rounds
 */
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

/**
 * Validate custom length parameter
 */
export function validateCustomLength(customLength: number): { isValid: boolean; validated: number; error?: string } {
  if (typeof customLength !== 'number' || isNaN(customLength)) {
    return { isValid: false, validated: 5, error: 'Custom length must be a number' };
  }
  
  const validated = Math.floor(customLength);
  
  if (validated < 1) {
    return { isValid: false, validated: 1, error: 'Custom length must be at least 1 word' };
  }
  
  if (validated > MAX_CUSTOM_LENGTH) {
    return { isValid: false, validated: MAX_CUSTOM_LENGTH, error: `Custom length cannot exceed ${MAX_CUSTOM_LENGTH} words` };
  }
  
  return { isValid: true, validated };
}

/**
 * Validate game settings before they're used for OpenAI calls
 */
export function validateGameSettings(settings: {
  topic: string;
  length: string;
  customLength?: number;
  rounds: number;
}): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Validate topic
  const topicValidation = validateTopic(settings.topic);
  if (!topicValidation.isValid) {
    errors.push(topicValidation.error || 'Invalid topic');
  }
  
  // Validate rounds
  const roundsValidation = validateRounds(settings.rounds);
  if (!roundsValidation.isValid) {
    errors.push(roundsValidation.error || 'Invalid rounds');
  }
  
  // Validate custom length if provided
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

/**
 * Validate and sanitize player name
 */
export function validatePlayerName(name: string): { isValid: boolean; sanitized: string; error?: string } {
  if (typeof name !== 'string') {
    return { isValid: false, sanitized: '', error: 'Player name must be a string' };
  }
  
  // Remove HTML tags and other potentially dangerous content
  let sanitized = name.replace(/<[^>]*>/g, '').trim();
  
  // Remove excessive whitespace
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  
  if (sanitized.length === 0) {
    return { isValid: false, sanitized: '', error: 'Player name cannot be empty' };
  }
  
  if (sanitized.length > MAX_PLAYER_NAME_LENGTH) {
    return { 
      isValid: false, 
      sanitized: sanitized.slice(0, MAX_PLAYER_NAME_LENGTH), 
      error: `Player name exceeds maximum length of ${MAX_PLAYER_NAME_LENGTH} characters` 
    };
  }
  
  return { isValid: true, sanitized };
}

const MAX_TRANSCRIPT_LENGTH = 500; // characters - reasonable limit for speech input

/**
 * Validate transcript input for scoring
 */
export function validateTranscript(transcript: string): { isValid: boolean; sanitized: string; error?: string } {
  if (typeof transcript !== 'string') {
    return { isValid: false, sanitized: '', error: 'Transcript must be a string' };
  }
  
  // Basic sanitization - remove control characters and excessive whitespace
  let sanitized = transcript
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  if (sanitized.length === 0) {
    return { isValid: false, sanitized: '', error: 'Transcript cannot be empty' };
  }
  
  if (sanitized.length > MAX_TRANSCRIPT_LENGTH) {
    // Truncate to max length
    sanitized = sanitized.slice(0, MAX_TRANSCRIPT_LENGTH);
  }
  
  return { isValid: true, sanitized };
}