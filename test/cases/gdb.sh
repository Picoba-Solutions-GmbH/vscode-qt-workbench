# Breakpoints added while the program runs, for a gdb that can't stop it itself: which
# sessions get help (gdb/launch.js), when the program is stopped (gdb/interrupt-tracker.js),
# and the helper that stops it (gdb/break-helper.js). Against a real gdb and application:
# test/real-gdb.js, by hand.

EXT="$(native_path "${EXT_DIR:-$TEST_DIR/..}")"

# launch_says <JavaScript expression>: its JSON value, with `l` = gdb/launch.js.
launch_says() {
  "${RUNTIME[@]}" -e 'const l = require(process.argv[1]); Promise.resolve(eval(process.argv[2])).then((v) => console.log(JSON.stringify(v)))' \
    "$EXT/src/gdb/launch.js" "$1"
}

echo "== which gdb needs help =="
check "Qt's MinGW gdb" "$(launch_says 'l.parseGdbVersion("GNU gdb (GDB) 11.2\nCopyright (C) 2022 Free Software Foundation, Inc.")')" \
  '{"major":11,"minor":2,"text":"GNU gdb (GDB) 11.2"}'
check "a build number before the version" "$(launch_says 'l.parseGdbVersion("GNU gdb (GDB; JetBrains IDE bundle; build 262) 17.1\r\n").major')" "17"
check "a vendor with digits in its name" "$(launch_says 'l.parseGdbVersion("GNU gdb (GDB for MinGW-W64 x86_64, built by Brecht Sanders) 13.2").minor')" "2"
check "not gdb" "$(launch_says 'l.parseGdbVersion("lldb version 17.0.6")')" "null"
check "gdb 11 and 14 get help, 15 and no version do not" \
  "$(launch_says '[11, 14, 15, 17].map((major) => l.needsInterrupt({ major, minor: 1 })).concat(l.needsInterrupt(null))')" "[true,true,false,false,false]"
check "a cppdbg gdb session on Windows: its miDebuggerPath" \
  "$(launch_says 'l.localGdb({ type: "cppdbg", MIMode: "gdb", miDebuggerPath: "C:/Qt/Tools/mingw1310_64/bin/gdb.exe" }, "win32")')" '"C:/Qt/Tools/mingw1310_64/bin/gdb.exe"'
check "no miDebuggerPath: the gdb on PATH" "$(launch_says 'l.localGdb({ type: "cppdbg" }, "win32")')" '"gdb"'
check "left alone: other systems, lldb, remote gdb, cores, other debuggers" \
  "$(launch_says '[
    l.localGdb({ type: "cppdbg", MIMode: "gdb" }, "linux"),
    l.localGdb({ type: "cppdbg", MIMode: "lldb" }, "win32"),
    l.localGdb({ type: "cppdbg", miDebuggerServerAddress: "localhost:1234" }, "win32"),
    l.localGdb({ type: "cppdbg", pipeTransport: {} }, "win32"),
    l.localGdb({ type: "cppdbg", coreDumpPath: "core" }, "win32"),
    l.localGdb({ type: "cppvsdbg" }, "win32")
  ]')" "[null,null,null,null,null,null]"
check "--version is asked once per gdb" \
  "$(launch_says '(async () => { let runs = 0; const run = async () => { runs++; return "GNU gdb (GDB) 11.2"; }; const a = await l.readGdbVersion("no/such/gdb.exe", run); const b = await l.readGdbVersion("no/such/gdb.exe", run); return [a.major, b.major, runs]; })()')" "[11,11,1]"
check "a gdb that doesn't run has no version" \
  "$(launch_says 'l.readGdbVersion("no/other/gdb.exe", async () => { throw new Error("ENOENT"); })')" "null"
check "setupCommands: gdb ignores Ctrl+C, after the configuration's own commands" \
  "$(launch_says 'l.withSigintIgnored({ name: "x", setupCommands: [{ text: "-enable-pretty-printing" }] }).setupCommands.map((c) => c.text + " " + !!c.ignoreFailures)')" \
  '["-enable-pretty-printing false","handle SIGINT nostop noprint nopass true"]'
check "added once" "$(launch_says '(() => { const once = l.withSigintIgnored({}); return [once.setupCommands.length, l.withSigintIgnored(once) === once]; })()')" "[1,true]"

# track <JSON steps>: a session's messages through the tracker; see test/interrupt-tracker.js.
track() {
  LAST="$WORK/last-track.log"
  "${RUNTIME[@]}" "$TEST_DIR/interrupt-tracker.js" "$1" > "$LAST" 2>&1
}
# What a step printed, without the helper's state questions: those repeat as long as it waits.
acted() {
  step "$1" | sed 's/helper: state 42\( (32-bit)\)*;//g'
}
PROCESS='{"event":"process","body":{"systemProcessId":42,"pointerSize":64}}'
STOPPED_FOR='does not stop it itself;'

echo "== when the running program is stopped for gdb =="
track "[$PROCESS, {\"request\":\"setBreakpoints\",\"seq\":5}, {\"wait\":201}]"
check "a breakpoint change unanswered while the program runs: stopped" "$(acted '"wait":201')" \
  "helper: break 42;log: stopped the running program (pid 42) for setBreakpoints: gdb 11.2 $STOPPED_FOR"
check "only after asking whether it still runs" "$(step '"seq":5')" "helper: state 42;"

track "[$PROCESS, {\"request\":\"setBreakpoints\",\"seq\":5}, {\"wait\":11}, {\"response\":\"setBreakpoints\",\"seq\":5}, {\"wait\":202}]"
check "answered in time: left alone" "$(acted '"wait":11')$(acted '"wait":202')" ""

track "[$PROCESS, {\"program\":\"stopped\"}, {\"request\":\"setBreakpoints\",\"seq\":5}, {\"wait\":203}]"
check "the program stops (a gdb that stops it itself): left alone" "$(step '"seq":5')$(step '"wait":203')" "helper: state 42;"

track "[$PROCESS, {\"program\":\"gone\"}, {\"request\":\"setBreakpoints\",\"seq\":5}, {\"wait\":204}]"
check "the program is gone: left alone, not logged" "$(step '"seq":5')$(step '"wait":204')" "helper: state 42;"

track "[$PROCESS, {\"event\":\"stopped\",\"body\":{\"reason\":\"breakpoint\"}}, {\"request\":\"setBreakpoints\",\"seq\":5}, {\"wait\":205}]"
check "stopped at a breakpoint: nothing asked" "$(step '"seq":5')$(step '"wait":205')" ""

track "[{\"request\":\"setBreakpoints\",\"seq\":1}, {\"wait\":206}]"
check "before the program starts: nothing asked" "$(step '"seq":1')$(step '"wait":206')" ""

track "[$PROCESS, {\"event\":\"exited\",\"body\":{\"exitCode\":0}}, {\"request\":\"setBreakpoints\",\"seq\":5}, {\"wait\":207}]"
check "after it exited: nothing asked" "$(step '"seq":5')$(step '"wait":207')" ""

track "[$PROCESS, {\"request\":\"evaluate\",\"seq\":5}, {\"request\":\"threads\",\"seq\":6}, {\"wait\":208}]"
check "other requests: nothing asked" "$(step '"seq":5')$(step '"seq":6')$(step '"wait":208')" ""

track "[$PROCESS, {\"request\":\"pause\",\"seq\":7}, {\"wait\":12}, {\"response\":\"pause\",\"seq\":7}, {\"wait\":209}]"
check "Pause is answered at once but waits for the stop: stopped" "$(acted '"wait":12')$(acted '"wait":209')" \
  "helper: break 42;log: stopped the running program (pid 42) for pause: gdb 11.2 $STOPPED_FOR"

track "[$PROCESS, {\"request\":\"pause\",\"seq\":7}, {\"response\":\"pause\",\"seq\":7}, {\"event\":\"stopped\",\"body\":{\"reason\":\"pause\"}}, {\"wait\":210}]"
check "Pause followed by the stop: left alone" "$(acted '"wait":210')" ""

track "[$PROCESS, {\"request\":\"setBreakpoints\",\"seq\":1}, {\"request\":\"setBreakpoints\",\"seq\":2}, {\"request\":\"setExceptionBreakpoints\",\"seq\":3}, {\"wait\":211}]"
check "several requests at once: stopped once" "$(acted '"wait":211')" \
  "helper: break 42;log: stopped the running program (pid 42) for setBreakpoints, setExceptionBreakpoints: gdb 11.2 $STOPPED_FOR"

track "[$PROCESS, {\"event\":\"stopped\",\"body\":{\"reason\":\"breakpoint\"}}, {\"response\":\"continue\",\"seq\":9}, {\"request\":\"setBreakpoints\",\"seq\":10}, {\"wait\":212}]"
check "running again after Continue" "$(acted '"wait":212')" \
  "helper: break 42;log: stopped the running program (pid 42) for setBreakpoints: gdb 11.2 $STOPPED_FOR"

track "[$PROCESS, {\"event\":\"stopped\",\"body\":{\"reason\":\"breakpoint\"}}, {\"response\":\"continue\",\"seq\":9,\"success\":false}, {\"request\":\"setBreakpoints\",\"seq\":10}, {\"wait\":213}]"
check "not after a Continue that failed" "$(step '"seq":10')$(step '"wait":213')" ""

track '[{"event":"process","body":{"systemProcessId":42,"pointerSize":32}}, {"request":"setBreakpoints","seq":5}, {"wait":214}]'
check "a 32-bit program: the 32-bit helper" "$(acted '"wait":214')" \
  "helper: break 42 (32-bit);log: stopped the running program (pid 42) for setBreakpoints: gdb 11.2 $STOPPED_FOR"

track "[$PROCESS, {\"program\":\"error Add-Type is blocked\"}, {\"request\":\"setBreakpoints\",\"seq\":1}, {\"wait\":215}, {\"request\":\"setBreakpoints\",\"seq\":2}, {\"wait\":216}]"
check "a helper that fails is logged once" "$(grep -c '^  log: ! could not stop the running program for setBreakpoints, breakpoints added while it runs may not bind: Add-Type is blocked$' "$LAST")" "1"

# helper_says <fake helper argument, or ""> <async JavaScript body>: its JSON value, with
# `h` a BreakHelper running fake-break-helper.js and `bits` the sizes it was started for.
helper_says() {
  "${RUNTIME[@]}" -e '
    const { BreakHelper } = require(process.argv[1]);
    const bits = [];
    const h = new BreakHelper({ launch: (b) => { bits.push(b); return { command: process.execPath, args: [process.argv[2], process.argv[3]].filter(Boolean) }; } });
    (async () => eval("(async () => {" + process.argv[4] + "})()"))()
      .then((v) => console.log(JSON.stringify(v)), (e) => console.log("threw " + e.message))
      .finally(() => h.dispose());
  ' "$EXT/src/gdb/break-helper.js" "$(native_path "$TEST_DIR/fake-break-helper.js")" "$1" "$2"
}

echo "== the helper process =="
check "ready, and answers in the order asked" \
  "$(helper_says "" 'return [await h.start(), ...(await Promise.all([h.state(1), h.breakInto(2), h.state(3)]))];')" '[null,"running","break","running"]'
check "one process per program size" "$(helper_says "" 'await h.state(1, 32); await h.state(1); await h.state(2, 64); return bits;')" "[32,64]"
check "a helper that can't start: what it said, for every request" \
  "$(helper_says "Add-Type is blocked" 'return [await h.start(), await h.breakInto(1)];')" '["Add-Type is blocked","error Add-Type is blocked"]'
check "a helper that exits: an error, then and afterwards" \
  "$(helper_says "" 'return [await h.state(666), await h.state(1)];')" '["error the helper exited with code 3","error the helper exited with code 3"]'

if [ "${OS:-}" = "Windows_NT" ]; then
  echo "== break-helper.ps1 =="
  check "starts, sees this runtime running and a missing process gone" \
    "$("${RUNTIME[@]}" -e '
      const { BreakHelper } = require(process.argv[1]);
      const h = new BreakHelper();
      (async () => [await h.start(), await h.state(process.pid), await h.state(2147483000)])()
        .then((v) => console.log(JSON.stringify(v))).finally(() => h.dispose());
    ' "$EXT/src/gdb/break-helper.js")" '[null,"running","gone"]'
fi
