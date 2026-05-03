// call_multi_libs.ctl
// Manager -num 8   Mode: manual   Flags: -dbg CTRL_DEBUGBREAK
// Tests: BPs in multiple libs + nested lib depth (lib-calls-lib)
//
// #uses:
//   math_lib    → multiply_two(a, b)
//   nested_lib  → add_then_double(a, b)  → internally calls debugger_lib.add_two_integers
//
// Key lines:
//   line 22: DebugBreak()  (WinCC OA reports stop at line 24 = while)
//   line 26: result1 = multiply_two(counter, 5)       ← BP_MULTI_MAIN (math_lib call)
//   line 27: result2 = add_then_double(counter, 3)     ← BP_MULTI_NESTED (nested_lib call)

#uses "math_lib"
#uses "nested_lib"

main()
{
  int counter = 0;
  int result1 = 0;
  int result2 = 0;
  DebugBreak();           // line 22 — stop-on-entry: all libs loaded via #uses

  while (true)
  {
    result1 = multiply_two(counter, 5);       // line 26 — BP_MULTI_MAIN
    result2 = add_then_double(counter, 3);    // line 27 — BP_MULTI_NESTED
    counter++;
    delay(1);
  }
}
