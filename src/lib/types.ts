export type Task = {
  id: string;
  user_id: number;
  title: string;
  due_date: string | null; // YYYY-MM-DD
  done: boolean;
  source: string;
  created_at: string;
  completed_at: string | null;
};

export type Note = {
  id: string;
  user_id: number;
  body: string;
  source: string;
  created_at: string;
};

export type Meeting = {
  id: string;
  user_id: number;
  title: string;
  starts_at: string; // локальное время: "2026-10-07T14:30:00"
  ends_at: string | null;
  note: string | null;
  source: string;
  created_at: string;
};
