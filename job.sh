#!/bin/bash
# One-shot, resumable Facebook outcome calibration. Cron checks every 15
# minutes, but the gate starts after the owner's weekly Codex reset and retries
# no more than once per five-hour window.
set -uo pipefail
APP_ID="${1:-}"
DATA_DIR="${DATA_DIR:-/data}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_ROOT="${CARE_GAP_PROJECT_ROOT:-$DATA_DIR/projects/d7b1ff82-0ea2-5a07-8f4b-d538f501ab31}"
STATE_DIR="$PROJECT_ROOT/data/outcome-pilot"
RETRY_STATE_DIR="$PROJECT_ROOT/data/outcome-pilot-retry"
RUNNER="$SCRIPT_DIR/scripts/outcome_pilot.py"
LOCK="$STATE_DIR/.run.lock"
SCHEDULE_STATE="$STATE_DIR/schedule.json"
LOG_DIR="${APP_JOB_STATE_DIR:-$DATA_DIR/apps/${APP_ID:-unknown}/job-state}"
LOG="$LOG_DIR/outcome-pilot.log"
FIRST_DUE_EPOCH=1791180900  # 2026-10-05 08:15 Europe/Berlin / 06:15 UTC
INTERVAL_SECONDS=18000
mkdir -p "$STATE_DIR" "$LOG_DIR"
log() { echo "[$(date -Iseconds)] care-gap-outcomes: $*" >>"$LOG"; }
if [[ ! "$APP_ID" =~ ^[0-9]+$ ]] || [[ ! -f "$RUNNER" ]]; then log "ERROR valid app id and runner required"; exit 2; fi
if python3 - "$SCHEDULE_STATE" <<'PY'
import json,pathlib,sys
try: disabled=bool(json.loads(pathlib.Path(sys.argv[1]).read_text()).get('collection_disabled'))
except Exception: disabled=False
raise SystemExit(0 if disabled else 1)
PY
then exit 0; fi
exec 9>"$LOCK"
if ! flock -n 9; then log "another pilot run owns the lock; skipping"; exit 5; fi
read -r NEXT_DUE COMPLETE RETRY_DUE RETRY_COMPLETE RETRY_CANCELLED < <(python3 - "$SCHEDULE_STATE" "$STATE_DIR/summary.json" "$RETRY_STATE_DIR/summary.json" "$FIRST_DUE_EPOCH" <<'PY'
import json,pathlib,sys
schedule=pathlib.Path(sys.argv[1]); summary=pathlib.Path(sys.argv[2]); retry_summary=pathlib.Path(sys.argv[3]); default=int(sys.argv[4])
try: state=json.loads(schedule.read_text())
except Exception: state={}
try: complete=bool(json.loads(summary.read_text()).get('complete'))
except Exception: complete=False
try: retry_complete=bool(json.loads(retry_summary.read_text()).get('complete'))
except Exception: retry_complete=False
print(int(state.get('next_due_epoch',default)),'1' if complete else '0',int(state.get('second_pass_due_epoch',2**62)),'1' if retry_complete else '0','1' if state.get('second_pass_cancelled') else '0')
PY
)
NOW="$(date +%s)"
PASS=1
RUN_STATE_DIR="$STATE_DIR"
STATE_DIR_NAME="outcome-pilot"
RUN_DUE="$NEXT_DUE"
if [[ "$COMPLETE" == "1" ]]; then
  [[ "$RETRY_CANCELLED" == "1" ]] && exit 0
  [[ "$RETRY_COMPLETE" == "1" ]] && exit 0
  (( NOW < RETRY_DUE )) && exit 0
  PASS=2
  RUN_STATE_DIR="$RETRY_STATE_DIR"
  STATE_DIR_NAME="outcome-pilot-retry"
  RUN_DUE="$RETRY_DUE"
else
  (( NOW < NEXT_DUE )) && exit 0
fi
python3 - "$SCHEDULE_STATE" "$RUN_DUE" "$NOW" "$INTERVAL_SECONDS" "$PASS" <<'PY'
import datetime as dt,json,os,pathlib,sys,tempfile
p=pathlib.Path(sys.argv[1]); due=int(sys.argv[2]); now=int(sys.argv[3]); step=int(sys.argv[4]); run_pass=int(sys.argv[5])
while due <= now: due += step
try: state=json.loads(p.read_text())
except Exception: state={}
due_fields = ({'next_due_epoch':due,'next_due_utc':dt.datetime.fromtimestamp(due,dt.timezone.utc).isoformat()}
              if run_pass == 1 else
              {'second_pass_due_epoch':due,'second_pass_due_utc':dt.datetime.fromtimestamp(due,dt.timezone.utc).isoformat()})
state.update({'pilot':'60-case Facebook outcome calibration','timezone':'Europe/Berlin','last_attempt_started_utc':dt.datetime.now(dt.timezone.utc).isoformat(), **due_fields})
p.parent.mkdir(parents=True,exist_ok=True)
fd,tmp=tempfile.mkstemp(prefix=p.name+'.',dir=p.parent)
with os.fdopen(fd,'w') as f: json.dump(state,f,indent=2); f.write('\n')
os.replace(tmp,p)
PY
export CODEX_HOME="${CODEX_HOME:-$DATA_DIR/cli-auth/codex}"
export DATA_DIR PROJECT_ROOT APP_ID
RC=0
for ATTEMPT in $(seq 1 6); do
  timeout --signal=TERM --kill-after=60 3600 python3 "$RUNNER" --project-root "$PROJECT_ROOT" --state-dir-name "$STATE_DIR_NAME" --batch-size 10 >>"$LOG" 2>&1
  RC=$?
  read -r COMPLETE DONE FIVE WEEKLY ERROR < <(python3 - "$RUN_STATE_DIR/summary.json" <<'PY'
import json,pathlib,sys
try: p=json.loads(pathlib.Path(sys.argv[1]).read_text())
except Exception: p={}
u=p.get('usage_after') or {}; err=str(p.get('last_error') or '-').replace(' ','_')[:160]
print('1' if p.get('complete') else '0',int(p.get('records_completed',0)),u.get('five_hour_used_percent',-1),u.get('weekly_used_percent',-1),err)
PY
  )
  log "step=$ATTEMPT rc=$RC completed=$DONE five_hour=$FIVE weekly=$WEEKLY error=$ERROR"
  [[ "$RC" != "0" || "$COMPLETE" == "1" ]] && break
  if python3 - "$FIVE" "$WEEKLY" <<'PY'
import sys
def n(v):
  try: return float(v)
  except ValueError: return -1
raise SystemExit(0 if n(sys.argv[1]) >= 85 or n(sys.argv[2]) >= 85 else 1)
PY
  then log "allowance threshold reached; preserving the last completed record"; break; fi
done
python3 - "$SCHEDULE_STATE" "$RC" "$RUN_STATE_DIR/summary.json" "$PASS" <<'PY'
import datetime as dt,json,os,pathlib,sys,tempfile
p=pathlib.Path(sys.argv[1]); rc=int(sys.argv[2]); summary=pathlib.Path(sys.argv[3]); run_pass=int(sys.argv[4])
try: state=json.loads(p.read_text())
except Exception: state={}
try: result=json.loads(summary.read_text())
except Exception: result={}
fields={'last_attempt_finished_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'last_exit_code':rc}
if run_pass == 1:
  fields.update({'complete':bool(result.get('complete')),'records_completed':int(result.get('records_completed',0))})
else:
  fields.update({'second_pass_complete':bool(result.get('complete')),'second_pass_records_completed':int(result.get('records_completed',0))})
state.update(fields)
fd,tmp=tempfile.mkstemp(prefix=p.name+'.',dir=p.parent)
with os.fdopen(fd,'w') as f: json.dump(state,f,indent=2); f.write('\n')
os.replace(tmp,p)
PY
log "finished pass=$PASS rc=$RC"
exit "$RC"
