-- 在線時間（Worker 上線起點）改由資料庫計算。
-- 前端原本抓 1500 筆心跳自己往回掃，但 PostgREST 的 db-max-rows 上限是 1000 列：
-- 實際只拿得到 1000 筆（約 17 小時），起點永遠卡在視窗邊界而不是真正的斷線點，
-- 而且每次輪詢要傳約 78 KB。改成一次 RPC 回傳一列。

create index if not exists idx_system_logs_user_type_created_at
  on public.system_logs using btree (user_id, type, created_at desc);

create or replace function public.worker_heartbeat_status(p_timeout_seconds integer default 90)
returns table (
  online_since timestamptz,
  last_heartbeat_at timestamptz,
  last_message text
)
language sql
stable
security invoker
set search_path = public
as $$
  with hb as (
    select
      created_at,
      message,
      created_at - lag(created_at) over (order by created_at) as gap
    from public.system_logs
    where user_id = (select auth.uid())
      and type = 'heartbeat'
  )
  select
    -- 最後一個超過 timeout 的間隙之後的第一筆心跳＝本次連線起點；
    -- 整段都沒斷過就退回保留期內最早的一筆。
    coalesce(
      max(created_at) filter (where gap > make_interval(secs => p_timeout_seconds)),
      min(created_at)
    ),
    max(created_at),
    (select message from hb order by created_at desc limit 1)
  from hb;
$$;

revoke all on function public.worker_heartbeat_status(integer) from public;
grant execute on function public.worker_heartbeat_status(integer) to authenticated;
