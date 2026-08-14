import { z } from 'zod';

const chatIntentSchema = z.enum([
  'PREDICTION',
  'BEST_BET',
  'TOTAL_GOALS',
  'BTTS',
  'EXPLANATION',
  'DISCOVERY',
  'HISTORY',
  'RELIABILITY',
]);

const nullableBoundedText = z.string().trim().min(1).max(120).nullable();

export const predictionChatContextSchema = z
  .object({
    activeProviderFixtureId: z.number().int().positive().nullable(),
    activeHomeTeamName: nullableBoundedText,
    activeAwayTeamName: nullableBoundedText,
    lastIntent: chatIntentSchema.nullable(),
    turnCount: z.number().int().min(0).max(24),
  })
  .strict()
  .superRefine((context, issue) => {
    if (
      context.activeProviderFixtureId == null &&
      (context.activeHomeTeamName != null || context.activeAwayTeamName != null)
    ) {
      issue.addIssue({
        code: 'custom',
        message: 'Fixture names require an active fixture id.',
        path: ['activeProviderFixtureId'],
      });
    }
  });

export const predictionChatRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(240),
    context: predictionChatContextSchema.optional(),
  })
  .strict();

export type PredictionChatRequest = z.infer<typeof predictionChatRequestSchema>;
