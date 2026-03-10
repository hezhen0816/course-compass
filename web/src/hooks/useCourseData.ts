import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import type { AppData, Course } from '../types';
import { INITIAL_SEMESTERS, DEFAULT_TARGETS } from '../constants';

function normalizeCourse(course: Course): Course {
  return {
    ...course,
    program: course.program ?? 'home',
  };
}

function normalizeAppData(rawData: AppData): AppData {
  return {
    ...rawData,
    semesters: (rawData.semesters || INITIAL_SEMESTERS).map((semester) => ({
      ...semester,
      courses: (semester.courses || []).map(normalizeCourse),
    })),
    targets: {
      ...DEFAULT_TARGETS,
      ...(rawData.targets || {}),
    },
  };
}

function createEmptyAppData(): AppData {
  return normalizeAppData({
    semesters: INITIAL_SEMESTERS,
    targets: { ...DEFAULT_TARGETS },
  });
}

type UserDataRecord = {
  content: AppData;
};

export function useCourseData(session: Session | null) {
  const [data, setData] = useState<AppData>(() => createEmptyAppData());
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [loadedUserID, setLoadedUserID] = useState<string | null>(null);
  const userID = session?.user.id ?? null;

  const isLoading = useMemo(() => {
    if (!supabase || !userID) {
      return false;
    }
    return loadedUserID != userID;
  }, [loadedUserID, userID]);

  useEffect(() => {
    if (!userID || !supabase) {
      return;
    }

    const client = supabase;
    let isActive = true;

    const loadUserData = async () => {
      const result = await client
        .from('user_data')
        .select('content')
        .eq('user_id', userID)
        .maybeSingle();

      if (!isActive) {
        return;
      }

      if (result.error) {
        console.error('Error loading data:', result.error);
      }

      const userData = result.data as UserDataRecord | null;
      if (userData?.content) {
        setData(normalizeAppData(userData.content));
      } else {
        setData(createEmptyAppData());
      }
      setLoadedUserID(userID);
      setSyncStatus('idle');
    };

    void loadUserData();

    return () => {
      isActive = false;
    };
  }, [userID]);

  useEffect(() => {
    if (!userID || !supabase || loadedUserID !== userID) {
      return;
    }

    const client = supabase;
    let isActive = true;
    let resetStatusTimer: ReturnType<typeof window.setTimeout> | undefined;
    const saveTimer = window.setTimeout(async () => {
      setSyncStatus('saving');

      const normalizedData = normalizeAppData(data);
      const { error } = await client
        .from('user_data')
        .upsert(
          [{ user_id: userID, content: normalizedData, updated_at: new Date().toISOString() }],
          { onConflict: 'user_id' }
        );

      if (!isActive) {
        return;
      }

      if (error) {
        console.error('Error saving data:', error);
        setSyncStatus('error');
        return;
      }

      setSyncStatus('saved');
      resetStatusTimer = window.setTimeout(() => {
        if (isActive) {
          setSyncStatus('idle');
        }
      }, 2000);
    }, 2000);

    return () => {
      isActive = false;
      window.clearTimeout(saveTimer);
      if (resetStatusTimer) {
        window.clearTimeout(resetStatusTimer);
      }
    };
  }, [data, loadedUserID, userID]);

  return { data, setData, syncStatus, isLoading };
}
