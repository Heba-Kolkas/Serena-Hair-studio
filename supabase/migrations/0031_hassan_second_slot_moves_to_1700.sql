-- ── HASSAN'S SECOND SHORT SLOT MOVES: 16:30 → 17:00 ──
--
-- Three places have to agree or the change half-lands: the times offered, the
-- rule that lets a short client sit inside a colour's processing time, and the
-- half hour around an arrival where a consultation may not start. Move only
-- the first and a 17:00 booking is offered and then refused as an overlap.
--
-- The two functions are rewritten from their own live definitions rather than
-- re-typed. book_appointment_core is 350 lines; re-entering it by hand to
-- change five characters is how a booking rule gets silently altered. Counted
-- first: exactly one occurrence of 16:30 in each.

-- 1. The times themselves.
update staff_service_schedule sss
   set start_time = time '17:00'
  from staff s, services sv
 where s.id = sss.staff_id and sv.id = sss.service_id
   and s.name = 'Hassan K.'
   and not sv.daily_limited
   and sss.start_time = time '16:30';

-- 2 and 3. The overlap pairing and the consultation blackout.
do $$
declare v_src text; v_n int;
begin
  foreach v_src in array array['book_appointment_core', 'consultation_start_allowed'] loop
    declare v_def text;
    begin
      select pg_get_functiondef(p.oid) into v_def
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = v_src
       limit 1;
      if v_def is null then raise exception 'Function % not found', v_src; end if;

      v_n := (length(v_def) - length(replace(v_def, '16:30', ''))) / 5;
      if v_n <> 1 then
        raise exception 'Expected exactly one 16:30 in %, found % - not touching it', v_src, v_n;
      end if;

      execute replace(v_def, '16:30', '17:00');
    end;
  end loop;
end $$;
