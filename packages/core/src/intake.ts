// Intake engine types — conversation, content research, talent profile

import type { Message } from './ai.js';

// --- Conversation Engine ---

export type ConversationPhase = 'role' | 'company' | 'success_profile' | 'strategy';

export interface IntakeContext {
  roleDescription?: string;
  roleParameters?: RoleParameters;
  companyUrl?: string;
  companyIntel?: CompanyIntel;
  teamProfiles?: ProfileAnalysis[];
  antiPatterns?: string[];
  competitorMap?: CompetitorMap;
  talentProfile?: TalentProfile;
  similaritySeeds?: string[];
  conversationHistory: Message[];
}

export interface ParsedResponse {
  structured: Record<string, unknown>;
  contextUpdates: Partial<IntakeContext>;
  followUpNeeded: boolean;
  followUpReason?: string;
}

export interface ConversationNode {
  id: string;
  phase: ConversationPhase;
  prompt: string | ((context: IntakeContext) => Promise<string>);
  parse: (response: string, context: IntakeContext) => Promise<ParsedResponse>;
  next: (parsed: ParsedResponse, context: IntakeContext) => string;
  optional?: boolean;
  skipIf?: (context: IntakeContext) => boolean;
}

// --- Content Research ---

export type ProfileInput =
  | { type: 'github_url'; url: string }
  | { type: 'linkedin_url'; url: string }
  | { type: 'pasted_text'; text: string }
  | { type: 'name_company'; name: string; company: string }
  | { type: 'personal_url'; url: string };

export interface CrawledContent {
  url: string;
  title?: string;
  text: string;
  html?: string;
  crawledAt: string;
  adapter: string;
}

export interface CompanyIntel {
  name: string;
  url: string;
  techStack: string[];
  teamSize?: string;
  fundingStage?: string;
  productCategory?: string;
  cultureSignals: string[];
  pitch?: string;
  competitors?: string[];
  analyzedAt: string;
}

export interface CareerStep {
  company: string;
  role?: string;
  duration?: string;
  signals: string[];
}

export interface ProfileAnalysis {
  inputType: ProfileInput['type'];
  name?: string;
  careerTrajectory: CareerStep[];
  skillSignatures: string[];
  seniorityLevel?: string;
  cultureSignals: string[];
  urls: string[];
  analyzedAt: string;
}

export interface SimilarResult {
  url: string;
  title?: string;
  similarity: number;
  snippet?: string;
}

export interface ContentResearch {
  crawlUrl(url: string): Promise<CrawledContent>;
  analyzeCompany(content: CrawledContent): Promise<CompanyIntel>;
  analyzeProfile(input: ProfileInput): Promise<ProfileAnalysis>;
  findSimilar(urls: string[]): Promise<SimilarResult[]>;
}

// --- Role & Talent Profile ---

export interface RoleParameters {
  title: string;
  level: string;
  scope: string;
  location?: string;
  remotePolicy?: 'remote' | 'hybrid' | 'in_person' | 'negotiable';
  compensationRange?: { min?: number; max?: number; currency: string };
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  teamSize?: string;
  reportingTo?: string;
}

export interface CompetitorMap {
  targetCompanies: string[];
  avoidCompanies: string[];
  competitorReason: Record<string, string>;
}

export interface TalentProfile {
  role: RoleParameters;
  company: CompanyIntel;
  successPatterns: {
    careerTrajectories: CareerStep[][];
    skillSignatures: string[];
    seniorityCalibration: string;
    cultureSignals: string[];
  };
  antiPatterns: string[];
  competitorMap: CompetitorMap;
  createdAt: string;
}
