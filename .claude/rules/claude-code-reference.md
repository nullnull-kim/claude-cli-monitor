# Claude Code 소스 참조 가이드

> 이 파일은 `src/` 접근 시 자동 로드된다.
> 참조 소스: `C:\Users\kimty\CLAUDE\claude-code` (비공식 reverse-engineered 구현체 — 실제 동작과 대조 검증 필수)

## 핵심 참조 파일

| 목적 | 파일 경로 (claude-code 기준) |
|------|---------------------------|
| 훅 이벤트 전체 목록 + 입출력 스키마 | `src/entrypoints/sdk/coreSchemas.ts` |
| 훅 타입 정의 (HookCallback, HookJSONOutput) | `src/types/hooks.ts` |
| transcript JSONL 엔트리 타입 | `src/types/logs.ts` |
| 에이전트 실행 로직 (runAgent, sidechain 생성) | `src/tools/AgentTool/runAgent.ts` |
| 에이전트 정의 로딩 | `src/tools/AgentTool/loadAgentsDir.ts` |
| 세션 저장/JSONL 읽기쓰기 | `src/utils/sessionStorage.ts` |
| 메시지 생성/정규화 | `src/utils/messages.ts` |
| 훅 실행 엔진 | `src/utils/hooks.ts` |
| SDK 타입 (공개 API) | `src/entrypoints/agentSdkTypes.ts` |

## 이 프로젝트가 사용하는 훅 이벤트

- `SubagentStart` — 서브에이전트 스폰 시. `agent_id`(필수), `agent_type`(선택) 포함
- `SubagentStop` — 서브에이전트 완료 시. `agent_id`(필수)
- `PostToolUse` — 도구 실행 후. `tool_name`, `tool_input`, `tool_response` 포함
- `UserPromptSubmit` — 사용자 프롬프트 제출 시
- `Stop` — 세션 종료 시

## 향후 활용 가능한 이벤트

`PreCompact`/`PostCompact`, `TaskCreated`/`TaskCompleted`, `WorktreeCreate`/`WorktreeRemove`, `TeammateIdle`

## 훅 입력 기본 구조

`BaseHookInputSchema` (coreSchemas.ts):
```
session_id: string        (필수)
transcript_path: string   (필수)
cwd: string               (필수)
permission_mode?: string
agent_id?: string         // 서브에이전트 컨텍스트에서만 존재
agent_type?: string
```
참고: `hook_event_name`은 base가 아닌 이벤트별 확장 스키마에서 추가됨.

## 주요 Transcript JSONL 엔트리 타입 (logs.ts)

우리 parser.ts가 파싱하는 대상:
- `TranscriptMessage` — user/assistant 메시지 (type: `'user' | 'assistant' | 'progress' | 'file-history-snapshot'`)

참고용 (현재 미파싱):
- `AgentNameMessage`, `AgentColorMessage`, `AgentSettingMessage` — 에이전트 메타데이터
- `ContextCollapseCommitEntry` / `ContextCollapseSnapshotEntry` — 컨텍스트 압축 기록
- `AttributionSnapshotMessage` — Claude 기여도 추적

서브에이전트 transcript는 `isSidechain: true`로 별도 JSONL 파일에 저장됨.

## 참조 규칙

- **타입 불일치 발견 시**: 우리 `types.ts`와 claude-code `src/types/logs.ts`를 비교하여 차이를 보고한다.
- **새 훅 이벤트 연동 시**: `coreSchemas.ts`에서 해당 이벤트의 입력 스키마를 먼저 확인한다.
- **파싱 오류 디버깅 시**: `sessionStorage.ts`의 JSONL 읽기 로직과 `messages.ts`의 정규화 로직을 참조한다.
- **에이전트 라이프사이클 이해 시**: `runAgent.ts`에서 스폰→실행→결과 반환 흐름을 확인한다.
- **참조 후 반드시 실제 동작과 대조**: 이 소스는 비공식이므로 필드명·동작이 실제와 다를 수 있다.
