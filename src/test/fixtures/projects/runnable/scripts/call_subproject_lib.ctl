// call_subproject_lib.ctl
// Manager -num 10   Mode: manual   Flags: -dbg CTRL_DEBUGBREAK
// Tests breakpoints in libraries from the sub-project (pvss_path).
// DebugBreak at line 13, WinCC OA stops at line 15.  BP_MAIN_LINE = 17.
// Also validates auto-creation of _CtrlDebug_CTRL_10 (manager ≥10).

#uses "sub_math"

main()
{
  int counter = 0;
  int result = 0;
  DebugBreak();           // line 13 — stop-on-entry: sub_math already loaded via #uses

  while (true)            // line 15 — WinCC OA reports stop here (STOP_LINE)
  {
    result = sub_multiply_add(counter, 7);  // line 17 — BP_MAIN_LINE
    counter++;
    delay(1);
  }
}
