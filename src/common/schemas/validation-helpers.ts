import { Logger } from '@nestjs/common';

const logger = new Logger('Validation');

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

const INJECTION_PATTERNS = [
  /(?:ignore|disregard|forget|override)\s+(?:the\s+)?(?:previous|above|all|earlier|existing)\s+(?:instructions|rules|prompts|text|content|guidelines)/i,
  /(?:you\s+are\s+now|act\s+as|pretend\s+(?:to\s+be|you\s+are)|roleplay\s+as|from\s+now\s+on|from\s+this\s+point)/i,
  /(?:show\s+(?:me\s+)?(?:your|the)\s+)?(?:instructions|rules|prompts|system\s+message|system\s+prompt)/i,
  /(?:execute|run|eval|exec|sudo|chmod|rm\s+-rf)\s*[(/]/i,
  /(?:api[_\s]?key|secret|password|token|credential|auth)/i,
  /(?:```|<\/?[a-z]+>|^\s*[-=]{3,}|^\s*\*{3,})/i,
  /[?!]{3,}/,
  /(.{3,})\1{2,}/i,
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

export function checkTopicForInjection(sanitized: string): string | null {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      logger.warn(
        `Potential prompt injection attempt detected, topic: ${sanitized.substring(0, 50)}, pattern: ${pattern.toString()}`,
      );
      if (
        pattern.source.includes('ignore|disregard|forget|override') ||
        pattern.source.includes('you are now|act as|pretend')
      ) {
        return 'Topic contains prohibited content. Please use a different topic.';
      }
    }
  }
  return null;
}
