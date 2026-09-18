"""Explicit Windows-only 65 s no-provider stress, separate from normal pytest.

Run with --output-dir NEW_DIRECT_CHILD_OF_RESEARCH_RUNS. A real Node child
continuously reads immutable heartbeats and calls the real provider host checker
while a Python reader intentionally holds Windows handles without
FILE_SHARE_DELETE. Publication must not overwrite a held destination.
No credentials, provider, ledger, global power settings, or old artifacts are read.
"""
import argparse
import importlib.util
import json
import sys
import threading
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/local_run_guard.py"
SPEC = importlib.util.spec_from_file_location("local_run_guard", SCRIPT)
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)

NODE_READER = r"""
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { assertResearchHostReady } = require('./services/goalspec-runtime/provider.ts');
const directory = process.env.GOALSPEC_HOST_STATUS_FILE;
const start = performance.now();
let attempts=0, valid=0, parseErrors=0, invalid=0, stale=0, maxAgeMs=0, maximumSequence=0, hostCheckPassed=0, hostCheckFailed=0;
const readErrors = {};
function tick() {
  for (let i=0; i<20; i++) {
    attempts++;
    try { assertResearchHostReady(); hostCheckPassed++; } catch { hostCheckFailed++; }
    let raw;
    try {
      const name=fs.readdirSync(directory).filter(name=>/^\d{16}\.json$/.test(name)).sort().at(-1);
      raw=fs.readFileSync(path.join(directory,name),'utf8');
    }
    catch(error) { const code=String(error.code || 'unknown'); readErrors[code]=(readErrors[code]||0)+1; continue; }
    let status;
    try { status=JSON.parse(raw); } catch { parseErrors++; continue; }
    const age=Date.now()-status.observedAtUnixMs;
    maxAgeMs=Math.max(maxAgeMs,age);
    maximumSequence=Math.max(maximumSequence,status.heartbeatSequence);
    if(status.healthy!==true || status.state!=='healthy' || status.networkConnected!==true) invalid++;
    else if(age < -1000 || age > Math.min(status.maxStatusAgeMs,3000)) stale++;
    else valid++;
  }
  if(performance.now()-start<65000) return setTimeout(tick,1);
  const result={durationMs:performance.now()-start,attempts,valid,parseErrors,invalid,stale,maxAgeMs,maximumSequence,readErrors,hostCheckPassed,hostCheckFailed,providerCalls:0};
  fs.writeFileSync(path.join(path.dirname(directory),'node-reader-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({event:'node_reader_stress_completed',...result}));
  process.exitCode=(parseErrors||invalid||stale||hostCheckFailed||Object.keys(readErrors).length)?1:0;
}
tick();
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    output = guard.safe_output(root, args.output_dir)
    stopping = threading.Event()
    locks = {"successfulHolds": 0, "openFailures": 0, "changedWhileHeld": 0}

    def reader_without_delete_sharing():
        while not stopping.is_set():
            try:
                # CPython's Windows CRT file handle allows reads/writes but does
                # not share deletion. Node can read; replacing this path would fail.
                publications = sorted((output / "status").glob("*.json"))
                if not publications:
                    stopping.wait(0.01)
                    continue
                with publications[-1].open("rb") as reader:
                    before = reader.read()
                    locks["successfulHolds"] += 1
                    stopping.wait(0.03)
                    reader.seek(0)
                    if reader.read() != before:
                        locks["changedWhileHeld"] += 1
            except OSError:
                locks["openFailures"] += 1
            stopping.wait(0.01)

    locker = threading.Thread(target=reader_without_delete_sharing)
    locker.start()
    try:
        code = guard.run_guard(["node", "--import", "tsx", "-e", NODE_READER], output, host=guard.WindowsHost(),
                               interval=0.1, gap=5, root=root)
    finally:
        stopping.set()
        locker.join()
    events = [json.loads(line) for line in (output / "events.jsonl").read_text().splitlines()]
    reader = json.loads((output / "node-reader-result.json").read_text())
    recovered = [event for event in events if event["event"] == "status_publish_recovered"]
    failures = [event for event in events if event["event"] in {"status_publish_failed", "guard_failed"}]
    heartbeats = [event for event in events if event["event"] == "heartbeat"]
    files = sorted((output / "status").glob("*.json"))
    verified_publications = 0
    for event, file in zip(heartbeats, files, strict=True):
        saved = json.loads(file.read_text())
        expected = {key: value for key, value in event.items() if key not in {"event", "statusFile"}}
        if event["statusFile"] == file.name and saved == expected:
            verified_publications += 1
    complete = len(files) == verified_publications == len(heartbeats)
    no_temporary = not list((output / "status").glob("*.next"))
    final = events[-1]
    passed = (code == 0 and reader["durationMs"] >= 60_000 and reader["attempts"] > 1000
              and reader["parseErrors"] == reader["invalid"] == reader["stale"] == 0
              and not reader["readErrors"] and reader["hostCheckFailed"] == 0
              and reader["hostCheckPassed"] == reader["attempts"]
              and locks["successfulHolds"] > 100 and locks["changedWhileHeld"] == 0
              and complete and no_temporary and not failures
              and final["executionStateReleased"] and not final["degradedDuringRun"])
    result = {"passed": passed, "guardExitCode": code, "reader": reader, "noDeleteShareReader": locks,
              "publicationMode": "immutable_sequence_directory", "publicationFiles": len(files),
              "verifiedPublicationsAgainstEvents": verified_publications, "noTemporaryFilesRemain": no_temporary,
              "recoveredUniquePublicationConflicts": len(recovered),
              "observedRecoveryWinerrors": sorted({event["lastError"]["winerror"] for event in recovered}),
              "maximumRecoveryMs": max((event["elapsedMs"] for event in recovered), default=0),
              "terminalWriteFailures": len(failures), "guardFinal": final, "providerCalls": 0}
    with (output / "stress-verification.json").open("x", encoding="utf-8") as target:
        json.dump(result, target, indent=2)
        target.write("\n")
    print(json.dumps(result), flush=True)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
