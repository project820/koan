import type { AmbiguityAxis, DevelopmentUnderstanding, Language, UserProfile } from "./schemas.js";

interface QuestionTemplate {
  intent: string;
  text: Record<Language, Record<DevelopmentUnderstanding, string>>;
}

export interface KoanQuestion {
  axis: AmbiguityAxis;
  intent: string;
  userFacingQuestion: string;
  answerSchema: "free_text";
  hostAgentInstruction: string;
}

const fallbackLevels: DevelopmentUnderstanding[] = ["beginner", "intermediate", "expert", "non_technical"];

const bank: Record<AmbiguityAxis, QuestionTemplate> = {
  purpose: {
    intent: "Clarify why the project should exist.",
    text: {
      ko: {
        non_technical: "이 프로젝트를 만들고 싶은 가장 큰 이유는 무엇인가요?",
        beginner: "이 프로젝트가 해결해야 하는 가장 중요한 문제는 무엇인가요?",
        intermediate: "이 프로젝트의 핵심 목적을 한 문장으로 말하면 무엇인가요?",
        expert: "이 프로젝트의 primary objective는 무엇인가요?"
      },
      en: {
        non_technical: "What is the main reason you want this project to exist?",
        beginner: "What is the most important problem this project should solve?",
        intermediate: "What is the project's core purpose in one sentence?",
        expert: "What is the primary objective of this project?"
      },
      mixed: {
        non_technical: "이 프로젝트를 만들고 싶은 main reason은 무엇인가요?",
        beginner: "이 프로젝트가 해결해야 하는 core problem은 무엇인가요?",
        intermediate: "이 프로젝트의 core purpose를 한 문장으로 말하면 무엇인가요?",
        expert: "이 프로젝트의 primary objective는 무엇인가요?"
      }
    }
  },
  target_users: {
    intent: "Identify who changes if the project succeeds.",
    text: {
      ko: {
        non_technical: "이게 완성되면 누가 가장 도움을 받나요?",
        beginner: "주 사용자는 누구이고, 그 사람의 어떤 상황이 달라지나요?",
        intermediate: "이 프로젝트의 target user와 개선될 workflow는 무엇인가요?",
        expert: "Primary user segment와 user outcome을 정의해 주세요."
      },
      en: {
        non_technical: "Who benefits most if this works?",
        beginner: "Who is the main user, and what gets easier for them?",
        intermediate: "What target user and workflow does this improve?",
        expert: "Define the primary user segment and user outcome."
      },
      mixed: {
        non_technical: "이게 완성되면 who benefits most인가요?",
        beginner: "main user는 누구이고 무엇이 easier해지나요?",
        intermediate: "target user와 개선될 workflow는 무엇인가요?",
        expert: "primary user segment와 user outcome을 정의해 주세요."
      }
    }
  },
  current_goal: {
    intent: "Define the active goal for this Koan session.",
    text: {
      ko: {
        non_technical: "이번에 먼저 끝내고 싶은 한 가지는 무엇인가요?",
        beginner: "지금 당장 Koan이 정리해야 할 목표 하나를 고르면 무엇인가요?",
        intermediate: "이번 세션의 active goal은 무엇인가요?",
        expert: "Define the active goal for this planning cycle."
      },
      en: {
        non_technical: "What is the one thing you want to finish first?",
        beginner: "What single goal should Koan clarify right now?",
        intermediate: "What is the active goal for this session?",
        expert: "Define the active goal for this planning cycle."
      },
      mixed: {
        non_technical: "먼저 finish하고 싶은 one thing은 무엇인가요?",
        beginner: "지금 Koan이 clarify할 single goal은 무엇인가요?",
        intermediate: "이번 session의 active goal은 무엇인가요?",
        expert: "이번 planning cycle의 active goal을 정의해 주세요."
      }
    }
  },
  scope: {
    intent: "Clarify what is inside the current goal.",
    text: {
      ko: {
        non_technical: "이번에 꼭 포함되어야 하는 일은 무엇인가요?",
        beginner: "이번 목표 안에 들어가는 기능이나 결과물은 무엇인가요?",
        intermediate: "이번 scope에 포함되는 deliverable은 무엇인가요?",
        expert: "List the in-scope deliverables for this goal."
      },
      en: {
        non_technical: "What must be included this time?",
        beginner: "What features or outputs belong inside this goal?",
        intermediate: "What deliverables are in scope?",
        expert: "List the in-scope deliverables for this goal."
      },
      mixed: {
        non_technical: "이번에 must include 되는 일은 무엇인가요?",
        beginner: "이번 goal 안에 들어가는 features나 outputs는 무엇인가요?",
        intermediate: "이번 scope의 deliverables는 무엇인가요?",
        expert: "in-scope deliverables를 정의해 주세요."
      }
    }
  },
  non_goals: {
    intent: "Clarify what must not be included now.",
    text: {
      ko: {
        non_technical: "이번에는 하지 말아야 할 일은 무엇인가요?",
        beginner: "나중으로 미루거나 제외해야 하는 것은 무엇인가요?",
        intermediate: "이번 목표의 non-goals는 무엇인가요?",
        expert: "Define explicit non-goals and exclusions."
      },
      en: {
        non_technical: "What should not be done this time?",
        beginner: "What should be postponed or excluded?",
        intermediate: "What are the non-goals for this goal?",
        expert: "Define explicit non-goals and exclusions."
      },
      mixed: {
        non_technical: "이번에는 not do 해야 할 일은 무엇인가요?",
        beginner: "postpone하거나 exclude할 것은 무엇인가요?",
        intermediate: "이번 goal의 non-goals는 무엇인가요?",
        expert: "explicit non-goals와 exclusions를 정의해 주세요."
      }
    }
  },
  constraints: {
    intent: "Identify constraints that shape the plan.",
    text: {
      ko: {
        non_technical: "꼭 지켜야 하는 조건이나 제한이 있나요?",
        beginner: "시간, 비용, 도구, 환경 중 반드시 맞춰야 하는 조건은 무엇인가요?",
        intermediate: "이번 구현의 constraints는 무엇인가요?",
        expert: "List technical, operational, and product constraints."
      },
      en: {
        non_technical: "Are there any rules or limits we must respect?",
        beginner: "What time, cost, tool, or environment limits matter?",
        intermediate: "What constraints shape this implementation?",
        expert: "List technical, operational, and product constraints."
      },
      mixed: {
        non_technical: "꼭 respect해야 하는 rules나 limits가 있나요?",
        beginner: "time, cost, tool, environment limits 중 중요한 것은 무엇인가요?",
        intermediate: "이번 implementation constraints는 무엇인가요?",
        expert: "technical, operational, product constraints를 정의해 주세요."
      }
    }
  },
  success_criteria: {
    intent: "Define how completion will be judged.",
    text: {
      ko: {
        non_technical: "무엇을 보면 '이제 됐다'고 말할 수 있나요?",
        beginner: "이 작업이 finished 되었다고 판단할 결과는 무엇인가요?",
        intermediate: "완료 판단 기준과 검증 방법은 무엇인가요?",
        expert: "Define acceptance criteria and verification signals."
      },
      en: {
        non_technical: "What will make you say, 'this is done'?",
        beginner: "What result proves this is finished?",
        intermediate: "What completion criteria and verification steps matter?",
        expert: "Define acceptance criteria and verification signals."
      },
      mixed: {
        non_technical: "무엇을 보면 'this is done'이라고 말할 수 있나요?",
        beginner: "이 작업이 finished 됐다는 result는 무엇인가요?",
        intermediate: "completion criteria와 verification steps는 무엇인가요?",
        expert: "acceptance criteria와 verification signals를 정의해 주세요."
      }
    }
  },
  philosophical_intent: {
    intent: "Record the deeper reason and principle behind the work.",
    text: {
      ko: {
        non_technical: "기능 말고, 왜 이걸 만들고 싶어졌나요?",
        beginner: "이 프로젝트가 바로잡고 싶은 불편함이나 혼란은 무엇인가요?",
        intermediate: "구현 중에도 잃지 말아야 할 원칙은 무엇인가요?",
        expert: "What product philosophy should guide tradeoffs?"
      },
      en: {
        non_technical: "Beyond features, why do you want this to exist?",
        beginner: "What frustration or confusion should this correct?",
        intermediate: "What principle must survive implementation tradeoffs?",
        expert: "What product philosophy should guide tradeoffs?"
      },
      mixed: {
        non_technical: "features 말고, 왜 이걸 만들고 싶어졌나요?",
        beginner: "이 프로젝트가 correct해야 할 frustration이나 confusion은 무엇인가요?",
        intermediate: "implementation tradeoffs 속에서도 지킬 principle은 무엇인가요?",
        expert: "tradeoffs를 guide할 product philosophy는 무엇인가요?"
      }
    }
  },
  implementation_plan: {
    intent: "Clarify enough structure for implementation planning.",
    text: {
      ko: {
        non_technical: "어떤 순서로 만들면 가장 자연스러울까요?",
        beginner: "처음 만들 부분, 그 다음 만들 부분을 나누면 어떻게 되나요?",
        intermediate: "구현을 어떤 단계로 나누면 좋을까요?",
        expert: "What implementation phases and module boundaries should the plan use?"
      },
      en: {
        non_technical: "What order would feel natural to build this in?",
        beginner: "What should be built first, second, and after that?",
        intermediate: "How should implementation be split into phases?",
        expert: "What implementation phases and module boundaries should the plan use?"
      },
      mixed: {
        non_technical: "어떤 order로 build하면 자연스러울까요?",
        beginner: "first, second, after that으로 나누면 어떻게 되나요?",
        intermediate: "implementation phases를 어떻게 나누면 좋을까요?",
        expert: "implementation phases와 module boundaries를 정의해 주세요."
      }
    }
  },
  qa_criteria: {
    intent: "Define how review should judge the work.",
    text: {
      ko: {
        non_technical: "검토할 때 꼭 확인해야 하는 것은 무엇인가요?",
        beginner: "잘 만들었는지 확인할 체크리스트는 무엇인가요?",
        intermediate: "QA 기준과 테스트 기대치는 무엇인가요?",
        expert: "Define spec-compliance and general quality review criteria."
      },
      en: {
        non_technical: "What must be checked during review?",
        beginner: "What checklist proves this was built well?",
        intermediate: "What QA criteria and test expectations matter?",
        expert: "Define spec-compliance and general quality review criteria."
      },
      mixed: {
        non_technical: "review 때 꼭 check해야 하는 것은 무엇인가요?",
        beginner: "잘 만들었는지 확인할 checklist는 무엇인가요?",
        intermediate: "QA criteria와 test expectations는 무엇인가요?",
        expert: "spec-compliance와 general quality criteria를 정의해 주세요."
      }
    }
  },
  handoff_readiness: {
    intent: "Clarify what another agent needs to continue.",
    text: {
      ko: {
        non_technical: "다른 사람이 이어받으려면 꼭 알아야 할 것은 무엇인가요?",
        beginner: "Codex나 Claude가 다음에 바로 이어가려면 어떤 설명이 필요할까요?",
        intermediate: "handoff에 반드시 포함할 맥락과 다음 행동은 무엇인가요?",
        expert: "What context, state, and next action are required for handoff?"
      },
      en: {
        non_technical: "What must another person know to continue?",
        beginner: "What should Codex or Claude know to pick this up next?",
        intermediate: "What context and next action must handoff include?",
        expert: "What context, state, and next action are required for handoff?"
      },
      mixed: {
        non_technical: "다른 사람이 continue하려면 꼭 알아야 할 것은 무엇인가요?",
        beginner: "Codex나 Claude가 pick up하려면 어떤 설명이 필요할까요?",
        intermediate: "handoff에 포함할 context와 next action은 무엇인가요?",
        expert: "handoff에 required context, state, next action을 정의해 주세요."
      }
    }
  }
};

export function getQuestion(axis: AmbiguityAxis, profile: UserProfile): KoanQuestion {
  const template = bank[axis];
  const language = profile.language;
  const byLevel = template.text[language] ?? template.text.ko;
  const question =
    byLevel[profile.developmentUnderstanding] ??
    fallbackLevels.map((level) => byLevel[level]).find(Boolean) ??
    template.intent;

  return {
    axis,
    intent: template.intent,
    userFacingQuestion: question,
    answerSchema: "free_text",
    hostAgentInstruction:
      "Preserve the user's reasoning. If using MCP mode, structure the answer into decision, reasoning, constraints, out-of-scope, and project context before recording it."
  };
}
