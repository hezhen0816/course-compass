import type {
  CourseSearchResult,
  CourseSemesterInfo,
  HistoryImportResponse,
  RequirementPdfImportResponse,
  ScheduleSyncResponse,
} from './types';

const API_BASE_URL = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    let message = `API 請求失敗 (${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.detail) {
        message = String(payload.detail);
      }
    } catch {
      // Keep default message.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function fetchCourseSemesters(): Promise<CourseSemesterInfo[]> {
  return apiRequest<CourseSemesterInfo[]>('/api/courses/semesters');
}

export function searchCourses(semester: string, query: string, mode: 'name' | 'code'): Promise<CourseSearchResult[]> {
  const params = new URLSearchParams({ semester, q: query, mode });
  return apiRequest<CourseSearchResult[]>(`/api/courses/search?${params.toString()}`);
}

export function importRequirementsPdf(file: File): Promise<RequirementPdfImportResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return apiRequest<RequirementPdfImportResponse>('/api/planner/import-requirements/pdf', {
    method: 'POST',
    body: formData,
  });
}

export function syncSchoolSchedule(username: string, password: string): Promise<ScheduleSyncResponse> {
  return apiRequest<ScheduleSyncResponse>('/api/schedule/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      profile_key: username,
      persist_to_supabase: false,
      verify_ssl: false,
    }),
  });
}

export function importAcademicHistory(username: string, password: string): Promise<HistoryImportResponse> {
  return apiRequest<HistoryImportResponse>('/api/history/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      profile_key: username,
      persist_to_supabase: false,
      verify_ssl: false,
    }),
  });
}
