import { updateMcpCache } from "../core/mcpCache.js";
import { defaultProfile, saveProfile } from "../core/profile.js";
import { AmbiguityAxisSchema, type UserProfile } from "../core/schemas.js";
import { runConnect, type ConnectAgent } from "./connect.js";
import type { Prompter } from "./prompt.js";

// ---------------------------------------------------------------------------
// Journey onboarding copy
//
// Every string the interactive `koan hello` flow speaks lives here, in three
// registers (ko / en / mixed) with identical key sets. The tone contract:
// warm 해요체 Korean, no interrogation, one thought at a time — Koan is a
// companion for finding "why build it" before "what to build".
//
// `welcome`, `languageWhy`, and `languagePrompt` are shown before a language
// exists, so they carry the same bilingual content in all three registers.
// ---------------------------------------------------------------------------

export const DEVELOPMENT_UNDERSTANDING_OPTIONS = [
  "non_technical",
  "beginner",
  "intermediate",
  "expert"
] as const;
export const EXPLANATION_STYLE_OPTIONS = [
  "short",
  "example_first",
  "step_by_step",
  "technical_ok"
] as const;
export const LANGUAGE_OPTIONS = ["ko", "en", "mixed"] as const;
export const OUTPUT_USE_OPTIONS = [
  "self_implementation",
  "agent_execution",
  "team_sharing",
  "learning"
] as const;
export const LEARNING_MODE_OPTIONS = ["approval_required", "auto_with_review"] as const;

export const AXIS_TOTAL = AmbiguityAxisSchema.options.length;

export interface OnboardingCopy {
  welcome: readonly string[];
  languageWhy: string;
  languagePrompt: string;
  developmentUnderstandingWhy: string;
  developmentUnderstandingAsk: string;
  explanationStyleWhy: string;
  explanationStyleAsk: string;
  outputUseWhy: string;
  outputUseAsk: string;
  domainBackgroundWhy: string;
  domainBackgroundAsk: string;
  learningModeWhy: string;
  learningModeAsk: string;
  profileSaved: string;
  skillOffer: string;
  skillOfferHint: string;
  skillGuidanceClaude: string;
  skillGuidanceCodex: string;
  rawIntentInvite: string;
  rawIntentThanks: string;
  transition: readonly string[];
  progress: (axis: string, step: number, total: number) => string;
  answerAck: (axis: string, clarity: string) => string;
  acceptedClarity: string;
  convergedClosing: string;
  resumeGreeting: string;
  resumeLastAnswer: (axis: string, answer: string) => string;
  resumeChoices: string;
  resumeUnrecognized: (choice: string) => string;
  welcomeBack: string;
  stopped: string;
  sessionComplete: string;
  crystallized: (count: number) => string;
}

// Shown before the user has chosen a language, so it speaks both.
const BILINGUAL_WELCOME: readonly string[] = [
  "Koan에 오신 걸 환영해요. (Welcome to Koan.)",
  "'무엇을 만들까'보다 '왜 만들고 싶은가'를 먼저 함께 찾아가는 여정이에요.",
  "(A journey to find why you want to build, before deciding what to build.)",
  "정답을 요구하지 않아요. 한 번에 하나씩, 천천히 생각을 비춰 드릴게요."
];

const BILINGUAL_LANGUAGE_WHY =
  "먼저, 어떤 언어로 대화하면 편한지 알려 주세요. / First, tell me which language feels comfortable.";

const BILINGUAL_LANGUAGE_PROMPT = "언어 / Language [1 한국어 / 2 English / 3 mixed] (1): ";

const PROGRESS = (axis: string, step: number, total: number): string =>
  `(${axis} · ${step}/${total})`;

export const ONBOARDING_COPY: Record<"ko" | "en" | "mixed", OnboardingCopy> = {
  ko: {
    welcome: BILINGUAL_WELCOME,
    languageWhy: BILINGUAL_LANGUAGE_WHY,
    languagePrompt: BILINGUAL_LANGUAGE_PROMPT,
    developmentUnderstandingWhy: "개발 경험을 알면 질문의 깊이를 당신에게 맞출 수 있어요.",
    developmentUnderstandingAsk:
      "개발이 얼마나 익숙하세요? [1 non_technical / 2 beginner / 3 intermediate / 4 expert] (2): ",
    explanationStyleWhy: "설명을 어떤 호흡으로 듣고 싶은지 알면, 답변을 그 결에 맞출게요.",
    explanationStyleAsk:
      "어떤 설명이 편하세요? [1 short / 2 example_first / 3 step_by_step / 4 technical_ok] (2): ",
    outputUseWhy: "정리된 결과를 어디에 쓰실지 알면, 문서의 모양을 거기에 맞출 수 있어요.",
    outputUseAsk:
      "정리된 결과는 주로 어떻게 쓰실 건가요? [1 self_implementation / 2 agent_execution / 3 team_sharing / 4 learning] (2): ",
    domainBackgroundWhy: "어떤 분야에서 오셨는지 알면, 익숙한 말로 여쭤볼 수 있어요.",
    domainBackgroundAsk: "어떤 분야나 배경에서 일하고 계세요? (자유롭게, 비워 두셔도 돼요): ",
    learningModeWhy: "Koan이 무언가 배웠을 때, 먼저 여쭤볼지 바로 반영할지 정하는 항목이에요.",
    learningModeAsk: "변경 반영 방식은 어떻게 할까요? [1 approval_required / 2 auto_with_review] (1): ",
    profileSaved: "좋아요, 이렇게 기억해 둘게요. 언제든 koan hello --setup으로 바꿀 수 있어요.",
    skillOffer: "원하시면 Koan을 Claude Code나 Codex에서 스킬로 쓸 수 있게 연결해 드릴 수 있어요.",
    skillOfferHint: "[1 claude / 2 codex / 3 both / Enter 건너뛰기] (나중에 koan connect로도 가능해요): ",
    skillGuidanceClaude: "Claude Code 연결은 이 명령으로 할 수 있어요: koan connect claude",
    skillGuidanceCodex: "Codex 연결은 이 명령으로 할 수 있어요: koan connect codex",
    rawIntentInvite:
      "시작하기 전에, 지금 머릿속에 있는 생각을 형식 없이 한 줄로 적어 보실래요? (Enter로 건너뛰기): ",
    rawIntentThanks: "고마워요. 그 문장을 잘 간직해 두었다가, 질문을 건넬 때 함께 비춰 볼게요.",
    transition: [
      "이제부터 Koan이 질문을 하나씩 건넬게요. 하나의 생각을 11가지 각도에서 비춰 보는 여정이에요.",
      "생각나는 대로 편하게 답해 주세요. 충분하다 싶으면 'enough', 잠시 멈추고 싶으면 'stop'이라고 입력하면 돼요."
    ],
    progress: PROGRESS,
    answerAck: (axis, clarity) => `기록했어요 — ${axis} (clarity ${clarity})`,
    acceptedClarity: "좋아요, 지금의 또렷함으로 충분해요. 여기까지의 생각을 문서로 새길게요.",
    convergedClosing: "모든 축이 또렷해졌어요. 생각이 충분히 여물었네요.",
    resumeGreeting: "다시 만나서 반가워요. 지난 여정을 이어가 볼까요?",
    resumeLastAnswer: (axis, answer) => `지난 답변 (${axis}): ${answer}`,
    resumeChoices: "이어가기 [c] / 지난 답 고치기 [r] / 멈추기 [s]? ",
    resumeUnrecognized: (choice) => `이해하지 못했어요: ${choice}`,
    welcomeBack: "다시 오셨네요. 새 목표를 함께 들여다볼게요.",
    stopped: "여기서 잠시 멈출게요. 이어가고 싶을 때 koan hello를 실행해 주세요.",
    sessionComplete: "오늘의 여정은 여기까지예요. 수고하셨어요.",
    crystallized: (count) => `${count}개의 축을 문서에 새겨 두었어요.`
  },
  en: {
    welcome: BILINGUAL_WELCOME,
    languageWhy: BILINGUAL_LANGUAGE_WHY,
    languagePrompt: BILINGUAL_LANGUAGE_PROMPT,
    developmentUnderstandingWhy:
      "Knowing your development experience lets Koan pitch each question at the right depth.",
    developmentUnderstandingAsk:
      "How familiar is software development to you? [1 non_technical / 2 beginner / 3 intermediate / 4 expert] (2): ",
    explanationStyleWhy: "Knowing how you like things explained lets Koan match that rhythm.",
    explanationStyleAsk:
      "What kind of explanation feels right? [1 short / 2 example_first / 3 step_by_step / 4 technical_ok] (2): ",
    outputUseWhy: "Knowing where the results will go lets Koan shape the documents for that use.",
    outputUseAsk:
      "How will you mostly use what we write down? [1 self_implementation / 2 agent_execution / 3 team_sharing / 4 learning] (2): ",
    domainBackgroundWhy: "Knowing your field lets Koan ask in words you already live in.",
    domainBackgroundAsk: "What field or background are you coming from? (free text, empty is fine): ",
    learningModeWhy: "This decides whether Koan asks first or applies what it learns right away.",
    learningModeAsk: "How should changes be applied? [1 approval_required / 2 auto_with_review] (1): ",
    profileSaved: "Profile saved. You can revisit this anytime with koan hello --setup.",
    skillOffer: "If you like, Koan can also work as a skill inside Claude Code or Codex.",
    skillOfferHint: "[1 claude / 2 codex / 3 both / Enter to skip] (you can always run koan connect later): ",
    skillGuidanceClaude: "To connect Claude Code, run: koan connect claude",
    skillGuidanceCodex: "To connect Codex, run: koan connect codex",
    rawIntentInvite:
      "Before we begin — want to jot down what's on your mind, one unpolished line? (Enter to skip): ",
    rawIntentThanks: "Thank you. Koan will keep that line close and reflect it back as the questions unfold.",
    transition: [
      "From here, Koan asks one question at a time — eleven facets of a single idea.",
      "Answer in your own words. Type 'enough' to settle for the clarity you have, or 'stop' to pause anytime."
    ],
    progress: PROGRESS,
    answerAck: (axis, clarity) => `Recorded ${axis} (clarity ${clarity}).`,
    acceptedClarity: "Good — the clarity you have is enough. Let's engrave what we've found.",
    convergedClosing: "Every axis has come into focus — your thinking has ripened.",
    resumeGreeting: "Welcome back — let's pick up the journey where we left it.",
    resumeLastAnswer: (axis, answer) => `Last answer (${axis}): ${answer}`,
    resumeChoices: "Resume: [c]ontinue, [r]evise last answer, [s]top? ",
    resumeUnrecognized: (choice) => `Unrecognized choice: ${choice}`,
    welcomeBack: "Welcome back. Let's look into this new goal together.",
    stopped: "Pausing here. Run koan hello whenever you're ready to continue.",
    sessionComplete: "That's today's journey. Well walked.",
    crystallized: (count) => `Engraved ${count} axes into your documents.`
  },
  mixed: {
    welcome: BILINGUAL_WELCOME,
    languageWhy: BILINGUAL_LANGUAGE_WHY,
    languagePrompt: BILINGUAL_LANGUAGE_PROMPT,
    developmentUnderstandingWhy: "개발 경험을 알면 question의 depth를 당신에게 맞출 수 있어요.",
    developmentUnderstandingAsk:
      "개발이 얼마나 familiar하세요? [1 non_technical / 2 beginner / 3 intermediate / 4 expert] (2): ",
    explanationStyleWhy: "어떤 style의 설명이 편한지 알면, 답변을 그 결에 맞출게요.",
    explanationStyleAsk:
      "어떤 explanation이 편하세요? [1 short / 2 example_first / 3 step_by_step / 4 technical_ok] (2): ",
    outputUseWhy: "정리된 output을 어디에 쓰실지 알면, 문서를 거기에 맞출 수 있어요.",
    outputUseAsk:
      "정리된 결과는 주로 어떻게 쓰실 건가요? [1 self_implementation / 2 agent_execution / 3 team_sharing / 4 learning] (2): ",
    domainBackgroundWhy: "어떤 domain에서 오셨는지 알면, 익숙한 말로 여쭤볼 수 있어요.",
    domainBackgroundAsk: "어떤 field나 background에서 일하고 계세요? (자유롭게, 비워 두셔도 돼요): ",
    learningModeWhy: "Koan이 무언가 배웠을 때, 먼저 여쭤볼지 바로 apply할지 정하는 항목이에요.",
    learningModeAsk: "변경 반영 방식은요? [1 approval_required / 2 auto_with_review] (1): ",
    profileSaved: "좋아요, profile로 기억해 둘게요. 언제든 koan hello --setup으로 바꿀 수 있어요.",
    skillOffer: "원하시면 Koan을 Claude Code나 Codex에서 skill로 쓸 수 있게 연결해 드릴 수 있어요.",
    skillOfferHint: "[1 claude / 2 codex / 3 both / Enter 건너뛰기] (나중에 koan connect로도 가능해요): ",
    skillGuidanceClaude: "Claude Code 연결은 이 command로 할 수 있어요: koan connect claude",
    skillGuidanceCodex: "Codex 연결은 이 command로 할 수 있어요: koan connect codex",
    rawIntentInvite:
      "시작하기 전에, 지금 머릿속에 있는 생각을 형식 없이 한 줄로 적어 보실래요? (Enter로 skip): ",
    rawIntentThanks: "고마워요. 그 문장을 잘 간직해 두었다가, question을 건넬 때 함께 비춰 볼게요.",
    transition: [
      "이제부터 Koan이 question을 하나씩 건넬게요. 하나의 생각을 11가지 각도에서 비춰 보는 journey예요.",
      "생각나는 대로 편하게 답해 주세요. 충분하다 싶으면 'enough', 잠시 멈추고 싶으면 'stop'을 입력하면 돼요."
    ],
    progress: PROGRESS,
    answerAck: (axis, clarity) => `기록했어요 — ${axis} (clarity ${clarity})`,
    acceptedClarity: "좋아요, 지금의 clarity로 충분해요. 여기까지의 생각을 문서로 새길게요.",
    convergedClosing: "모든 axis가 또렷해졌어요. 생각이 충분히 여물었네요.",
    resumeGreeting: "다시 만나서 반가워요. 지난 journey를 이어가 볼까요?",
    resumeLastAnswer: (axis, answer) => `지난 answer (${axis}): ${answer}`,
    resumeChoices: "이어가기 [c] / 지난 답 고치기 [r] / 멈추기 [s]? ",
    resumeUnrecognized: (choice) => `이해하지 못했어요: ${choice}`,
    welcomeBack: "다시 오셨네요. 새 goal을 함께 들여다볼게요.",
    stopped: "여기서 잠시 멈출게요. 이어가고 싶을 때 koan hello를 실행해 주세요.",
    sessionComplete: "오늘의 journey는 여기까지예요. 수고하셨어요.",
    crystallized: (count) => `${count}개의 axis를 문서에 새겨 두었어요.`
  }
};

export function onboardingCopy(language: UserProfile["language"]): OnboardingCopy {
  return ONBOARDING_COPY[language] ?? ONBOARDING_COPY.ko;
}

// Progress through the question loop: step k of AXIS_TOTAL, where k counts
// from 1 and treats a revised (already-resolved) axis as its own step.
// k = (total + 1) - (number of unresolved axes including the current one).
export function progressStep(unresolved: readonly string[], currentAxis: string): number {
  const count = unresolved.includes(currentAxis) ? unresolved.length : unresolved.length + 1;
  return Math.max(1, AXIS_TOTAL + 1 - count);
}

// Journey-style profile setup: language first (asked bilingually), then the
// five remaining questions in the chosen language, each preceded by a
// one-line explanation of why Koan asks. Same option values, numeric-input
// contract, and defaults as the original setup — the change is tone and
// order, not substance.
export async function runJourneyProfileSetup(prompt: Prompter, homeDir: string): Promise<UserProfile> {
  const profile = defaultProfile();
  let ended = false;

  const choose = async <T extends string>(
    why: string,
    question: string,
    options: readonly T[],
    fallback: T
  ): Promise<T> => {
    if (ended) return fallback;
    console.log(why);
    const line = await prompt.ask(question);
    if (line === null) {
      ended = true;
      return fallback;
    }
    if (/^[0-9]+$/.test(line)) return options[Number.parseInt(line, 10) - 1] ?? fallback;
    return options.find((option) => option === line) ?? fallback;
  };

  const bilingual = ONBOARDING_COPY.ko;
  profile.language = await choose(
    bilingual.languageWhy,
    bilingual.languagePrompt,
    LANGUAGE_OPTIONS,
    profile.language
  );
  const copy = onboardingCopy(profile.language);

  profile.developmentUnderstanding = await choose(
    copy.developmentUnderstandingWhy,
    copy.developmentUnderstandingAsk,
    DEVELOPMENT_UNDERSTANDING_OPTIONS,
    profile.developmentUnderstanding
  );
  profile.explanationStyle = await choose(
    copy.explanationStyleWhy,
    copy.explanationStyleAsk,
    EXPLANATION_STYLE_OPTIONS,
    profile.explanationStyle
  );
  profile.outputUse = await choose(
    copy.outputUseWhy,
    copy.outputUseAsk,
    OUTPUT_USE_OPTIONS,
    profile.outputUse
  );
  if (!ended) {
    console.log(copy.domainBackgroundWhy);
    const background = await prompt.ask(copy.domainBackgroundAsk);
    if (background === null) ended = true;
    else profile.domainBackground = background;
  }
  profile.learningMode = await choose(
    copy.learningModeWhy,
    copy.learningModeAsk,
    LEARNING_MODE_OPTIONS,
    profile.learningMode
  );

  const saved = await saveProfile(homeDir, profile);
  console.log(copy.profileSaved);
  return saved;
}

// Offer to install Koan as a skill for Claude Code / Codex. A selection (or a
// plain "yes") runs the real installer; Enter/EOF skips silently; anything
// else prints the manual-connect guidance so the path stays discoverable.
const AFFIRMATIVES = new Set(["y", "yes", "네", "예", "응", "그래", "좋아"]);

export async function offerSkillInstall(
  prompt: Prompter,
  copy: OnboardingCopy,
  homeDir: string,
  language: UserProfile["language"]
): Promise<void> {
  console.log(copy.skillOffer);
  const line = (await prompt.ask(copy.skillOfferHint))?.trim().toLowerCase() ?? "";
  const agents: ConnectAgent[] =
    line === "1" || line === "claude"
      ? ["claude"]
      : line === "2" || line === "codex"
        ? ["codex"]
        : line === "3" || line === "both" || AFFIRMATIVES.has(line)
          ? ["claude", "codex"]
          : [];
  if (agents.length > 0) {
    await runConnect({ agents, homeDir, language });
    return;
  }
  if (line.length > 0) {
    // Unrecognized non-empty input: don't install, but leave a pointer.
    console.log(copy.skillGuidanceClaude);
    console.log(copy.skillGuidanceCodex);
  }
  // Enter or EOF: skip silently.
}

// Invite one unpolished line of raw intent before the question loop begins.
// Non-empty text is stored in the MCP cache so later surfaces can reflect it;
// Enter (or EOF) skips silently.
export async function inviteRawIntent(
  prompt: Prompter,
  projectRoot: string,
  copy: OnboardingCopy
): Promise<void> {
  const line = await prompt.ask(copy.rawIntentInvite);
  const text = line?.trim() ?? "";
  if (text.length === 0) return;
  await updateMcpCache(projectRoot, (cache) => ({ ...cache, rawIntent: text }));
  console.log(copy.rawIntentThanks);
}
