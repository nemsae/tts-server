import { z } from 'zod';
import { sanitizeInput, checkTopicForInjection } from './validation-helpers.js';

// ── Constants ──────────────────────────────────────────────────────────
export const MAX_TOPIC_LENGTH = 80;
export const MAX_ROUNDS = 10;
export const MAX_CUSTOM_LENGTH = 20;
export const MAX_PLAYER_NAME_LENGTH = 20;
export const MAX_TRANSCRIPT_LENGTH = 500;
export const MIN_ROUND_TIME_LIMIT = 5;
export const MAX_ROUND_TIME_LIMIT = 120;

// ── Reusable field schemas ─────────────────────────────────────────────

export const TwisterLengthSchema = z.enum(['short', 'medium', 'long', 'custom']);

export const TopicSchema = z
  .string()
  .min(1, 'Topic cannot be empty')
  .transform((val) => sanitizeInput(val))
  .pipe(
    z
      .string()
      .min(1, 'Topic cannot be empty after sanitization')
      .max(MAX_TOPIC_LENGTH, `Topic exceeds maximum length of ${MAX_TOPIC_LENGTH} characters`)
      .superRefine((val, ctx) => {
        const injectionError = checkTopicForInjection(val);
        if (injectionError) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: injectionError });
        }
      }),
  );

export const RoundsSchema = z
  .number()
  .int('Rounds must be an integer')
  .min(1, 'Rounds must be at least 1')
  .max(MAX_ROUNDS, `Rounds cannot exceed ${MAX_ROUNDS}`);

export const CustomLengthSchema = z
  .number()
  .int('Custom length must be an integer')
  .min(1, 'Custom length must be at least 1 word')
  .max(MAX_CUSTOM_LENGTH, `Custom length cannot exceed ${MAX_CUSTOM_LENGTH} words`);

export const PlayerNameSchema = z
  .string()
  .min(1, 'Player name cannot be empty')
  .transform((val) => {
    let sanitized = val.replace(/<[^>]*>/g, '').trim();
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    return sanitized;
  })
  .pipe(
    z
      .string()
      .min(1, 'Player name cannot be empty')
      .max(MAX_PLAYER_NAME_LENGTH, `Player name exceeds maximum length of ${MAX_PLAYER_NAME_LENGTH} characters`),
  );

export const TranscriptSchema = z
  .string()
  .min(1, 'Transcript cannot be empty')
  .transform((val) => {
    // eslint-disable-next-line no-control-regex
    const controlChars = new RegExp('[\\x00-\\x1F\\x7F]', 'g');
    let sanitized = val.replace(controlChars, '').replace(/\s+/g, ' ').trim();
    if (sanitized.length > MAX_TRANSCRIPT_LENGTH) {
      sanitized = sanitized.slice(0, MAX_TRANSCRIPT_LENGTH);
    }
    return sanitized;
  })
  .pipe(z.string().min(1, 'Transcript cannot be empty'));

// ── Composite schemas (DTOs) ──────────────────────────────────────────

export const GameSettingsSchema = z.object({
  topic: TopicSchema,
  length: TwisterLengthSchema,
  customLength: CustomLengthSchema.optional(),
  rounds: RoundsSchema,
  roundTimeLimit: z.number().min(MIN_ROUND_TIME_LIMIT, `Round time limit must be at least ${MIN_ROUND_TIME_LIMIT} seconds`).max(MAX_ROUND_TIME_LIMIT, `Round time limit cannot exceed ${MAX_ROUND_TIME_LIMIT} seconds`),
  autoSubmitEnabled: z.boolean().optional(),
  autoSubmitDelay: z.number().optional(),
});

export const CreateRoomSchema = z.object({
  playerName: PlayerNameSchema,
  settings: GameSettingsSchema,
});

export const JoinRoomSchema = z.object({
  roomCode: z.string().min(1, 'Room code is required'),
  playerName: PlayerNameSchema,
});

export const SubmitAnswerSchema = z.object({
  transcript: TranscriptSchema,
  timestamp: z.number(),
});

export const GenerateTwistersSchema = z.object({
  topic: TopicSchema,
  length: TwisterLengthSchema,
  customLength: CustomLengthSchema.optional(),
  rounds: RoundsSchema.optional(),
});

// ── Inferred types ────────────────────────────────────────────────────

export type TwisterLength = z.infer<typeof TwisterLengthSchema>;
export type GameSettings = z.infer<typeof GameSettingsSchema>;
export type CreateRoomDto = z.infer<typeof CreateRoomSchema>;
export type JoinRoomDto = z.infer<typeof JoinRoomSchema>;
export type SubmitAnswerDto = z.infer<typeof SubmitAnswerSchema>;
export type GenerateTwistersDto = z.infer<typeof GenerateTwistersSchema>;

// ── Re-export helpers ─────────────────────────────────────────────────

export { sanitizeInput, checkTopicForInjection } from './validation-helpers.js';
