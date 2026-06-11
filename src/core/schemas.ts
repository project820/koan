import { z } from "zod";

export const StrictnessSchema = z.enum(["advisory", "strict"]);
export type Strictness = z.infer<typeof StrictnessSchema>;

export const LanguageSchema = z.enum(["ko", "en", "mixed"]);
export type Language = z.infer<typeof LanguageSchema>;

export const DevelopmentUnderstandingSchema = z.enum([
  "non_technical",
  "beginner",
  "intermediate",
  "expert"
]);
export type DevelopmentUnderstanding = z.infer<typeof DevelopmentUnderstandingSchema>;

export const ExplanationStyleSchema = z.enum([
  "short",
  "example_first",
  "step_by_step",
  "technical_ok"
]);
export type ExplanationStyle = z.infer<typeof ExplanationStyleSchema>;

export const OutputUseSchema = z.enum([
  "self_implementation",
  "agent_execution",
  "team_sharing",
  "learning"
]);
export type OutputUse = z.infer<typeof OutputUseSchema>;

export const LearningModeSchema = z.enum(["approval_required", "auto_with_review"]);
export type LearningMode = z.infer<typeof LearningModeSchema>;

export const UserProfileSchema = z.object({
  developmentUnderstanding: DevelopmentUnderstandingSchema,
  explanationStyle: ExplanationStyleSchema,
  language: LanguageSchema,
  outputUse: OutputUseSchema,
  domainBackground: z.string(),
  learningMode: LearningModeSchema
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const ProjectConfigSchema = z.object({
  version: z.literal(1),
  koanVersion: z.string(),
  projectRoot: z.string(),
  strictness: StrictnessSchema,
  experimentalHandoff: z.boolean(),
  documents: z.object({
    readme: z.string(),
    goal: z.string(),
    status: z.string(),
    plan: z.string()
  })
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const AmbiguityAxisSchema = z.enum([
  "purpose",
  "target_users",
  "current_goal",
  "scope",
  "non_goals",
  "constraints",
  "success_criteria",
  "philosophical_intent",
  "implementation_plan",
  "qa_criteria",
  "handoff_readiness"
]);
export type AmbiguityAxis = z.infer<typeof AmbiguityAxisSchema>;

export const AxisScoreSchema = z.object({
  axis: AmbiguityAxisSchema,
  clarity: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  updatedAt: z.string()
});
export type AxisScore = z.infer<typeof AxisScoreSchema>;

export const AmbiguityLedgerSchema = z.object({
  version: z.literal(1),
  goalId: z.string(),
  axes: z.array(AxisScoreSchema)
});
export type AmbiguityLedger = z.infer<typeof AmbiguityLedgerSchema>;

export const SessionStateSchema = z.object({
  version: z.literal(1),
  sessionId: z.string(),
  activeGoalId: z.string().nullable(),
  phase: z.enum(["setup", "questioning", "crystallizing", "ready", "archived"]),
  lastQuestionId: z.string().nullable(),
  updatedAt: z.string()
});
export type SessionState = z.infer<typeof SessionStateSchema>;

export const WritePlanOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("write"), path: z.string(), content: z.string() }),
  z.object({ type: z.literal("append"), path: z.string(), content: z.string() }),
  z.object({
    type: z.literal("managed-region"),
    path: z.string(),
    name: z.string(),
    content: z.string()
  })
]);
export type WritePlanOperation = z.infer<typeof WritePlanOperationSchema>;

export const WritePlanSchema = z.object({
  description: z.string(),
  operations: z.array(WritePlanOperationSchema)
});
export type WritePlan = z.infer<typeof WritePlanSchema>;
