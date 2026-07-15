export interface PRInfo {
  workspace: string;
  repoSlug: string;
  prNumber: number;
}

export interface PRMetadata {
  title: string;
  description: string;
  sourceBranch: string;
  commitMessages: string[];
}

export interface ReviewFinding {
  severity: 'CRITICAL' | 'HIGH' | 'BUG';
  file: string;
  line?: number;
  message: string;
}

export interface ReviewResult {
  findings: ReviewFinding[];
  jiraKeys: string[];
  prUrl: string;
}

export interface BitbucketConfig {
  email: string;
  apiToken: string;
}

export interface JiraConfig {
  email: string;
  apiToken: string;
  baseUrl: string;
  projectKey: string;
}
