const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const root = path.resolve(__dirname, '../..'); const migration = path.join(root, 'supabase/migrations/20261013140000_app076_pregnancy_foundation.sql'); const bin = path.dirname(execFileSync('which',['postgres'],{encoding:'utf8'}).trim()); const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'lifesort-app076-')); const cluster=path.join(scratch,'db'); const port='55476'; let started=false;
const args=['-X','-qAt','-v','ON_ERROR_STOP=1','-h',scratch,'-p',port,'-U','postgres','-d','postgres']; const sql=(s)=>execFileSync(path.join(bin,'psql'),args,{input:s,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim(); const err=(s)=>{try{sql(s);}catch(e){return String(e.stderr);}assert.fail('SQL unexpectedly succeeded');};
const sqlAsync=(s)=>new Promise((resolve,reject)=>{ const child=spawn(path.join(bin,'psql'),args,{stdio:['pipe','pipe','pipe']}); let out='', stderr=''; child.stdout.on('data',(chunk)=>{out+=chunk;}); child.stderr.on('data',(chunk)=>{stderr+=chunk;}); child.on('error',reject); child.on('close',(code)=>code===0?resolve(out.trim()):reject(new Error(stderr))); child.stdin.end(s); });
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', C='cccccccc-cccc-4ccc-8ccc-cccccccccccc'; const auth=(id,s)=>sql(`set role authenticated; set request.jwt.claim.sub='${id}'; ${s}`); const authErr=(id,s)=>err(`set role authenticated; set request.jwt.claim.sub='${id}'; ${s}`);
const id=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`; const json=(v)=>`'${JSON.stringify(v).replace(/'/g,"''")}'::jsonb`;
const apply=(who,m,type,e,op,rev,payload,consent)=>auth(who,`select public.apply_pregnancy_sync_mutation('${m}','${type}','${e}','${op}',${rev},${json(payload)},${consent ? `'${consent}'` : 'null'})`);
const grant=(who,version='test-v1')=>auth(who,`select id from public.grant_health_consent('pregnancy-processing','${version}')`);
before(()=>{started=true;execFileSync(path.join(bin,'initdb'),['-D',cluster,'-U','postgres','--auth=trust','--no-locale'],{stdio:'pipe'});execFileSync(path.join(bin,'pg_ctl'),['-D',cluster,'-l',path.join(scratch,'log'),'-o',`-k ${scratch} -p ${port} -c listen_addresses=''`,'-w','start'],{stdio:'pipe'});sql(`create extension pgcrypto;create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;alter default privileges in schema public grant all on tables to anon,authenticated,service_role;alter default privileges in schema public grant all on functions to anon,authenticated,service_role;insert into auth.users values('${A}'),('${B}'),('${C}');`);sql(fs.readFileSync(migration,'utf8'));assert.equal(sql(`select (select count(*) from public.pregnancy_consent_policies)||'/'||(select count(*) from public.health_consents)`),'0/0','the migration seeds no production consent policy and no consent');sql(`insert into public.pregnancy_consent_policies values ('pregnancy-processing','test-v1',true,true),('pregnancy-processing','test-v2',true,false),('pregnancy-processing','off',false,false);`);});
after(()=>{if(started)try{execFileSync(path.join(bin,'pg_ctl'),['-D',cluster,'-m','immediate','-w','stop'],{stdio:'pipe'});}catch{}fs.rmSync(scratch,{recursive:true,force:true});});

test('policy gates consent and withdrawal blocks writes but not deletes',()=>{
  assert.match(authErr(A,`select public.grant_health_consent('marketing-newsletter','zzz')`),/unsupported_consent/); assert.match(authErr(A,`select public.grant_health_consent('pregnancy-processing','off')`),/unsupported_consent/);
  const c=grant(A), p=id(1); apply(A,id(2),'pregnancy',p,'upsert','null',{method:'lmp',outcomeNotes:'PRIVATE'},c); auth(A,`select public.withdraw_health_consent('${c}')`); assert.match(authErr(A,`select public.apply_pregnancy_sync_mutation('${id(3)}','pregnancy','${p}','upsert',1,${json({method:'lmp'})},'${c}')`),/consent_required/); assert.match(apply(A,id(4),'pregnancy',p,'delete',1,{},null),/"deleted": true/); sql(`update public.pregnancy_consent_policies set is_current=false where purpose='pregnancy-processing'`); sql(`update public.pregnancy_consent_policies set is_current=true where purpose='pregnancy-processing' and consent_version='test-v2'`); assert.notEqual(c,grant(A,'test-v2'));
});
test('safe idempotency, RLS, tombstone scrubbing and all entity branches',()=>{
  const c=grant(B,'test-v2'), p=id(10), m=id(11), first=apply(B,m,'pregnancy',p,'upsert','null',{method:'lmp',outcomeNotes:'SECRET'},c); assert.match(first,/"revision": 1/); assert.match(apply(B,m,'pregnancy',p,'upsert','null',{method:'lmp',outcomeNotes:'SECRET'},c),/"status": "replayed"/); assert.match(authErr(B,`select public.apply_pregnancy_sync_mutation('${m}','pregnancy','${p}','upsert',null,${json({method:'dueDate'})},'${c}')`),/mutation_id_conflict/); assert.match(authErr(A,`insert into public.pregnancies(id,user_id,method) values('${id(12)}','${A}','lmp')`),/permission denied/);
  const log=id(13), appt=id(14); apply(B,id(15),'log',log,'upsert','null',{pregnancyId:p,date:'2030-01-02',symptoms:['nausea'],notes:'NOTE'},c); assert.match(apply(B,id(151),'log',log,'upsert',1,{pregnancyId:p,date:'2030-01-03',symptoms:['fatigue'],notes:'UPDATED'},c),/"revision": 2/); apply(B,id(16),'appointment',appt,'upsert','null',{pregnancyId:p,startsAt:'2030-01-02T10:00:00Z',timeZone:'Europe/Copenhagen',title:'visit',notes:'NOTE'},c); assert.match(apply(B,id(161),'appointment',appt,'upsert',1,{pregnancyId:p,startsAt:'2030-01-03T10:00:00Z',timeZone:'Europe/Copenhagen',title:'updated',notes:'UPDATED'},c),/"revision": 2/); apply(B,id(17),'settings',B,'upsert','null',{recoveryDisplayDays:42,privacyMode:false},c); assert.match(apply(B,id(171),'settings',B,'upsert',1,{recoveryDisplayDays:43,privacyMode:true},c),/"revision": 2/); assert.match(authErr(B,`select public.apply_pregnancy_sync_mutation('${id(172)}','settings','${B}','upsert',1,${json({recoveryDisplayDays:44})},'${c}')`),/revision_conflict/);
  apply(B,id(18),'log',log,'delete',2,{},null); apply(B,id(19),'log',id(20),'upsert','null',{pregnancyId:p,date:'2030-01-03',symptoms:[]},c);
  apply(B,id(21),'pregnancy',p,'delete',1,{},null); assert.equal(sql(`select coalesce(method,''),coalesce(outcome_notes,'') from public.pregnancies where id='${p}'`),'|'); assert.equal(sql(`select coalesce(title,''),coalesce(notes,'') from public.pregnancy_appointments where id='${appt}'`),'|'); assert.doesNotMatch(sql(`select coalesce(string_agg(notes,''),'') from public.pregnancy_symptom_logs`),/NOTE|UPDATED/); assert.match(authErr(B,`select public.apply_pregnancy_sync_mutation('${id(22)}','appointment','${appt}','upsert',2,${json({pregnancyId:p,startsAt:'2030-01-02T10:00:00Z',timeZone:'Europe/Copenhagen',title:'again'})},'${c}')`),/parent_unavailable|revision_conflict/);
  assert.equal(sql(`select count(*) from information_schema.columns where table_schema='public' and table_name='pregnancy_mutation_receipts' and column_name='response'`),'0'); assert.doesNotMatch(sql(`select row_to_json(r)::text from public.pregnancy_mutation_receipts r where user_id='${B}'`),/SECRET|NOTE|UPDATED/); assert.doesNotMatch(sql(`select row_to_json(c)::text from public.pregnancy_changes c where user_id='${B}'`),/SECRET|NOTE|UPDATED/); assert.match(authErr(A,`select * from public.pregnancy_mutation_receipts`),/permission denied/);
});
test('ownership, direct-DML and malformed-command boundaries remain closed',()=>{
  const c=grant(A,'test-v2'), cB=grant(B,'test-v2'), root=id(30); apply(A,id(31),'pregnancy',root,'upsert','null',{method:'lmp'},c);
  assert.match(authErr(B,`select public.apply_pregnancy_sync_mutation('${id(32)}','pregnancy','${root}','upsert',null,${json({method:'lmp'})},'${cB}')`),/mutation_rejected|revision_conflict/);
  assert.match(authErr(B,`select public.apply_pregnancy_sync_mutation('${id(33)}','unknown','${id(34)}','upsert',null,'{}'::jsonb,null)`),/invalid_mutation/);
  assert.match(err(`set role anon; select public.pull_pregnancy_sync_state(0,1)`),/permission denied|not_authenticated/);
  for (const table of ['pregnancy_symptom_logs','pregnancy_appointments','pregnancy_settings','health_consents']) assert.match(authErr(A,`delete from public.${table}`),/permission denied/);
  assert.match(authErr(B,`select public.apply_pregnancy_sync_mutation('${id(35)}','log','${id(36)}','upsert',null,${json({pregnancyId:root,date:'2030-01-01',symptoms:['invented']})},'${cB}')`),/parent_unavailable|mutation_rejected/);
});
test('change sequence is ordered, bounded, retryable and owner-bound',()=>{
  const page=auth(B,`select public.pull_pregnancy_sync_state(0,2)`); assert.match(page,/"nextChangeSeq": 2/); assert.equal(auth(B,`select public.pull_pregnancy_sync_state(0,2)`),page); assert.equal(auth(B,`select public.pull_pregnancy_sync_state(999,2)`),'{"changes": [], "nextChangeSeq": 999}'); assert.doesNotMatch(auth(A,`select public.pull_pregnancy_sync_state(0,20)`),/000000000010/);
});
test('concurrent identical retry serializes to one side effect and safe successes',async()=>{
  const c=grant(C,'test-v2'), p=id(40), m=id(41), source=`set role authenticated; set request.jwt.claim.sub='${C}'; select public.apply_pregnancy_sync_mutation('${m}','pregnancy','${p}','upsert',null,${json({method:'lmp'})},'${c}')`;
  const responses=await Promise.all(Array.from({length:6},()=>sqlAsync(source)));
  assert.equal(responses.every((response)=>/"status": "(?:applied|replayed)"/.test(response)),true);
  assert.equal(sql(`select count(*) from public.pregnancies where id='${p}' and user_id='${C}'`),'1');
  assert.equal(sql(`select count(*) from public.pregnancy_mutation_receipts where user_id='${C}' and mutation_id='${m}'`),'1');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Final hostile delta review additions. Each block below was written against a mutant that the first five tests let survive
// (see the review report); users are minted per test so the tests stay independent of one another's state.
const delay=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
const user=(n)=>{const u=`99999999-9999-4999-8999-${String(n).padStart(12,'0')}`;sql(`insert into auth.users values('${u}') on conflict do nothing`);return u;};
const attempt=(who,m,type,e,op,rev,payload,consent)=>authErr(who,`select public.apply_pregnancy_sync_mutation('${m}','${type}','${e}','${op}',${rev},${json(payload)},${consent ? `'${consent}'` : 'null'})`);
const seqOf=(response)=>Number(/"changeSeq": (\d+)/.exec(response)[1]);
const ownRows=(who)=>sql(`select (select count(*) from public.pregnancies where user_id='${who}')||'/'||(select count(*) from public.pregnancy_symptom_logs where user_id='${who}')||'/'||(select count(*) from public.pregnancy_appointments where user_id='${who}')||'/'||(select count(*) from public.pregnancy_settings where user_id='${who}')||'/'||(select count(*) from public.health_consents where user_id='${who}')||'/'||(select count(*) from public.pregnancy_mutation_receipts where user_id='${who}')||'/'||(select count(*) from public.pregnancy_changes where user_id='${who}')||'/'||(select count(*) from public.pregnancy_sync_state where user_id='${who}')`);

test('consent binds to the server policy; withdrawal is per purpose; a stale policy no longer authorises; users cannot author policy',()=>{
  const X=user(1), other=user(2);
  for (const version of ['test-v1','test-v2']) assert.match(authErr(X,`select public.grant_health_consent('marketing-newsletter','${version}')`),/unsupported_consent/); // a supported (and, for v2, CURRENT) version under the wrong PURPOSE
  assert.match(authErr(X,`select public.grant_health_consent('pregnancy-processing','off')`),/unsupported_consent/); // right purpose, unsupported version
  assert.match(authErr(X,`select public.grant_health_consent('pregnancy-processing','test-v1 ')`),/unsupported_consent/);
  assert.match(authErr(X,`select public.grant_health_consent(null,null)`),/unsupported_consent/);
  for (const statement of [`insert into public.pregnancy_consent_policies values('pregnancy-processing','mine',true,true)`,`update public.pregnancy_consent_policies set supported=true,is_current=true`,`delete from public.pregnancy_consent_policies`,`select * from public.pregnancy_consent_policies`]) assert.match(authErr(X,statement),/permission denied/);
  assert.equal(sql(`select count(*) from public.pregnancy_consent_policies where consent_version='mine'`),'0');
  // A consent granted while v1 was current stops authorising once v2 is current.
  sql(`update public.pregnancy_consent_policies set is_current=false where purpose='pregnancy-processing' and supported`); sql(`update public.pregnancy_consent_policies set is_current=true where purpose='pregnancy-processing' and consent_version='test-v1'`);
  const stale=grant(X,'test-v1'), root=id(300); apply(X,id(301),'pregnancy',root,'upsert','null',{method:'lmp'},stale);
  sql(`update public.pregnancy_consent_policies set is_current=false where purpose='pregnancy-processing' and supported`); sql(`update public.pregnancy_consent_policies set is_current=true where purpose='pregnancy-processing' and consent_version='test-v2'`);
  assert.match(attempt(X,id(302),'pregnancy',root,'upsert',1,{method:'conception'},stale),/consent_required/);
  // A retried / second-device grant leaves a sibling row: withdrawing one must withdraw every active consent of the purpose.
  const first=grant(X,'test-v2'), second=grant(X,'test-v2'); assert.notEqual(first,second);
  apply(X,id(303),'pregnancy',root,'upsert',1,{method:'conception'},second);
  auth(X,`select public.withdraw_health_consent('${first}')`);
  assert.equal(sql(`select count(*) from public.health_consents where user_id='${X}' and withdrawn_at is null`),'0');
  assert.match(attempt(X,id(304),'pregnancy',root,'upsert',2,{method:'lmp'},second),/consent_required/);
  assert.match(auth(X,`select public.pull_pregnancy_sync_state(0,100)`),/"entityType": "pregnancy"/); // read/pull is never consent-gated
  assert.match(apply(X,id(305),'pregnancy',root,'delete',2,{},null),/"deleted": true/);
  assert.match(authErr(other,`select public.withdraw_health_consent('${first}')`),/not_authorized/);
  assert.match(attempt(other,id(306),'pregnancy',id(307),'upsert','null',{method:'lmp'},first),/consent_required/);
});

test('another account cannot overwrite, delete or collide with ANY entity class, even with the right id and revision',()=>{
  const victim=user(3), attacker=user(4), cv=grant(victim,'test-v2'), ca=grant(attacker,'test-v2');
  const root=id(310), log=id(311), appt=id(312), mine=id(313);
  apply(victim,id(314),'pregnancy',root,'upsert','null',{method:'lmp',outcomeNotes:'VICTIM-ROOT'},cv);
  apply(victim,id(315),'log',log,'upsert','null',{pregnancyId:root,date:'2030-05-01',symptoms:['nausea'],notes:'VICTIM-LOG'},cv);
  apply(victim,id(316),'appointment',appt,'upsert','null',{pregnancyId:root,startsAt:'2030-05-02T10:00:00Z',timeZone:'Europe/Copenhagen',title:'VICTIM-APPT',notes:'VICTIM-ANOTE'},cv);
  apply(victim,id(317),'settings',victim,'upsert','null',{recoveryDisplayDays:30,privacyMode:true},cv);
  apply(attacker,id(318),'pregnancy',mine,'upsert','null',{method:'lmp'},ca);
  const snapshot=()=>sql(`select (select method||'/'||revision||'/'||coalesce(outcome_notes,'') from public.pregnancies where id='${root}')||'|'||(select coalesce(notes,'')||'/'||revision||'/'||date from public.pregnancy_symptom_logs where id='${log}')||'|'||(select title||'/'||coalesce(notes,'')||'/'||revision from public.pregnancy_appointments where id='${appt}')||'|'||(select recovery_display_days||'/'||privacy_mode||'/'||revision from public.pregnancy_settings where user_id='${victim}')`);
  const before=snapshot(), victimRows=ownRows(victim), attackerChanges=sql(`select count(*) from public.pregnancy_changes where user_id='${attacker}'`);
  const attacks=[
    ['pregnancy',root,'upsert',1,{method:'dueDate',outcomeNotes:'HIJACK'}],['pregnancy',root,'upsert','null',{method:'dueDate',outcomeNotes:'HIJACK'}],['pregnancy',root,'delete',1,{}],
    ['log',log,'upsert',1,{pregnancyId:mine,date:'2030-05-09',symptoms:[],notes:'HIJACK'}],['log',log,'upsert','null',{pregnancyId:mine,date:'2030-05-09',symptoms:[],notes:'HIJACK'}],['log',log,'delete',1,{}],
    ['appointment',appt,'upsert',1,{pregnancyId:mine,startsAt:'2030-05-09T10:00:00Z',timeZone:'UTC',title:'HIJACK'}],['appointment',appt,'upsert','null',{pregnancyId:mine,startsAt:'2030-05-09T10:00:00Z',timeZone:'UTC',title:'HIJACK'}],['appointment',appt,'delete',1,{}],
    ['log',id(319),'upsert','null',{pregnancyId:root,date:'2030-05-10',symptoms:[]}],['appointment',id(320),'upsert','null',{pregnancyId:root,startsAt:'2030-05-10T10:00:00Z',timeZone:'UTC',title:'HIJACK'}],
    ['settings',victim,'upsert',1,{recoveryDisplayDays:1,privacyMode:false}],['settings',victim,'upsert','null',{recoveryDisplayDays:1}],
  ];
  attacks.forEach(([type,entity,op,rev,payload],index)=>{const message=attempt(attacker,id(330+index),type,entity,op,rev,payload,op==='upsert'?ca:null); assert.match(message,/revision_conflict|mutation_rejected|parent_unavailable|not_authorized/,`${type} ${op}`); assert.doesNotMatch(message,new RegExp(`${victim}|VICTIM|HIJACK`));});
  assert.equal(snapshot(),before); assert.equal(ownRows(victim),victimRows); assert.equal(sql(`select count(*) from public.pregnancy_changes where user_id='${attacker}'`),attackerChanges);
  assert.equal(sql(`select count(*) from public.pregnancy_changes where user_id='${attacker}' and entity_id in ('${root}','${log}','${appt}')`),'0');
  for (const table of ['pregnancies','pregnancy_symptom_logs','pregnancy_appointments','pregnancy_settings','health_consents']) assert.equal(auth(attacker,`select count(*) from public.${table} where user_id='${victim}'`),'0',table);
  assert.doesNotMatch(auth(attacker,`select public.pull_pregnancy_sync_state(0,100)`),new RegExp(`${root}|${log}|${appt}`));
  // Mutation ids are scoped per account: reusing the victim's id for the attacker's own valid request neither collides nor reveals it.
  assert.match(apply(attacker,id(315),'pregnancy',mine,'upsert',1,{method:'conception'},ca),/"status": "applied"/);
});

test('a mutation id binds the whole request (payload, entity, type, operation, revision) and key order is irrelevant',()=>{
  const X=user(5), c=grant(X,'test-v2'), root=id(340), m=id(341), body={method:'lmp',outcomeNotes:'n'};
  apply(X,m,'pregnancy',root,'upsert','null',body,c);
  const rows=ownRows(X), changes=()=>sql(`select count(*) from public.pregnancy_changes where user_id='${X}'`), n=changes();
  assert.match(apply(X,m,'pregnancy',root,'upsert','null',body,c),/"status": "replayed"/);
  assert.match(auth(X,`select public.apply_pregnancy_sync_mutation('${m}','pregnancy','${root}','upsert',null,'{"outcomeNotes":"n","method":"lmp"}'::jsonb,'${c}')`),/"status": "replayed"/); // reordered keys
  const same=(over)=>({type:'pregnancy',entity:root,op:'upsert',rev:'null',payload:body,consent:c,...over});
  for (const [name,variant] of Object.entries({payload:same({payload:{method:'lmp',outcomeNotes:'changed'}}),entity:same({entity:id(342)}),type:same({type:'log'}),operation:same({op:'delete'}),revision:same({rev:1}),consent:same({consent:grant(X,'test-v2')})})) {
    assert.match(attempt(X,m,variant.type,variant.entity,variant.op,variant.rev,variant.payload,variant.consent),/mutation_id_conflict/,name);
  }
  assert.equal(changes(),n); assert.equal(ownRows(X).replace(/^(\d+\/\d+\/\d+\/\d+\/)\d+/,'$1'),rows.replace(/^(\d+\/\d+\/\d+\/\d+\/)\d+/,'$1')); // only the extra consent row from the `consent` vector differs
  assert.equal(sql(`select count(*) from public.pregnancy_mutation_receipts where mutation_id='${m}'`),'1');
});

test('log date replacement, root-delete cascade, scrubbing, reconciliation evidence and tombstone dominance',()=>{
  const X=user(6), c=grant(X,'test-v2'), root=id(350), first=id(351), second=id(352), third=id(353), appt=id(354), solo=id(355);
  apply(X,id(356),'pregnancy',root,'upsert','null',{method:'lmp'},c);
  apply(X,id(357),'log',first,'upsert','null',{pregnancyId:root,date:'2030-06-01',symptoms:['nausea'],weightKg:60,notes:'FIRST-NOTE'},c); apply(X,id(358),'log',first,'delete',1,{},null);
  apply(X,id(359),'log',second,'upsert','null',{pregnancyId:root,date:'2030-06-01',symptoms:['fatigue'],weightKg:61,notes:'LIVE-LOG-NOTE'},c); // a deleted day can be logged again
  assert.match(attempt(X,id(360),'log',third,'upsert','null',{pregnancyId:root,date:'2030-06-01',symptoms:[]},c),/mutation_rejected/); // two active logs for one day cannot coexist
  apply(X,id(361),'appointment',appt,'upsert','null',{pregnancyId:root,startsAt:'2030-06-02T10:00:00Z',timeZone:'Europe/Copenhagen',title:'T',notes:'LIVE-APPT-NOTE'},c);
  apply(X,id(362),'appointment',solo,'upsert','null',{pregnancyId:root,startsAt:'2030-06-03T10:00:00Z',timeZone:'Europe/Copenhagen',title:'S',notes:'SOLO-APPT-NOTE'},c); apply(X,id(363),'appointment',solo,'delete',1,{},null);
  assert.equal(sql(`select coalesce(notes,'')||'|'||coalesce(title,'') from public.pregnancy_appointments where id='${solo}'`),'|'); // a single delete scrubs too
  const head=Number(sql(`select max(change_seq) from public.pregnancy_changes where user_id='${X}'`)), del=id(364);
  const deleted=apply(X,del,'pregnancy',root,'delete',1,{},null); assert.match(deleted,/"deleted": true/);
  assert.equal(sql(`select (select count(*) from public.pregnancies where id='${root}' and method is null and outcome_notes is null and lmp_date is null and deleted_at is not null)||'/'||(select count(*) from public.pregnancy_symptom_logs where user_id='${X}' and (notes is not null or symptoms is not null or date is not null or weight_kg is not null) )||'/'||(select count(*) from public.pregnancy_appointments where user_id='${X}' and (notes is not null or title is not null or starts_at is not null or time_zone is not null))||'/'||(select count(*) from public.pregnancy_symptom_logs where user_id='${X}' and deleted_at is not null)||'/'||(select count(*) from public.pregnancy_appointments where user_id='${X}' and deleted_at is not null)`),'1/0/0/2/2');
  assert.equal(sql(`select string_agg(entity_type||':'||deleted,',' order by entity_type) from public.pregnancy_changes where user_id='${X}' and change_seq>${head}`),'appointment:true,log:true,pregnancy:true'); // children are told about in the SAME transaction
  const page=auth(X,`select public.pull_pregnancy_sync_state(${head},100)`); for (const entity of [root,second,appt]) assert.match(page,new RegExp(`"deleted": true, "entityId": "${entity}"`));
  assert.doesNotMatch(page,/FIRST-NOTE|LIVE-LOG-NOTE|LIVE-APPT-NOTE/);
  assert.match(attempt(X,id(365),'log',second,'upsert',3,{pregnancyId:root,date:'2030-06-09',symptoms:[]},c),/parent_unavailable|revision_conflict/); // stale child update
  assert.match(attempt(X,id(366),'log',second,'delete',3,{},null),/revision_conflict/); // stale child delete
  assert.match(attempt(X,id(367),'log',id(368),'upsert','null',{pregnancyId:root,date:'2030-06-10',symptoms:[]},c),/parent_unavailable/); // new child under a deleted root
  assert.match(attempt(X,id(369),'appointment',id(370),'upsert','null',{pregnancyId:root,startsAt:'2030-06-10T10:00:00Z',timeZone:'UTC',title:'x'},c),/parent_unavailable/);
  assert.match(attempt(X,id(371),'pregnancy',root,'upsert',2,{method:'lmp'},c),/revision_conflict/); // tombstone beats a stale upsert
  assert.match(attempt(X,id(372),'pregnancy',root,'upsert','null',{method:'lmp'},c),/revision_conflict/); // ... and a re-create
  assert.match(apply(X,del,'pregnancy',root,'delete',1,{},null),/"status": "replayed"/); assert.match(attempt(X,id(373),'pregnancy',root,'delete',2,{},null),/revision_conflict/);
  assert.equal(sql(`select count(*) from public.pregnancy_symptom_logs where user_id='${X}' and revision<>2 and id='${second}'`),'0');
});

test('serialization is observable: overlapping identical/conflicting retries, rollback without gaps, commit order and per-account independence',async()=>{
  // Every account first commits one mutation, so its sync-state row already exists: the first-ever mutation is serialized by the row insert alone and would hide a missing lock.
  const X=user(7), Y=user(8), Z=user(9), c=grant(X,'test-v2'), cz=grant(Z,'test-v2'), rootX=id(380), rootZ=id(381);
  apply(X,id(382),'pregnancy',rootX,'upsert','null',{method:'lmp'},c); apply(Z,id(383),'pregnancy',rootZ,'upsert','null',{method:'lmp'},cz);
  const as=(who,statements)=>`set role authenticated; set request.jwt.claim.sub='${who}'; ${statements}`;
  const run=(mutation,entity,payload,consent,root)=>`select public.apply_pregnancy_sync_mutation('${mutation}','log','${entity}','upsert',null,${json({pregnancyId:root,symptoms:[],...payload})},'${consent}')`;
  // (a) a rolled-back transaction consumes no sequence number and leaves no receipt
  sql(as(X,`begin; ${run(id(384),id(385),{date:'2030-07-01'},c,rootX)}; rollback;`));
  assert.equal(sql(`select count(*) from public.pregnancy_mutation_receipts where mutation_id='${id(384)}'`),'0'); assert.equal(sql(`select next_change_seq from public.pregnancy_sync_state where user_id='${X}'`),'1');
  // (b) an identical retry that overlaps the first request waits for it and is acknowledged as a replay
  const m=id(386), entity=id(387), hold=sqlAsync(as(X,`begin; ${run(m,entity,{date:'2030-07-02'},c,rootX)}; select pg_sleep(1.6); commit;`)); await delay(600);
  const retry=await sqlAsync(as(X,run(m,entity,{date:'2030-07-02'},c,rootX))); await hold; assert.match(retry,/"status": "replayed"/);
  assert.equal(sql(`select count(*) from public.pregnancy_symptom_logs where id='${entity}'`),'1'); assert.equal(sql(`select count(*) from public.pregnancy_changes where user_id='${X}'`),'2');
  // (c) a conflicting request reusing the id of an in-flight one is a stable conflict, never a second side effect
  const m2=id(388), entity2=id(389), hold2=sqlAsync(as(X,`begin; ${run(m2,entity2,{date:'2030-07-03'},c,rootX)}; select pg_sleep(1.6); commit;`)); await delay(600);
  const conflicting=await sqlAsync(as(X,run(m2,entity2,{date:'2030-07-04'},c,rootX))).then(()=>'unexpected success',(error)=>String(error.message)); await hold2; assert.match(conflicting,/mutation_id_conflict/);
  assert.equal(sql(`select date::text from public.pregnancy_symptom_logs where id='${entity2}'`),'2030-07-03'); assert.equal(sql(`select count(*) from public.pregnancy_changes where user_id='${X}'`),'3');
  // (e) the race window itself: both requests are parked on a table lock AFTER the receipt lookup, then released together. Only the account lock keeps the retry out
  // of the function until the first request has committed; without it the retry would reach the primary key concurrently and be rejected.
  const m3=id(395), entity3=id(396), blocker=sqlAsync(`begin; lock table public.pregnancy_symptom_logs in access exclusive mode; select pg_sleep(1.4); commit;`); await delay(400);
  const first=sqlAsync(as(X,run(m3,entity3,{date:'2030-07-05'},c,rootX))); await delay(250); const second=sqlAsync(as(X,run(m3,entity3,{date:'2030-07-05'},c,rootX)));
  const [,one,two]=await Promise.all([blocker,first,second]); assert.deepEqual([one,two].map((out)=>/"status": "(applied|replayed)"/.exec(out)[1]).sort(),['applied','replayed']); // order-insensitive: whichever reached the lock first applies, the other is acknowledged as a replay
  assert.equal(sql(`select count(*) from public.pregnancy_symptom_logs where id='${entity3}'`),'1'); assert.equal(sql(`select count(*) from public.pregnancy_mutation_receipts where mutation_id='${m3}'`),'1');
  // (d) commit order equals sequence order within an account, and another account is never blocked behind it
  const slow=sqlAsync(as(Z,`begin; ${run(id(390),id(391),{date:'2030-08-01'},cz,rootZ)}; select pg_sleep(1.6); commit; select extract(epoch from clock_timestamp());`)); await delay(500);
  const independent=await sqlAsync(as(X,`select public.apply_pregnancy_sync_mutation('${id(392)}','settings','${X}','upsert',null,'{}'::jsonb,'${c}'); select extract(epoch from clock_timestamp());`));
  const queued=await sqlAsync(as(Z,`${run(id(393),id(394),{date:'2030-08-02'},cz,rootZ)}; select extract(epoch from clock_timestamp());`)); const slowDone=await slow;
  const stamp=(out)=>Number(out.trim().split('\n').pop()); assert.ok(stamp(independent)<stamp(slowDone)-0.3,'another account must not wait for the first account\'s lock');
  assert.ok(seqOf(queued)>seqOf(slowDone),'the later committer gets the higher sequence'); assert.equal(sql(`select string_agg(change_seq::text,',' order by change_seq) from public.pregnancy_changes where user_id='${Z}'`),'1,2,3');
});

test('pull pages are gapless, strictly ordered, bounded and exactly repeatable; no cursor is advanced by an empty page',()=>{
  const X=user(10), c=grant(X,'test-v2'), root=id(400); apply(X,id(401),'pregnancy',root,'upsert','null',{method:'lmp'},c);
  for (let n=0;n<6;n+=1) apply(X,id(410+n),'log',id(420+n),'upsert','null',{pregnancyId:root,date:`2030-08-0${n+1}`,symptoms:[]},c);
  apply(X,id(430),'log',id(420),'delete',1,{},null); // 8 changes, the last one a tombstone
  const seen=[]; let cursor=0;
  for (;;) {
    const raw=auth(X,`select public.pull_pregnancy_sync_state(${cursor},3)`), page=JSON.parse(raw);
    assert.equal(auth(X,`select public.pull_pregnancy_sync_state(${cursor},3)`),raw); // retrying a cursor is exact
    assert.ok(page.changes.length<=3);
    if (!page.changes.length) { assert.equal(page.nextChangeSeq,cursor); break; }
    assert.equal(page.nextChangeSeq,page.changes[page.changes.length-1].changeSeq); seen.push(...page.changes.map((change)=>change.changeSeq)); cursor=page.nextChangeSeq;
  }
  assert.deepEqual(seen,[1,2,3,4,5,6,7,8]); assert.equal(JSON.parse(auth(X,`select public.pull_pregnancy_sync_state(7,100)`)).changes[0].deleted,true);
  assert.match(authErr(X,`select public.pull_pregnancy_sync_state(-1,10)`),/invalid_cursor/); assert.match(authErr(X,`select public.pull_pregnancy_sync_state(null,10)`),/invalid_cursor/);
  assert.equal(JSON.parse(auth(X,`select public.pull_pregnancy_sync_state(0,100000)`)).changes.length,8); assert.equal(JSON.parse(auth(X,`select public.pull_pregnancy_sync_state(0,0)`)).changes.length,1);
});

test('stored shapes and privileges: payload-free ledger/receipts, exact grants, one current overload, no seeded policy, cascade on account deletion',()=>{
  const columns=(table)=>sql(`select string_agg(column_name,',' order by column_name) from information_schema.columns where table_schema='public' and table_name='${table}'`);
  assert.equal(columns('pregnancy_changes'),'change_seq,created_at,deleted,entity_id,entity_type,revision,user_id');
  assert.equal(columns('pregnancy_mutation_receipts'),'deleted,entity_id,entity_type,mutation_id,processed_at,request_hash,resulting_revision,user_id');
  assert.equal(columns('pregnancy_sync_state'),'next_change_seq,user_id');
  const tables=['pregnancies','pregnancy_symptom_logs','pregnancy_appointments','pregnancy_settings','health_consents','pregnancy_mutation_receipts','pregnancy_sync_state','pregnancy_changes','pregnancy_consent_policies'], readable=['pregnancies','pregnancy_symptom_logs','pregnancy_appointments','pregnancy_settings','health_consents'];
  for (const table of tables) { assert.equal(sql(`select relrowsecurity from pg_class where oid='public.${table}'::regclass`),'t',table); for (const role of ['anon','authenticated']) for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) assert.equal(sql(`select has_table_privilege('${role}','public.${table}','${privilege}')`),role==='authenticated'&&privilege==='SELECT'&&readable.includes(table)?'t':'f',`${role} ${privilege} ${table}`); }
  assert.equal(sql(`select string_agg(p.oid::regprocedure::text,' ' order by p.proname) from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like '%pregnancy%' or p.proname like '%health_consent%')`),'apply_pregnancy_sync_mutation(uuid,text,uuid,text,bigint,jsonb,uuid) grant_health_consent(text,text) pull_pregnancy_sync_state(bigint,integer) withdraw_health_consent(uuid)');
  assert.equal(sql(`select string_agg(distinct p.prosecdef::text||':'||coalesce(array_to_string(p.proconfig,','),'')||':'||has_function_privilege('anon',p.oid,'execute')||has_function_privilege('authenticated',p.oid,'execute')||has_function_privilege('public',p.oid,'execute'),'|') from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like '%pregnancy%' or p.proname like '%health_consent%')`),'true:search_path="":falsetruefalse');
  assert.equal(sql(`select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prosrc ~* '(execute\\s+format|execute\\s+''|execute\\s+p_|execute\\s+v_)' and (p.proname like '%pregnancy%' or p.proname like '%health_consent%')`),'0'); // static SQL only
  // Account deletion removes every user-owned row and none of the server-owned policy configuration.
  const X=user(11), c=grant(X,'test-v2'), root=id(440); apply(X,id(441),'pregnancy',root,'upsert','null',{method:'lmp'},c); apply(X,id(442),'log',id(443),'upsert','null',{pregnancyId:root,date:'2030-09-01',symptoms:[]},c); apply(X,id(444),'appointment',id(445),'upsert','null',{pregnancyId:root,startsAt:'2030-09-01T10:00:00Z',timeZone:'UTC',title:'t'},c); apply(X,id(446),'settings',X,'upsert','null',{},c);
  assert.notEqual(ownRows(X),'0/0/0/0/0/0/0/0'); const policies=sql(`select count(*) from public.pregnancy_consent_policies`); sql(`delete from auth.users where id='${X}'`);
  assert.equal(ownRows(X),'0/0/0/0/0/0/0/0'); assert.equal(sql(`select count(*) from public.pregnancy_consent_policies`),policies);
});

test('dates and instants are literal ISO text; malformed input maps to stable, payload-free error codes',()=>{
  let n=500; const next=()=>id(n+=1); const X=user(12), c=grant(X,'test-v2'), root=id(450); apply(X,id(451),'pregnancy',root,'upsert','null',{method:'lmp',lmpDate:'2030-01-01'},c);
  const log=(date)=>attempt(X,next(),'log',next(),'upsert','null',{pregnancyId:root,date,symptoms:[]},c);
  for (const date of ['yesterday','today','tomorrow','now','epoch','infinity','-infinity','20300101','2030-1-1',12345,true,{}]) assert.match(log(date),/invalid_mutation/,String(date));
  assert.match(log('2030-02-30'),/mutation_rejected/);
  for (const startsAt of ['now','today','epoch','infinity','2030-03-01 10:00:00+00',20300301]) assert.match(attempt(X,next(),'appointment',next(),'upsert','null',{pregnancyId:root,startsAt,timeZone:'UTC',title:'t'},c),/invalid_mutation/,String(startsAt));
  assert.match(attempt(X,id(480),'pregnancy',id(481),'upsert','null',{method:'lmp',lmpDate:'yesterday'},c),/invalid_mutation/);
  assert.match(apply(X,id(482),'log',id(483),'upsert','null',{pregnancyId:root,date:'2030-03-03',symptoms:[],notes:null,weightKg:null},c),/"status": "applied"/);
  assert.match(apply(X,id(484),'appointment',id(485),'upsert','null',{pregnancyId:root,startsAt:'2030-03-03T10:00:00.123+02:00',timeZone:'Europe/Copenhagen',title:'t'},c),/"status": "applied"/);
  for (const [type,op,entity,rev,payload] of [[null,'upsert',id(486),'null',{}],['log',null,id(487),'null',{}],['LOG','upsert',id(488),'null',{}],['log','upsert',id(489),-1,{}],['log','upsert',id(490),'null',null],['log','upsert',id(491),'null',{pregnancyId:root,date:'2030-04-01',symptoms:['invented']}],['appointment','upsert',id(492),'null',{pregnancyId:root,startsAt:'2030-04-01T10:00:00Z',timeZone:'  ',title:'t'}]]) {
    const message=authErr(X,`select public.apply_pregnancy_sync_mutation('${id(493)}',${type===null?'null':`'${type}'`},'${entity}',${op===null?'null':`'${op}'`},${rev},${payload===null?'null':json(payload)},'${c}')`);
    assert.match(message,/invalid_mutation|mutation_rejected|parent_unavailable/); assert.doesNotMatch(message,/pregnancy_symptom|pregnancy_appointments|violates|detail|hint|invented/i);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Final micro-delta review additions: exact SQLSTATE contract, one current policy per purpose, IANA zones, strict JSON booleans, final schema parity.
const withState=(who,statement)=>err(`\\set VERBOSITY verbose\nset role authenticated; ${who?`set request.jwt.claim.sub='${who}'; `:''}${statement}`);
const upsertAppt=(who,n,consent,payload,root)=>attempt(who,id(n),'appointment',id(n+1),'upsert','null',{pregnancyId:root,startsAt:'2031-03-01T10:00:00Z',timeZone:'UTC',title:'t',...payload},consent);

test('contract codes: PT428 consent_required, PT401 only for authentication, PT422 for a settings delete',()=>{
  const X=user(20), c=grant(X,'test-v2'), call=(consent)=>`select public.apply_pregnancy_sync_mutation('${id(700)}','pregnancy','${id(701)}','upsert',null,${json({method:'lmp'})},${consent?`'${consent}'`:'null'})`;
  assert.match(withState(X,call(null)),/PT428: consent_required/); assert.match(withState(user(21),call(c)),/PT428: consent_required/); // none / another account's consent
  assert.match(withState(null,call(c)),/PT401: not_authenticated/);
  auth(X,`select public.withdraw_health_consent('${c}')`); assert.match(withState(X,call(c)),/PT428: consent_required/); assert.doesNotMatch(withState(X,call(c)),/PT401/);
  assert.match(withState(X,`select public.apply_pregnancy_sync_mutation('${id(702)}','settings','${X}','delete',1,'{}'::jsonb,null)`),/PT422: invalid_mutation/);
  assert.match(withState(X,`select public.apply_pregnancy_sync_mutation('${id(703)}','settings','${user(22)}','upsert',null,'{}'::jsonb,'${grant(X,'test-v2')}')`),/PT401: not_authorized/);
  assert.match(withState(X,`select public.grant_health_consent('pregnancy-processing','nope')`),/PT422: unsupported_consent/);
});

test('at most one current consent policy per purpose; users cannot edit policy; no production policy is seeded',()=>{
  const policy=(version,supported,current)=>sql(`insert into public.pregnancy_consent_policies values('zz-purpose','${version}',${supported},${current})`);
  try {
    policy('v1',true,true); assert.match(err(`insert into public.pregnancy_consent_policies values('zz-purpose','v2',true,true)`),/pregnancy_consent_policies_one_current/);
    policy('v2',true,false); assert.match(err(`update public.pregnancy_consent_policies set is_current=true where purpose='zz-purpose' and consent_version='v2'`),/pregnancy_consent_policies_one_current/);
    sql(`update public.pregnancy_consent_policies set is_current=false where purpose='zz-purpose' and consent_version='v1'; update public.pregnancy_consent_policies set is_current=true where purpose='zz-purpose' and consent_version='v2'`);
    sql(`insert into public.pregnancy_consent_policies values('zz-other','v1',true,true)`); // one current per PURPOSE, not globally
    assert.match(err(`insert into public.pregnancy_consent_policies values('zz-third','v1',false,true)`),/pregnancy_consent_policies_current_supported/);
    assert.equal(sql(`select count(*) from public.pregnancy_consent_policies where purpose in ('zz-purpose','zz-other') and is_current`),'2');
    assert.match(authErr(user(23),`update public.pregnancy_consent_policies set is_current=true where purpose='zz-purpose'`),/permission denied/);
  } finally { sql(`delete from public.pregnancy_consent_policies where purpose like 'zz-%'`); }
});

test('appointment zones must be IANA names known to PostgreSQL; JSON booleans are strict; final schema keeps the v1.1 constraints',()=>{
  const X=user(24), c=grant(X,'test-v2'), root=id(710); apply(X,id(711),'pregnancy',root,'upsert','null',{method:'lmp'},c); let n=720;
  const ok=(over)=>{n+=2;return apply(X,id(n),'appointment',id(n+1),'upsert','null',{pregnancyId:root,startsAt:'2031-03-01T10:00:00Z',timeZone:'UTC',title:'t',...over},c);}, bad=(over)=>{n+=2;return upsertAppt(X,n,c,over,root);};
  for (const timeZone of ['Europe/Copenhagen','UTC','America/New_York','Etc/GMT+1']) assert.match(ok({timeZone}),/"status": "applied"/,timeZone);
  for (const timeZone of ['Mars/Phobos','foo','','   ','europe/copenhagen','Factory','+02:00','UTC+2',null,5]) assert.match(bad({timeZone}),/invalid_mutation/,String(timeZone));
  for (const key of ['completed','reminderEnabled']) { for (const value of [true,false]) assert.match(ok({[key]:value}),/"status": "applied"/); for (const value of ['true','false','yes','on',1,0,null,{},[]]) assert.match(bad({[key]:value}),/invalid_mutation/,`${key}=${JSON.stringify(value)}`); }
  let revision=null; for (const value of [true,false]) { assert.match(apply(X,id(n+=2),'settings',X,'upsert',revision===null?'null':revision,{privacyMode:value},c),/"status": "applied"/); revision=Number(sql(`select revision from public.pregnancy_settings where user_id='${X}'`)); }
  for (const value of ['true','false','yes',1,0,null,{},[]]) assert.match(attempt(X,id(n+=2),'settings',X,'upsert',revision,{privacyMode:value},c),/invalid_mutation/,`privacyMode=${JSON.stringify(value)}`);
  // the stored row is constrained at the table too, not only in the command (v1.1 Appendix E)
  assert.match(err(`insert into public.pregnancies(id,user_id,method) values('${id(790)}','${X}','bogus')`),/pregnancies_method_check/);
  assert.match(err(`insert into public.pregnancies(id,user_id,method,outcome) values('${id(791)}','${C}','lmp','birth')`),/pregnancies_active_shape/);
  assert.match(err(`insert into public.pregnancies(id,user_id,method,due_date_source) values('${id(792)}','${C}','lmp','nobody')`),/due_date_source/);
  assert.match(err(`insert into public.pregnancies(id,user_id,method,ended_at,outcome) values('${id(793)}','${C}','lmp',now(),'zzz')`),/pregnancies_outcome_check/);
  assert.equal(sql(`select string_agg(table_name||'.'||column_name||':'||is_nullable,',' order by table_name,column_name) from information_schema.columns where table_schema='public' and table_name='pregnancy_mutation_receipts' and column_name in ('entity_id','resulting_revision','entity_type') and (is_nullable='YES' or column_default is not null)`),'');
});
