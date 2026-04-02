import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { validateTopic, validateRounds, validateCustomLength } from '../../common/utils/validation.js';
import type { Twister, TwisterLength, TwisterTopic } from '../../common/types/index.js';

function getLengthInstruction(length: TwisterLength, customLength?: number): string {
  if (length === 'custom' && customLength) {
    return `Each tongue twister must be exactly ${customLength} words long.`;
  }
  const lengthMap: Record<'short' | 'medium' | 'long', string> = {
    short: 'Keep each tongue twister very brief, around 5 words.',
    medium: 'Make each tongue twister moderately long, around 10 words.',
    long: 'Make each tongue twister quite lengthy, around 20 words.',
  };
  return lengthMap[length as 'short' | 'medium' | 'long'];
}

@Injectable()
export class TwisterGeneratorService {
  private readonly logger = new Logger(TwisterGeneratorService.name);
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async generateTwisters(
    topic: TwisterTopic,
    length: TwisterLength,
    customLength: number | undefined,
    rounds: number,
  ): Promise<Twister[]> {
    const topicValidation = validateTopic(topic);
    if (!topicValidation.isValid) {
      this.logger.error(`Invalid topic provided, original: ${topic.substring(0, 50)}, error: ${topicValidation.error}`);
      throw new Error(`Invalid topic: ${topicValidation.error}`);
    }

    const sanitizedTopic = topicValidation.sanitized;

    const roundsValidation = validateRounds(rounds);
    if (!roundsValidation.isValid) {
      this.logger.error(`Invalid rounds provided, original: ${rounds}, error: ${roundsValidation.error}`);
      throw new Error(`Invalid rounds: ${roundsValidation.error}`);
    }

    const validatedRounds = roundsValidation.validated;

    let validatedCustomLength: number | undefined = undefined;
    if (length === 'custom' && customLength !== undefined) {
      const customLengthValidation = validateCustomLength(customLength);
      if (!customLengthValidation.isValid) {
        this.logger.error(`Invalid custom length provided, original: ${customLength}, error: ${customLengthValidation.error}`);
        throw new Error(`Invalid custom length: ${customLengthValidation.error}`);
      }
      validatedCustomLength = customLengthValidation.validated;
    }

    const lengthInstruction = getLengthInstruction(length, validatedCustomLength);

    this.logger.log(`Generating twisters, topic: ${sanitizedTopic}, length: ${length}, customLength: ${validatedCustomLength}, rounds: ${validatedRounds}`);

    const systemPrompt = `You are a tongue twister generator. Generate ${validatedRounds} unique, fun, and challenging tongue twisters that are difficult to say quickly.
Each tongue twister should feature words related to the topic: ${sanitizedTopic}.
${lengthInstruction}
Return only the tongue twisters, one per line, with no numbering, no explanations, and no additional text.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'o3-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate ${validatedRounds} unique tongue twisters about ${sanitizedTopic}.` },
        ],
        reasoning_effort: 'low',
      });

      const content = response.choices[0]?.message?.content?.trim() ?? '';

      this.logger.debug(`OpenAI response: ${content.substring(0, 100)}`);

      const texts = content
        .split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0);

      const usedTexts = new Set<string>();

      const twisters = texts
        .filter((text: string) => {
          const normalized = text.toLowerCase();
          if (usedTexts.has(normalized)) return false;
          usedTexts.add(normalized);
          return true;
        })
        .map((text: string, index: number) => {
          const difficulty: 1 | 2 | 3 = length === 'short' ? 1 : length === 'medium' ? 2 : 3;
          return {
            id: `ai-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
            text,
            difficulty,
            topic: sanitizedTopic,
            length,
          };
        });

      this.logger.log(`Twisters generated, count: ${twisters.length}, texts: ${JSON.stringify(twisters.map((t: Twister) => t.text))}`);

      return twisters;
    } catch (error) {
      this.logger.error(`Failed to generate twisters, error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
