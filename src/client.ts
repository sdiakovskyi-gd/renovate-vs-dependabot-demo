import axios from 'axios';
import pick from 'lodash/pick';

const http = axios.create({
  baseURL: process.env.UPSTREAM_URL ?? 'https://api.github.com',
  timeout: 5000,
});

export interface RepoSummary {
  full_name: string;
  stargazers_count: number;
  default_branch: string;
}

const SUMMARY_FIELDS = ['full_name', 'stargazers_count', 'default_branch'] as const;

export async function fetchRepoSummary(owner: string, repo: string): Promise<RepoSummary> {
  const { data } = await http.get<Record<string, unknown>>(`/repos/${owner}/${repo}`);
  return pick(data, SUMMARY_FIELDS as unknown as string[]) as unknown as RepoSummary;
}
