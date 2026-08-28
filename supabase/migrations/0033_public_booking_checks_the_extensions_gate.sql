-- The gate goes in the PUBLIC wrapper, beside client_must_call, and nowhere
-- else. staff_book_appointment does not call it, deliberately: when a client
-- rings up because her hair is late, or arrived early, or she ordered it in
-- person months ago, Hassan must be able to book her anyway. A rule that the
-- salon cannot override is a rule that turns paying clients away.
--
-- Rewritten from its own live definition so the fourteen arguments, the rate
-- limit, the terms check and the name handling come through exactly as they
-- are; only the new check is added. Asserts first that it is amending the
-- version it thinks it is.
do $$
declare v_def text; v_anchor text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'book_appointment'
     and pg_get_function_identity_arguments(p.oid) like '%p_sms_consent boolean%';

  if v_def is null then raise exception 'The 14-argument book_appointment was not found'; end if;

  v_anchor := 'if client_must_call(p_customer_phone, p_service_id) then';
  if position(v_anchor in v_def) = 0 then
    raise exception 'client_must_call guard not found - not amending blind';
  end if;

  v_new := 'declare v_ext_block text;
  begin
    v_ext_block := extensions_booking_block(p_customer_phone, p_service_id, p_addon_ids, p_date);
    if v_ext_block is not null then raise exception ''%'', v_ext_block; end if;
  end;

  ' || v_anchor;

  execute replace(v_def, v_anchor, v_new);
end $$;
