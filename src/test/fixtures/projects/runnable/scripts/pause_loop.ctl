// pause_loop.ctl
// Pause (interrupt) integration test script.
// Manager -num 7   Mode: manual   Flags: -dbg CTRL_DEBUGBREAK
//
// Expected stop at DebugBreak() on line 22.
// (Without -dbg CTRL_DEBUGBREAK, DebugBreak() is a no-op.)
//
// Test flow:
//   1. Start manager -num 7 (manual — started by the test)
//   2. Script calls DebugBreak() → WinCC OA pauses, stopState captured
//   3. Attach with stopOnEntry=true → stopped event received
//   4. Continue → script enters while(true) loop; stopState retained
//   5. Pause → adapter uses stopState for 'script N + thread N' + 'b'
//
// STOP_LINE = 22  (DebugBreak())

main()
{
  int counter = 0;
  int running = 1;

  DebugBreak();           // line 22 — stop-on-entry point

  while (running)
  {
    counter++;
    delay(1);
  }
}
