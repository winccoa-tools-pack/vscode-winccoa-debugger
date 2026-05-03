// call_library_function.ctl
// Manager -num 4   Mode: manual   Flags: -dbg CTRL_DEBUGBREAK
// STOP_LINE = 11  (DebugBreak)   BP_MAIN_LINE = 14  (sum = add_two_integers)

#uses "debugger_lib"

main()
{
  int counter = 0;
  int sum = 0;
  DebugBreak();           // line 11 — stop-on-entry: lib already loaded via #uses

  while (true)
  {
    sum = add_two_integers(counter, 10);  // line 14 — BP_MAIN_LINE
    //DebugN("call_library_function: sum = " + sum);
    counter++;
    delay(1);
  }
}
