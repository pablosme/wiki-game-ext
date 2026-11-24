export type Language = 'pt' | 'en';

export type GameMode = 'free' | 'daily';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface GameLimits {
  maxTimeSeconds: number | null;
  maxClicks: number | null;
}

export interface TopicModifier {
  topic: string;
  points: number;
}

export interface CheckpointModifier {
  title: string;
  points: number;
  required: boolean;
}

export interface RoundModifiers {
  clickPenalty: number;
  timePenalty: number;
  topicModifiers: TopicModifier[];
  checkpoint: CheckpointModifier | null;
}

export interface MatchInfo {
  mode: GameMode;
  lang: Language;
  difficulty: Difficulty;
  origin: string;
  target: string;
  modifiers: RoundModifiers;
  limits: GameLimits;
  startedAt: number;
  expiresAt: number;
}

export interface PathStep {
  title: string;
  timestamp: number;
}

export interface ScoreBreakdownItem {
  label: string;
  count: number;
  multiplier: number;
  delta: number;
}

export interface ScoreResult {
  baseScore: number;
  finalScore: number;
  clicks: number;
  elapsedSeconds: number;
  checkpointReached: boolean;
  breakdown: ScoreBreakdownItem[];
}

export type MatchStatus = 'idle' | 'playing' | 'validating' | 'won' | 'lost';

export type LossReason =
  | 'forward_back'
  | 'typed_url'
  | 'multiple_wiki_tabs'
  | 'max_clicks_exceeded'
  | 'max_time_exceeded'
  | 'surrender'
  | 'validation_failed';

export interface ActiveMatchState {
  status: MatchStatus;
  apiUrl: string;
  token: string | null;
  tabId: number | null;
  match: MatchInfo | null;
  path: PathStep[];
  initialNavigationPending: boolean;
  lossReason?: LossReason;
  lossDetails?: string;
  score?: ScoreResult;
}

export type ExtensionMessage =
  | {
      type: 'START_MATCH';
      payload: {
        apiUrl: string;
        mode: GameMode;
        lang: Language;
        difficulty: Difficulty;
        limits: GameLimits;
        enableModifiers: boolean;
      };
    }
  | {
      type: 'ARTICLE_VISITED';
      payload: {
        canonicalTitle: string;
        url: string;
        isDisambiguation: boolean;
      };
    }
  | {
      type: 'SURRENDER_MATCH';
    }
  | {
      type: 'RESET_MATCH';
    }
  | {
      type: 'GET_MATCH_STATE';
    }
  | {
      type: 'STATE_UPDATED';
      payload: ActiveMatchState;
    };
